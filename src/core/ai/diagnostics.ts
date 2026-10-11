import { LxcManager } from '../lxc/lxcManager.js';
import { HostChecker } from '../compatibility/hostChecker.js';
import { SshxManager } from '../sshx/sshxManager.js';
import { logger } from '../../utils/logger.js';

export interface DiagnosticResult {
    vpsId: string;
    healthy: boolean;
    issuesFound: string[];
    rootCause?: string;
    recommendedActions: string[];
    autoFixAvailable: boolean;
    autoFixAction?: string;
}

export class AiDiagnosticAgent {
    /**
     * Perform deep analysis on a container instance to identify errors and anomalies
     */
    static async diagnoseContainer(vpsId: string, lxcManager: LxcManager): Promise<DiagnosticResult> {
        logger.info(`AI Diagnostic Agent: Starting analysis for VPS ${vpsId}...`);
        const issuesFound: string[] = [];
        const recommendedActions: string[] = [];
        let autoFixAvailable = false;
        let autoFixAction: string | undefined;

        // 1. Check container existence
        const exists = await lxcManager.exists(vpsId);
        if (!exists) {
            return {
                vpsId,
                healthy: false,
                issuesFound: ['Container filesystem does not exist in /var/lib/lxc.'],
                rootCause: 'Container was never created or its directory was deleted manually.',
                recommendedActions: ['Recreate the container using ?create or reinstall via ?reinstall.'],
                autoFixAvailable: false,
            };
        }

        // 2. Inspect real runtime status
        const stats = await lxcManager.getInfo(vpsId);

        // 3. Inspect LXC error logs
        const logs = await lxcManager.getLogs(vpsId, 40);
        if (logs.includes('failed to mount') || logs.includes('mount error')) {
            issuesFound.push('Filesystem mount failure detected in container startup logs.');
            recommendedActions.push('Check host kernel mount permissions or check if AppArmor is blocking container mounts.');
        }

        if (logs.includes('cgroup') && logs.includes('Permission denied')) {
            issuesFound.push('Cgroup v2 permission denied. Host delegation missing.');
            recommendedActions.push('Ensure systemd allows delegate=yes for user/lxc cgroups.');
            autoFixAvailable = true;
            autoFixAction = 'restart_cgroup_service';
        }

        // 4. Check memory consumption threshold
        if (stats.status === 'running' && stats.ramLimitMb > 0) {
            const memoryRatio = stats.ramUsedMb / stats.ramLimitMb;
            if (memoryRatio > 0.95) {
                issuesFound.push(`Container memory usage is critical (${stats.ramUsedMb}MB / ${stats.ramLimitMb}MB). Risk of kernel OOM Killer.`);
                recommendedActions.push(`Increase RAM quota via ?setram ${vpsId} <new_mb> or terminate heavy memory-consuming processes.`);
            }
        }

        // 5. Check SSHX process status
        if (stats.status === 'running') {
            const isSshxAlive = await SshxManager.isProcessAlive(vpsId);
            if (!isSshxAlive) {
                issuesFound.push('SSHX terminal background service is offline while container is running.');
                recommendedActions.push('Auto-restart the SSHX process inside the container.');
                autoFixAvailable = true;
                autoFixAction = 'restart_sshx';
            }
        }

        // 6. Check host system health
        const hostReport = await HostChecker.checkHost();
        if (!hostReport.hasBridge) {
            issuesFound.push('Host network bridge (lxcbr0) is down. Container cannot obtain private IP.');
            recommendedActions.push('Restart lxc-net service: sudo systemctl restart lxc-net.');
            autoFixAvailable = true;
            autoFixAction = 'restart_lxc_net';
        }

        const healthy = issuesFound.length === 0;

        return {
            vpsId,
            healthy,
            issuesFound: healthy ? ['No anomalies detected. System operating normally.'] : issuesFound,
            rootCause: healthy ? undefined : issuesFound[0],
            recommendedActions: healthy ? ['No action needed.'] : recommendedActions,
            autoFixAvailable,
            autoFixAction,
        };
    }

    /**
     * Execute automated self-healing fix for known common errors
     */
    static async executeAutoFix(vpsId: string, action: string, lxcManager: LxcManager): Promise<string> {
        logger.info(`AI Diagnostic Agent: Executing auto-fix "${action}" for ${vpsId}...`);

        switch (action) {
            case 'restart_sshx': {
                await SshxManager.createSession(vpsId, 'system_ai_repair');
                return '✅ SSHX background daemon has been cleanly restarted inside the container.';
            }
            case 'restart_cgroup_service':
            case 'restart_lxc_net': {
                await lxcManager.restart(vpsId);
                return '✅ Restarted container and refreshed network bridge binding.';
            }
            default:
                throw new Error(`Unknown auto-fix action: ${action}`);
        }
    }
}
