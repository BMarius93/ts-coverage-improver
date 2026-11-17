import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CoverageRunnerPort,
  FileMeasurement,
  RepositoryCoverage,
} from '../../../application/ports/coverage-runner.port';
import { FilePath } from '../../../domain/coverage/file-path';
import { childEnv } from '../../process/child-env';
import { ProcessError, ProcessResult, runProcess, runProcessOrThrow, tail } from '../../process/run-process';
import { CoverageFinalJson, CoverageReportParser, CoverageSummaryJson } from './coverage-report-parser';
import { SourceFileClassifier } from '../source-file-classifier';
import { TestFileScanner } from './test-file-scanner';

export interface JestCoverageRunnerOptions {
  /** e.g. `npx --no-install jest`; split on whitespace, never run through a shell. */
  jestCommand: string;
  sourceGlob: string;
  timeoutMs: number;
}

const OUTPUT_TAIL_CHARS = 8000;

/**
 * Runs the target repository's own Jest (documented assumption: Jest only).
 * Reports go to a temp directory outside the clone, so they never show up in `git status`.
 * `npm` and `jest` run with a minimal environment and `--ignore-scripts`: the cloned code is untrusted.
 */
export class JestCoverageRunner implements CoverageRunnerPort {
  constructor(
    private readonly options: JestCoverageRunnerOptions,
    private readonly scanner = new TestFileScanner(),
    private readonly classifier = new SourceFileClassifier(),
  ) {}

  async installDependencies(dir: string): Promise<void> {
    const args = existsSync(join(dir, 'package-lock.json'))
      ? ['ci', '--ignore-scripts', '--no-audit', '--no-fund']
      : ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'];
    await runProcessOrThrow('npm', args, { cwd: dir, env: this.env(), timeoutMs: this.options.timeoutMs });
  }

  async measureRepository(dir: string): Promise<RepositoryCoverage> {
    return this.withReportDir(async (reportDir) => {
      const result = await this.jest(dir, [
        '--coverage',
        `--collectCoverageFrom=${this.options.sourceGlob}`,
        '--collectCoverageFrom=!**/*.d.ts',
        '--collectCoverageFrom=!**/*.test.ts',
        '--collectCoverageFrom=!**/*.spec.ts',
        '--collectCoverageFrom=!**/node_modules/**',
        '--coverageReporters=json-summary',
        `--coverageDirectory=${reportDir}`,
        '--passWithNoTests',
      ]);
      const summary = await this.readJson<CoverageSummaryJson>(
        join(reportDir, 'coverage-summary.json'),
        result,
      );
      const files = await Promise.all(
        new CoverageReportParser(dir).parseSummary(summary).map(async (file) => {
          const content = await readFile(join(dir, file.path.value), 'utf8').catch(() => null);
          return content === null ? file : file.withKind(this.classifier.classify(file.path.value, content));
        }),
      );
      return { files, testsPassed: result.exitCode === 0 };
    });
  }

  async measureFile(dir: string, targetFile: FilePath): Promise<FileMeasurement> {
    return this.withReportDir(async (reportDir) => {
      const result = await this.jest(dir, [
        '--findRelatedTests',
        targetFile.value,
        '--coverage',
        `--collectCoverageFrom=${targetFile.value}`,
        '--coverageReporters=json-summary',
        '--coverageReporters=json',
        `--coverageDirectory=${reportDir}`,
        '--passWithNoTests',
      ]);
      const output = tail(`${result.stdout}\n${result.stderr}`, OUTPUT_TAIL_CHARS);
      const context = {
        existingTestFiles: await this.scanner.existingTestFiles(dir, targetFile),
        styleExample: await this.scanner.styleExample(dir),
      };
      const testsPassed = result.exitCode === 0;
      const summaryPath = join(reportDir, 'coverage-summary.json');
      if (!existsSync(summaryPath)) {
        return { testsPassed, coverage: null, uncoveredLines: [], uncoveredBranches: [], output, ...context };
      }
      const parser = new CoverageReportParser(dir);
      const summary = await this.readJson<CoverageSummaryJson>(summaryPath, result);
      const coverage = parser.parseSummary(summary).find((file) => file.path.equals(targetFile)) ?? null;
      const finalPath = join(reportDir, 'coverage-final.json');
      const finalReport = existsSync(finalPath)
        ? await this.readJson<CoverageFinalJson>(finalPath, result)
        : {};
      return {
        testsPassed,
        coverage,
        uncoveredLines: parser.uncoveredLines(finalReport, targetFile),
        uncoveredBranches: parser.uncoveredBranches(finalReport, targetFile),
        output,
        ...context,
      };
    });
  }

  private async jest(dir: string, args: string[]): Promise<ProcessResult> {
    const [command, ...baseArgs] = this.options.jestCommand.split(/\s+/).filter(Boolean);
    const result = await runProcess(
      command,
      // `--coverageThreshold={}` neutralises thresholds in the target's config: we want numbers, not a gate.
      [...baseArgs, '--ci', '--coverageThreshold={}', ...args],
      { cwd: dir, env: this.env(), timeoutMs: this.options.timeoutMs },
    );
    if (result.timedOut) {
      throw new ProcessError(`jest timed out after ${this.options.timeoutMs} ms`, result);
    }
    return result;
  }

  private async readJson<T>(path: string, result: ProcessResult): Promise<T> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch {
      throw new ProcessError(
        `Jest produced no coverage report (exit code ${result.exitCode}): ${tail(result.stderr || result.stdout, 1500)}`,
        result,
      );
    }
  }

  private async withReportDir<T>(work: (reportDir: string) => Promise<T>): Promise<T> {
    const reportDir = await mkdtemp(join(tmpdir(), 'coverage-improver-report-'));
    try {
      return await work(reportDir);
    } finally {
      await rm(reportDir, { recursive: true, force: true });
    }
  }

  private env(): NodeJS.ProcessEnv {
    return childEnv({ CI: 'true', NODE_ENV: 'test', FORCE_COLOR: '0', npm_config_update_notifier: 'false' });
  }
}
