import { FileCoverage } from '../../domain/coverage/file-coverage';
import { FilePath } from '../../domain/coverage/file-path';

export interface RepositoryCoverage {
  files: FileCoverage[];
  testsPassed: boolean;
}

/** A branch point with at least one path no test has taken, e.g. "line 42 if: else path never taken". */
export interface UncoveredBranch {
  line: number;
  /** istanbul branch type: if, cond-expr, binary-expr, switch, default-arg, … */
  type: string;
  /** Human names of the paths never taken, e.g. ['else'] or ['case 2', 'case 3']. */
  uncoveredPaths: string[];
}

export interface FileMeasurement {
  testsPassed: boolean;
  /** Null when the runner produced no coverage for the file (e.g. no test imports it). */
  coverage: FileCoverage | null;
  uncoveredLines: number[];
  uncoveredBranches: UncoveredBranch[];
  /** Repo-relative test files next to the target or in a sibling `__tests__` folder (at most 5). */
  existingTestFiles: string[];
  /** The shortest existing test file of the repository (≤ 120 lines), as an example of house style. */
  styleExample: string | null;
  /** Tail of the test runner output; fed back to the AI when verification fails. */
  output: string;
}

/** Runs the target repository's test suite with coverage. */
export interface CoverageRunnerPort {
  installDependencies(dir: string): Promise<void>;
  measureRepository(dir: string): Promise<RepositoryCoverage>;
  measureFile(dir: string, targetFile: FilePath): Promise<FileMeasurement>;
}

export const COVERAGE_RUNNER_PORT = Symbol('CoverageRunnerPort');
