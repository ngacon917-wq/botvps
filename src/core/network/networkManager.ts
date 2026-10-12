import { isIP } from 'net';
import { config } from '../../config/index.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { NatRepository } from '../../db/repositories/natRepository.js';

const execFileAsync = promisify(execFile);

export class NetworkManager {
    /**
     * Add a NAT port forward rule using iptables
     */
    static async addPortForward(vpsId: string, containerIp: string, publicPort: number, privatePort: number, protocol: 'tcp' | 'udp' = 'tcp'): Promise<void> {
        // Validation
        if (publicPort < 1024 || publicPort > 65535) {
            throw new Error('Public port must be between 1024 and 65535.');
        }
        if (privatePort < 1 || privatePort > 65535) {
            throw new Error('Private port must be between 1 and 65535.');
        }

        const isTaken = await NatRepository.isPortTaken(publicPort, protocol);
        if (isTaken) {
            throw new Error(`Public port ${publicPort}/${protocol} is already allocated.`);
        }

        logger.info(`Adding NAT rule: ${publicPort} -> ${containerIp}:${privatePort} (${protocol})`);

        try {
            // Apply DNAT prerouting
            await execFileAsync('iptables', [
                '-t', 'nat',
                '-A', 'PREROUTING',
                '-p', protocol,
                '--dport', String(publicPort),
                '-j', 'DNAT',
                '--to-destination', `${containerIp}:${privatePort}`,
            ]);

            // Allow Forwarding
            await execFileAsync('iptables', [
                '-A', 'FORWARD',
                '-p', protocol,
                '-d', containerIp,
                '--dport', String(privatePort),
                '-j', 'ACCEPT',
            ]);
        } catch (err: any) {
            logger.error(`iptables command failed: ${err.message}`);
            throw new Error(`Failed to apply iptables rule: ${err.message}`);
        }

        await NatRepository.addMapping(vpsId, publicPort, privatePort, protocol);
    }

    /**
     * Remove a NAT port forward rule
     */
    static async removePortForward(vpsId: string, containerIp: string, publicPort: number, privatePort: number, protocol: 'tcp' | 'udp' = 'tcp'): Promise<void> {
        logger.info(`Removing NAT rule for public port ${publicPort}`);

        try {
            await execFileAsync('iptables', [
                '-t', 'nat',
                '-D', 'PREROUTING',
                '-p', protocol,
                '--dport', String(publicPort),
                '-j', 'DNAT',
                '--to-destination', `${containerIp}:${privatePort}`,
            ]).catch(() => {});

            await execFileAsync('iptables', [
                '-D', 'FORWARD',
                '-p', protocol,
                '-d', containerIp,
                '--dport', String(privatePort),
                '-j', 'ACCEPT',
            ]).catch(() => {});
        } catch (err: any) {
            logger.warn(`Notice while removing iptables rule: ${err.message}`);
        }

        await NatRepository.removeMapping(vpsId, publicPort);
    }

    /**
     * Inspect DNS resolvers configured in container
     */
    static async getDns(containerId: string): Promise<string[]> {
        try {
            const { stdout } = await execFileAsync('lxc-attach', ['-P', config.agent.lxcPath, '-n', containerId, '--', 'cat', '/etc/resolv.conf']);
            const resolvers: string[] = [];
            for (const line of stdout.split('\n')) {
                const match = line.match(/^nameserver\s+([^\s]+)/);
                if (match) resolvers.push(match[1]);
            }
            return resolvers.length ? resolvers : ['1.1.1.1', '8.8.8.8'];
        } catch {
            return ['1.1.1.1', '8.8.8.8'];
        }
    }

    /**
     * Set DNS resolvers in container
     */
    static async setDns(containerId: string, resolvers: string[]): Promise<void> {
        if (!Array.isArray(resolvers) || !resolvers.length || resolvers.some((r) => typeof r !== 'string' || !isIP(r))) {
            throw new Error('DNS resolvers must be valid IP addresses.');
        }
        const content = resolvers.map((r) => `nameserver ${r}`).join('\n') + '\n';
        await execFileAsync('lxc-attach', ['-P', config.agent.lxcPath, '-n', containerId, '--', 'sh', '-c', `echo "${content.trim()}" > /etc/resolv.conf`]);
    }

    /**
     * Test ping latency from inside container
     */
    static async pingHost(containerId: string, targetHost: string): Promise<string> {
        // Sanitize host string
        const cleanHost = targetHost.replace(/[^a-zA-Z0-9\.\-]/g, '');
        if (!cleanHost) throw new Error('Invalid host specified.');

        try {
            const { stdout } = await execFileAsync('lxc-attach', ['-P', config.agent.lxcPath, '-n', containerId, '--', 'ping', '-c', '3', '-W', '2', cleanHost]);
            return stdout;
        } catch (err: any) {
            return `Ping failed: ${err.message}`;
        }
    }
}
