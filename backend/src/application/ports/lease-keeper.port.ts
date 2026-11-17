export interface LeaseHandle {
  /** True once a heartbeat failed to extend the lease: another worker may own the job now. */
  isLost(): boolean;
  stop(): void;
}

/** Keeps a job lease alive (heartbeat) while the pipeline works on it. */
export interface LeaseKeeperPort {
  keepAlive(jobId: string, workerId: string): LeaseHandle;
}

export const LEASE_KEEPER_PORT = Symbol('LeaseKeeperPort');
