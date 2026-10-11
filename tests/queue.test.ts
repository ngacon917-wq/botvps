import { describe, it, expect } from 'vitest';
import { JobQueue } from '../src/core/queue/jobQueue.js';

describe('JobQueue & VPS Lock Mechanism', () => {
    it('should acquire and release locks correctly per VPS ID', () => {
        const vpsId = 'vps-test-lock-01';

        // 1. Acquire initial lock
        const locked1 = JobQueue.acquireLock(vpsId);
        expect(locked1).toBe(true);

        // 2. Second attempt must fail
        const locked2 = JobQueue.acquireLock(vpsId);
        expect(locked2).toBe(false);

        // 3. Release lock
        JobQueue.releaseLock(vpsId);

        // 4. Third attempt must succeed
        const locked3 = JobQueue.acquireLock(vpsId);
        expect(locked3).toBe(true);
        JobQueue.releaseLock(vpsId);
    });
});
