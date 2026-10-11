import { query } from '../client.js';

export interface OperationJobRecord {
    id: string;
    vps_id?: string;
    action: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    stage: string;
    error_message?: string;
    requested_by: string;
    created_at: Date;
    updated_at: Date;
    completed_at?: Date;
}

export class JobRepository {
    static async create(data: {
        id: string;
        vpsId?: string;
        action: string;
        requestedBy: string;
        stage?: string;
    }): Promise<OperationJobRecord> {
        const sql = `
            INSERT INTO operation_jobs (id, vps_id, action, status, stage, requested_by)
            VALUES ($1, $2, $3, 'pending', $4, $5)
            RETURNING *;
        `;
        const res = await query<OperationJobRecord>(sql, [
            data.id,
            data.vpsId || null,
            data.action,
            data.stage || 'queued',
            data.requestedBy,
        ]);
        return res.rows[0];
    }

    static async updateStage(id: string, stage: string, status: OperationJobRecord['status'] = 'running'): Promise<void> {
        await query(
            `UPDATE operation_jobs SET stage = $1, status = $2, updated_at = NOW() WHERE id = $3`,
            [stage, status, id]
        );
    }

    static async complete(id: string): Promise<void> {
        await query(
            `UPDATE operation_jobs SET status = 'completed', stage = 'ready', updated_at = NOW(), completed_at = NOW() WHERE id = $1`,
            [id]
        );
    }

    static async fail(id: string, errorMessage: string): Promise<void> {
        await query(
            `UPDATE operation_jobs SET status = 'failed', error_message = $1, updated_at = NOW(), completed_at = NOW() WHERE id = $1`,
            [errorMessage, id]
        );
    }

    static async getActiveJobForVps(vpsId: string): Promise<OperationJobRecord | null> {
        const sql = `
            SELECT * FROM operation_jobs
            WHERE vps_id = $1 AND status IN ('pending', 'running')
            ORDER BY created_at DESC
            LIMIT 1;
        `;
        const res = await query<OperationJobRecord>(sql, [vpsId]);
        return res.rows[0] || null;
    }

    static async getRecent(limit: number = 10): Promise<OperationJobRecord[]> {
        const res = await query<OperationJobRecord>(
            `SELECT * FROM operation_jobs ORDER BY created_at DESC LIMIT $1`,
            [limit]
        );
        return res.rows;
    }
}
