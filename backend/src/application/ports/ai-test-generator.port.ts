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

/** An AI agent that edits test files inside the workspace. */
export interface AiTestGeneratorPort {
  /** Read-only analysis that returns a plan (AI_MODE=plan-and-write). */
  plan(context: TestGenerationContext): Promise<TestPlan>;
  /** Writes tests that implement `plan`. */
  write(context: TestGenerationContext, plan: TestPlan): Promise<void>;
  /** Single call that writes tests and reports what it did as a plan (AI_MODE=single). */
  planAndWrite(context: TestGenerationContext): Promise<TestPlan>;
  /** Repairs the tests after a failed verification. */
  fix(context: TestGenerationContext, plan: TestPlan, failures: string[], testOutput: string): Promise<void>;
}

export const AI_TEST_GENERATOR_PORT = Symbol('AiTestGeneratorPort');
