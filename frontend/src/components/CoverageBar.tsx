import { coverageLevel, formatPercent } from '../lib/format';

export function CoverageBar({ value, threshold }: { value: number; threshold: number }) {
  return (
    <div className="coverage" title={`${formatPercent(value)} of lines covered (threshold ${threshold}%)`}>
      <div className="coverage-track">
        <div className={`coverage-fill ${coverageLevel(value, threshold)}`} style={{ width: `${value}%` }} />
        <div className="coverage-threshold" style={{ left: `${threshold}%` }} />
      </div>
      <span className="coverage-value">{formatPercent(value)}</span>
    </div>
  );
}
