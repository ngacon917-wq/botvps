import crypto from 'crypto';
import { query } from '../client.js';

export interface SshxSessionRecord {
    id: string;
    vps_id: string;
    user_discord_id: string;
    session_url: string;
    token_hash: string;
    status: 'active' | 'revoked' | 'expired';
    created_at: Date;
    revoked_at?: Date;
}

export class SshxRepository {
    static async createSession(vpsId: string, userId: string, sessionUrl: string): Promise<SshxSessionRecord> {
        // Revoke any existing active sessions for this VPS first
        await this.revokeAllForVps(vpsId);

        const id = `sshx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const tokenHash = crypto.createHash('sha256').update(sessionUrl).digest('hex');

        const sql = `
            INSERT INTO sshx_sessions (id, vps_id, user_discord_id, session_url, token_hash, status)
            VALUES ($1, $2, $3, $4, $5, 'active')
            RETURNING *;
        `;
        const res = await query<SshxSessionRecord>(sql, [id, vpsId, userId, sessionUrl, tokenHash]);
        return res.rows[0];
    }

    static async getActiveSession(vpsId: string): Promise<SshxSessionRecord | null> {
        const sql = `
            SELECT * FROM sshx_sessions
            WHERE vps_id = $1 AND status = 'active'
            ORDER BY created_at DESC
            LIMIT 1;
        `;
        const res = await query<SshxSessionRecord>(sql, [vpsId]);
        return res.rows[0] || null;
    }

    static async revokeAllForVps(vpsId: string): Promise<void> {
        await query(
            `UPDATE sshx_sessions SET status = 'revoked', revoked_at = NOW() WHERE vps_id = $1 AND status = 'active'`,
            [vpsId]
        );
    }
}
