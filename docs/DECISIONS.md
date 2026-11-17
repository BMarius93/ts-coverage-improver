# Architecture decisions

Short ADRs, appended phase by phase. Format: context → decision → alternatives → consequences.

---

## Phase 0 — demo target repository

### ADR-0.1 A purpose-built demo library instead of a random public repo
- **Context:** The service must open a real PR. A third-party repo needs a fork and has unknown tooling.
- **Decision:** `../coverage-demo-target` is a small, dependency-light TS library (date parser, price
  calculator, string validator, TTL cache, user service with an injected HTTP client) with Jest + ts-jest and
  a few tests, so per-file line coverage is 0–32%.
- **Alternatives:** an existing OSS repo (realistic but slow `npm ci`, flaky tests, needs a fork).
- **Consequences:** Fast, deterministic demo. It must be pushed to GitHub by the author before the end-to-end run.

### ADR-0.2 TypeScript 5.9, not 7
- **Context:** `typescript@latest` is 7.x (native compiler); `ts-jest` declares `typescript >=4.3 <7`.
- **Decision:** Pin `typescript@~5.9.3` in both repositories.
- **Consequences:** Stable ts-jest support. Revisit when ts-jest supports TS 7.

---

## Phase 1 — scaffold + domain

### ADR-1.1 NestJS 11 (CommonJS), not NestJS 12
- **Context:** NestJS 12 ships as ESM only. Jest + ts-jest with ESM requires `--experimental-vm-modules` and
  makes mocking harder.
- **Decision:** Use NestJS 11.2 (CommonJS) with Jest 30 + ts-jest.
- **Alternatives:** NestJS 12 + Vitest; NestJS 12 + Jest ESM mode.
- **Consequences:** Simple, conventional test setup. The upgrade to 12 is a mechanical follow-up.

### ADR-1.2 Four layers, enforced by lint
- **Context:** DDD layering is an evaluation criterion; rules that are only written down erode.
- **Decision:** `domain` → nothing; `application` → `domain`; `infrastructure`/`interface` → inward.
  ESLint `no-restricted-imports` forbids `@nestjs/*`, `better-sqlite3`, `simple-git`, `octokit`, `zod`,
  `express`, `child_process` and `fs` inside `src/domain` **and** `src/application`, and forbids outer-layer
  imports. Use cases are therefore plain classes, wired in Nest modules with `useFactory`.
- **Alternatives:** `@Injectable()` on use cases (simpler wiring, but couples the application layer to Nest);
  dependency-cruiser (one more dependency).
- **Consequences:** Use cases and domain objects are constructed with `new` in tests. Slightly more wiring code
  in the Nest modules.

### ADR-1.3 `Result` for parsing and use cases, exceptions for broken invariants
- **Context:** Some failures are expected (a user types a bad URL) and some are bugs (a worker tries to complete
  a queued job).
- **Decision:** Value-object factories (`GitHubRepoUrl.create`, `FilePath.create`, …) return
  `Result<T, ValidationError>`. Aggregate methods throw `DomainError` subclasses on illegal transitions
  (`IllegalStateTransitionError`). Use cases return `Result`; controllers map error `code`s to HTTP statuses.
- **Alternatives:** throw everywhere + exception filter (less explicit); Result everywhere (verbose aggregates).
- **Consequences:** Every user-input path is forced to handle failure; programmer errors stay loud.

### ADR-1.4 ImprovementJob state machine lives in the aggregate
- **Decision:** `status` (`queued|running|completed|failed`) and `phase`
  (`cloning → planning → writing → verifying ⇄ fixing → opening_pr`) transitions are checked by the aggregate
  using an explicit transition table. `cloning → writing` is allowed for `AI_MODE=single`. A failed job keeps the
  phase it failed in (useful in the UI); a completed job has no phase. The aggregate also refuses to complete
  unless coverage increased. Every transition appends to a `timeline` (shown in the dashboard).
- **Consequences:** The worker cannot persist an impossible state; illegal transitions are unit-tested.

### ADR-1.5 Optimistic concurrency via a `version` on ImprovementJob
- **Context:** A worker may be paused (GC, laptop sleep) long enough for the reaper to requeue its job and a
  second worker to claim it. The first worker must not overwrite the second one's progress.
- **Decision:** The aggregate carries a `version`; `ImprovementJobRepository.save` must compare it and throw
  `ConcurrencyConflictError` on mismatch. The heartbeat only touches the lease, not the version.
- **Consequences:** A worker that lost its lease fails fast on its next save instead of corrupting state.

### ADR-1.6 Lease and claim are not part of the domain model
- **Decision:** Leases (`lease_until`, heartbeat) and the atomic claim are queue mechanics and live behind an
  application port (`JobQueuePort`). The domain owns the *rules*: `JobSchedulingPolicy` (one running job per
  repository, one active job per file) and `ImprovementJob.handleExpiredLease(maxAttempts)` (requeue vs fail).
- **Consequences:** The SQLite adapter re-states the "one running job per repo" rule in SQL for atomicity; the
  policy class is the readable source of truth and is used by in-memory adapters/tests.

### ADR-1.7 Deterministic `ImprovementVerifier` is a domain service
- **Decision:** "Only `*.test.ts` added/modified, tests pass, target coverage strictly increased" is a pure
  function over data in `domain/job`. Deletions of paths removed by workspace hardening (`.claude/`,
  `CLAUDE.md`) are expected and ignored; any other deletion fails verification.
- **Consequences:** The most important safety gate has no I/O and is fully unit-tested.

### ADR-1.8 Scan state on the Repository aggregate
- **Context:** Cloning + `npm ci` + Jest can take minutes; an HTTP request should not block that long.
- **Decision:** `Repository` has a small scan lifecycle (`never_scanned|scanning|succeeded|failed`, error,
  start time) and `isScanStale()` so interrupted scans can be recovered.
- **Consequences:** The scan endpoint can return `202 Accepted` and the dashboard can poll.

### ADR-1.9 `FilePath` is strict
- **Decision:** Relative POSIX paths only; no `..`/`.`/empty segments, no leading `-`, only `.ts`/`.tsx`,
  a conservative character allow-list.
- **Consequences:** Paths can be safely joined to the workspace and passed as CLI arguments to Jest/git.

---

## Phase 2 — persistence + application layer

### ADR-2.1 Ports are interfaces + Symbol tokens in `application/ports`
- **Decision:** `GitPort`, `WorkspacePort`, `CoverageRunnerPort`, `AiTestGeneratorPort`, `PullRequestPort`,
  `JobQueuePort`, `LeaseKeeperPort`, `LoggerPort`. Each file exports its interface and a `Symbol` token for Nest.
  Domain repository interfaces stay in `domain/*` (they speak the domain's language); their tokens live in
  `application/tokens.ts` so the domain has no DI concerns.
- **Consequences:** Use cases depend on interfaces only and are unit-tested with in-memory fakes
  (`test/support/fakes.ts`).

### ADR-2.2 Use cases return read models (views), not aggregates
- **Decision:** `application/views.ts` maps aggregates to plain JSON-ready objects (`RepositoryView`,
  `FileView`, `JobView`). Controllers never see domain objects.
- **Consequences:** The HTTP shape is stable even when aggregates change.

### ADR-2.3 Scans run in the background with state on the aggregate
- **Decision:** `ScanCoverage.execute` validates, marks the repository `scanning`, persists, and returns
  a `completion` promise that never rejects (the controller ignores it; tests await it). Failure is recorded
  on the aggregate (`failScan`). The scan workspace is always removed.
- **Alternatives:** run scans through the job queue (more robust, more code); synchronous scan in the request
  (simple, but HTTP timeouts on large repos).
- **Consequences:** A process crash leaves `scanning` behind — `RecoverStaleJobs` marks scans older than
  `maxScanDurationMs` (2× `PROCESS_TIMEOUT_MS`) as failed. Two simultaneous scan requests in the same tick
  could both pass the `isScanning` check (no version on Repository) — acceptable for a single-user tool.

### ADR-2.4 SQLite claim: domain logic inside `BEGIN IMMEDIATE`
- **Context:** CLAUDE.md sketches a single `UPDATE … RETURNING`. That would duplicate the aggregate's `start()`
  logic (timeline, branch name, attempts) in SQL.
- **Decision:** `SqliteJobQueue.claimNext` runs a `BEGIN IMMEDIATE` transaction (better-sqlite3
  `transaction().immediate()`): select the oldest queued job of a repository with no running job (the same
  `NOT EXISTS` query), call `job.start()`, write it with the optimistic version check, set `lease_until`.
  The write lock is held from the first statement, so no other connection/process can interleave.
- **Backstops:** partial unique indexes `one_running_job_per_repo` and `one_active_job_per_file`.
- **Verification:** an integration test spawns 6 OS processes that race to claim 9 jobs across 3 repos; it
  asserts one running job per repo and no double claims. With a deferred transaction the test fails
  (`SQLITE_BUSY`), so it really exercises the locking.

### ADR-2.5 Lease is a column owned by the queue
- **Decision:** `lease_until` (epoch ms) is written by `claimNext`/`extendLease` only. `save()` keeps it while
  the job is running and clears it otherwise. `extendLease` matches on `worker_id` and `status='running'`, so a
  worker can never extend a lease it no longer owns.

### ADR-2.6 Pipeline failures fail the job; crashes are retried
- **Decision:** Any error inside `ProcessNextJob` (clone, npm, AI, verification, push, PR) marks the job
  `failed` with the phase it failed in; the user can request a new job. Only *crashes/hangs* (expired lease)
  are retried by the reaper, up to `JOB_MAX_ATTEMPTS`. A lost lease (`LeaseLostError`) or a stale write
  (`ConcurrencyConflictError`) makes the worker *abandon* the job without writing anything.
- **Alternatives:** automatic retry with backoff for transient errors (network) — future improvement.
- **Consequences:** No double PRs from duplicate workers; failure reasons are visible in the dashboard.

### ADR-2.7 Retried jobs are idempotent towards GitHub
- **Decision:** The branch name is derived from the job id (stable across attempts), push is `--force` to that
  job-owned branch, and `PullRequestPort.open` returns the existing open PR for the same head if there is one.
- **Consequences:** A crash between "push" and "save completed" cannot create duplicate PRs.

### ADR-2.8 Coverage before/after measured with the same command
- **Decision:** `CoverageRunnerPort.measureFile` is used for both measurements (Phase 3 implements it with
  `jest --findRelatedTests <target>`), so before/after numbers are comparable. If Jest reports nothing for the
  file (no test imports it), "before" is 0%.

### ADR-2.9 Workspace hardening deletions are expected by the verifier
- **Decision:** The pipeline deletes `.claude/`, `CLAUDE.md`, `CLAUDE.local.md` from the clone, passes the
  removed paths to the verifier as expected deletions, and commits only the verified test files by name
  (never `git add -A`), so these deletions never reach the PR.
