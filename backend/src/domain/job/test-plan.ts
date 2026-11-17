import { FilePath } from '../coverage/file-path';
import { ValidationError } from '../shared/domain-error';
import { err, ok, Result } from '../shared/result';

export interface PlannedTestCase {
  /** Test name as it will appear in `it(...)`. */
  name: string;
  /** The behaviour, branch or lines this case covers. */
  covers: string;
}

export interface TestPlanProps {
  testFilePath: string;
  summary: string;
  cases: PlannedTestCase[];
}

const MAX_CASES = 50;
const MAX_TEXT = 2000;

/** The AI planner's proposal of which tests to write. Validated before it is trusted. */
export class TestPlan {
  private constructor(
    readonly testFile: FilePath,
    readonly summary: string,
    readonly cases: readonly PlannedTestCase[],
  ) {}

  static create(props: TestPlanProps): Result<TestPlan, ValidationError> {
    const path = FilePath.create(props.testFilePath);
    if (!path.ok) {
      return path;
    }
    if (!/\.test\.tsx?$/.test(path.value.value)) {
      return err(new ValidationError(`Test file must end with .test.ts: ${props.testFilePath}`));
    }
    const summary = props.summary.trim();
    if (summary.length === 0 || summary.length > MAX_TEXT) {
      return err(new ValidationError(`Plan summary must be between 1 and ${MAX_TEXT} characters`));
    }
    if (props.cases.length === 0 || props.cases.length > MAX_CASES) {
      return err(new ValidationError(`Plan must contain between 1 and ${MAX_CASES} test cases`));
    }
    const cases: PlannedTestCase[] = [];
    for (const testCase of props.cases) {
      const name = testCase.name.trim();
      const covers = testCase.covers.trim();
      if (name.length === 0 || name.length > MAX_TEXT || covers.length > MAX_TEXT) {
        return err(
          new ValidationError('Every test case needs a name (and descriptions must be reasonably short)'),
        );
      }
      cases.push({ name, covers });
    }
    return ok(new TestPlan(path.value, summary, cases));
  }

  toProps(): TestPlanProps {
    return {
      testFilePath: this.testFile.value,
      summary: this.summary,
      cases: this.cases.map((c) => ({ ...c })),
    };
  }
}
