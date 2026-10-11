import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

export interface CompatibilityReport {
    compatible: boolean;
    virtualization: string;
    isNestedLxc: boolean;
    hasLxcBinaries: boolean;
    hasCgroupV2: boolean;
    hasBridge: boolean;
    hasIptables: boolean;
    freeDiskGb: number;
    issues: string[];
    recommendations: string[];
}

export class HostChecker {
    static async checkHost(bridgeName: string = 'lxcbr0', lxcPath: string = '/var/lib/lxc'): Promise<CompatibilityReport> {
        const issues: string[] = [];
        const recommendations: string[] = [];

        // 1. Detect virtualization
        let virt = 'unknown';
        try {
            const { stdout } = await execFileAsync('systemd-detect-virt', []);
            virt = stdout.trim();
        } catch {
            virt = 'bare-metal/unknown';
        }

        const isNestedLxc = virt.toLowerCase().includes('lxc');
        if (isNestedLxc) {
            issues.push(`Host is running inside an existing LXC container (${virt}). Nested LXC may fail if nested virtualization is unprivileged or disallowed by provider.`);
            recommendations.push('Run Node Agent on a Bare Metal or KVM VPS, or enable Remote LXC Node Mode in VPSBot.');
        }

        // 2. Check LXC binaries
        let hasLxcBinaries = false;
        try {
            await execFileAsync('which', ['lxc-create']);
            hasLxcBinaries = true;
        } catch {
            issues.push('LXC utilities (lxc-create, lxc-start) not found on host.');
            recommendations.push('Install LXC: apt-get update && apt-get install -y lxc lxc-templates bridge-utils');
        }

        // 3. Check Cgroup v2
        const hasCgroupV2 = fs.existsSync('/sys/fs/cgroup/cgroup.controllers');
        if (!hasCgroupV2) {
            issues.push('Cgroup v2 is not active on this host.');
            recommendations.push('Enable unified cgroup hierarchy in kernel command line: systemd.unified_cgroup_hierarchy=1');
        }

        // 4. Check Network Bridge
        let hasBridge = false;
        try {
            const { stdout } = await execFileAsync('ip', ['link', 'show', bridgeName]);
            hasBridge = stdout.includes(bridgeName);
        } catch {
            issues.push(`Network bridge interface "${bridgeName}" not detected.`);
            recommendations.push(`Setup LXC bridge: apt-get install -y dnsmasq-base && brctl addbr ${bridgeName} or configure lxc-net.`);
        }

        // 5. Check iptables
        let hasIptables = false;
        try {
            await execFileAsync('which', ['iptables']);
            hasIptables = true;
        } catch {
            issues.push('iptables not found. NAT port forwarding cannot be automated.');
            recommendations.push('Install iptables: apt-get install -y iptables');
        }

        // 6. Check free disk space
        let freeDiskGb = 0;
        try {
            const checkDir = fs.existsSync(lxcPath) ? lxcPath : '/';
            const { stdout } = await execFileAsync('df', ['-BG', checkDir]);
            const lines = stdout.trim().split('\n');
            if (lines.length > 1) {
                const parts = lines[1].split(/\s+/);
                freeDiskGb = parseInt(parts[3]?.replace('G', '') || '0', 10);
            }
        } catch (e: any) {
            logger.warn(`Failed to inspect disk space: ${e.message}`);
        }

        if (freeDiskGb < 5) {
            issues.push(`Low available disk space (${freeDiskGb} GB free).`);
            recommendations.push('Ensure at least 20 GB free space for creating container rootfs images.');
        }

        const compatible = hasLxcBinaries && hasCgroupV2 && !isNestedLxc;

        return {
            compatible,
            virtualization: virt,
            isNestedLxc,
            hasLxcBinaries,
            hasCgroupV2,
            hasBridge,
            hasIptables,
            freeDiskGb,
            issues,
            recommendations,
        };
    }
}
