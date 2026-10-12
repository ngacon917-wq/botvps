import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('child_process', () => ({ execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: exec }) }));
import { LxcManager, validateCreateOptions } from '../src/core/lxc/lxcManager.js';
import { NetworkManager } from '../src/core/network/networkManager.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
beforeEach(() => { exec.mockReset().mockResolvedValue({ stdout: '', stderr: '' }); });
afterEach(() => vi.restoreAllMocks());
describe('LXC runtime failures', () => {
    it('rejects startup if the container never becomes running', async () => {
        const manager = new LxcManager('/custom/lxc');
        vi.spyOn(manager, 'waitForState').mockResolvedValue(false);
        await expect(manager.start('vps-0001')).rejects.toThrow('Timed out');
        expect(exec).toHaveBeenCalledWith('lxc-start', ['-P', '/custom/lxc', '-n', 'vps-0001', '-d'], expect.anything());
    });
    it('propagates failed deletion instead of reporting success', async () => {
        exec.mockRejectedValue(new Error('permission denied'));
        await expect(new LxcManager().destroy('vps-0001')).rejects.toThrow('permission denied');
    });
    it('rejects invalid provisioning values', () => {
        expect(() => validateCreateOptions({ id: '../host' } as any)).toThrow('Invalid container ID');
    });
    it('rejects DNS shell input before executing commands', async () => {
        await expect(NetworkManager.setDns('vps-0001', ['$(touch /tmp/injected)'])).rejects.toThrow('valid IP');
        expect(exec).not.toHaveBeenCalled();
    });
    it('retains distribution config and never follows a resolv.conf symlink into the host', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vpsbot-lxc-'));
        try {
            const container = path.join(dir, 'vps-0001');
            await fs.mkdir(path.join(container, 'rootfs', 'etc'), { recursive: true });
            await fs.writeFile(path.join(container, 'config'), 'lxc.include = /usr/share/lxc/config/debian.common.conf\nlxc.cgroup2.memory.max = 1\n');
            const outside = path.join(dir, 'host-resolv');
            await fs.writeFile(outside, 'host DNS');
            await fs.symlink(outside, path.join(container, 'rootfs', 'etc', 'resolv.conf'));
            await new LxcManager(dir).applyConfig({ id: 'vps-0001', distro: 'debian', release: 'trixie', ramMb: 512, cpuCores: 1, diskGb: 5, ipAddress: '10.0.3.50' });
            const config = await fs.readFile(path.join(container, 'config'), 'utf8');
            expect(config).toContain('debian.common.conf');
            expect(config.match(/lxc.cgroup2.memory.max =/g)).toHaveLength(1);
            expect(await fs.readFile(outside, 'utf8')).toBe('host DNS');
        } finally { await fs.rm(dir, { recursive: true, force: true }); }
    });
});
