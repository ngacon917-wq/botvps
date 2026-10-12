import { JobRepository } from '../../db/repositories/jobRepository.js';
import { logger } from '../../utils/logger.js';

type JobHandler<T> = (updateStage: (stage: string) => Promise<void>) => Promise<T>;

export class JobQueue {
    // Map of active locks by vpsId
    private static activeLocks = new Set<string>();

    /**
     * Acquire lock for a VPS ID
     */
    static acquireLock(vpsId: string): boolean {
        if (this.activeLocks.has(vpsId)) {
            return false;
        }
        this.activeLocks.add(vpsId);
        return true;
    }

    /**
     * Release lock for a VPS ID
     */
    static releaseLock(vpsId: string): void {
        this.activeLocks.delete(vpsId);
    }

    /**
     * Execute a job under concurrency lock and track its stages in DB
     */
    static async runJob<T>(options: {
        jobId: string;
        vpsId: string;
        action: string;
        requestedBy: string;
        handler: JobHandler<T>;
    }): Promise<T> {
        const { jobId, vpsId, action, requestedBy, handler } = options;

        if (!this.acquireLock(vpsId)) {
            throw new Error(`Another conflicting operation is currently in progress for VPS "${vpsId}". Please wait.`);
        }

        try {
            await JobRepository.create({
                id: jobId,
                vpsId,
                action,
                requestedBy,
                stage: 'validating',
            });

            const updateStage = async (stage: string) => {
                logger.info(`Job ${jobId} (${vpsId} - ${action}): Stage changed to "${stage}"`);
                await JobRepository.updateStage(jobId, stage, 'running');
            };

            await updateStage('processing');
            const result = await handler(updateStage);
            await JobRepository.complete(jobId);
            return result;
        } catch (err: any) {
            logger.error(`Job ${jobId} failed: ${err.message}`);
            await JobRepository.fail(jobId, err.message).catch((failure) => {
                logger.error(`Could not record job failure: ${failure.message}`);
            });
            throw err;
        } finally {
            this.releaseLock(vpsId);
        }
    }
}
