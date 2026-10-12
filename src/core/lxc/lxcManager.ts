import { isIPv4 } from 'net';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

export interface ContainerStats {
    id: string;
    status: 'running' | 'stopped' | 'frozen' | 'error';
    pid?: number;
    ip?: string;
    ramUsedMb: number;
    ramLimitMb: number;
    cpuCount: number;
    uptimeSeconds?: number;
}

export interface CreateLxcOptions {
    id: string;
    distro: string;
    release: string;
    arch?: string;
    ramMb: number;
    cpuCores: number;
    diskGb: number;
    ipAddress: string;
    bridgeName?: string;
}

export function validateCreateOptions(options: CreateLxcOptions): void {
    if (!options || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/.test(options.id || '')) throw new Error('Invalid container ID.');
    for (const value of [options.distro, options.release, options.arch ?? 'amd64']) {
        if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error('Invalid OS image parameters.');
    }
    if (!Number.isInteger(options.ramMb) || options.ramMb < 256 || options.ramMb > 65536 ||
        !Number.isInteger(options.cpuCores) || options.cpuCores < 1 || options.cpuCores > 64 ||
        !Number.isInteger(options.diskGb) || options.diskGb < 2 || options.diskGb > 2000) {
        throw new Error('Invalid RAM, CPU or disk allocation.');
    }
    if (typeof options.ipAddress !== 'string' || !isIPv4(options.ipAddress)) throw new Error('Invalid IPv4 address.');
}

export class LxcManager {
    private lxcPath: string;
    private bridgeName: string;

    constructor(lxcPath: string = '/var/lib/lxc', bridgeName: string = 'lxcbr0') {
        this.lxcPath = lxcPath;
        this.bridgeName = bridgeName;
    }

    private getConfigPath(containerId: string): string {
        return path.join(this.lxcPath, containerId, 'config');
    }

    private getRootfsPath(containerId: string): string {
        return path.join(this.lxcPath, containerId, 'rootfs');
    }

    /**
     * Check if a container exists
     */
    async exists(containerId: string): Promise<boolean> {
        try {
            const { stdout } = await execFileAsync('lxc-info', ['-P', this.lxcPath, '-n', containerId]);
            return !stdout.includes("doesn't exist");
        } catch {
            return false;
        }
    }

    /**
     * Create an LXC container using download or standard template
     */
    async create(options: CreateLxcOptions): Promise<void> {
        validateCreateOptions(options);
        const { id, distro, release, arch = 'amd64' } = options;
        logger.info(`Starting creation of LXC container ${id} (${distro} ${release})...`);

        if (await this.exists(id)) {
            throw new Error(`Container ${id} already exists`);
        }

        // Use lxc-create with download template
        // Note: In non-interactive mode, download template requires --dist, --release, --arch
        const args = [
            '-P', this.lxcPath, '-n', id,
            '-t', 'download',
            '--',
            '--dist', distro.toLowerCase(),
            '--release', release.toLowerCase(),
            '--arch', arch,
            '--no-validate'
        ];

        try {
            await execFileAsync('lxc-create', args, { timeout: 300000 });
        } catch (err: any) {
            logger.error(`lxc-create failed for ${id}: ${err.message}`);
            // Rollback container directory if partially created
            await this.destroy(id).catch(() => {});
            throw new Error(`Failed to download and create container OS: ${err.message}`);
        }

        // Write container configuration (cgroup v2 resource limits & networking)
        await this.applyConfig(options);
        logger.info(`Successfully created and configured container ${id}`);
    }

    /**
     * Write/update lxc configuration file with cgroup2 memory/cpu limits and network
     */
    async applyConfig(options: CreateLxcOptions): Promise<void> {
        const configPath = this.getConfigPath(options.id);
        const bridge = options.bridgeName || this.bridgeName;

        // Generate cgroups & veth config
        const memoryBytes = options.ramMb * 1024 * 1024;
        const cpuCores = Math.max(1, options.cpuCores);
        const cpuMax = `${cpuCores * 100000} 100000`; // quota period

        // Base network and resource configs
        const configLines = [
            `# Distribution configuration`,
            `lxc.include = /usr/share/lxc/config/common.conf`,
            `lxc.arch = linux64`,
            ``,
            `# Container specific configuration`,
            `lxc.rootfs.path = dir:${this.getRootfsPath(options.id)}`,
            `lxc.uts.name = ${options.id}`,
            ``,
            `# Network configuration`,
            `lxc.net.0.type = veth`,
            `lxc.net.0.link = ${bridge}`,
            `lxc.net.0.flags = up`,
            `lxc.net.0.hwaddr = 00:16:3e:${Math.floor(Math.random() * 89 + 10)}:${Math.floor(Math.random() * 89 + 10)}:${Math.floor(Math.random() * 89 + 10)}`,
            `lxc.net.0.ipv4.address = ${options.ipAddress}/24`,
            `lxc.net.0.ipv4.gateway = 10.0.3.1`,
            ``,
            `# Cgroup v2 Limits`,
            `lxc.cgroup2.memory.max = ${memoryBytes}`,
            `lxc.cgroup2.cpu.max = ${cpuMax}`,
            `lxc.cgroup2.pids.max = 2048`,
            ``,
            `# Autostart`,
            `lxc.start.auto = 1`,
            `lxc.start.delay = 5`,
            ``,
        ];

        // Retain the download template's distribution-specific includes and settings.
        const existing = await fs.promises.readFile(configPath, 'utf8').catch(() => '');
        const managed = /^(?:lxc\.(?:arch|rootfs\.path|uts\.name|net\.0\..*|cgroup2\.(?:memory\.max|cpu\.max|pids\.max)|start\.(?:auto|delay)))\s*=/;
        const preserved = existing.split('\n').filter((line) => !managed.test(line.trim()));
        const generated = existing.trim()
            ? configLines.filter((line) => !line.startsWith('lxc.include ='))
            : configLines;
        await fs.promises.writeFile(configPath, [...preserved, ...generated].join('\n'), 'utf8');

        // Setup container default DNS
        const resolvPath = path.join(this.getRootfsPath(options.id), 'etc', 'resolv.conf');
        try {
            if (fs.existsSync(path.dirname(resolvPath))) {
                const stat = await fs.promises.lstat(resolvPath).catch(() => null);
                if (stat?.isSymbolicLink()) await fs.promises.unlink(resolvPath);
                await fs.promises.writeFile(resolvPath, 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n', 'utf8');
            }
        } catch (e: any) {
            logger.warn(`Could not pre-configure /etc/resolv.conf in container: ${e.message}`);
        }
    }

    /**
     * Start an LXC container
     */
    async start(containerId: string): Promise<void> {
        logger.info(`Starting container ${containerId}...`);
        try {
            await execFileAsync('lxc-start', ['-P', this.lxcPath, '-n', containerId, '-d'], { timeout: 30000 });
            // Wait for it to enter RUNNING state
            if (!await this.waitForState(containerId, 'RUNNING', 15000)) {
                throw new Error('Timed out waiting for RUNNING state');
            }
        } catch (err: any) {
            throw new Error(`Failed to start container ${containerId}: ${err.message}`);
        }
    }

    /**
     * Stop an LXC container
     */
    async stop(containerId: string): Promise<void> {
        if ((await this.getInfo(containerId)).status === 'stopped') return;
        logger.info(`Stopping container ${containerId}...`);
        try {
            // Attempt clean stop, fallback to kill (-k)
            try {
                await execFileAsync('lxc-stop', ['-P', this.lxcPath, '-n', containerId, '-t', '10'], { timeout: 15000 });
            } catch {
                await execFileAsync('lxc-stop', ['-P', this.lxcPath, '-n', containerId, '-k'], { timeout: 10000 });
            }
        } catch (err: any) {
            throw new Error(`Failed to stop container ${containerId}: ${err.message}`);
        }
    }

    /**
     * Restart container
     */
    async restart(containerId: string): Promise<void> {
        await this.stop(containerId);
        await new Promise((r) => setTimeout(r, 1500));
        await this.start(containerId);
    }

    /**
     * Completely destroy container
     */
    async destroy(containerId: string): Promise<void> {
        logger.info(`Destroying container ${containerId}...`);
        try {
            await execFileAsync('lxc-destroy', ['-P', this.lxcPath, '-n', containerId, '-f'], { timeout: 30000 });
        } catch (err: any) {
            throw new Error(`Failed to destroy container ${containerId}: ${err.message}`);
        }
    }

    /**
     * Wait for a specific status state
     */
    async waitForState(containerId: string, expectedState: string, timeoutMs: number = 10000): Promise<boolean> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const stats = await this.getInfo(containerId).catch(() => null);
            if (stats && stats.status.toUpperCase() === expectedState.toUpperCase()) {
                return true;
            }
            await new Promise((r) => setTimeout(r, 1000));
        }
        return false;
    }

    /**
     * Get detailed status and resource usage from lxc-info
     */
    async getInfo(containerId: string): Promise<ContainerStats> {
        try {
            const { stdout } = await execFileAsync('lxc-info', ['-P', this.lxcPath, '-n', containerId]);
            const lines = stdout.split('\n');
            const data: Record<string, string> = {};

            for (const line of lines) {
                const parts = line.split(':');
                if (parts.length >= 2) {
                    const key = parts[0].trim().toLowerCase();
                    const value = parts.slice(1).join(':').trim();
                    data[key] = value;
                }
            }

            const rawStatus = (data['state'] || 'stopped').toLowerCase();
            const status: ContainerStats['status'] =
                rawStatus === 'running' ? 'running' : rawStatus === 'frozen' ? 'frozen' : 'stopped';

            const pid = data['pid'] ? parseInt(data['pid'], 10) : undefined;
            const ip = data['ip'] || data['ipv4'] || undefined;

            let ramUsedMb = 0;
            if (data['memory use']) {
                const match = data['memory use'].match(/([\d\.]+)\s*([a-zA-Z]+)/);
                if (match) {
                    const val = parseFloat(match[1]);
                    const unit = match[2].toUpperCase();
                    if (unit.startsWith('G')) ramUsedMb = Math.round(val * 1024);
                    else if (unit.startsWith('M')) ramUsedMb = Math.round(val);
                    else if (unit.startsWith('K')) ramUsedMb = Math.round(val / 1024);
                }
            }

            return {
                id: containerId,
                status,
                pid,
                ip,
                ramUsedMb,
                ramLimitMb: 0,
                cpuCount: 1,
            };
        } catch (err: any) {
            return {
                id: containerId,
                status: 'error',
                ramUsedMb: 0,
                ramLimitMb: 0,
                cpuCount: 1,
            };
        }
    }

    /**
     * Read container console logs (last N lines)
     */
    async getLogs(containerId: string, lines: number = 50): Promise<string> {
        const logPath = path.join(this.lxcPath, containerId, `${containerId}.log`);
        if (!fs.existsSync(logPath)) {
            return 'No log file found for this container.';
        }
        try {
            const { stdout } = await execFileAsync('tail', ['-n', String(lines), logPath]);
            return stdout;
        } catch {
            return 'Unable to read container log file.';
        }
    }

    /**
     * Execute a command strictly INSIDE the container
     * Checks against safe command allowlist
     */
    async execInside(containerId: string, cmd: string, args: string[] = []): Promise<{ stdout: string; stderr: string }> {
        // Enforce safe allowlist for exec inside container
        const ALLOWED_BINARIES = ['uptime', 'df', 'free', 'cat', 'ps', 'uname', 'ping', 'top', 'curl', 'ip', 'systemctl', 'echo', 'date', 'whoami'];
        const bin = path.basename(cmd);

        if (!ALLOWED_BINARIES.includes(bin)) {
            throw new Error(`Command "${bin}" is not in the allowed execution list for VPS containers.`);
        }

        return execFileAsync('lxc-attach', ['-P', this.lxcPath, '-n', containerId, '--', cmd, ...args], { timeout: 15000 });
    }

    /**
     * Dynamic resizing of RAM and CPU via cgroup v2
     */
    async resize(containerId: string, ramMb: number, cpuCores: number): Promise<void> {
        const memoryBytes = ramMb * 1024 * 1024;
        const cpuMax = `${cpuCores * 100000} 100000`;

        // Update active cgroup if running
        try {
            await execFileAsync('lxc-cgroup', ['-P', this.lxcPath, '-n', containerId, 'memory.max', String(memoryBytes)]);
            await execFileAsync('lxc-cgroup', ['-P', this.lxcPath, '-n', containerId, 'cpu.max', cpuMax]);
        } catch (err: any) {
            logger.warn(`Dynamic cgroup update notice for ${containerId}: ${err.message}`);
        }

        // Also update persistent config file
        const configPath = this.getConfigPath(containerId);
        if (fs.existsSync(configPath)) {
            let content = await fs.promises.readFile(configPath, 'utf8');
            content = content.replace(/lxc\.cgroup2\.memory\.max\s*=.*$/m, `lxc.cgroup2.memory.max = ${memoryBytes}`);
            content = content.replace(/lxc\.cgroup2\.cpu\.max\s*=.*$/m, `lxc.cgroup2.cpu.max = ${cpuMax}`);
            await fs.promises.writeFile(configPath, content, 'utf8');
        }
    }
}
