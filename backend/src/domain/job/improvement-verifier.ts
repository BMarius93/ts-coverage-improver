import { CoveragePercentage } from '../coverage/coverage-percentage';

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  path: string;
  kind: ChangeKind;
  /** Original path of a rename. */
  from?: string;
}

export interface VerificationInput {
  changedFiles: ChangedFile[];
  /** Paths the pipeline itself removed (prompt-injection hardening); their deletion is expected. */
  expectedDeletions: string[];
  testsPassed: boolean;
  coverageBefore: CoveragePercentage;
  coverageAfter: CoveragePercentage | null;
  /**
   * Whether repeated runs of the same tests all passed with identical line coverage.
   * `null` when only one run was made (nothing to compare).
   */
  stableAcrossRuns: boolean | null;
}

export interface VerificationOutcome {
  passed: boolean;
  failures: string[];
}

const TEST_FILE = /\.test\.tsx?$/;

/** The only kind of file the AI may add or modify. */
export function isTestFilePath(path: string): boolean {
  return TEST_FILE.test(path);
}

/**
 * Deterministic gate between "the AI says it is done" and "we open a PR". No AI involved:
 * 1. the AI may only add or modify `*.test.ts` files,
 * 2. the tests must pass,
 * 3. line coverage of the target file must strictly increase,
 * 4. repeated runs must agree (no flaky tests).
 */
export class ImprovementVerifier {
  verify(input: VerificationInput): VerificationOutcome {
    const failures: string[] = [];
    const expected = new Set(input.expectedDeletions);
    const relevant = input.changedFiles.filter(
      (file) => !(file.kind === 'deleted' && isExpected(file.path, expected)),
    );

    if (relevant.length === 0) {
      failures.push('No test file was created or modified.');
    }
    for (const file of relevant) {
      if (file.kind === 'deleted') {
        failures.push(`File was deleted: ${file.path}`);
      } else if (!TEST_FILE.test(file.path)) {
        failures.push(`Only *.test.ts files may change, but ${file.path} was ${file.kind}.`);
      }
    }
    if (!input.testsPassed) {
      failures.push('Tests are failing.');
    }
    if (input.stableAcrossRuns === false) {
      failures.push('Tests are not stable across runs.');
    }
    if (input.coverageAfter === null) {
      failures.push('Coverage of the target file could not be measured.');
    } else if (!input.coverageAfter.isGreaterThan(input.coverageBefore)) {
      failures.push(
        `Coverage did not increase (${input.coverageBefore.toString()} -> ${input.coverageAfter.toString()}).`,
      );
    }
    return { passed: failures.length === 0, failures };
  }

  /** The files that should be committed: added or modified test files. */
  testFilesToCommit(changedFiles: ChangedFile[]): string[] {
    return changedFiles
      .filter((file) => file.kind !== 'deleted' && TEST_FILE.test(file.path))
      .map((file) => file.path)
      .sort();
  }
}

function isExpected(path: string, expected: Set<string>): boolean {
  for (const prefix of expected) {
    if (path === prefix || path.startsWith(`${prefix.replace(/\/$/, '')}/`)) {
      return true;
    }
  }
  return false;
}
