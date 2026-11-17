import { childEnv } from '../../../src/infrastructure/process/child-env';
import {
  ProcessError,
  runProcess,
  runProcessOrThrow,
  tail,
} from '../../../src/infrastructure/process/run-process';

const node = process.execPath;
const options = { cwd: __dirname, env: childEnv(), timeoutMs: 10_000 };

describe('runProcess', () => {
  it('captures stdout, stderr and the exit code', async () => {
    const result = await runProcess(
      node,
      ['-e', 'console.log("out"); console.error("err"); process.exit(3)'],
      options,
    );
    expect(result).toMatchObject({ exitCode: 3, stdout: 'out\n', stderr: 'err\n', timedOut: false });
  });

  it('passes arguments literally (no shell)', async () => {
    const result = await runProcess(
      node,
      ['-e', 'console.log(process.argv[1])', '$(echo hacked); rm -rf /'],
      options,
    );
    expect(result.stdout.trim()).toBe('$(echo hacked); rm -rf /');
  });

  it('writes stdin', async () => {
    const result = await runProcess(
      node,
      ['-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s.toUpperCase()))'],
      { ...options, input: 'hello' },
    );
    expect(result.stdout.trim()).toBe('HELLO');
  });

  it('kills the whole process group on timeout', async () => {
    // The parent spawns a grandchild that would outlive it; both must die.
    const script = `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      console.log(child.pid);
      setInterval(() => {}, 1000);
    `;
    const result = await runProcess(node, ['-e', script], { ...options, timeoutMs: 500 });
    expect(result.timedOut).toBe(true);
    const grandchild = Number(result.stdout.trim());
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(() => process.kill(grandchild, 0)).toThrow();
  });

  it('keeps only the tail of very long output', async () => {
    const result = await runProcess(node, ['-e', 'process.stdout.write("a".repeat(5000) + "END")'], {
      ...options,
      maxOutputBytes: 100,
    });
    expect(result.stdout.length).toBeLessThanOrEqual(100);
    expect(result.stdout.endsWith('END')).toBe(true);
  });

  it('rejects when the command does not exist', async () => {
    await expect(runProcess('definitely-not-a-command-xyz', [], options)).rejects.toBeInstanceOf(
      ProcessError,
    );
  });
});

describe('runProcessOrThrow', () => {
  it('resolves on exit code 0', async () => {
    await expect(runProcessOrThrow(node, ['-e', ''], options)).resolves.toMatchObject({ exitCode: 0 });
  });

  it('rejects with the output tail on failure', async () => {
    await expect(
      runProcessOrThrow(node, ['-e', 'console.error("boom"); process.exit(2)'], options),
    ).rejects.toThrow(/exited with code 2: boom/);
  });

  it('rejects on timeout', async () => {
    await expect(
      runProcessOrThrow(node, ['-e', 'setInterval(() => {}, 1000)'], { ...options, timeoutMs: 200 }),
    ).rejects.toThrow(/timed out after 200 ms/);
  });
});

describe('childEnv', () => {
  const source = {
    PATH: '/bin',
    HOME: '/home/me',
    GITHUB_TOKEN: 'secret',
    AWS_SECRET_ACCESS_KEY: 'x',
    ANTHROPIC_API_KEY: 'k',
  };

  it('keeps only allow-listed variables and drops secrets', () => {
    expect(childEnv({ CI: 'true' }, { source })).toEqual({ PATH: '/bin', HOME: '/home/me', CI: 'true' });
  });

  it('can inherit extra variables explicitly', () => {
    expect(childEnv({}, { source, inherit: ['ANTHROPIC_API_KEY'] })).toMatchObject({
      ANTHROPIC_API_KEY: 'k',
    });
  });

  it('the child really does not see GITHUB_TOKEN', async () => {
    process.env.GITHUB_TOKEN = 'ghp_should_not_leak';
    try {
      const result = await runProcess(node, ['-e', 'console.log(process.env.GITHUB_TOKEN ?? "none")'], {
        ...options,
        env: childEnv(),
      });
      expect(result.stdout.trim()).toBe('none');
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });
});

it('tail trims and keeps the end', () => {
  expect(tail('  abc  ', 10)).toBe('abc');
  expect(tail('abcdef', 3)).toBe('…def');
});
