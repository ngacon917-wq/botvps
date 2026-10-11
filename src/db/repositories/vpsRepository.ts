import { query } from '../client.js';

export interface VpsRecord {
    id: string;
    vps_number: number;
    node_id: string;
    owner_discord_id: string;
    name: string;
    os_id: string;
    ram_mb: number;
    cpu_cores: number;
    disk_gb: number;
    status: 'stopped' | 'running' | 'provisioning' | 'reinstalling' | 'suspended' | 'error';
    ip_address: string;
    mac_address?: string;
    auto_backup: boolean;
    suspended_reason?: string;
    created_at: Date;
    updated_at: Date;
    os_name?: string;
}

export class VpsRepository {
    static async create(data: {
        id: string;
        nodeId: string;
        ownerDiscordId: string;
        name: string;
        osId: string;
        ramMb: number;
        cpuCores: number;
        diskGb: number;
        ipAddress: string;
        macAddress?: string;
    }): Promise<VpsRecord> {
        const sql = `
            INSERT INTO vps_instances (id, node_id, owner_discord_id, name, os_id, ram_mb, cpu_cores, disk_gb, status, ip_address, mac_address)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'provisioning', $9, $10)
            RETURNING *;
        `;
        const res = await query<VpsRecord>(sql, [
            data.id,
            data.nodeId,
            data.ownerDiscordId,
            data.name,
            data.osId,
            data.ramMb,
            data.cpuCores,
            data.diskGb,
            data.ipAddress,
            data.macAddress || null,
        ]);
        return res.rows[0];
    }

    static async getById(id: string): Promise<VpsRecord | null> {
        const sql = `
            SELECT v.*, o.name as os_name
            FROM vps_instances v
            LEFT JOIN operating_system_images o ON v.os_id = o.id
            WHERE v.id = $1 OR v.id = $2
        `;
        const normalized = id.toLowerCase();
        const altId = normalized.startsWith('vps-') ? normalized : `vps-${normalized}`;
        const res = await query<VpsRecord>(sql, [normalized, altId]);
        return res.rows[0] || null;
    }

    static async getByOwner(ownerDiscordId: string): Promise<VpsRecord[]> {
        const sql = `
            SELECT v.*, o.name as os_name
            FROM vps_instances v
            LEFT JOIN operating_system_images o ON v.os_id = o.id
            WHERE v.owner_discord_id = $1
            ORDER BY v.created_at ASC;
        `;
        const res = await query<VpsRecord>(sql, [ownerDiscordId]);
        return res.rows;
    }

    static async getAll(limit: number = 50, offset: number = 0): Promise<VpsRecord[]> {
        const sql = `
            SELECT v.*, o.name as os_name
            FROM vps_instances v
            LEFT JOIN operating_system_images o ON v.os_id = o.id
            ORDER BY v.vps_number ASC
            LIMIT $1 OFFSET $2;
        `;
        const res = await query<VpsRecord>(sql, [limit, offset]);
        return res.rows;
    }

    static async updateStatus(id: string, status: VpsRecord['status'], reason?: string): Promise<boolean> {
        const res = await query(
            `UPDATE vps_instances SET status = $1, suspended_reason = $2, updated_at = NOW() WHERE id = $3 RETURNING id`,
            [status, reason || null, id]
        );
        return (res.rowCount ?? 0) > 0;
    }

    static async updateSpecs(id: string, ramMb: number, cpuCores: number, diskGb: number): Promise<boolean> {
        const res = await query(
            `UPDATE vps_instances SET ram_mb = $1, cpu_cores = $2, disk_gb = $3, updated_at = NOW() WHERE id = $4 RETURNING id`,
            [ramMb, cpuCores, diskGb, id]
        );
        return (res.rowCount ?? 0) > 0;
    }

    static async updateName(id: string, name: string): Promise<boolean> {
        const res = await query(
            `UPDATE vps_instances SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
            [name, id]
        );
        return (res.rowCount ?? 0) > 0;
    }

    static async updateOwner(id: string, newOwnerDiscordId: string): Promise<boolean> {
        const res = await query(
            `UPDATE vps_instances SET owner_discord_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
            [newOwnerDiscordId, id]
        );
        return (res.rowCount ?? 0) > 0;
    }

    static async updateOs(id: string, osId: string): Promise<boolean> {
        const res = await query(
            `UPDATE vps_instances SET os_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
            [osId, id]
        );
        return (res.rowCount ?? 0) > 0;
    }

    static async updateAutoBackup(id: string, enabled: boolean): Promise<boolean> {
        const res = await query(
            `UPDATE vps_instances SET auto_backup = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
            [enabled, id]
        );
        return (res.rowCount ?? 0) > 0;
    }

    static async delete(id: string): Promise<boolean> {
        const res = await query(`DELETE FROM vps_instances WHERE id = $1 RETURNING id`, [id]);
        return (res.rowCount ?? 0) > 0;
    }

    static async countUserVps(ownerDiscordId: string): Promise<number> {
        const res = await query<{ count: string }>(
            `SELECT COUNT(*) as count FROM vps_instances WHERE owner_discord_id = $1`,
            [ownerDiscordId]
        );
        return parseInt(res.rows[0].count, 10);
    }

    static async getNextVpsId(): Promise<string> {
        const res = await query<{ max_id: string }>(`SELECT MAX(vps_number) as max_id FROM vps_instances`);
        const nextNum = (res.rows[0]?.max_id ? parseInt(res.rows[0].max_id, 10) : 0) + 1;
        return `vps-${String(nextNum).padStart(4, '0')}`;
    }

    static async getTotalAllocations(): Promise<{ total_ram: number; total_cpu: number; total_disk: number; total_count: number; running_count: number; stopped_count: number }> {
        const res = await query(`
            SELECT 
                COALESCE(SUM(ram_mb), 0) as total_ram,
                COALESCE(SUM(cpu_cores), 0) as total_cpu,
                COALESCE(SUM(disk_gb), 0) as total_disk,
                COUNT(*) as total_count,
                COUNT(*) FILTER (WHERE status = 'running') as running_count,
                COUNT(*) FILTER (WHERE status = 'stopped') as stopped_count
            FROM vps_instances;
        `);
        const row = res.rows[0];
        return {
            total_ram: parseInt(row.total_ram, 10),
            total_cpu: parseInt(row.total_cpu, 10),
            total_disk: parseInt(row.total_disk, 10),
            total_count: parseInt(row.total_count, 10),
            running_count: parseInt(row.running_count, 10),
            stopped_count: parseInt(row.stopped_count, 10),
        };
    }
}
