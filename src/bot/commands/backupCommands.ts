import { Command } from './types.js';
import { VpsRepository } from '../../db/repositories/vpsRepository.js';
import { BackupRepository } from '../../db/repositories/backupRepository.js';
import { NodeAgentClient } from '../../agent/client.js';
import { JobQueue } from '../../core/queue/jobQueue.js';

export const backupCommands: Command[] = [
    // 1. ?backup <id>
    {
        name: 'backup',
        description: 'Create an isolated full backup of VPS rootfs (Owner only)',
        usage: '?backup <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`?backup <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const waitMsg = await message.reply(`📦 Creating backup for **${vps.id.toUpperCase()}**...`);
            try {
                await JobQueue.runJob({
                    jobId: `job-bk-${Date.now()}`,
                    vpsId: vps.id,
                    action: 'backup',
                    requestedBy: message.author.id,
                    handler: async (updateStage) => {
                        await updateStage('archiving');
                        const client = await NodeAgentClient.getClientForNode(vps.node_id);
                        const record = await client.createBackup(vps.id);
                        await waitMsg.edit(
                            `✅ **BACKUP COMPLETED SUCCESSFULLY:**\n` +
                            `• Backup ID: \`${record.id}\`\n` +
                            `• Size: \`${(record.size_bytes / 1024 / 1024).toFixed(2)} MB\`\n` +
                            `• SHA-256 Checksum: \`${record.checksum?.substring(0, 16)}...\``
                        );
                    },
                });
            } catch (err: any) {
                await waitMsg.edit(`❌ Backup failed: ${err.message}`);
            }
        },
    },

    // 2. ?backups <id>
    {
        name: 'backups',
        description: 'List all backups for a VPS (Owner only)',
        usage: '?backups <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`?backups <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const list = await BackupRepository.getByVps(vps.id);
            if (list.length === 0) {
                await message.reply(`ℹ️ No backups found for **${vps.id.toUpperCase()}**.`);
                return;
            }

            const items = list.map((b) => `• \`${b.id}\` — ${(b.size_bytes / 1024 / 1024).toFixed(2)} MB (${b.created_at.toLocaleString()})`);
            await message.reply(`📦 **BACKUPS FOR ${vps.id.toUpperCase()}:**\n\n${items.join('\n')}`);
        },
    },

    // 3. ?restore <id> <backup_id>
    {
        name: 'restore',
        description: 'Restore VPS from a specified backup archive (Owner only)',
        usage: '?restore <id> <backup_id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `?restore <id> <backup_id>`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }
            const backupId = args[1];

            const waitMsg = await message.reply(`⚠️ Restoring **${vps.id.toUpperCase()}** from backup \`${backupId}\`...`);
            try {
                await JobQueue.runJob({
                    jobId: `job-restore-${Date.now()}`,
                    vpsId: vps.id,
                    action: 'restore',
                    requestedBy: message.author.id,
                    handler: async (updateStage) => {
                        await updateStage('stopping_container');
                        const client = await NodeAgentClient.getClientForNode(vps.node_id);
                        await client.stopVps(vps.id).catch(() => {});
                        await updateStage('extracting_rootfs');
                        await client.restoreBackup(vps.id, backupId);
                        await updateStage('starting_container');
                        await client.startVps(vps.id);
                        await VpsRepository.updateStatus(vps.id, 'running');
                    },
                });

                await waitMsg.edit(`✅ Successfully restored **${vps.id.toUpperCase()}** from backup \`${backupId}\`!`);
            } catch (err: any) {
                await waitMsg.edit(`❌ Restore failed: ${err.message}`);
            }
        },
    },

    // 4. ?backupdelete <backup_id>
    {
        name: 'backupdelete',
        description: 'Delete a backup file (Owner only)',
        usage: '?backupdelete <backup_id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a backup ID (`?backupdelete <backup_id>`).');
                return;
            }
            const backupId = args[0];
            const backup = await BackupRepository.getById(backupId);
            if (!backup) {
                await message.reply(`❌ Backup \`${backupId}\` not found.`);
                return;
            }

            const vps = await VpsRepository.getById(backup.vps_id);
            if (vps) {
                const client = await NodeAgentClient.getClientForNode(vps.node_id);
                // Also trigger deletion on storage if client available
            }

            await BackupRepository.delete(backupId);
            await message.reply(`🗑️ Deleted backup record \`${backupId}\`.`);
        },
    },

    // 5. ?autobackup <id> on/off
    {
        name: 'autobackup',
        description: 'Toggle automated scheduled backups for VPS (Owner only)',
        usage: '?autobackup <id> on/off',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `?autobackup <id> on/off`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const state = args[1].toLowerCase();
            const enabled = state === 'on' || state === 'true' || state === 'enable';

            await VpsRepository.updateAutoBackup(vps.id, enabled);
            await message.reply(`🛡️ Automatic backup for **${vps.id.toUpperCase()}** is now **${enabled ? 'ENABLED' : 'DISABLED'}**.`);
        },
    },
];
