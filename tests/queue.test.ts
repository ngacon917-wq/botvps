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

// A secondary database outage must not mask the operation's actual failure.
import { vi, afterEach } from 'vitest';
import { JobRepository } from '../src/db/repositories/jobRepository.js';
afterEach(() => vi.restoreAllMocks());
it('preserves the original error and releases the lock when failure logging fails', async () => {
    vi.spyOn(JobRepository, 'create').mockResolvedValue({} as any);
    vi.spyOn(JobRepository, 'updateStage').mockResolvedValue();
    vi.spyOn(JobRepository, 'fail').mockRejectedValue(new Error('database unavailable'));
    await expect(JobQueue.runJob({
        jobId: 'job-regression', vpsId: 'vps-regression', action: 'start', requestedBy: 'owner',
        handler: async () => { throw new Error('container failed'); },
    })).rejects.toThrow('container failed');
    expect(JobQueue.acquireLock('vps-regression')).toBe(true);
    JobQueue.releaseLock('vps-regression');
});
