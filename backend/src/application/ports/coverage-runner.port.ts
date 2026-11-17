import { FileCoverage } from '../../domain/coverage/file-coverage';
import { FilePath } from '../../domain/coverage/file-path';

export interface RepositoryCoverage {
  files: FileCoverage[];
  testsPassed: boolean;
}

export interface FileMeasurement {
  testsPassed: boolean;
  /** Null when the runner produced no coverage for the file (e.g. no test imports it). */
  coverage: FileCoverage | null;
  uncoveredLines: number[];
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
