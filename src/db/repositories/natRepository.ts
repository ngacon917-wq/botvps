import { query } from '../client.js';

export interface NatPortRecord {
    id: number;
    vps_id: string;
    public_port: number;
    private_port: number;
    protocol: 'tcp' | 'udp';
    created_at: Date;
}

export class NatRepository {
    static async addMapping(vpsId: string, publicPort: number, privatePort: number, protocol: 'tcp' | 'udp' = 'tcp'): Promise<NatPortRecord> {
        const sql = `
            INSERT INTO nat_ports (vps_id, public_port, private_port, protocol)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        const res = await query<NatPortRecord>(sql, [vpsId, publicPort, privatePort, protocol]);
        return res.rows[0];
    }

    static async removeMapping(vpsId: string, publicPort: number): Promise<boolean> {
        const res = await query(
            `DELETE FROM nat_ports WHERE vps_id = $1 AND public_port = $2 RETURNING id`,
            [vpsId, publicPort]
        );
        return (res.rowCount ?? 0) > 0;
    }

    static async getByVps(vpsId: string): Promise<NatPortRecord[]> {
        const res = await query<NatPortRecord>(
            `SELECT * FROM nat_ports WHERE vps_id = $1 ORDER BY public_port ASC`,
            [vpsId]
        );
        return res.rows;
    }

    static async isPortTaken(publicPort: number, protocol: 'tcp' | 'udp' = 'tcp'): Promise<boolean> {
        const res = await query<{ count: string }>(
            `SELECT COUNT(*) as count FROM nat_ports WHERE public_port = $1 AND protocol = $2`,
            [publicPort, protocol]
        );
        return parseInt(res.rows[0].count, 10) > 0;
    }
}
