import { Command } from './types.js';
import { VpsRepository } from '../../db/repositories/vpsRepository.js';
import { UserRepository } from '../../db/repositories/userRepository.js';
import { NodeAgentClient } from '../../agent/client.js';
import { VpsEmbeds } from '../ui/embeds.js';
import { VpsComponents } from '../ui/components.js';
import { CreateSessionStore } from '../state/createSessionStore.js';
import { JobQueue } from '../../core/queue/jobQueue.js';
import { AuditRepository } from '../../db/repositories/auditRepository.js';

export const vpsLifecycleCommands: Command[] = [
    // 1. /create <ram> <cpu> <disk> @user
    {
        name: 'create',
        description: 'Create a new LXC VPS container (Owner only)',
        usage: '/create <ram_mb> <cpu_cores> <disk_gb> @user',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 4) {
                await message.reply('❌ **Usage:** `/create <ram_mb> <cpu_cores> <disk_gb> @user`\n*Example:* `/create 4096 2 20 @user`');
                return;
            }

            const ramMb = parseInt(args[0], 10);
            const cpuCores = parseInt(args[1], 10);
            const diskGb = parseInt(args[2], 10);

            if (isNaN(ramMb) || ramMb < 256 || ramMb > 65536) {
                await message.reply('❌ RAM must be between 256 MB and 65536 MB.');
                return;
            }
            if (isNaN(cpuCores) || cpuCores < 1 || cpuCores > 64) {
                await message.reply('❌ CPU must be between 1 and 64 vCPU.');
                return;
            }
            if (isNaN(diskGb) || diskGb < 2 || diskGb > 2000) {
                await message.reply('❌ Disk must be between 2 GB and 2000 GB.');
                return;
            }

            // Extract target user mention or id
            const mentionMatch = args[3].match(/<@!?(\d+)>/) || [null, args[3]];
            const targetUserId = mentionMatch[1];
            if (!targetUserId || !/^\d+$/.test(targetUserId)) {
                await message.reply('❌ Invalid target Discord user.');
                return;
            }

            const targetUser = await message.client.users.fetch(targetUserId).catch(() => null);
            if (!targetUser) {
                await message.reply('❌ Could not find the specified Discord user.');
                return;
            }

            // Ensure user exists in db
            await UserRepository.getOrCreate(targetUser.id, targetUser.username);

            // Store pending creation session
            const token = CreateSessionStore.createSession({
                ramMb,
                cpuCores,
                diskGb,
                targetUserId: targetUser.id,
                creatorUserId: message.author.id,
            });

            const embed = VpsEmbeds.createVpsSelection({
                ramMb,
                cpuCores,
                diskGb,
                targetUserTag: targetUser.tag,
                targetUserId: targetUser.id,
            });

            const menu = VpsComponents.osSelectMenu(`create:os:${token}`);
            await message.reply({ embeds: [embed], components: [menu] });
        },
    },

    // 2. /manage
    {
        name: 'manage',
        description: 'Open VPS Management Panel (Users can manage their own VPS, Owner can manage all)',
        usage: '/manage [vps_id]',
        ownerOnly: false,
        execute: async ({ message, args, isOwner }) => {
            const requestedId = args[0];

            if (requestedId) {
                const vps = await VpsRepository.getById(requestedId);
                if (!vps) {
                    await message.reply(`❌ VPS \`${requestedId}\` not found.`);
                    return;
                }
                if (!isOwner && vps.owner_discord_id !== message.author.id) {
                    await message.reply('❌ Bạn không có quyền quản lý VPS này!');
                    return;
                }

                const client = await NodeAgentClient.getClientForNode(vps.node_id);
                const stats = await client.getStats(vps.id).catch(() => null);
                const isRunning = (stats?.status ?? vps.status) === 'running';

                const embed = VpsEmbeds.vpsPanel(vps, stats);
                const buttons = VpsComponents.manageButtons(vps.id, isRunning);
                await message.reply({ embeds: [embed], components: buttons });
                return;
            }

            // If no ID specified, list user's VPS (or all if owner)
            const vpsList = isOwner
                ? await VpsRepository.getAll(25, 0)
                : await VpsRepository.getByOwner(message.author.id);

            if (vpsList.length === 0) {
                await message.reply('ℹ️ Bạn hiện chưa sở hữu bất kỳ VPS nào.');
                return;
            }

            if (vpsList.length === 1) {
                const vps = vpsList[0];
                const client = await NodeAgentClient.getClientForNode(vps.node_id);
                const stats = await client.getStats(vps.id).catch(() => null);
                const isRunning = (stats?.status ?? vps.status) === 'running';

                const embed = VpsEmbeds.vpsPanel(vps, stats);
                const buttons = VpsComponents.manageButtons(vps.id, isRunning);
                await message.reply({ embeds: [embed], components: buttons });
                return;
            }

            // Multiple VPS: display selector
            const selectMenu = VpsComponents.vpsSelectMenu(vpsList, 'vps:select_panel');
            await message.reply({
                content: `🔍 Bạn có **${vpsList.length}** VPS. Vui lòng chọn VPS cần quản lý:`,
                components: [selectMenu],
            });
        },
    },

    // 3. /list
    {
        name: 'list',
        description: 'List your VPS instances (Owner only for direct command)',
        usage: '/list',
        ownerOnly: true,
        execute: async ({ message, isOwner }) => {
            const list = isOwner ? await VpsRepository.getAll(50) : await VpsRepository.getByOwner(message.author.id);
            if (list.length === 0) {
                await message.reply('ℹ️ No VPS instances found.');
                return;
            }

            const rows = list.map((v) => {
                const statusDot = v.status === 'running' ? '🟢' : '🔴';
                return `${statusDot} **${v.id.toUpperCase()}** — ${v.name} | RAM: \`${v.ram_mb}MB\` | CPU: \`${v.cpu_cores}\` | Owner: <@${v.owner_discord_id}>`;
            });

            await message.reply(`📋 **VPS INSTANCES (${list.length})**:\n\n${rows.join('\n')}`);
        },
    },

    // 4. /info <id>
    {
        name: 'info',
        description: 'View full VPS specifications & details (Owner only)',
        usage: '/info <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/info <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const stats = await client.getStats(vps.id).catch(() => null);
            const embed = VpsEmbeds.vpsPanel(vps, stats);
            await message.reply({ embeds: [embed] });
        },
    },

    // 5. /start <id>
    {
        name: 'start',
        description: 'Start a stopped VPS (Owner only for direct command)',
        usage: '/start <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/start <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const statusMsg = await message.reply(`⏳ Starting **${vps.id}**...`);
            try {
                await JobQueue.runJob({
                    jobId: `job-start-${Date.now()}`,
                    vpsId: vps.id,
                    action: 'start',
                    requestedBy: message.author.id,
                    handler: async (updateStage) => {
                        await updateStage('starting');
                        const client = await NodeAgentClient.getClientForNode(vps.node_id);
                        await client.startVps(vps.id);
                        await VpsRepository.updateStatus(vps.id, 'running');
                    },
                });

                await statusMsg.edit(`✅ VPS **${vps.id.toUpperCase()}** has been successfully started!`);
                await AuditRepository.log({
                    userDiscordId: message.author.id,
                    action: 'vps_start',
                    targetType: 'vps',
                    targetId: vps.id,
                });
            } catch (err: any) {
                await statusMsg.edit(`❌ Failed to start VPS: ${err.message}`);
            }
        },
    },

    // 6. /stop <id>
    {
        name: 'stop',
        description: 'Stop a running VPS (Owner only for direct command)',
        usage: '/stop <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/stop <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const statusMsg = await message.reply(`⏳ Stopping **${vps.id}**...`);
            try {
                await JobQueue.runJob({
                    jobId: `job-stop-${Date.now()}`,
                    vpsId: vps.id,
                    action: 'stop',
                    requestedBy: message.author.id,
                    handler: async (updateStage) => {
                        await updateStage('stopping');
                        const client = await NodeAgentClient.getClientForNode(vps.node_id);
                        await client.stopVps(vps.id);
                        await VpsRepository.updateStatus(vps.id, 'stopped');
                    },
                });

                await statusMsg.edit(`🛑 VPS **${vps.id.toUpperCase()}** has been stopped.`);
                await AuditRepository.log({
                    userDiscordId: message.author.id,
                    action: 'vps_stop',
                    targetType: 'vps',
                    targetId: vps.id,
                });
            } catch (err: any) {
                await statusMsg.edit(`❌ Failed to stop VPS: ${err.message}`);
            }
        },
    },

    // 7. /restart <id>
    {
        name: 'restart',
        description: 'Restart a VPS (Owner only for direct command)',
        usage: '/restart <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/restart <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const statusMsg = await message.reply(`⏳ Restarting **${vps.id}**...`);
            try {
                await JobQueue.runJob({
                    jobId: `job-restart-${Date.now()}`,
                    vpsId: vps.id,
                    action: 'restart',
                    requestedBy: message.author.id,
                    handler: async (updateStage) => {
                        await updateStage('restarting');
                        const client = await NodeAgentClient.getClientForNode(vps.node_id);
                        await client.restartVps(vps.id);
                        await VpsRepository.updateStatus(vps.id, 'running');
                    },
                });

                await statusMsg.edit(`🔄 VPS **${vps.id.toUpperCase()}** restarted successfully.`);
                await AuditRepository.log({
                    userDiscordId: message.author.id,
                    action: 'vps_restart',
                    targetType: 'vps',
                    targetId: vps.id,
                });
            } catch (err: any) {
                await statusMsg.edit(`❌ Failed to restart VPS: ${err.message}`);
            }
        },
    },

    // 8. /reinstall <id>
    {
        name: 'reinstall',
        description: 'Reinstall operating system on VPS (Owner only for direct command)',
        usage: '/reinstall <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/reinstall <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const menu = VpsComponents.osSelectMenu(`reinstall:select_os:${vps.id}`);
            await message.reply({
                content: `💿 **CHỌN HỆ ĐIỀU HÀNH CẦN CÀI LẠI CHO VPS ${vps.id.toUpperCase()}**:`,
                components: [menu],
            });
        },
    },

    // 9. /delete <id>
    {
        name: 'delete',
        description: 'Permanently destroy a VPS instance (Owner only)',
        usage: '/delete <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/delete <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const statusMsg = await message.reply(`⚠️ Destroying container **${vps.id}** and cleaning resources...`);
            try {
                await JobQueue.runJob({
                    jobId: `job-delete-${Date.now()}`,
                    vpsId: vps.id,
                    action: 'delete',
                    requestedBy: message.author.id,
                    handler: async (updateStage) => {
                        await updateStage('destroying');
                        const client = await NodeAgentClient.getClientForNode(vps.node_id);
                        await client.deleteVps(vps.id);
                        await VpsRepository.delete(vps.id);
                    },
                });

                await statusMsg.edit(`🗑️ VPS **${vps.id.toUpperCase()}** has been permanently deleted.`);
                await AuditRepository.log({
                    userDiscordId: message.author.id,
                    action: 'vps_delete',
                    targetType: 'vps',
                    targetId: vps.id,
                });
            } catch (err: any) {
                await statusMsg.edit(`❌ Failed to delete VPS: ${err.message}`);
            }
        },
    },

    // 10. /rename <id> <name>
    {
        name: 'rename',
        description: 'Rename a VPS instance (Owner only)',
        usage: '/rename <id> <new_name>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `/rename <id> <new_name>`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const newName = args.slice(1).join(' ').trim();
            await VpsRepository.updateName(vps.id, newName);
            await message.reply(`✅ VPS **${vps.id.toUpperCase()}** renamed to: **${newName}**`);
        },
    },

    // 11. /status <id>
    {
        name: 'status',
        description: 'View current status of a VPS (Owner only for direct command)',
        usage: '/status <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/status <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const stats = await client.getStats(vps.id).catch(() => null);
            const status = stats?.status || vps.status;

            await message.reply(`🖥️ **${vps.id.toUpperCase()}** (${vps.name}): Status is **${status.toUpperCase()}**`);
        },
    },

    // 12. /uptime <id>
    {
        name: 'uptime',
        description: 'Inspect VPS container uptime (Owner only)',
        usage: '/uptime <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/uptime <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const res = await client.exec(vps.id, 'uptime').catch((e: any) => ({ stdout: `Failed: ${e.message}` }));
            await message.reply(`⏱️ **Uptime for ${vps.id.toUpperCase()}:**\n\`\`\`\n${res.stdout || 'Unavailable'}\n\`\`\``);
        },
    },

    // 13. /os <id>
    {
        name: 'os',
        description: 'View OS of VPS (Owner only)',
        usage: '/os <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/os <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }
            await message.reply(`💿 VPS **${vps.id.toUpperCase()}** is running OS: **${vps.os_name || vps.os_id}**`);
        },
    },

    // 14. /transfer <id> @user
    {
        name: 'transfer',
        description: 'Transfer VPS ownership to another user (Owner only)',
        usage: '/transfer <id> @user',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `/transfer <id> @user`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const mentionMatch = args[1].match(/<@!?(\d+)>/) || [null, args[1]];
            const newOwnerId = mentionMatch[1];
            if (!newOwnerId || !/^\d+$/.test(newOwnerId)) {
                await message.reply('❌ Invalid target Discord user.');
                return;
            }

            const targetUser = await message.client.users.fetch(newOwnerId).catch(() => null);
            if (!targetUser) {
                await message.reply('❌ Target user not found.');
                return;
            }

            await UserRepository.getOrCreate(targetUser.id, targetUser.username);
            await VpsRepository.updateOwner(vps.id, targetUser.id);

            // Also revoke any previous SSHX session
            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            await client.stopSshxSession(vps.id).catch(() => {});

            await message.reply(`✅ Transferred ownership of **${vps.id.toUpperCase()}** to <@${targetUser.id}>.`);
            await AuditRepository.log({
                userDiscordId: message.author.id,
                action: 'vps_transfer',
                targetType: 'vps',
                targetId: vps.id,
                details: { newOwnerId: targetUser.id },
            });
        },
    },
];
