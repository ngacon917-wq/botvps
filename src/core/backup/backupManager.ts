import { LxcManager } from '../lxc/lxcManager.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../../utils/logger.js';
import { BackupRepository, BackupRecord } from '../../db/repositories/backupRepository.js';

const execFileAsync = promisify(execFile);

export class BackupManager {
    private backupDir: string;
    private lxcDir: string;

    constructor(backupDir: string = '/var/lib/vpsbot/backups', lxcDir: string = '/var/lib/lxc') {
        this.backupDir = backupDir;
        this.lxcDir = lxcDir;
    }

    private async ensureBackupDir(): Promise<void> {
        if (!fs.existsSync(this.backupDir)) {
            await fs.promises.mkdir(this.backupDir, { recursive: true });
        }
    }

    /**
     * Compute SHA-256 hash of a file
     */
    private async calculateChecksum(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);
            stream.on('data', (data) => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    }

    /**
     * Create a compressed tarball backup of a container's rootfs
     */
    async createBackup(containerId: string): Promise<BackupRecord> {
        await this.ensureBackupDir();

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupId = `bk-${containerId}-${timestamp}`;
        const archiveName = `${backupId}.tar.gz`;
        const archivePath = path.join(this.backupDir, archiveName);
        const rootfsPath = path.join(this.lxcDir, containerId, 'rootfs');

        if (!fs.existsSync(rootfsPath)) {
            throw new Error(`Container rootfs path not found: ${rootfsPath}`);
        }

        logger.info(`Creating backup ${backupId} for container ${containerId}...`);

        try {
            // Compress container rootfs
            await execFileAsync('tar', ['-czf', archivePath, '-C', rootfsPath, '.'], { timeout: 300000 });

            const stats = await fs.promises.stat(archivePath);
            const checksum = await this.calculateChecksum(archivePath);

            const record = await BackupRepository.create({
                id: backupId,
                vpsId: containerId,
                filename: archiveName,
                sizeBytes: stats.size,
                checksum,
            });

            logger.info(`Backup ${backupId} completed successfully (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
            return record;
        } catch (err: any) {
            // Clean up failed archive if present
            if (fs.existsSync(archivePath)) {
                await fs.promises.unlink(archivePath).catch(() => {});
            }
            logger.error(`Backup failed for ${containerId}: ${err.message}`);
            throw new Error(`Backup failed: ${err.message}`);
        }
    }

    /**
     * Restore container rootfs from a backup archive
     */
    async restoreBackup(containerId: string, backupId: string): Promise<void> {
        const record = await BackupRepository.getById(backupId);
        if (!record) {
            throw new Error(`Backup ${backupId} not found.`);
        }

        if (path.basename(record.filename) !== record.filename) throw new Error('Invalid backup filename.');
        if (record.vps_id !== containerId) throw new Error('Backup does not belong to this VPS.');
        const archivePath = path.join(this.backupDir, record.filename);
        if (!fs.existsSync(archivePath)) {
            throw new Error(`Backup archive file is missing on storage: ${record.filename}`);
        }

        // Verify checksum integrity before restoring
        if (record.checksum) {
            const currentChecksum = await this.calculateChecksum(archivePath);
            if (currentChecksum !== record.checksum) {
                throw new Error('Backup integrity validation failed! Checksum mismatch.');
            }
        }

        const rootfsPath = path.join(this.lxcDir, containerId, 'rootfs');
        logger.info(`Restoring container ${containerId} from ${backupId}...`);

        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(containerId)) throw new Error('Invalid container ID.');
        const manager = new LxcManager(this.lxcDir);
        if ((await manager.getInfo(containerId)).status !== 'stopped') {
            throw new Error('Container must be stopped before restoring a backup.');
        }
        if (!(await fs.promises.lstat(rootfsPath)).isDirectory()) throw new Error('Rootfs must be a directory.');
        const staging = await fs.promises.mkdtemp(path.join(this.lxcDir, containerId, '.restore-'));
        const previous = `${staging}-previous`;
        try {
            // Extract completely before replacing the old tree, including hidden files.
            await execFileAsync('tar', ['-xzf', archivePath, '-C', staging], { timeout: 300000 });
            await fs.promises.rename(rootfsPath, previous);
            try {
                await fs.promises.rename(staging, rootfsPath);
            } catch (err) {
                await fs.promises.rename(previous, rootfsPath);
                throw err;
            }
            await fs.promises.rm(previous, { recursive: true, force: true });
            logger.info(`Successfully restored container ${containerId}`);
        } finally {
            await fs.promises.rm(staging, { recursive: true, force: true });
        }
    }

    /**
     * Delete a backup file and database record
     */
    async deleteBackup(backupId: string): Promise<boolean> {
        const record = await BackupRepository.getById(backupId);
        if (!record) return false;

        if (path.basename(record.filename) !== record.filename) throw new Error('Invalid backup filename.');
        const archivePath = path.join(this.backupDir, record.filename);
        if (fs.existsSync(archivePath)) {
            await fs.promises.unlink(archivePath);
        }

        return BackupRepository.delete(backupId);
    }
}
