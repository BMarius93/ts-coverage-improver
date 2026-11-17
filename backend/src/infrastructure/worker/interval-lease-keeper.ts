import { JobQueuePort } from '../../application/ports/job-queue.port';
import { LeaseHandle, LeaseKeeperPort } from '../../application/ports/lease-keeper.port';
import { LoggerPort } from '../../application/ports/logger.port';
import { errorMessage } from '../../application/errors';

/**
 * Heartbeat: extends the job lease every `leaseMs / 3`. If the queue says the worker no longer owns the
 * job, or no heartbeat succeeded for a whole lease period (e.g. the DB was locked), the lease counts as lost.
 */
export class IntervalLeaseKeeper implements LeaseKeeperPort {
  constructor(
    private readonly queue: JobQueuePort,
    private readonly leaseMs: number,
    private readonly logger: LoggerPort,
    private readonly now: () => number = Date.now,
  ) {}

  keepAlive(jobId: string, workerId: string): LeaseHandle {
    let lost = false;
    let lastSuccess = this.now();
    let inFlight = false;

    const beat = async (): Promise<void> => {
      if (inFlight || lost) return;
      inFlight = true;
      try {
        if (await this.queue.extendLease(jobId, workerId, this.leaseMs)) {
          lastSuccess = this.now();
        } else {
          lost = true;
          this.logger.warn('Lease lost: job no longer owned by this worker', { jobId, workerId });
        }
      } catch (error) {
        this.logger.warn('Heartbeat failed', { jobId, error: errorMessage(error) });
        if (this.now() - lastSuccess >= this.leaseMs) lost = true;
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => void beat(), Math.max(1, Math.floor(this.leaseMs / 3)));
    timer.unref();
    return {
      isLost: () => lost,
      stop: () => clearInterval(timer),
    };
  }
}
