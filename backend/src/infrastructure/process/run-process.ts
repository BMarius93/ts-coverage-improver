import { spawn } from 'node:child_process';

export interface RunProcessOptions {
  cwd: string;
  /** The complete environment of the child. Nothing is inherited implicitly. */
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** Written to stdin, which is then closed. */
  input?: string;
  /** Per stream; the tail is kept when output is longer. Default 1 MiB. */
  maxOutputBytes?: number;
}

export interface ProcessResult {
  command: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/** A process failed to start, exited non-zero or timed out. The message never contains the environment. */
export class ProcessError extends Error {
  constructor(
    message: string,
    readonly result: ProcessResult | null,
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

const KILL_GRACE_MS = 5_000;

/**
 * Process groups of children that are still running. Children are detached (own group) so a timeout can
 * kill grandchildren; the flip side is that they would outlive this process, so shutdown kills them.
 */
const activeGroups = new Set<number>();
let exitHookInstalled = false;

/** Kills every still-running child process group (used on shutdown). Returns how many were signalled. */
export function terminateAllProcesses(signal: NodeJS.Signals = 'SIGKILL'): number {
  let count = 0;
  for (const pid of activeGroups) {
    try {
      process.kill(-pid, signal);
      count++;
    } catch {
      // already gone
    }
  }
  activeGroups.clear();
  return count;
}

function trackGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  activeGroups.add(pid);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.once('exit', () => terminateAllProcesses());
  }
}

/** Keeps only the last `max` bytes of a stream so a chatty process cannot exhaust memory. */
class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  constructor(private readonly max: number) {}
  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.max && this.chunks.length > 1) {
      this.size -= this.chunks.shift()!.length;
    }
  }
  toString(): string {
    const text = Buffer.concat(this.chunks).toString('utf8');
    return text.length > this.max ? text.slice(-this.max) : text;
  }
}

/**
 * Runs a command without a shell (arguments are never interpreted), in its own process group, with an
 * explicit environment and a hard timeout. On timeout the whole group gets SIGTERM, then SIGKILL.
 * Resolves with the result for any exit code; rejects only if the process could not be started.
 */
export function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  const started = Date.now();
  const maxBytes = options.maxOutputBytes ?? 1024 * 1024;
  const label = [command, ...args.slice(0, 2)].join(' ');

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true, // own process group, so the timeout can kill grandchildren (npx -> node -> jest workers)
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    trackGroup(child.pid);
    const stdout = new TailBuffer(maxBytes);
    const stderr = new TailBuffer(maxBytes);
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        // already gone
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS);
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on('error', () => undefined); // child may exit before reading stdin
    child.stdin.end(options.input ?? '');

    child.on('error', (error) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      reject(new ProcessError(`Could not start ${command}: ${error.message}`, null));
    });
    child.on('close', (exitCode, signal) => {
      if (child.pid !== undefined) activeGroups.delete(child.pid);
      clearTimeout(timeout);
      clearTimeout(killTimer);
      if (timedOut) killGroup('SIGKILL'); // make sure no grandchild survives
      resolve({
        command: label,
        exitCode,
        signal,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

/** Like runProcess, but rejects with ProcessError unless the process exited with code 0. */
export async function runProcessOrThrow(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  const result = await runProcess(command, args, options);
  if (result.timedOut) {
    throw new ProcessError(`${result.command} timed out after ${options.timeoutMs} ms`, result);
  }
  if (result.exitCode !== 0) {
    throw new ProcessError(
      `${result.command} exited with code ${result.exitCode ?? result.signal}: ${tail(result.stderr || result.stdout, 1500)}`,
      result,
    );
  }
  return result;
}

export function tail(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length > maxChars ? `…${trimmed.slice(-maxChars)}` : trimmed;
}
