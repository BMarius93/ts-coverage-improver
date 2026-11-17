import { isAbsolute } from 'node:path';
import { ConfigError, loadConfig } from '../../../src/infrastructure/config/app-config';

describe('loadConfig', () => {
  it('applies defaults and resolves paths', () => {
    const config = loadConfig({});
    expect(config.PORT).toBe(3000);
    expect(config.AI_MODE).toBe('plan-and-write');
    expect(config.KEEP_FAILED_WORKSPACES).toBe(true);
    expect(isAbsolute(config.databasePath)).toBe(true);
    expect(config.maxScanDurationMs).toBe(config.PROCESS_TIMEOUT_MS * 3);
  });

  it('parses values from .env, including trailing comments and empty values', () => {
    const config = loadConfig({
      AI_MODE: 'single          # single | plan-and-write',
      WORKER_CONCURRENCY: '5',
      RUN_WORKER: 'false',
      GITHUB_TOKEN: '',
      DATABASE_PATH: ':memory:',
    });
    expect(config.AI_MODE).toBe('single');
    expect(config.WORKER_CONCURRENCY).toBe(5);
    expect(config.RUN_WORKER).toBe(false);
    expect(config.GITHUB_TOKEN).toBeUndefined();
    expect(config.databasePath).toBe(':memory:');
  });

  it('reports every invalid value', () => {
    expect(() => loadConfig({ COVERAGE_THRESHOLD: '150', AI_MODE: 'yolo' })).toThrow(ConfigError);
    expect(() => loadConfig({ COVERAGE_THRESHOLD: '150', AI_MODE: 'yolo' })).toThrow(
      /COVERAGE_THRESHOLD.*AI_MODE/,
    );
  });
});
