import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BackupManager } from '../src/core/backup/backupManager.js';
import { BackupRepository } from '../src/db/repositories/backupRepository.js';
import { LxcManager } from '../src/core/lxc/lxcManager.js';

const exec = promisify(execFile);
let dir: string;
let root: string;
let manager: BackupManager;
let record: any;
beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vpsbot-test-'));
    root = path.join(dir, 'lxc', 'vps-0001', 'rootfs');
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(path.join(dir, 'backups'));
    await fs.mkdir(path.join(dir, 'snapshot'));
    await fs.writeFile(path.join(root, '.old'), 'stale secret');
    await fs.writeFile(path.join(root, 'old'), 'stale file');
    await fs.writeFile(path.join(dir, 'snapshot', 'restored'), 'saved');
    await exec('tar', ['-czf', path.join(dir, 'backups', 'test.tar.gz'), '-C', path.join(dir, 'snapshot'), '.']);
    record = { id: 'bk-test', vps_id: 'vps-0001', filename: 'test.tar.gz' };
    vi.spyOn(BackupRepository, 'getById').mockImplementation(async () => record);
    vi.spyOn(LxcManager.prototype, 'getInfo').mockResolvedValue({ status: 'stopped' } as any);
    manager = new BackupManager(path.join(dir, 'backups'), path.join(dir, 'lxc'));
});
afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
});
describe('backup restore', () => {
    it('replaces old and hidden files with the complete archived tree', async () => {
        await manager.restoreBackup('vps-0001', 'bk-test');
        expect(await fs.readdir(root)).toEqual(['restored']);
        expect(await fs.readFile(path.join(root, 'restored'), 'utf8')).toBe('saved');
    });
    it('preserves existing files when the archive is corrupt', async () => {
        await fs.writeFile(path.join(dir, 'backups', 'test.tar.gz'), 'invalid');
        await expect(manager.restoreBackup('vps-0001', 'bk-test')).rejects.toThrow();
        expect(await fs.readFile(path.join(root, '.old'), 'utf8')).toBe('stale secret');
    });
    it('rejects a backup belonging to another VPS', async () => {
        record.vps_id = 'vps-0002';
        await expect(manager.restoreBackup('vps-0001', 'bk-test')).rejects.toThrow('does not belong');
    });
    it('refuses to restore a running container', async () => {
        vi.mocked(LxcManager.prototype.getInfo).mockResolvedValue({ status: 'running' } as any);
        await expect(manager.restoreBackup('vps-0001', 'bk-test')).rejects.toThrow('must be stopped');
        expect(await fs.readdir(root)).toContain('.old');
    });
    it('removes the archive and its database record', async () => {
        const remove = vi.spyOn(BackupRepository, 'delete').mockResolvedValue(true);
        await expect(manager.deleteBackup('bk-test')).resolves.toBe(true);
        await expect(fs.stat(path.join(dir, 'backups', 'test.tar.gz'))).rejects.toThrow();
        expect(remove).toHaveBeenCalledWith('bk-test');
    });
});
