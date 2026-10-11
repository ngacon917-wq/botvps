import { query } from '../client.js';

export interface OsImageRecord {
    id: string;
    name: string;
    distro: string;
    release: string;
    arch: string;
    template_name: string;
    is_verified: boolean;
    is_active: boolean;
    created_at: Date;
}

export class OsRepository {
    static async getAll(): Promise<OsImageRecord[]> {
        const res = await query<OsImageRecord>(
            `SELECT * FROM operating_system_images WHERE is_active = true ORDER BY id ASC`
        );
        return res.rows;
    }

    static async getById(id: string): Promise<OsImageRecord | null> {
        const res = await query<OsImageRecord>(
            `SELECT * FROM operating_system_images WHERE id = $1`,
            [id]
        );
        return res.rows[0] || null;
    }
}
