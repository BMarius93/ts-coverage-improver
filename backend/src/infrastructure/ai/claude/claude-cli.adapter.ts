import {
  AiTestGeneratorPort,
  TestGenerationContext,
} from '../../../application/ports/ai-test-generator.port';
import { LoggerPort } from '../../../application/ports/logger.port';
import { TestPlan } from '../../../domain/job/test-plan';
import { formatLineRanges } from '../../coverage/jest/coverage-report-parser';
import { childEnv } from '../../process/child-env';
import { ProcessError, runProcess, tail } from '../../process/run-process';
import { AiOutputError, ClaudeResult, extractTestPlan, parseClaudeResult } from './claude-output';
import { PromptName, PromptTemplates } from './prompt-templates';

export interface ClaudeCliOptions {
  cliPath: string;
  plannerModel: string;
  writerModel: string;
  plannerMaxTurns: number;
  writerMaxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
}

/** Credentials/config the CLI may need. GITHUB_TOKEN is deliberately absent. */
const CLAUDE_ENV_ALLOW_LIST = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CONFIG_DIR',
  'XDG_CONFIG_HOME',
];

const READ_ONLY_TOOLS = 'Read,Grep,Glob';
const WRITER_TOOLS = 'Read,Grep,Glob,Write,Edit,Bash';
const WRITER_ALLOWED = 'Read,Grep,Glob,Write,Edit,Bash(npx jest:*)';

/**
 * AiTestGeneratorPort using Claude Code in headless mode (`claude -p`).
 *
 * - The prompt is sent on stdin (not argv) and the CLI runs with cwd = job workspace.
 * - `--tools` limits which tools exist at all; `--allowedTools` auto-approves a subset. In print mode any
 *   other permission request is denied, so the writer can run `npx jest …` but no other shell command.
 * - The planner runs in `--permission-mode plan` with read-only tools.
 * - `--strict-mcp-config` (no MCP servers), `--no-session-persistence`, `--max-turns`, `--max-budget-usd`
 *   and a hard process timeout bound what one call can do and cost.
 */
export class ClaudeCliAdapter implements AiTestGeneratorPort {
  constructor(
    private readonly options: ClaudeCliOptions,
    private readonly logger: LoggerPort,
    private readonly prompts = new PromptTemplates(),
  ) {}

  async plan(context: TestGenerationContext): Promise<TestPlan> {
    const result = await this.run('planner', context, this.prompt('planner', context, {}), [
      '--model',
      this.options.plannerModel,
      '--permission-mode',
      'plan',
      '--tools',
      READ_ONLY_TOOLS,
      '--allowedTools',
      READ_ONLY_TOOLS,
      '--max-turns',
      String(this.options.plannerMaxTurns),
    ]);
    this.assertSuccess('planner', result);
    return extractTestPlan(result.result ?? '');
  }

  async write(context: TestGenerationContext, plan: TestPlan): Promise<void> {
    const result = await this.run(
      'writer',
      context,
      this.prompt('writer', context, { plan: formatPlan(plan) }),
      this.writerArgs(),
    );
    this.assertCompleted('writer', result);
  }

  async planAndWrite(context: TestGenerationContext): Promise<TestPlan> {
    const result = await this.run('single', context, this.prompt('single', context, {}), this.writerArgs());
    this.assertSuccess('single', result);
    return extractTestPlan(result.result ?? '');
  }

  async fix(
    context: TestGenerationContext,
    plan: TestPlan,
    failures: string[],
    testOutput: string,
  ): Promise<void> {
    const result = await this.run(
      'fixer',
      context,
      this.prompt('fixer', context, {
        plan: formatPlan(plan),
        failures: failures.map((failure) => `- ${failure}`).join('\n'),
        testOutput: tail(testOutput, 6000).replace(/```/g, "'''"),
      }),
      this.writerArgs(),
    );
    this.assertCompleted('fixer', result);
  }

  private writerArgs(): string[] {
    return [
      '--model',
      this.options.writerModel,
      '--permission-mode',
      'acceptEdits',
      '--tools',
      WRITER_TOOLS,
      '--allowedTools',
      WRITER_ALLOWED,
      '--max-turns',
      String(this.options.writerMaxTurns),
    ];
  }

  private prompt(name: PromptName, context: TestGenerationContext, extra: Record<string, string>): string {
    return this.prompts.render(name, {
      targetFile: context.targetFile.value,
      testFile: context.suggestedTestFile.value,
      coverage: context.coverage ? context.coverage.lines.toString() : '0% (no test imports this file yet)',
      uncoveredLines:
        context.uncoveredLines.length > 0 ? formatLineRanges(context.uncoveredLines) : 'unknown',
      ...extra,
    });
  }

  private async run(
    step: PromptName,
    context: TestGenerationContext,
    prompt: string,
    args: string[],
  ): Promise<ClaudeResult> {
    const result = await runProcess(
      this.options.cliPath,
      [
        '-p',
        '--output-format',
        'json',
        '--max-budget-usd',
        String(this.options.maxBudgetUsd),
        '--strict-mcp-config',
        '--no-session-persistence',
        ...args,
      ],
      {
        cwd: context.workspaceDir,
        input: prompt,
        timeoutMs: this.options.timeoutMs,
        env: childEnv({ CI: 'true', DISABLE_AUTOUPDATER: '1' }, { inherit: CLAUDE_ENV_ALLOW_LIST }),
      },
    );
    if (result.timedOut) {
      throw new ProcessError(`AI ${step} timed out after ${this.options.timeoutMs} ms`, result);
    }
    // The CLI exits non-zero for error results but still prints the JSON result; prefer it when present.
    let parsed: ClaudeResult;
    try {
      parsed = parseClaudeResult(result.stdout);
    } catch (error) {
      if (result.exitCode !== 0) {
        throw new ProcessError(
          `AI ${step} exited with code ${result.exitCode}: ${tail(result.stderr || result.stdout, 1000)}`,
          result,
        );
      }
      throw error;
    }
    this.logger.info(`AI ${step} finished`, {
      subtype: parsed.subtype,
      turns: parsed.num_turns,
      costUsd: parsed.total_cost_usd,
      seconds: Math.round(result.durationMs / 1000),
    });
    return parsed;
  }

  /** Planner / single call: we need the final answer, so anything but success is an error. */
  private assertSuccess(step: string, result: ClaudeResult): void {
    if (result.is_error || result.subtype !== 'success') {
      throw new AiOutputError(
        `AI ${step} failed (${result.subtype}): ${(result.result ?? '').slice(0, 500)}`,
      );
    }
  }

  /**
   * Writer / fixer: running out of turns or budget can still leave useful tests behind, so only hard errors
   * fail here; the deterministic verifier decides whether the result is good enough.
   */
  private assertCompleted(step: string, result: ClaudeResult): void {
    if (result.subtype === 'error_max_turns' || result.subtype === 'error_max_budget_usd') {
      this.logger.warn(`AI ${step} stopped early; verifying what it wrote`, { subtype: result.subtype });
      return;
    }
    this.assertSuccess(step, result);
  }
}

function formatPlan(plan: TestPlan): string {
  return [
    `Test file: ${plan.testFile.value}`,
    `Summary: ${plan.summary}`,
    'Cases:',
    ...plan.cases.map((testCase) => `- ${testCase.name} — ${testCase.covers}`),
  ].join('\n');
}
