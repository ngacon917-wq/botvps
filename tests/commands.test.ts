import { describe, it, expect } from 'vitest';
import { commandMap } from '../src/bot/commands/index.js';
import { isOwner } from '../src/config/index.js';

describe('Discord VPSBot Command Suite Verification', () => {
    const requiredCommands = [
        // 1. VPS Creation & Management
        'create', 'manage', 'list', 'info', 'start', 'stop', 'restart', 'reinstall', 'delete', 'rename', 'status', 'uptime', 'os', 'transfer',
        // 2. Resources & Statistics
        'stats', 'usage', 'resources', 'resize', 'setram', 'setcpu', 'setdisk', 'limits', 'top',
        // 3. SSHX & Terminal
        'sshx', 'terminal', 'sshxreset', 'sshxstop', 'sshxstatus', 'console', 'exec', 'logs',
        // 4. Networking & NAT
        'ip', 'network', 'ports', 'portadd', 'portremove', 'dns', 'setdns', 'ping', 'bandwidth',
        // 5. Backup & Recovery
        'backup', 'backups', 'restore', 'backupdelete', 'autobackup',
        // 6. Admin Commands
        'admin', 'nodes', 'nodeinfo', 'nodeadd', 'noderemove', 'maintenance', 'allvps', 'suspend', 'unsuspend', 'setowner', 'setquota', 'banvps', 'unbanvps', 'audit',
        // 7. User & Utility
        'help', 'profile', 'myvps', 'quota', 'notifications', 'health', 'images', 'version', 'support'
    ];

    it('should have all 60 prompt commands registered in commandMap', () => {
        for (const cmdName of requiredCommands) {
            const cmd = commandMap.get(cmdName);
            expect(cmd, `Command "?${cmdName}" must be implemented`).toBeDefined();
            expect(cmd?.name).toBe(cmdName);
        }
    });

    it('should enforce that "manage" and "help" allow non-owner execution', () => {
        const manageCmd = commandMap.get('manage');
        const helpCmd = commandMap.get('help');

        expect(manageCmd?.ownerOnly).toBe(false);
        expect(helpCmd?.ownerOnly).toBe(false);
    });

    it('should enforce that administrative and lifecycle commands are ownerOnly', () => {
        const adminCmds = ['create', 'delete', 'resize', 'admin', 'backup', 'nodes', 'setquota', 'banvps', 'reinstall'];
        for (const name of adminCmds) {
            const cmd = commandMap.get(name);
            expect(cmd?.ownerOnly, `Command "?${name}" must be ownerOnly = true`).toBe(true);
        }
    });
});
