import { EmbedBuilder } from 'discord.js';
import { VpsRecord } from '../../db/repositories/vpsRepository.js';
import { DiagnosticResult } from '../../core/ai/diagnostics.js';

export function createProgressBar(value: number, max: number, size: number = 10): string {
    const percentage = Math.min(Math.max(value / (max || 1), 0), 1);
    const filled = Math.round(size * percentage);
    const empty = size - filled;
    return `\`[${'█'.repeat(filled)}${'░'.repeat(empty)}]\` **${(percentage * 100).toFixed(0)}%**`;
}

export class VpsEmbeds {
    static createVpsSelection(params: { ramMb: number; cpuCores: number; diskGb: number; targetUserTag: string; targetUserId: string }): EmbedBuilder {
        return new EmbedBuilder()
            .setTitle('🚀 CREATE NEW VPS')
            .setColor(0x5865F2)
            .setDescription('Please select an operating system from the dropdown menu below to begin provisioning.')
            .addFields(
                { name: '💾 RAM Memory', value: `\`${params.ramMb} MB\``, inline: true },
                { name: '⚡ CPU Cores', value: `\`${params.cpuCores} vCPU\``, inline: true },
                { name: '💽 Disk Quota', value: `\`${params.diskGb} GB\``, inline: true },
                { name: '👤 Owner', value: `<@${params.targetUserId}>`, inline: true },
                { name: '📦 Virtualization', value: '`LXC Container (cgroup v2)`', inline: true },
                { name: '🌐 Network', value: '`Isolated Bridge / NAT`', inline: true }
            )
            .setFooter({ text: 'Discord LXC VPS Manager • Zero-Config Edition' })
            .setTimestamp();
    }

    static vpsPanel(vps: VpsRecord, stats?: any, uptimeStr?: string): EmbedBuilder {
        const isRunning = vps.status === 'running';
        const color = isRunning ? 0x57F287 : vps.status === 'suspended' ? 0xED4245 : 0xFEE75C;

        const ramUsed = stats?.ramUsedMb || 0;
        const ramBar = createProgressBar(ramUsed, vps.ram_mb, 8);

        const embed = new EmbedBuilder()
            .setTitle(`🖥️ VPS MANAGEMENT PANEL — ${vps.id.toUpperCase()}`)
            .setColor(color)
            .setDescription(
                `**Instance Name:** ${vps.name}\n` +
                `**Owner:** <@${vps.owner_discord_id}>\n` +
                `**Status:** ${isRunning ? '🟢 `RUNNING`' : vps.status === 'stopped' ? '🔴 `STOPPED`' : `🟡 \`${vps.status.toUpperCase()}\``}\n` +
                `**RAM Utilization:** ${ramBar} (\`${ramUsed} / ${vps.ram_mb} MB\`)`
            )
            .addFields(
                { name: '💿 Operating System', value: vps.os_name || vps.os_id, inline: true },
                { name: '⚡ CPU Limit', value: `\`${vps.cpu_cores} vCPU\``, inline: true },
                { name: '💽 Disk Quota', value: `\`${vps.disk_gb} GB\``, inline: true },
                { name: '🌐 IPv4 Address', value: `\`${vps.ip_address || '10.0.3.x'}\``, inline: true },
                { name: '⏱️ Uptime', value: uptimeStr || (isRunning ? 'Active' : 'Offline'), inline: true },
                { name: '🛡️ Auto Backup', value: vps.auto_backup ? '✅ Enabled' : '❌ Disabled', inline: true }
            )
            .setFooter({ text: `VPS ID: ${vps.id} • Use interactive buttons below` })
            .setTimestamp();

        if (vps.suspended_reason) {
            embed.addFields({ name: '⚠️ Suspension Notice', value: vps.suspended_reason });
        }

        return embed;
    }

    static reinstallWarning(vpsId: string, osName: string): EmbedBuilder {
        return new EmbedBuilder()
            .setTitle('⚠️ WARNING: DATA DESTRUCTION (REINSTALL OS)')
            .setColor(0xED4245)
            .setDescription(
                `You are about to reinstall **${vpsId.toUpperCase()}** with **${osName}**.\n\n` +
                '**This operation will irreversibly:**\n' +
                '• Stop the VPS container.\n' +
                '• Completely wipe and delete the root filesystem.\n' +
                '• Delete all files, installed software, user accounts, and databases.\n' +
                '• Revoke any existing active SSHX terminal sessions.\n' +
                '• Rebuild the filesystem using the new OS image.\n' +
                '• Preserve your VPS ID, Owner, RAM, CPU, and Disk quota.\n\n' +
                '**Are you absolutely sure you want to proceed?**'
            )
            .setFooter({ text: 'Action cannot be undone!' })
            .setTimestamp();
    }

    static adminDashboard(data: {
        totalVps: number;
        runningVps: number;
        stoppedVps: number;
        totalRam: number;
        totalCpu: number;
        totalDisk: number;
        nodeStatus: string;
        pendingJobs: number;
    }): EmbedBuilder {
        return new EmbedBuilder()
            .setTitle('⚙️ VPS MANAGER — MASTER ADMIN DASHBOARD')
            .setColor(0x5865F2)
            .setDescription('Overview of cluster capacity, container instances, and orchestrator status.')
            .addFields(
                { name: '📊 Total VPS', value: `\`${data.totalVps}\``, inline: true },
                { name: '🟢 Running', value: `\`${data.runningVps}\``, inline: true },
                { name: '🔴 Stopped', value: `\`${data.stoppedVps}\``, inline: true },
                { name: '💾 Total Allocated RAM', value: `\`${(data.totalRam / 1024).toFixed(1)} GB\``, inline: true },
                { name: '⚡ Total Allocated CPU', value: `\`${data.totalCpu} Cores\``, inline: true },
                { name: '💽 Total Allocated Disk', value: `\`${data.totalDisk} GB\``, inline: true },
                { name: '🖥️ Local Master Node', value: `\`${data.nodeStatus}\``, inline: true },
                { name: '⏳ Pending Jobs', value: `\`${data.pendingJobs}\``, inline: true }
            )
            .setFooter({ text: 'Restricted to Master Owner' })
            .setTimestamp();
    }

    static aiDiagnosticReport(result: DiagnosticResult): EmbedBuilder {
        const color = result.healthy ? 0x57F287 : 0xED4245;
        const embed = new EmbedBuilder()
            .setTitle(`🤖 AI AGENT DIAGNOSTIC REPORT — ${result.vpsId.toUpperCase()}`)
            .setColor(color)
            .setDescription(
                result.healthy
                    ? '✅ **Container is completely healthy and operating with zero detected faults!**'
                    : '⚠️ **The AI Agent has detected issues affecting this container instance.**'
            )
            .addFields(
                {
                    name: '🔍 Detected Issues',
                    value: result.issuesFound.map((i) => `• ${i}`).join('\n') || 'None',
                },
                {
                    name: '💡 Recommended Solutions',
                    value: result.recommendedActions.map((a) => `• ${a}`).join('\n') || 'None',
                }
            )
            .setFooter({ text: 'AI Infrastructure Diagnostics Engine' })
            .setTimestamp();

        if (result.rootCause) {
            embed.addFields({ name: '🎯 Root Cause Analysis (RCA)', value: result.rootCause });
        }

        if (result.autoFixAvailable) {
            embed.addFields({
                name: '🛠️ Automated Self-Healing',
                value: `Self-healing action available: \`${result.autoFixAction}\`. Run \`?fix ${result.vpsId}\` to execute automatic repair.`,
            });
        }

        return embed;
    }
}
