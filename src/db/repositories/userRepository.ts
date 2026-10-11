import { query } from '../client.js';

export interface UserRecord {
    discord_id: string;
    username: string;
    is_admin: boolean;
    is_banned: boolean;
    notifications_enabled: boolean;
    max_vps: number;
    max_ram_mb: number;
    max_cpu: number;
    max_disk_gb: number;
    created_at: Date;
    updated_at: Date;
}

export class UserRepository {
    static async getOrCreate(discordId: string, username: string): Promise<UserRecord> {
        const sql = `
            INSERT INTO users (discord_id, username)
            VALUES ($1, $2)
            ON CONFLICT (discord_id) DO UPDATE
            SET username = EXCLUDED.username, updated_at = NOW()
            RETURNING *;
        `;
        const res = await query<UserRecord>(sql, [discordId, username]);
        return res.rows[0];
    }

    static async getById(discordId: string): Promise<UserRecord | null> {
        const res = await query<UserRecord>(`SELECT * FROM users WHERE discord_id = $1`, [discordId]);
        return res.rows[0] || null;
    }

    static async setBanned(discordId: string, isBanned: boolean): Promise<boolean> {
        const res = await query(
            `UPDATE users SET is_banned = $1, updated_at = NOW() WHERE discord_id = $2 RETURNING discord_id`,
            [isBanned, discordId]
        );
        return (res.rowCount ?? 0) > 0;
    }

    static async setNotifications(discordId: string, enabled: boolean): Promise<boolean> {
        const res = await query(
            `UPDATE users SET notifications_enabled = $1, updated_at = NOW() WHERE discord_id = $2 RETURNING discord_id`,
            [enabled, discordId]
        );
        return (res.rowCount ?? 0) > 0;
    }

    static async setQuota(discordId: string, maxVps: number, maxRam: number, maxCpu: number, maxDisk: number): Promise<boolean> {
        const res = await query(
            `UPDATE users SET max_vps = $1, max_ram_mb = $2, max_cpu = $3, max_disk_gb = $4, updated_at = NOW() WHERE discord_id = $5 RETURNING discord_id`,
            [maxVps, maxRam, maxCpu, maxDisk, discordId]
        );
        return (res.rowCount ?? 0) > 0;
    }
}
