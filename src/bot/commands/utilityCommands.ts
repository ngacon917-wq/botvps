import { Command } from './types.js';
import { UserRepository } from '../../db/repositories/userRepository.js';
import { OsRepository } from '../../db/repositories/osRepository.js';
import { HostChecker } from '../../core/compatibility/hostChecker.js';

export const utilityCommands: Command[] = [
    // 1. ?help
    {
        name: 'help',
        description: 'Show list of available commands according to your role',
        usage: '?help',
        ownerOnly: false,
        execute: async ({ message, isOwner }) => {
            if (!isOwner) {
                await message.reply(
                    '📖 **HỆ THỐNG DISCORD LXC VPS MANAGER**\n\n' +
                    'Bạn hiện đang đăng nhập với tư cách **VPS User**.\n' +
                    '• `?manage` — Mở bảng điều khiển quản lý VPS của bạn (Bật/Tắt, Khởi động lại, Mở SSHX terminal, Cài lại OS, Thống kê).\n\n' +
                    '*Lưu ý: Chỉ Master Owner mới có quyền tạo VPS và thực hiện các lệnh quản trị hệ thống.*'
                );
                return;
            }

            await message.reply(
                '👑 **DANH SÁCH LỆNH QUẢN TRỊ VIÊN (MASTER OWNER):**\n\n' +
                '**1. VPS Lifecycle:**\n' +
                '`?create <ram> <cpu> <disk> @user`, `?manage [id]`, `?list`, `?info <id>`, `?start <id>`, `?stop <id>`, `?restart <id>`, `?reinstall <id>`, `?delete <id>`, `?rename <id> <name>`, `?status <id>`, `?uptime <id>`, `?os <id>`, `?transfer <id> @user`\n\n' +
                '**2. Resources:**\n' +
                '`?stats <id>`, `?usage <id>`, `?resources`, `?resize <id> <ram> <cpu> <disk>`, `?setram <id> <mb>`, `?setcpu <id> <cores>`, `?setdisk <id> <gb>`, `?limits <id>`, `?top`\n\n' +
                '**3. Terminal & SSHX:**\n' +
                '`?sshx <id>`, `?terminal <id>`, `?sshxreset <id>`, `?sshxstop <id>`, `?sshxstatus <id>`, `?console <id>`, `?exec <id> <cmd>`, `?logs <id>`\n\n' +
                '**4. Network & NAT:**\n' +
                '`?ip <id>`, `?network <id>`, `?ports <id>`, `?portadd <id> <pub> <priv>`, `?portremove <id> <pub>`, `?dns <id>`, `?setdns <id> <resolver>`, `?ping <id> <host>`, `?bandwidth <id>`\n\n' +
                '**5. Backup & Restore:**\n' +
                '`?backup <id>`, `?backups <id>`, `?restore <id> <bk_id>`, `?backupdelete <bk_id>`, `?autobackup <id> on/off`\n\n' +
                '**6. Admin & Nodes:**\n' +
                '`?admin`, `?nodes`, `?nodeinfo <id>`, `?nodeadd`, `?noderemove <id>`, `?maintenance <id> on/off`, `?allvps`, `?suspend <id>`, `?unsuspend <id>`, `?setowner <id> @user`, `?setquota @user`, `?banvps @user`, `?unbanvps @user`, `?audit`\n\n' +
                '**7. Utility:**\n' +
                '`?health`, `?images`, `?version`, `?support`, `?quota`, `?profile`, `?myvps`'
            );
        },
    },

    // 2. ?profile
    {
        name: 'profile',
        description: 'View user account profile (Owner only)',
        usage: '?profile [@user]',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            const targetId = args[0]?.replace(/[<@!>]/g, '') || message.author.id;
            const user = await UserRepository.getById(targetId);
            if (!user) {
                await message.reply('❌ User not found in database.');
                return;
            }

            await message.reply(
                `👤 **USER PROFILE — <@${user.discord_id}>:**\n` +
                `• Admin: ${user.is_admin ? '✅ Yes' : '❌ No'}\n` +
                `• Status: ${user.is_banned ? '⛔ Banned' : '🟢 Active'}\n` +
                `• Quota: ${user.max_vps} VPS | ${user.max_ram_mb} MB RAM | ${user.max_cpu} CPU | ${user.max_disk_gb} GB Disk\n` +
                `• Joined: ${user.created_at.toLocaleDateString()}`
            );
        },
    },

    // 3. ?myvps
    {
        name: 'myvps',
        description: 'Quick view of your VPS instances (Owner only)',
        usage: '?myvps',
        ownerOnly: true,
        execute: async ({ message }) => {
            const user = await UserRepository.getOrCreate(message.author.id, message.author.username);
            await message.reply(`ℹ️ Run \`?manage\` or \`?list\` to view and control your instances.`);
        },
    },

    // 4. ?quota
    {
        name: 'quota',
        description: 'Check user resource quota limits (Owner only)',
        usage: '?quota [@user]',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            const targetId = args[0]?.replace(/[<@!>]/g, '') || message.author.id;
            const user = await UserRepository.getOrCreate(targetId, 'User');
            await message.reply(
                `📊 **QUOTA LIMITS FOR <@${targetId}>:**\n` +
                `• Max VPS: \`${user.max_vps}\`\n` +
                `• Max RAM: \`${user.max_ram_mb} MB\`\n` +
                `• Max CPU: \`${user.max_cpu} vCPU\`\n` +
                `• Max Disk: \`${user.max_disk_gb} GB\``
            );
        },
    },

    // 5. ?notifications on/off
    {
        name: 'notifications',
        description: 'Toggle DM alert notifications (Owner only)',
        usage: '?notifications on/off',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Usage: `?notifications on/off`');
                return;
            }
            const enabled = args[0].toLowerCase() === 'on';
            await UserRepository.setNotifications(message.author.id, enabled);
            await message.reply(`🔔 Direct Message notifications: **${enabled ? 'ENABLED' : 'DISABLED'}**.`);
        },
    },

    // 6. ?health
    {
        name: 'health',
        description: 'Run comprehensive system health check (Owner only)',
        usage: '?health',
        ownerOnly: true,
        execute: async ({ message }) => {
            const rep = await HostChecker.checkHost();
            await message.reply(
                `🩺 **SYSTEM HEALTH REPORT:**\n\n` +
                `• **Virtualization:** \`${rep.virtualization}\`\n` +
                `• **LXC Ready:** ${rep.hasLxcBinaries ? '✅ Yes' : '❌ Missing'}\n` +
                `• **Cgroup v2:** ${rep.hasCgroupV2 ? '✅ Active' : '❌ Inactive'}\n` +
                `• **Bridge Network:** ${rep.hasBridge ? '✅ Ready' : '❌ Not detected'}\n` +
                `• **iptables NAT:** ${rep.hasIptables ? '✅ Active' : '❌ Missing'}\n` +
                `• **Free Disk Space:** \`${rep.freeDiskGb} GB\`\n` +
                `• **Overall Status:** ${rep.compatible ? '🟢 HEALTHY & OPERATIONAL' : '🟡 RESTRICTED (Issues detected)'}`
            );
        },
    },

    // 7. ?images
    {
        name: 'images',
        description: 'List supported and verified operating system images (Owner only)',
        usage: '?images',
        ownerOnly: true,
        execute: async ({ message }) => {
            const images = await OsRepository.getAll();
            const lines = images.map((img) => `• **${img.name}** (\`${img.id}\`) — Template: \`${img.template_name}\` [Verified: ✅]`);
            await message.reply(`💿 **VERIFIED OPERATING SYSTEM IMAGES:**\n\n${lines.join('\n')}`);
        },
    },

    // 8. ?version
    {
        name: 'version',
        description: 'Display bot and agent software version (Owner only)',
        usage: '?version',
        ownerOnly: true,
        execute: async ({ message }) => {
            await message.reply('🚀 **Discord LXC VPS Manager** — `v2.0.0-production`\nNode.js v24 • discord.js v14 • Debian 13 Ready');
        },
    },

    // 9. ?support
    {
        name: 'support',
        description: 'Display system documentation and support guidelines (Owner only)',
        usage: '?support',
        ownerOnly: true,
        execute: async ({ message }) => {
            await message.reply(
                '🛠️ **HỖ TRỢ & HƯỚNG DẪN:**\n\n' +
                '• Tài liệu: Tham khảo file `README.md` trong thư mục dự án.\n' +
                '• Xử lý lỗi SSHX: Chạy `?sshxreset <id>` để tái tạo phiên terminal.\n' +
                '• Cài đặt node worker: Chạy `src/agent-cli.ts` trên máy chủ LXC mục tiêu và đăng ký bằng `?nodeadd`.'
            );
        },
    },

    // 10. ?ai <vps_id>
    {
        name: 'ai',
        aliases: ['diagnose'],
        description: 'AI Agent deep diagnostic analysis for container anomalies (Owner only)',
        usage: '?ai <vps_id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`?ai <vps_id>`).');
                return;
            }
            const vpsId = args[0].toLowerCase();
            const { LxcManager } = await import('../../core/lxc/lxcManager.js');
            const { AiDiagnosticAgent } = await import('../../core/ai/diagnostics.js');
            const { VpsEmbeds } = await import('../ui/embeds.js');

            const waitMsg = await message.reply(`🤖 **AI Agent is inspecting container ${vpsId.toUpperCase()}...**`);
            const lxcManager = new LxcManager();
            const report = await AiDiagnosticAgent.diagnoseContainer(vpsId, lxcManager);
            const embed = VpsEmbeds.aiDiagnosticReport(report);

            await waitMsg.edit({ content: null, embeds: [embed] });
        },
    },

    // 11. ?fix <vps_id>
    {
        name: 'fix',
        description: 'AI Agent automated self-healing repair for container (Owner only)',
        usage: '?fix <vps_id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`?fix <vps_id>`).');
                return;
            }
            const vpsId = args[0].toLowerCase();
            const { LxcManager } = await import('../../core/lxc/lxcManager.js');
            const { AiDiagnosticAgent } = await import('../../core/ai/diagnostics.js');

            const lxcManager = new LxcManager();
            const report = await AiDiagnosticAgent.diagnoseContainer(vpsId, lxcManager);

            if (!report.autoFixAvailable || !report.autoFixAction) {
                await message.reply(`ℹ️ No automated self-healing action currently required for **${vpsId.toUpperCase()}**.`);
                return;
            }

            const waitMsg = await message.reply(`🛠️ Executing AI self-healing repair (\`${report.autoFixAction}\`)...`);
            const repairResult = await AiDiagnosticAgent.executeAutoFix(vpsId, report.autoFixAction, lxcManager);
            await waitMsg.edit(`🔧 **AI Self-Healing Result for ${vpsId.toUpperCase()}:**\n${repairResult}`);
        },
    },
];
