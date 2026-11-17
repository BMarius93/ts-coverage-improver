import { useEffect, useRef } from 'react';

/**
 * Calls `tick` now and then again `intervalMs` after each run finishes (never overlapping).
 * Re-arms when `intervalMs` or `key` changes.
 */
export function usePolling(tick: () => Promise<void>, intervalMs: number, key: unknown = null): void {
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        await tickRef.current();
      } finally {
        if (!cancelled) timer = setTimeout(run, intervalMs);
      }
    };
    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [intervalMs, key]);
}
