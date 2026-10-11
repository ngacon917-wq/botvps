import { query } from '../client.js';

export class AuditRepository {
    static async log(data: {
        userDiscordId: string;
        action: string;
        targetType: string;
        targetId?: string;
        details?: any;
        ipAddress?: string;
    }): Promise<void> {
        const sql = `
            INSERT INTO audit_logs (user_discord_id, action, target_type, target_id, details, ip_address)
            VALUES ($1, $2, $3, $4, $5, $6);
        `;
        await query(sql, [
            data.userDiscordId,
            data.action,
            data.targetType,
            data.targetId || null,
            JSON.stringify(data.details || {}),
            data.ipAddress || null,
        ]);
    }

    static async getRecent(limit: number = 20): Promise<any[]> {
        const res = await query(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1`, [limit]);
        return res.rows;
    }
}
