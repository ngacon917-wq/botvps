import { query } from '../client.js';

export interface BackupRecord {
    id: string;
    vps_id: string;
    filename: string;
    size_bytes: number;
    checksum?: string;
    status: 'creating' | 'completed' | 'failed';
    created_at: Date;
}

export class BackupRepository {
    static async create(data: {
        id: string;
        vpsId: string;
        filename: string;
        sizeBytes?: number;
        checksum?: string;
    }): Promise<BackupRecord> {
        const sql = `
            INSERT INTO backups (id, vps_id, filename, size_bytes, checksum, status)
            VALUES ($1, $2, $3, $4, $5, 'completed')
            RETURNING *;
        `;
        const res = await query<BackupRecord>(sql, [
            data.id,
            data.vpsId,
            data.filename,
            data.sizeBytes || 0,
            data.checksum || null,
        ]);
        return res.rows[0];
    }

    static async getByVps(vpsId: string): Promise<BackupRecord[]> {
        const res = await query<BackupRecord>(
            `SELECT * FROM backups WHERE vps_id = $1 ORDER BY created_at DESC`,
            [vpsId]
        );
        return res.rows;
    }

    static async getById(id: string): Promise<BackupRecord | null> {
        const res = await query<BackupRecord>(`SELECT * FROM backups WHERE id = $1`, [id]);
        return res.rows[0] || null;
    }

    static async delete(id: string): Promise<boolean> {
        const res = await query(`DELETE FROM backups WHERE id = $1 RETURNING id`, [id]);
        return (res.rowCount ?? 0) > 0;
    }
}
