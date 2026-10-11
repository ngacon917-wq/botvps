import { query } from '../client.js';

export interface NodeRecord {
    id: string;
    name: string;
    host: string;
    port: number;
    api_token: string;
    is_active: boolean;
    is_maintenance: boolean;
    max_ram_mb: number;
    max_cpu: number;
    max_disk_gb: number;
    last_seen: Date;
    created_at: Date;
}

export class NodeRepository {
    static async getById(id: string): Promise<NodeRecord | null> {
        const res = await query<NodeRecord>(`SELECT * FROM nodes WHERE id = $1`, [id]);
        return res.rows[0] || null;
    }

    static async getAll(): Promise<NodeRecord[]> {
        const res = await query<NodeRecord>(`SELECT * FROM nodes ORDER BY created_at ASC`);
        return res.rows;
    }

    static async addNode(data: {
        id: string;
        name: string;
        host: string;
        port: number;
        apiToken: string;
        maxRamMb?: number;
        maxCpu?: number;
        maxDiskGb?: number;
    }): Promise<NodeRecord> {
        const sql = `
            INSERT INTO nodes (id, name, host, port, api_token, max_ram_mb, max_cpu, max_disk_gb)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                host = EXCLUDED.host,
                port = EXCLUDED.port,
                api_token = EXCLUDED.api_token
            RETURNING *;
        `;
        const res = await query<NodeRecord>(sql, [
            data.id,
            data.name,
            data.host,
            data.port,
            data.apiToken,
            data.maxRamMb || 32768,
            data.maxCpu || 16,
            data.maxDiskGb || 500,
        ]);
        return res.rows[0];
    }

    static async removeNode(id: string): Promise<boolean> {
        const res = await query(`DELETE FROM nodes WHERE id = $1 RETURNING id`, [id]);
        return (res.rowCount ?? 0) > 0;
    }

    static async setMaintenance(id: string, isMaintenance: boolean): Promise<boolean> {
        const res = await query(
            `UPDATE nodes SET is_maintenance = $1 WHERE id = $2 RETURNING id`,
            [isMaintenance, id]
        );
        return (res.rowCount ?? 0) > 0;
    }

    static async updateHeartbeat(id: string): Promise<void> {
        await query(`UPDATE nodes SET last_seen = NOW() WHERE id = $1`, [id]);
    }
}
