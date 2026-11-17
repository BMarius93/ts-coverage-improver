import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { RepositoryView } from '../../src/application/views';
import { createE2eApp, E2eContext, waitFor } from '../support/e2e-app';

describe('Scan pipeline (e2e, local fixture repository, no network)', () => {
  let ctx: E2eContext;
  let http: App;

  beforeAll(async () => {
    ctx = await createE2eApp(AppModule);
    http = ctx.app.getHttpServer() as App;
  });
  afterAll(() => ctx.close());

  it('registers, scans and lists files below the threshold', async () => {
    const registered = await request(http)
      .post('/repositories')
      .send({ url: 'https://github.com/acme/sample-lib' })
      .expect(201);
    const id = (registered.body as RepositoryView).id;

    const started = await request(http).post(`/repositories/${id}/scan`).expect(202);
    expect((started.body as RepositoryView).scanStatus).toBe('scanning');
    await request(http).post(`/repositories/${id}/scan`).expect(409);

    const scanned = await waitFor(
      async () => (await request(http).get(`/repositories/${id}`).expect(200)).body as RepositoryView,
      (repo) => repo.scanStatus !== 'scanning',
    );
    expect(scanned.scanError).toBeNull();
    expect(scanned.scanStatus).toBe('succeeded');
    expect(scanned.defaultBranch).toBe('main');
    expect(scanned.latestSnapshot).toMatchObject({ fileCount: 4, filesBelowThreshold: 2, filesSkipped: 1 });

    const below = await request(http).get(`/repositories/${id}/files?belowThreshold=true`).expect(200);
    expect(below.body).toEqual([
      expect.objectContaining({ path: 'src/strings.ts', lines: 0, belowThreshold: true, latestJob: null }),
      expect.objectContaining({
        path: 'src/math.ts',
        belowThreshold: true,
        kind: 'module',
        skippedReason: null,
      }),
      // The barrel is below the threshold (no test imports it) but classified and skipped.
      expect.objectContaining({
        path: 'src/index.ts',
        kind: 're-export-only',
        skippedReason: 're-exports only',
      }),
    ]);
    const math = (below.body as Array<{ path: string; lines: number }>)[1];
    expect(math.lines).toBeGreaterThan(0);
    expect(math.lines).toBeLessThan(80);

    const all = await request(http).get(`/repositories/${id}/files`).expect(200);
    expect((all.body as Array<{ path: string }>).map((f) => f.path)).toEqual([
      'src/fully-covered.ts',
      'src/index.ts',
      'src/math.ts',
      'src/strings.ts',
    ]);
  });

  it('records a failed scan when the repository cannot be cloned', async () => {
    const registered = await request(http)
      .post('/repositories')
      .send({ url: 'https://github.com/acme/does-not-exist' })
      .expect(201);
    const id = (registered.body as RepositoryView).id;
    await request(http).post(`/repositories/${id}/scan`).expect(202);
    const failed = await waitFor(
      async () => (await request(http).get(`/repositories/${id}`).expect(200)).body as RepositoryView,
      (repo) => repo.scanStatus !== 'scanning',
    );
    expect(failed.scanStatus).toBe('failed');
    expect(failed.scanError).toMatch(/git clone/);
  });

  it('validates input and maps errors to HTTP codes', async () => {
    await request(http).post('/repositories').send({ url: 'not a url' }).expect(400);
    await request(http).post('/repositories').send({}).expect(400);
    await request(http).post('/repositories/nope/scan').expect(404);
    await request(http).get('/repositories/nope/files').expect(404);
    await request(http).get('/health').expect(200, { status: 'ok' });
  });
});
