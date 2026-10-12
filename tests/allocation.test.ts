import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../src/db/client.js';
import { VpsRepository } from '../src/db/repositories/vpsRepository.js';
const allocation = { nodeId: 'worker', ownerDiscordId: 'user', osId: 'debian-13', ramMb: 512, cpuCores: 1, diskGb: 5 };
afterEach(() => vi.restoreAllMocks());
describe('VPS allocation transaction', () => {
    it('skips allocated addresses and legacy IDs before inserting the VPS', async () => {
        let sequence = 0;
        const query = vi.fn(async (sql: string, params?: any[]) => {
            if (sql.includes('SELECT ip_address')) return { rows: [{ ip_address: '10.0.3.50' }], rowCount: 1 };
            if (sql.includes('nextval')) return { rows: [{ number: ++sequence }], rowCount: 1 };
            if (sql.includes('SELECT id')) return { rows: [], rowCount: params?.[0] === 'vps-0001' ? 1 : 0 };
            if (sql.includes('INSERT INTO')) return { rows: [{ id: params?.[0], ip_address: params?.[9] }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });
        const release = vi.fn();
        vi.spyOn(pool, 'connect').mockResolvedValue({ query, release } as any);
        const result = await VpsRepository.reserve(allocation);
        expect(result).toEqual({ id: 'vps-0002', ip_address: '10.0.3.51' });
        expect(query.mock.calls[0][0]).toBe('BEGIN');
        expect(query.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
        expect(query.mock.lastCall?.[0]).toBe('COMMIT');
        expect(release).toHaveBeenCalledOnce();
    });
    it('rolls back and releases the connection when no addresses remain', async () => {
        const query = vi.fn(async (sql: string) => ({ rows: sql.includes('SELECT ip_address')
            ? Array.from({ length: 150 }, (_, i) => ({ ip_address: `10.0.3.${i + 50}` })) : [], rowCount: 0 }));
        const release = vi.fn();
        vi.spyOn(pool, 'connect').mockResolvedValue({ query, release } as any);
        await expect(VpsRepository.reserve(allocation)).rejects.toThrow('No free VPS IP');
        expect(query.mock.lastCall?.[0]).toBe('ROLLBACK');
        expect(release).toHaveBeenCalledOnce();
        expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(false);
    });
});
