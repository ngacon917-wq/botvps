import { VpsRepository } from '../../db/repositories/vpsRepository.js';
import { NodeAgentClient } from '../../agent/client.js';
import { logger } from '../../utils/logger.js';
import { SshxRepository } from '../../db/repositories/sshxRepository.js';

export class BackgroundMonitor {
    private static intervalHandle: NodeJS.Timeout | null = null;

    static start(intervalMs: number = 60000) {
        if (this.intervalHandle) return;
        logger.info('Starting Background Health & VPS Monitor service...');

        this.intervalHandle = setInterval(async () => {
            try {
                await this.checkAllContainers();
            } catch (err: any) {
                logger.error(`Error during background health monitor cycle: ${err.message}`);
            }
        }, intervalMs);
    }

    static stop() {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    private static async checkAllContainers() {
        const vpsList = await VpsRepository.getAll(100, 0);

        for (const vps of vpsList) {
            // Only inspect running containers
            if (vps.status !== 'running') continue;

            try {
                const client = await NodeAgentClient.getClientForNode(vps.node_id);
                const stats = await client.getStats(vps.id);

                // Container crash detection
                if (stats.status === 'stopped' && vps.status === 'running') {
                    logger.warn(`Container ${vps.id} was expected to be running but is stopped! Updating state.`);
                    await VpsRepository.updateStatus(vps.id, 'stopped', 'Process exited unexpectedly');
                }

                // Check SSHX session if one was recorded as active
                const activeSshx = await SshxRepository.getActiveSession(vps.id);
                if (activeSshx) {
                    const sshxStatus = await client.getSshxStatus(vps.id);
                    if (!sshxStatus.active) {
                        logger.warn(`SSHX session for ${vps.id} dropped. Auto-restarting SSHX...`);
                        await client.createSshxSession(vps.id, activeSshx.user_discord_id).catch(() => {});
                    }
                }
            } catch (err: any) {
                // If node is offline or unreachable
                logger.warn(`Could not reach node ${vps.node_id} for VPS ${vps.id}: ${err.message}`);
            }
        }
    }
}
