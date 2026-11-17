import { FileCoverage } from '../../domain/coverage/file-coverage';
import { FilePath } from '../../domain/coverage/file-path';
import { TestPlan } from '../../domain/job/test-plan';

export interface TestGenerationContext {
  workspaceDir: string;
  targetFile: FilePath;
  /** Where the tests should go unless the plan says otherwise. */
  suggestedTestFile: FilePath;
  coverage: FileCoverage | null;
  uncoveredLines: number[];
}

/** Per-call limits, set by the pipeline from the job's remaining budget. */
export interface AiCallLimits {
  maxBudgetUsd: number;
}

/** Every call reports what it cost, so the job can track its total AI spend. */
export interface AiCallResult {
  costUsd: number;
}

export interface AiPlanResult extends AiCallResult {
  plan: TestPlan;
}

/** An AI call failed after spending money; carries the cost so it can still be recorded. */
export class AiCallFailedError extends Error {
  constructor(
    message: string,
    readonly costUsd: number,
  ) {
    super(message);
    this.name = 'AiCallFailedError';
  }
}

/** An AI agent that edits test files inside the workspace. */
export interface AiTestGeneratorPort {
  /** Read-only analysis that returns a plan (AI_MODE=plan-and-write). */
  plan(context: TestGenerationContext, limits: AiCallLimits): Promise<AiPlanResult>;
  /** Writes tests that implement `plan`. */
  write(context: TestGenerationContext, plan: TestPlan, limits: AiCallLimits): Promise<AiCallResult>;
  /** Single call that writes tests and reports what it did as a plan (AI_MODE=single). */
  planAndWrite(context: TestGenerationContext, limits: AiCallLimits): Promise<AiPlanResult>;
  /** Repairs the tests after a failed verification. */
  fix(
    context: TestGenerationContext,
    plan: TestPlan,
    failures: string[],
    testOutput: string,
    limits: AiCallLimits,
  ): Promise<AiCallResult>;
}

export const AI_TEST_GENERATOR_PORT = Symbol('AiTestGeneratorPort');
