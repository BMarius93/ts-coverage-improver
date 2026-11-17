import { describe, expect, it } from 'vitest';
import {
  coverageLevel,
  eventLabel,
  formatDuration,
  formatPercent,
  formatUsd,
  improveAction,
  isJobActive,
  jobLabel,
  pollInterval,
} from './format';
import type { FileRow, Job, Repository } from './types';

const job = (overrides: Partial<Job> = {}): Job => ({
  id: 'j1',
  repositoryId: 'r1',
  targetFile: 'src/a.ts',
  status: 'queued',
  phase: null,
  attempts: 0,
  fixAttempts: 0,
  branchName: null,
  coverageBefore: null,
  coverageAfter: null,
  testPlan: null,
  revertedFiles: [],
  aiCostUsd: 0,
  budget: null,
  prUrl: null,
  error: null,
  timeline: [],
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  ...overrides,
});

const repo = (scanStatus: Repository['scanStatus']): Repository =>
  ({ id: 'r1', scanStatus, threshold: 80 }) as Repository;
const file = (latestJob: Job | null): FileRow => ({ path: 'src/a.ts', latestJob }) as FileRow;

describe('format helpers', () => {
  it('formats percentages', () => {
    expect(formatPercent(12.345)).toBe('12.3%');
    expect(formatPercent(null)).toBe('—');
  });

  it('classifies coverage relative to the threshold', () => {
    expect(coverageLevel(85, 80)).toBe('good');
    expect(coverageLevel(80, 80)).toBe('good');
    expect(coverageLevel(45, 80)).toBe('medium');
    expect(coverageLevel(39.9, 80)).toBe('low');
  });

  it('labels jobs by status and phase', () => {
    expect(jobLabel(job())).toBe('Queued');
    expect(jobLabel(job({ attempts: 1 }))).toBe('Queued (retry 2)');
    expect(jobLabel(job({ status: 'running', phase: 'writing' }))).toBe('Running · Writing tests');
    expect(jobLabel(job({ status: 'completed' }))).toBe('PR opened');
    expect(jobLabel(job({ status: 'failed', phase: 'verifying' }))).toBe('Failed · Verifying');
    expect(jobLabel(job({ status: 'failed' }))).toBe('Failed');
    expect(eventLabel('opening_pr')).toBe('Opening PR');
    expect(eventLabel('requeued')).toBe('Requeued');
  });

  it('knows which jobs are active', () => {
    expect(isJobActive(job({ status: 'running' }))).toBe(true);
    expect(isJobActive(job({ status: 'failed' }))).toBe(false);
    expect(isJobActive(null)).toBe(false);
  });

  it('polls quickly only while work is in progress', () => {
    expect(pollInterval([repo('succeeded')], [file(job({ status: 'completed' }))], null)).toBe(15000);
    expect(pollInterval([repo('scanning')], [], null)).toBe(2500);
    expect(pollInterval([repo('succeeded')], [file(job({ status: 'running' }))], null)).toBe(2500);
    expect(pollInterval([], [], job({ status: 'queued' }))).toBe(2500);
  });

  it('hides Improve for skipped files and disables it while a job is active', () => {
    const row = (overrides: Partial<FileRow>): FileRow =>
      ({ path: 'src/a.ts', skippedReason: null, latestJob: null, ...overrides }) as FileRow;
    expect(improveAction(row({ skippedReason: 're-exports only' }))).toBe('hidden');
    expect(improveAction(row({ latestJob: job({ status: 'running' }) }))).toBe('disabled');
    expect(improveAction(row({ latestJob: job({ status: 'failed' }) }))).toBe('enabled');
    expect(improveAction(row({}))).toBe('enabled');
  });

  it('formats money', () => {
    expect(formatUsd(0.456)).toBe('$0.46');
    expect(formatUsd(3)).toBe('$3.00');
  });

  it('formats durations', () => {
    expect(formatDuration('2026-01-01T10:00:00Z', '2026-01-01T10:00:42Z')).toBe('42s');
    expect(formatDuration('2026-01-01T10:00:00Z', '2026-01-01T10:02:05Z')).toBe('2m 5s');
  });
});
