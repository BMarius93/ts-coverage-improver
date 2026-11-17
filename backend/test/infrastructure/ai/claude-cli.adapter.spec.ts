import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AiCallFailedError,
  TestGenerationContext,
} from '../../../src/application/ports/ai-test-generator.port';
import { ClaudeCliAdapter, ClaudeCliOptions } from '../../../src/infrastructure/ai/claude/claude-cli.adapter';
import { fileCoverage, path, plan } from '../../support/builders';
import { RecordingLogger } from '../../support/fakes';

interface RecordedCall {
  argv: string[];
  stdin: string;
  env: Record<string, string>;
  cwd: string;
}

const PLAN_JSON = JSON.stringify({
  testFilePath: 'src/price.test.ts',
  summary: 'Cover discount kinds and errors.',
  cases: [{ name: 'applies percentage discounts', covers: 'lines 40-45' }],
});

/** Creates an executable that records how it was called and prints a canned `claude -p` JSON result. */
function fakeCli(dir: string, response: { stdout: string; exitCode?: number; sleepMs?: number }): string {
  const script = join(dir, 'fake-claude.js');
  writeFileSync(
    script,
    `#!${process.execPath}
const fs = require('node:fs');
let stdin = '';
process.stdin.on('data', (d) => (stdin += d)).on('end', () => {
  fs.writeFileSync(${JSON.stringify(join(dir, 'call.json'))}, JSON.stringify({ argv: process.argv.slice(2), stdin, env: process.env, cwd: process.cwd() }));
  setTimeout(() => { process.stdout.write(${JSON.stringify(response.stdout)}); process.exit(${response.exitCode ?? 0}); }, ${response.sleepMs ?? 0});
});
`,
  );
  chmodSync(script, 0o755);
  return script;
}

const LIMITS = { maxBudgetUsd: 2.5 };

const result = (fields: Record<string, unknown>) =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 3,
    total_cost_usd: 0.12,
    ...fields,
  });

describe('ClaudeCliAdapter', () => {
  let dir: string;
  let workspace: string;
  let context: TestGenerationContext;
  const options = (cliPath: string, overrides: Partial<ClaudeCliOptions> = {}): ClaudeCliOptions => ({
    cliPath,
    plannerModel: 'opus',
    writerModel: 'sonnet',
    plannerMaxTurns: 10,
    writerMaxTurns: 30,
    maxBudgetUsd: 3,
    timeoutMs: 10_000,
    restrictWritesToTests: true,
    ...overrides,
  });
  const recorded = (): RecordedCall =>
    JSON.parse(readFileSync(join(dir, 'call.json'), 'utf8')) as RecordedCall;
  const flag = (argv: string[], name: string) => argv[argv.indexOf(name) + 1];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
    workspace = mkdtempSync(join(tmpdir(), 'fake-workspace-'));
    context = {
      workspaceDir: workspace,
      targetFile: path('src/price.ts'),
      suggestedTestFile: path('src/price.test.ts'),
      coverage: fileCoverage('src/price.ts', 12.5),
      uncoveredLines: [3, 4, 5, 9],
    };
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  describe('plan', () => {
    it('runs a read-only planner in the workspace and returns the validated plan', async () => {
      const cli = fakeCli(dir, { stdout: result({ result: PLAN_JSON }) });
      process.env.GITHUB_TOKEN = 'ghp_must_not_leak';
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      try {
        const { plan: testPlan, costUsd } = await new ClaudeCliAdapter(
          options(cli),
          new RecordingLogger(),
        ).plan(context, LIMITS);
        expect(testPlan.testFile.value).toBe('src/price.test.ts');
        expect(testPlan.cases).toHaveLength(1);
        expect(costUsd).toBe(0.12);
      } finally {
        delete process.env.GITHUB_TOKEN;
        delete process.env.ANTHROPIC_API_KEY;
      }

      const call = recorded();
      expect(call.argv[0]).toBe('-p');
      expect(flag(call.argv, '--output-format')).toBe('json');
      expect(flag(call.argv, '--model')).toBe('opus');
      expect(flag(call.argv, '--permission-mode')).toBe('plan');
      expect(flag(call.argv, '--tools')).toBe('Read,Grep,Glob');
      expect(flag(call.argv, '--allowedTools')).toBe('Read,Grep,Glob');
      expect(flag(call.argv, '--max-turns')).toBe('10');
      expect(flag(call.argv, '--max-budget-usd')).toBe('2.5000'); // job's remaining budget < per-call cap
      expect(call.argv).toEqual(expect.arrayContaining(['--strict-mcp-config', '--no-session-persistence']));
      expect(call.cwd).toBe(realpathSync(workspace));
      // The prompt travels on stdin, not argv, and contains the context.
      expect(call.argv.join(' ')).not.toContain('src/price.ts');
      expect(call.stdin).toContain('`src/price.ts`');
      expect(call.stdin).toContain('12.50%');
      expect(call.stdin).toContain('3-5, 9');
      // Secrets: the AI CLI never sees GITHUB_TOKEN, but does get its own credentials.
      expect(call.env.GITHUB_TOKEN).toBeUndefined();
      expect(call.env.ANTHROPIC_API_KEY).toBe('sk-test');
    });

    it('accepts a plan wrapped in prose or a Markdown fence', async () => {
      const cli = fakeCli(dir, {
        stdout: result({ result: 'Here is the plan:\n```json\n' + PLAN_JSON + '\n```' }),
      });
      const { plan: testPlan } = await new ClaudeCliAdapter(options(cli), new RecordingLogger()).plan(
        context,
        LIMITS,
      );
      expect(testPlan.summary).toBe('Cover discount kinds and errors.');
    });

    it.each([
      ['no JSON at all', result({ result: 'I could not do it' }), /did not return a JSON test plan/],
      ['wrong shape', result({ result: '{"foo": 1}' }), /wrong shape/],
      [
        'a plan targeting a source file',
        result({
          result: JSON.stringify({
            testFilePath: 'src/price.ts',
            summary: 's',
            cases: [{ name: 'n', covers: 'c' }],
          }),
        }),
        /invalid: Test file must end with \.test\.ts/,
      ],
      [
        'an error result',
        result({ is_error: true, result: 'model not found' }),
        /planner failed \(success\): model not found/,
      ],
      ['max turns reached', result({ subtype: 'error_max_turns' }), /planner failed \(error_max_turns\)/],
      ['non-JSON stdout', 'Segmentation fault', /did not return JSON/],
    ])('rejects %s', async (_label, stdout, message) => {
      const cli = fakeCli(dir, { stdout });
      await expect(
        new ClaudeCliAdapter(options(cli), new RecordingLogger()).plan(context, LIMITS),
      ).rejects.toThrow(message);
    });

    it('never exceeds the per-call cap and reports the cost of a failed call', async () => {
      const cli = fakeCli(dir, { stdout: result({ is_error: true, result: 'boom', total_cost_usd: 0.4 }) });
      const error = await new ClaudeCliAdapter(options(cli, { maxBudgetUsd: 1 }), new RecordingLogger())
        .plan(context, { maxBudgetUsd: 4 })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiCallFailedError);
      expect((error as AiCallFailedError).costUsd).toBe(0.4);
      expect(flag(recorded().argv, '--max-budget-usd')).toBe('1.0000');
    });

    it('reports a crashing CLI with its exit code', async () => {
      const cli = fakeCli(dir, { stdout: '', exitCode: 2 });
      await expect(
        new ClaudeCliAdapter(options(cli), new RecordingLogger()).plan(context, LIMITS),
      ).rejects.toThrow(/exited with code 2/);
    });

    it('kills the CLI on timeout', async () => {
      const cli = fakeCli(dir, { stdout: result({ result: PLAN_JSON }), sleepMs: 5000 });
      await expect(
        new ClaudeCliAdapter(options(cli, { timeoutMs: 300 }), new RecordingLogger()).plan(context, LIMITS),
      ).rejects.toThrow(/timed out after 300 ms/);
    });
  });

  describe('write and fix', () => {
    it('runs the writer in dontAsk mode with writes allowed only for test files', async () => {
      const cli = fakeCli(dir, { stdout: result({ result: 'done' }) });
      await new ClaudeCliAdapter(options(cli), new RecordingLogger()).write(context, plan(), LIMITS);
      const call = recorded();
      expect(flag(call.argv, '--model')).toBe('sonnet');
      expect(flag(call.argv, '--permission-mode')).toBe('dontAsk');
      expect(JSON.parse(flag(call.argv, '--settings'))).toEqual({
        permissions: { allow: ['Edit(**/*.test.ts)', 'Edit(**/*.test.tsx)'] },
      });
      expect(flag(call.argv, '--tools')).toBe('Read,Grep,Glob,Write,Edit,Bash');
      expect(flag(call.argv, '--allowedTools')).toBe('Read,Grep,Glob,Bash(npx jest:*)');
      expect(call.argv).not.toContain('acceptEdits');
      expect(flag(call.argv, '--max-turns')).toBe('30');
      expect(call.stdin).toContain('applies a percentage discount');
      expect(call.stdin).toContain('Create or edit **only** `src/price.test.ts`');
    });

    it('can fall back to acceptEdits when write restriction is disabled', async () => {
      const cli = fakeCli(dir, { stdout: result({ result: 'done' }) });
      await new ClaudeCliAdapter(options(cli, { restrictWritesToTests: false }), new RecordingLogger()).write(
        context,
        plan(),
        LIMITS,
      );
      const call = recorded();
      expect(flag(call.argv, '--permission-mode')).toBe('acceptEdits');
      expect(flag(call.argv, '--allowedTools')).toBe('Read,Grep,Glob,Bash(npx jest:*),Write,Edit');
      expect(call.argv).not.toContain('--settings');
    });

    it('lets the verifier judge a writer that ran out of turns', async () => {
      const cli = fakeCli(dir, {
        stdout: result({ subtype: 'error_max_turns', is_error: true }),
        exitCode: 1,
      });
      const logger = new RecordingLogger();
      await expect(
        new ClaudeCliAdapter(options(cli), logger).write(context, plan(), LIMITS),
      ).resolves.toEqual({ costUsd: 0.12 });
      expect(logger.entries.some((e) => e.message.includes('stopped early'))).toBe(true);
    });

    it('fails the writer on a real error', async () => {
      const cli = fakeCli(dir, { stdout: result({ subtype: 'error_during_execution', is_error: true }) });
      await expect(
        new ClaudeCliAdapter(options(cli), new RecordingLogger()).write(context, plan(), LIMITS),
      ).rejects.toThrow(/writer failed/);
    });

    it('feeds verification failures and test output to the fixer', async () => {
      const cli = fakeCli(dir, { stdout: result({ result: 'fixed' }) });
      await new ClaudeCliAdapter(options(cli), new RecordingLogger()).fix(
        context,
        plan(),
        ['Tests are failing.'],
        'Expected: 2\nReceived: 3\n```',
        LIMITS,
      );
      const call = recorded();
      expect(call.stdin).toContain('- Tests are failing.');
      expect(call.stdin).toContain('Received: 3');
      expect(call.stdin).not.toMatch(/Received: 3\n```\n```/); // fences in output are neutralised
    });

    it('returns the plan reported by the single-call mode', async () => {
      const cli = fakeCli(dir, { stdout: result({ result: PLAN_JSON }) });
      const { plan: testPlan } = await new ClaudeCliAdapter(options(cli), new RecordingLogger()).planAndWrite(
        { ...context, coverage: null, uncoveredLines: [] },
        LIMITS,
      );
      expect(testPlan.testFile.value).toBe('src/price.test.ts');
      const call = recorded();
      expect(flag(call.argv, '--permission-mode')).toBe('dontAsk');
      expect(call.stdin).toContain('0% (no test imports this file yet)');
      expect(call.stdin).toContain('Uncovered lines: unknown');
    });
  });
});
