import { Command } from './types.js';
import { VpsRepository } from '../../db/repositories/vpsRepository.js';
import { NodeAgentClient } from '../../agent/client.js';
import { HostChecker } from '../../core/compatibility/hostChecker.js';

export const resourceCommands: Command[] = [
    // 1. /stats <id>
    {
        name: 'stats',
        description: 'View resource utilization statistics of VPS (Owner only)',
        usage: '/stats <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/stats <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const stats = await client.getStats(vps.id).catch(() => null);

            if (!stats) {
                await message.reply('❌ Could not fetch stats from node.');
                return;
            }

            await message.reply(
                `📊 **STATISTICS FOR ${vps.id.toUpperCase()}:**\n` +
                `• **Status:** \`${stats.status.toUpperCase()}\`\n` +
                `• **PID:** \`${stats.pid || 'N/A'}\`\n` +
                `• **RAM Used:** \`${stats.ramUsedMb} MB / ${vps.ram_mb} MB\`\n` +
                `• **CPU Limit:** \`${vps.cpu_cores} vCPU\`\n` +
                `• **Disk Quota:** \`${vps.disk_gb} GB\`\n` +
                `• **IP Address:** \`${stats.ip || vps.ip_address}\``
            );
        },
    },

    // 2. /usage <id>
    {
        name: 'usage',
        description: 'Check VPS container usage metrics (Owner only)',
        usage: '/usage <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/usage <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const freeMem = await client.exec(vps.id, 'free', ['-m']).catch(() => ({ stdout: 'N/A' }));
            const diskUsage = await client.exec(vps.id, 'df', ['-h', '/']).catch(() => ({ stdout: 'N/A' }));

            await message.reply(
                `📈 **RESOURCE USAGE — ${vps.id.toUpperCase()}**\n\n` +
                `**Memory (free -m):**\n\`\`\`\n${freeMem.stdout}\n\`\`\`\n` +
                `**Disk (df -h /):**\n\`\`\`\n${diskUsage.stdout}\n\`\`\``
            );
        },
    },

    // 3. /resources
    {
        name: 'resources',
        description: 'View total system resources on host node (Owner only)',
        usage: '/resources',
        ownerOnly: true,
        execute: async ({ message }) => {
            const report = await HostChecker.checkHost();
            const alloc = await VpsRepository.getTotalAllocations();

            await message.reply(
                `🖥️ **NODE RESOURCE CAPACITY & ALLOCATIONS:**\n\n` +
                `• **Host Virtualization:** \`${report.virtualization}\`\n` +
                `• **LXC Compatible:** ${report.compatible ? '✅ Yes' : '❌ Incompatible'}\n` +
                `• **Cgroup v2 Support:** ${report.hasCgroupV2 ? '✅ Active' : '❌ Disabled'}\n` +
                `• **Free Disk on Node:** \`${report.freeDiskGb} GB\`\n\n` +
                `**Containers Allocated:**\n` +
                `• Total Instances: \`${alloc.total_count}\` (${alloc.running_count} running, ${alloc.stopped_count} stopped)\n` +
                `• Total RAM Allocated: \`${(alloc.total_ram / 1024).toFixed(2)} GB\`\n` +
                `• Total CPU Allocated: \`${alloc.total_cpu} vCPU\`\n` +
                `• Total Disk Allocated: \`${alloc.total_disk} GB\``
            );
        },
    },

    // 4. /resize <id> <ram> <cpu> <disk>
    {
        name: 'resize',
        description: 'Modify VPS specifications dynamically (Owner only)',
        usage: '/resize <id> <ram_mb> <cpu_cores> <disk_gb>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 4) {
                await message.reply('❌ Usage: `/resize <id> <ram_mb> <cpu_cores> <disk_gb>`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const ramMb = parseInt(args[1], 10);
            const cpuCores = parseInt(args[2], 10);
            const diskGb = parseInt(args[3], 10);

            if (isNaN(ramMb) || isNaN(cpuCores) || isNaN(diskGb)) {
                await message.reply('❌ Invalid numerical specifications provided.');
                return;
            }

            if (diskGb < vps.disk_gb) {
                await message.reply('❌ Shrinking disk quota is not supported safely for existing filesystems. Disk can only be increased.');
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            await client.resizeVps(vps.id, ramMb, cpuCores);
            await VpsRepository.updateSpecs(vps.id, ramMb, cpuCores, diskGb);

            await message.reply(
                `✅ VPS **${vps.id.toUpperCase()}** resized successfully:\n` +
                `• RAM: \`${ramMb} MB\`\n` +
                `• CPU: \`${cpuCores} vCPU\`\n` +
                `• Disk: \`${diskGb} GB\``
            );
        },
    },

    // 5. /setram <id> <mb>
    {
        name: 'setram',
        description: 'Adjust RAM memory for VPS (Owner only)',
        usage: '/setram <id> <ram_mb>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `/setram <id> <ram_mb>`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const ramMb = parseInt(args[1], 10);
            if (isNaN(ramMb) || ramMb < 256) {
                await message.reply('❌ RAM must be at least 256 MB.');
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            await client.resizeVps(vps.id, ramMb, vps.cpu_cores);
            await VpsRepository.updateSpecs(vps.id, ramMb, vps.cpu_cores, vps.disk_gb);

            await message.reply(`✅ RAM for **${vps.id.toUpperCase()}** updated to \`${ramMb} MB\`.`);
        },
    },

    // 6. /setcpu <id> <cores>
    {
        name: 'setcpu',
        description: 'Adjust CPU core limit for VPS (Owner only)',
        usage: '/setcpu <id> <cores>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `/setcpu <id> <cores>`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const cpuCores = parseInt(args[1], 10);
            if (isNaN(cpuCores) || cpuCores < 1) {
                await message.reply('❌ CPU cores must be at least 1.');
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            await client.resizeVps(vps.id, vps.ram_mb, cpuCores);
            await VpsRepository.updateSpecs(vps.id, vps.ram_mb, cpuCores, vps.disk_gb);

            await message.reply(`✅ CPU for **${vps.id.toUpperCase()}** updated to \`${cpuCores} vCPU\`.`);
        },
    },

    // 7. /setdisk <id> <gb>
    {
        name: 'setdisk',
        description: 'Expand disk quota for VPS (Owner only)',
        usage: '/setdisk <id> <disk_gb>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `/setdisk <id> <disk_gb>`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const diskGb = parseInt(args[1], 10);
            if (isNaN(diskGb) || diskGb < vps.disk_gb) {
                await message.reply(`❌ New disk size must be greater than current size (\`${vps.disk_gb} GB\`). Shrinking is not permitted.`);
                return;
            }

            await VpsRepository.updateSpecs(vps.id, vps.ram_mb, vps.cpu_cores, diskGb);
            await message.reply(`✅ Disk quota for **${vps.id.toUpperCase()}** expanded to \`${diskGb} GB\`.`);
        },
    },

    // 8. /limits <id>
    {
        name: 'limits',
        description: 'Inspect active cgroup v2 limits for VPS (Owner only)',
        usage: '/limits <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/limits <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            await message.reply(
                `⚙️ **CGROUP V2 LIMITS — ${vps.id.toUpperCase()}:**\n` +
                `• \`memory.max\`: \`${vps.ram_mb * 1024 * 1024} bytes\` (${vps.ram_mb} MB)\n` +
                `• \`cpu.max\`: \`${vps.cpu_cores * 100000} 100000\` (${vps.cpu_cores} vCPU)\n` +
                `• \`pids.max\`: \`2048\`\n` +
                `• \`disk.quota\`: \`${vps.disk_gb} GB\``
            );
        },
    },

    // 9. /top
    {
        name: 'top',
        description: 'View top VPS instances consuming resources (Owner only)',
        usage: '/top',
        ownerOnly: true,
        execute: async ({ message }) => {
            const list = await VpsRepository.getAll(10, 0);
            if (list.length === 0) {
                await message.reply('ℹ️ No active VPS instances found.');
                return;
            }

            // Sort by RAM allocated
            const sorted = list.sort((a, b) => b.ram_mb - a.ram_mb);
            const lines = sorted.map((v, i) => `${i + 1}. **${v.id.toUpperCase()}** — RAM: \`${v.ram_mb}MB\` | CPU: \`${v.cpu_cores}c\` | Owner: <@${v.owner_discord_id}>`);

            await message.reply(`🏆 **TOP ALLOCATED VPS INSTANCES:**\n\n${lines.join('\n')}`);
        },
    },
];
