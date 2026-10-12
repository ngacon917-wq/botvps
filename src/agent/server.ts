import { Server } from 'http';
import express, { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { HostChecker } from '../core/compatibility/hostChecker.js';
import { LxcManager, validateCreateOptions } from '../core/lxc/lxcManager.js';
import { SshxManager } from '../core/sshx/sshxManager.js';
import { NetworkManager } from '../core/network/networkManager.js';
import { BackupManager } from '../core/backup/backupManager.js';

export function createAgentApp() {
    const app = express();
    app.use(express.json());

    const lxcManager = new LxcManager(config.agent.lxcPath, config.agent.bridgeInterface);
    const backupManager = new BackupManager(config.agent.backupPath, config.agent.lxcPath);

    // Authentication middleware
    const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
        const authHeader = req.headers.authorization;
        const expectedToken = config.agent.apiToken;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Unauthorized: Missing or invalid authorization header' });
            return;
        }

        const token = authHeader.substring(7);
        if (token !== expectedToken) {
            res.status(403).json({ error: 'Forbidden: Invalid API token' });
            return;
        }

        next();
    };

    // Public health check
    app.get('/api/health', (req: Request, res: Response) => {
        res.json({
            status: 'ok',
            nodeId: config.agent.nodeId,
            time: new Date().toISOString(),
        });
    });

    // Protected endpoints
    app.use('/api', authMiddleware);

    app.param('id', (req, res, next, id) => {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
            res.status(400).json({ error: 'Invalid resource ID' });
            return;
        }
        next();
    });

    // 1. Compatibility check
    app.get('/api/compatibility', async (req: Request, res: Response) => {
        try {
            const report = await HostChecker.checkHost(config.agent.bridgeInterface, config.agent.lxcPath);
            res.json(report);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 2. Node Resources
    app.get('/api/resources', async (req: Request, res: Response) => {
        try {
            const report = await HostChecker.checkHost(config.agent.bridgeInterface, config.agent.lxcPath);
            res.json({
                nodeId: config.agent.nodeId,
                freeDiskGb: report.freeDiskGb,
                isNestedLxc: report.isNestedLxc,
                compatible: report.compatible,
            });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 3. Create VPS container
    app.post('/api/vps/create', async (req: Request, res: Response) => {
        try {
            const { id, distro, release, arch, ramMb, cpuCores, diskGb, ipAddress } = req.body;
            if (!id || !distro || !release || !ramMb || !cpuCores) {
                res.status(400).json({ error: 'Missing required parameters' });
                return;
            }

            validateCreateOptions({ id, distro, release, arch, ramMb, cpuCores, diskGb, ipAddress });

            // Verify host compatibility first
            const comp = await HostChecker.checkHost(config.agent.bridgeInterface, config.agent.lxcPath);
            if (!comp.compatible) {
                res.status(400).json({
                    error: `Node host is incompatible for LXC creation: ${comp.issues.join('; ')}`,
                    recommendations: comp.recommendations,
                });
                return;
            }

            await lxcManager.create({
                id,
                distro,
                release,
                arch,
                ramMb,
                cpuCores,
                diskGb,
                ipAddress,
            });

            res.json({ success: true, message: `Container ${id} created` });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 4. Start VPS
    app.post('/api/vps/:id/start', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            await lxcManager.start(id);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 5. Stop VPS
    app.post('/api/vps/:id/stop', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            await lxcManager.stop(id);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 6. Restart VPS
    app.post('/api/vps/:id/restart', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            await lxcManager.restart(id);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 7. Reinstall VPS
    app.post('/api/vps/:id/reinstall', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const { distro, release, arch, ramMb, cpuCores, diskGb, ipAddress } = req.body;

            validateCreateOptions({ id, distro, release, arch, ramMb, cpuCores, diskGb, ipAddress });

            // Stop and destroy old container filesystem
            await lxcManager.stop(id).catch(() => {});
            await SshxManager.revokeSession(id).catch(() => {});
            await lxcManager.destroy(id);

            // Re-create cleanly with new OS
            await lxcManager.create({
                id,
                distro,
                release,
                arch,
                ramMb,
                cpuCores,
                diskGb,
                ipAddress,
            });

            // Start new container
            await lxcManager.start(id);

            res.json({ success: true, message: `Container ${id} reinstalled successfully.` });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 8. Delete VPS
    app.delete('/api/vps/:id', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            await lxcManager.stop(id).catch(() => {});
            await SshxManager.revokeSession(id).catch(() => {});
            await lxcManager.destroy(id);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 9. Status & Stats
    app.get('/api/vps/:id/stats', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const stats = await lxcManager.getInfo(id);
            res.json(stats);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 10. Console Logs
    app.get('/api/vps/:id/logs', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const lines = parseInt((req.query.lines as string) || '50', 10);
            const logs = await lxcManager.getLogs(id, lines);
            res.json({ logs });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 11. Exec inside container
    app.post('/api/vps/:id/exec', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const { command, args = [] } = req.body;
            const result = await lxcManager.execInside(id, command, args);
            res.json(result);
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // 12. SSHX Terminal Session
    app.post('/api/vps/:id/sshx/create', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const { userId } = req.body;
            const result = await SshxManager.createSession(id, userId || 'system');
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/vps/:id/sshx/stop', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            await SshxManager.revokeSession(id);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/vps/:id/sshx/status', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const alive = await SshxManager.isProcessAlive(id);
            res.json({ active: alive });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 13. Dynamic Resize
    app.post('/api/vps/:id/resize', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const { ramMb, cpuCores } = req.body;
            await lxcManager.resize(id, ramMb, cpuCores);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 14. Network Management
    app.get('/api/vps/:id/network/dns', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const resolvers = await NetworkManager.getDns(id);
            res.json({ resolvers });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/vps/:id/network/setdns', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const { resolvers } = req.body;
            await NetworkManager.setDns(id, resolvers);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/vps/:id/network/ping', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const { host } = req.body;
            const output = await NetworkManager.pingHost(id, host);
            res.json({ output });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/vps/:id/network/portadd', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const { ipAddress, publicPort, privatePort, protocol } = req.body;
            await NetworkManager.addPortForward(id, ipAddress, publicPort, privatePort, protocol);
            res.json({ success: true });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    app.post('/api/vps/:id/network/portremove', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const { ipAddress, publicPort, privatePort, protocol } = req.body;
            await NetworkManager.removePortForward(id, ipAddress, publicPort, privatePort, protocol);
            res.json({ success: true });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // 15. Backup & Restore
    app.post('/api/vps/:id/backup', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const record = await backupManager.createBackup(id);
            res.json(record);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/vps/:id/restore', async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id);
            const { backupId } = req.body;
            await backupManager.restoreBackup(id, backupId);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/backups/:id', async (req: Request, res: Response) => {
        try {
            const deleted = await backupManager.deleteBackup(String(req.params.id));
            res.status(deleted ? 200 : 404).json({ success: deleted });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return app;
}

export async function startAgentServer(port: number = config.agent.port): Promise<Server> {
    const app = createAgentApp();
    return new Promise((resolve, reject) => {
        const server = app.listen(port, config.agent.host);
        server.once('error', reject);
        server.once('listening', () => {
            logger.info(`VPS Node Agent listening on ${config.agent.host}:${port} (Node ID: ${config.agent.nodeId})`);
            resolve(server);
        });
    });
}
