import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AiTestGeneratorPort,
  TestGenerationContext,
} from '../../src/application/ports/ai-test-generator.port';
import { OpenPullRequest, PullRequestPort } from '../../src/application/ports/pull-request.port';
import { PullRequestUrl } from '../../src/domain/job/pull-request-url';
import { TestPlan } from '../../src/domain/job/test-plan';
import { unwrap } from '../../src/domain/shared/result';

export const STRINGS_TEST = `import { capitalize } from './strings';

describe('capitalize', () => {
  it('upper-cases the first letter', () => {
    expect(capitalize('hello')).toBe('Hello');
  });

  it('returns an empty string unchanged', () => {
    expect(capitalize('')).toBe('');
  });
});
`;

/**
 * Stands in for Claude in e2e tests: writes real files into the job workspace, so git, Jest and the
 * verifier operate on genuine changes.
 */
export class ScriptedAi implements AiTestGeneratorPort {
  readonly calls: string[] = [];
  /** Extra files the "AI" writes besides the test, e.g. a tampered source file. */
  extraWrites: Record<string, string> = {};
  testContent = STRINGS_TEST;

  async plan(context: TestGenerationContext): Promise<TestPlan> {
    this.calls.push('plan');
    return Promise.resolve(
      unwrap(
        TestPlan.create({
          testFilePath: context.suggestedTestFile.value,
          summary: 'Cover both branches of capitalize.',
          cases: [
            { name: 'upper-cases the first letter', covers: 'non-empty input' },
            { name: 'returns an empty string unchanged', covers: 'empty input branch' },
          ],
        }),
      ),
    );
  }

  async write(context: TestGenerationContext, plan: TestPlan): Promise<void> {
    this.calls.push('write');
    writeFileSync(join(context.workspaceDir, plan.testFile.value), this.testContent);
    for (const [file, content] of Object.entries(this.extraWrites)) {
      writeFileSync(join(context.workspaceDir, file), content);
    }
    return Promise.resolve();
  }

  async planAndWrite(context: TestGenerationContext): Promise<TestPlan> {
    const plan = await this.plan(context);
    await this.write(context, plan);
    return plan;
  }

  async fix(): Promise<void> {
    this.calls.push('fix');
    return Promise.resolve();
  }
}

export class RecordingPullRequests implements PullRequestPort {
  readonly opened: OpenPullRequest[] = [];

  open(request: OpenPullRequest): Promise<PullRequestUrl> {
    this.opened.push(request);
    return Promise.resolve(
      unwrap(PullRequestUrl.create(`${request.repository.webUrl}/pull/${this.opened.length}`)),
    );
  }
}
