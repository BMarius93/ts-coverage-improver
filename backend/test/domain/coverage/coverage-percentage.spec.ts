import { CoveragePercentage } from '../../../src/domain/coverage/coverage-percentage';
import { CoverageThreshold } from '../../../src/domain/coverage/coverage-threshold';
import { pct } from '../../support/builders';

describe('CoveragePercentage', () => {
  it.each([0, 55.5, 100])('accepts %p', (value) => {
    const result = CoveragePercentage.create(value);
    expect(result.ok && result.value.value).toBe(value);
  });

  it.each([-0.01, 100.01, Number.NaN, Number.POSITIVE_INFINITY])('rejects %p', (value) => {
    expect(CoveragePercentage.create(value).ok).toBe(false);
  });

  it('rounds to two decimals', () => {
    expect(pct(33.33333).value).toBe(33.33);
  });

  it('builds from counts and treats an empty file as fully covered', () => {
    const half = CoveragePercentage.fromCounts(1, 2);
    const empty = CoveragePercentage.fromCounts(0, 0);
    expect(half.ok && half.value.value).toBe(50);
    expect(empty.ok && empty.value.value).toBe(100);
  });

  it.each([
    [3, 2],
    [-1, 2],
    [1.5, 2],
  ])('rejects invalid counts %p/%p', (covered, total) => {
    expect(CoveragePercentage.fromCounts(covered, total).ok).toBe(false);
  });

  it('compares values', () => {
    expect(pct(50).isGreaterThan(pct(40))).toBe(true);
    expect(pct(40).isGreaterThan(pct(40))).toBe(false);
    expect(pct(40).equals(pct(40))).toBe(true);
    expect(CoveragePercentage.zero().toString()).toBe('0.00%');
  });
});

describe('CoverageThreshold', () => {
  it('defaults to 80', () => {
    expect(CoverageThreshold.default().value).toBe(80);
  });

  it.each([0, -5, 101, Number.NaN])('rejects %p', (value) => {
    expect(CoverageThreshold.create(value).ok).toBe(false);
  });

  it('is met by coverage equal to or above it', () => {
    const threshold = CoverageThreshold.default();
    expect(threshold.isMetBy(pct(80))).toBe(true);
    expect(threshold.isMetBy(pct(79.99))).toBe(false);
  });
});

it('creates a custom threshold', () => {
  const result = CoverageThreshold.create(90);
  expect(result.ok && result.value.value).toBe(90);
});
