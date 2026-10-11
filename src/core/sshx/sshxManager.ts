import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';
import { SshxRepository } from '../../db/repositories/sshxRepository.js';

const execFileAsync = promisify(execFile);

export interface SshxSessionResult {
    success: boolean;
    sessionUrl?: string;
    error?: string;
}

export class SshxManager {
    /**
     * Ensure sshx is installed inside the LXC container
     */
    static async ensureInstalled(containerId: string): Promise<boolean> {
        try {
            // Check if sshx binary exists in container
            const { stdout } = await execFileAsync('lxc-attach', ['-n', containerId, '--', 'which', 'sshx']).catch(() => ({ stdout: '' }));
            if (stdout.includes('sshx')) {
                return true;
            }

            logger.info(`Installing sshx inside container ${containerId}...`);
            // Install curl/ca-certificates if missing, then install sshx
            await execFileAsync('lxc-attach', ['-n', containerId, '--', 'sh', '-c', 'command -v curl >/dev/null || (apt-get update && apt-get install -y curl ca-certificates) || (apk add --no-cache curl)'], { timeout: 120000 });
            await execFileAsync('lxc-attach', ['-n', containerId, '--', 'sh', '-c', 'curl -sSf https://sshx.io/get | sh'], { timeout: 120000 });

            return true;
        } catch (err: any) {
            logger.error(`Failed to install sshx in container ${containerId}: ${err.message}`);
            return false;
        }
    }

    /**
     * Create or retrieve a new SSHX terminal session
     * Runs sshx in background, captures session URL, verifies process health
     */
    static async createSession(containerId: string, userId: string): Promise<SshxSessionResult> {
        logger.info(`Creating SSHX session for container ${containerId}...`);

        try {
            // 1. Ensure installed
            const installed = await this.ensureInstalled(containerId);
            if (!installed) {
                return { success: false, error: 'Could not install or verify SSHX binary inside the container.' };
            }

            // 2. Kill any old existing sshx session in the container
            await this.revokeSession(containerId);

            // 3. Launch sshx and write output to log
            const sessionLog = '/tmp/sshx_session.log';
            await execFileAsync('lxc-attach', ['-n', containerId, '--', 'sh', '-c', `rm -f ${sessionLog} && nohup sshx > ${sessionLog} 2>&1 &`], { timeout: 15000 });

            // 4. Poll for URL in log (up to 15 seconds)
            let sessionUrl: string | null = null;
            const startTime = Date.now();
            while (Date.now() - startTime < 15000) {
                try {
                    const { stdout } = await execFileAsync('lxc-attach', ['-n', containerId, '--', 'cat', sessionLog]);
                    const match = stdout.match(/https:\/\/sshx\.io\/s\/[a-zA-Z0-9_\-]+/);
                    if (match) {
                        sessionUrl = match[0];
                        break;
                    }
                } catch {}
                await new Promise((r) => setTimeout(r, 1000));
            }

            if (!sessionUrl) {
                return { success: false, error: 'Timed out waiting for SSHX to generate session link.' };
            }

            // 5. Verify process is genuinely running
            const isAlive = await this.isProcessAlive(containerId);
            if (!isAlive) {
                return { success: false, error: 'SSHX exited unexpectedly right after launch.' };
            }

            // 6. Record in DB with hashed secret and revoke previous sessions
            await SshxRepository.createSession(containerId, userId, sessionUrl);

            return {
                success: true,
                sessionUrl,
            };
        } catch (err: any) {
            logger.error(`Error creating SSHX session for ${containerId}: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    /**
     * Check if sshx process is actively running inside container
     */
    static async isProcessAlive(containerId: string): Promise<boolean> {
        try {
            const { stdout } = await execFileAsync('lxc-attach', ['-n', containerId, '--', 'pgrep', 'sshx']);
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Revoke active SSHX session by terminating process inside container
     */
    static async revokeSession(containerId: string): Promise<void> {
        try {
            await execFileAsync('lxc-attach', ['-n', containerId, '--', 'sh', '-c', 'pkill -9 sshx || true'], { timeout: 10000 });
            await SshxRepository.revokeAllForVps(containerId);
            logger.info(`Revoked SSHX session for container ${containerId}`);
        } catch (err: any) {
            logger.warn(`Notice while revoking sshx in ${containerId}: ${err.message}`);
        }
    }
}
