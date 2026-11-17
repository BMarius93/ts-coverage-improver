/** Abstracts "now" so time-dependent rules (leases, timestamps) are deterministic in tests. */
export interface Clock {
  now(): Date;
}
