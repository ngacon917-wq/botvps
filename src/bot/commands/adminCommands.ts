import { Command } from './types.js';
import { VpsRepository } from '../../db/repositories/vpsRepository.js';
import { NodeRepository } from '../../db/repositories/nodeRepository.js';
import { UserRepository } from '../../db/repositories/userRepository.js';
import { AuditRepository } from '../../db/repositories/auditRepository.js';
import { NodeAgentClient } from '../../agent/client.js';
import { VpsEmbeds } from '../ui/embeds.js';

export const adminCommands: Command[] = [
    // 1. /admin
    {
        name: 'admin',
        description: 'Open Master Admin Dashboard (Owner only)',
        usage: '/admin',
        ownerOnly: true,
        execute: async ({ message }) => {
            const alloc = await VpsRepository.getTotalAllocations();
            const embed = VpsEmbeds.adminDashboard( {
                totalVps: alloc.total_count,
                runningVps: alloc.running_count,
                stoppedVps: alloc.stopped_count,
                totalRam: alloc.total_ram,
                totalCpu: alloc.total_cpu,
                totalDisk: alloc.total_disk,
                nodeStatus: 'ONLINE (Healthy)',
                pendingJobs: 0,
            });
            await message.reply({ embeds: [embed] });
        },
    },

    // 2. /nodes
    {
        name: 'nodes',
        description: 'List all cluster LXC nodes (Owner only)',
        usage: '/nodes',
        ownerOnly: true,
        execute: async ({ message }) => {
            const nodes = await NodeRepository.getAll();
            if (nodes.length === 0) {
                await message.reply('ℹ️ No nodes registered.');
                return;
            }

            const lines = nodes.map((n) => {
                const status = n.is_maintenance ? '🟡 Maintenance' : n.is_active ? '🟢 Active' : '🔴 Inactive';
                return `• **${n.id}** (${n.name}) — \`${n.host}:${n.port}\` | Status: ${status}`;
            });

            await message.reply(`🖥️ **REGISTERED CLUSTER NODES (${nodes.length}):**\n\n${lines.join('\n')}`);
        },
    },

    // 3. /nodeinfo <id>
    {
        name: 'nodeinfo',
        description: 'View specific node details (Owner only)',
        usage: '/nodeinfo <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a Node ID (`/nodeinfo <id>`).');
                return;
            }
            const node = await NodeRepository.getById(args[0]);
            if (!node) {
                await message.reply(`❌ Node \`${args[0]}\` not found.`);
                return;
            }

            await message.reply(
                `🖥️ **NODE DETAILS — ${node.id.toUpperCase()}:**\n` +
                `• **Name:** ${node.name}\n` +
                `• **Endpoint:** \`${node.host}:${node.port}\`\n` +
                `• **Status:** ${node.is_maintenance ? 'Maintenance' : node.is_active ? 'Active' : 'Offline'}\n` +
                `• **Capacity:** RAM: \`${node.max_ram_mb} MB\` | CPU: \`${node.max_cpu} Cores\` | Disk: \`${node.max_disk_gb} GB\`\n` +
                `• **Last Heartbeat:** ${node.last_seen ? node.last_seen.toLocaleString() : 'Never'}`
            );
        },
    },

    // 4. /nodeadd <id> <name> <host> <port> <token>
    {
        name: 'nodeadd',
        description: 'Register a remote LXC worker node (Owner only)',
        usage: '/nodeadd <id> <name> <host> <port> <token>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 5) {
                await message.reply('❌ Usage: `/nodeadd <id> <name> <host> <port> <api_token>`');
                return;
            }

            const id = args[0];
            const name = args[1];
            const host = args[2];
            const port = parseInt(args[3], 10);
            const apiToken = args[4];

            if (isNaN(port)) {
                await message.reply('❌ Port must be numeric.');
                return;
            }

            await NodeRepository.addNode({ id, name, host, port, apiToken });
            await message.reply(`✅ Registered remote node **${id}** (\`${host}:${port}\`).`);
            await AuditRepository.log({
                userDiscordId: message.author.id,
                action: 'node_add',
                targetType: 'node',
                targetId: id,
            });
        },
    },

    // 5. /noderemove <id>
    {
        name: 'noderemove',
        description: 'Remove a cluster node (Owner only)',
        usage: '/noderemove <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Usage: `/noderemove <id>`');
                return;
            }
            const id = args[0];
            await NodeRepository.removeNode(id);
            await message.reply(`🗑️ Removed node **${id}**.`);
        },
    },

    // 6. /maintenance <id> on/off
    {
        name: 'maintenance',
        description: 'Toggle node maintenance mode (Owner only)',
        usage: '/maintenance <node_id> on/off',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `/maintenance <node_id> on/off`');
                return;
            }
            const id = args[0];
            const state = args[1].toLowerCase() === 'on';

            await NodeRepository.setMaintenance(id, state);
            await message.reply(`⚙️ Node **${id}** maintenance mode: **${state ? 'ENABLED' : 'DISABLED'}**.`);
        },
    },

    // 7. /allvps
    {
        name: 'allvps',
        description: 'Display all VPS instances across cluster (Owner only)',
        usage: '/allvps',
        ownerOnly: true,
        execute: async ({ message }) => {
            const list = await VpsRepository.getAll(50, 0);
            if (list.length === 0) {
                await message.reply('ℹ️ No VPS containers registered.');
                return;
            }

            const lines = list.map((v) => {
                const dot = v.status === 'running' ? '🟢' : '🔴';
                return `${dot} **${v.id.toUpperCase()}** (${v.name}) — Node: \`${v.node_id}\` | RAM: \`${v.ram_mb}MB\` | Owner: <@${v.owner_discord_id}>`;
            });

            await message.reply(`🖥️ **ALL VPS INSTANCES (${list.length}):**\n\n${lines.join('\n')}`);
        },
    },

    // 8. /suspend <id> [reason]
    {
        name: 'suspend',
        description: 'Suspend a VPS instance (Owner only)',
        usage: '/suspend <id> [reason]',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Usage: `/suspend <id> [reason]`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const reason = args.slice(1).join(' ') || 'Policy violation or administrative action';
            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            await client.stopVps(vps.id).catch(() => {});
            await client.stopSshxSession(vps.id).catch(() => {});
            await VpsRepository.updateStatus(vps.id, 'suspended', reason);

            await message.reply(`🔒 Suspended **${vps.id.toUpperCase()}**. Reason: *${reason}*`);
            await AuditRepository.log({
                userDiscordId: message.author.id,
                action: 'vps_suspend',
                targetType: 'vps',
                targetId: vps.id,
                details: { reason },
            });
        },
    },

    // 9. /unsuspend <id>
    {
        name: 'unsuspend',
        description: 'Unsuspend a VPS instance (Owner only)',
        usage: '/unsuspend <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Usage: `/unsuspend <id>`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            await VpsRepository.updateStatus(vps.id, 'stopped');
            await message.reply(`🔓 Unsuspended **${vps.id.toUpperCase()}**. Container is now in STOPPED state.`);
            await AuditRepository.log({
                userDiscordId: message.author.id,
                action: 'vps_unsuspend',
                targetType: 'vps',
                targetId: vps.id,
            });
        },
    },

    // 10. /setowner <id> @user
    {
        name: 'setowner',
        description: 'Reassign VPS owner (Owner only)',
        usage: '/setowner <id> @user',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `/setowner <id> @user`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const match = args[1].match(/<@!?(\d+)>/) || [null, args[1]];
            const targetId = match[1];
            if (!targetId || !/^\d+$/.test(targetId)) {
                await message.reply('❌ Invalid user specified.');
                return;
            }

            const user = await message.client.users.fetch(targetId).catch(() => null);
            if (!user) {
                await message.reply('❌ User not found.');
                return;
            }

            await UserRepository.getOrCreate(user.id, user.username);
            await VpsRepository.updateOwner(vps.id, user.id);
            await message.reply(`✅ Reassigned owner of **${vps.id.toUpperCase()}** to <@${user.id}>.`);
        },
    },

    // 11. /setquota @user <vps> <ram> <cpu> <disk>
    {
        name: 'setquota',
        description: 'Set custom resource quota for a user (Owner only)',
        usage: '/setquota @user <max_vps> <max_ram_mb> <max_cpu> <max_disk_gb>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 5) {
                await message.reply('❌ Usage: `/setquota @user <max_vps> <max_ram_mb> <max_cpu> <max_disk_gb>`');
                return;
            }

            const match = args[0].match(/<@!?(\d+)>/) || [null, args[0]];
            const targetId = match[1];
            if (!targetId) {
                await message.reply('❌ Invalid user mentioned.');
                return;
            }

            const maxVps = parseInt(args[1], 10);
            const maxRam = parseInt(args[2], 10);
            const maxCpu = parseInt(args[3], 10);
            const maxDisk = parseInt(args[4], 10);

            await UserRepository.setQuota(targetId, maxVps, maxRam, maxCpu, maxDisk);
            await message.reply(`✅ Updated quota for <@${targetId}>: ${maxVps} VPS, ${maxRam}MB RAM, ${maxCpu} CPU, ${maxDisk}GB Disk.`);
        },
    },

    // 12. /banvps @user
    {
        name: 'banvps',
        description: 'Ban user from creating or using VPS (Owner only)',
        usage: '/banvps @user',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Usage: `/banvps @user`');
                return;
            }
            const match = args[0].match(/<@!?(\d+)>/) || [null, args[0]];
            const targetId = match[1];
            if (!targetId) {
                await message.reply('❌ Invalid user mentioned.');
                return;
            }

            await UserRepository.setBanned(targetId, true);
            await message.reply(`⛔ Banned <@${targetId}> from creating or managing VPS.`);
            await AuditRepository.log({
                userDiscordId: message.author.id,
                action: 'user_ban',
                targetType: 'user',
                targetId: targetId,
            });
        },
    },

    // 13. /unbanvps @user
    {
        name: 'unbanvps',
        description: 'Unban a user (Owner only)',
        usage: '/unbanvps @user',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Usage: `/unbanvps @user`');
                return;
            }
            const match = args[0].match(/<@!?(\d+)>/) || [null, args[0]];
            const targetId = match[1];
            if (!targetId) {
                await message.reply('❌ Invalid user mentioned.');
                return;
            }

            await UserRepository.setBanned(targetId, false);
            await message.reply(`✅ Unbanned <@${targetId}>.`);
            await AuditRepository.log({
                userDiscordId: message.author.id,
                action: 'user_unban',
                targetType: 'user',
                targetId: targetId,
            });
        },
    },

    // 14. /audit
    {
        name: 'audit',
        description: 'View recent administrative audit log (Owner only)',
        usage: '/audit',
        ownerOnly: true,
        execute: async ({ message }) => {
            const logs = await AuditRepository.getRecent(15);
            if (logs.length === 0) {
                await message.reply('ℹ️ No audit logs recorded yet.');
                return;
            }

            const lines = logs.map((l) => `• \`[${new Date(l.created_at).toLocaleTimeString()}]\` <@${l.user_discord_id}>: **${l.action}** on \`${l.target_type}:${l.target_id || '-'}\``);
            await message.reply(`📜 **RECENT AUDIT LOGS:**\n\n${lines.join('\n')}`);
        },
    },
];
