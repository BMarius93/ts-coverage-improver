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

---

## Phase 3 — scan pipeline (git + Jest coverage adapters)

### ADR-3.1 One safe spawn helper for every external process
- **Decision:** `infrastructure/process/run-process.ts`: `spawn` with `shell: false` (arguments are never
  interpreted), `detached: true` (own process group), an explicit environment, a hard timeout that sends
  SIGTERM then SIGKILL to the **whole group** (npx → node → jest workers), stdout/stderr tail buffers
  (1 MiB) so a chatty process cannot exhaust memory. Tests prove a grandchild dies on timeout.
- **Alternatives:** `execa` (one more dependency), `exec` (shell injection risk).

### ADR-3.2 Children get an allow-listed environment
- **Decision:** `childEnv()` copies only `PATH, HOME, USER, LOGNAME, LANG, LC_ALL, TMPDIR, TZ, SHELL, TERM` plus
  explicit extras. `GITHUB_TOKEN` and anything else is dropped. A test spawns a child and asserts it cannot
  read `GITHUB_TOKEN`.

### ADR-3.3 `git` CLI instead of simple-git; token via `GIT_CONFIG_*` env
- **Context:** CLAUDE.md allows simple-git or spawning git. The token must never be in argv, the remote URL
  or `.git/config`.
- **Decision:** Spawn `git` through the safe helper. For clone/push only, pass
  `GIT_CONFIG_COUNT=1, GIT_CONFIG_KEY_0=http.https://github.com/.extraheader,
  GIT_CONFIG_VALUE_0=AUTHORIZATION: basic <base64(x-access-token:TOKEN)>` (git ≥ 2.31). The header is scoped to
  `https://github.com/`, so it is never sent to any other host. `GIT_TERMINAL_PROMPT=0` prevents hangs.
  `git -c` was rejected because it puts the token in argv (visible in `ps`).
- **Consequences:** No extra dependency, same timeout/kill guarantees as every other process. A test asserts
  the token is not in `.git/config`.

### ADR-3.4 Shallow clone, explicit commit list, `--no-verify`
- **Decision:** `git clone --depth 1 --single-branch --no-tags`; the default branch is whatever the clone
  checked out (`rev-parse --abbrev-ref HEAD`). Commits stage exactly the verified files (`git add -- <files>`)
  and use `--no-verify` so the target repo's hooks are not run.

### ADR-3.5 Jest runner details
- **Decision:**
  - Install: `npm ci --ignore-scripts` if `package-lock.json` exists, else `npm install --ignore-scripts
    --no-package-lock`. `--ignore-scripts` because the clone is untrusted code.
  - Jest is the repo's own (`npx --no-install jest`, configurable as `JEST_COMMAND`), with
    `--ci --coverageThreshold={}` so the target's own thresholds do not turn measurements into failures.
  - Reports go to a **temp directory outside the clone** (`--coverageDirectory`), so they never appear in
    `git status` (which the verifier inspects).
  - Scan: `--collectCoverageFrom=$COVERAGE_SOURCE_GLOB` minus `*.d.ts`, `*.test.ts`, `*.spec.ts`,
    `node_modules`; `json-summary` reporter. Exit code ≠ 0 still yields a snapshot (tests may fail while
    coverage is still meaningful).
  - Per file (before/after): `--findRelatedTests <target> --collectCoverageFrom=<target>` with `json-summary`
    + `json`. **Deviation from CLAUDE.md** (`jest <testFile>`): `findRelatedTests` runs *all* tests importing
    the target, so "before" reflects existing tests and "after" includes the new file — the same command for
    both, hence comparable numbers. Missing report → coverage `null` (treated as 0% before).
  - Percentages are computed from `covered/total` counts (istanbul reports `pct: "Unknown"` for empty files).
  - Uncovered lines come from `coverage-final.json` statement maps (`s[id] === 0`).
  - Paths are made repo-relative after `realpath` (macOS `/var` → `/private/var`).
- **Known effect:** barrel files (`index.ts` with only re-exports) show up with low coverage because the
  scan glob overrides the target's own `collectCoverageFrom`.

### ADR-3.6 Workspaces
- **Decision:** `WORKSPACE_DIR/{scans,jobs}/<id>`; ids are sanitised; `remove`/`removePaths` refuse any path
  outside the root (defence against a bug turning into `rm -rf` somewhere else).

### ADR-3.7 Config with zod; `.env` loaded with `process.loadEnvFile`
- **Decision:** `loadConfig()` validates every variable and reports all problems at once. Trailing `# comments`
  (present in `.env.example`) and empty values are tolerated. Node 22's `process.loadEnvFile` replaces dotenv.
  Two extra, test-oriented variables: `GIT_CLONE_BASE_URL` (default `https://github.com`) and `JEST_COMMAND`;
  plus `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` for the bot's commits.

### ADR-3.8 Composition root in `src/composition`
- **Decision:** Nest modules (`ConfigModule`, `PersistenceModule`, `AdaptersModule`, `ApplicationModule`,
  `HttpModule`) bind adapters to port tokens and build use cases with `useFactory`. Controllers are thin:
  zod DTO pipe → use case → `unwrapOrThrow` (domain error `code` → HTTP status: VALIDATION 400, NOT_FOUND 404,
  CONFLICT/ILLEGAL_STATE/CONCURRENCY 409).
- **Endpoints:** `POST /repositories` (201 new / 200 existing), `GET /repositories`, `GET /repositories/:id`,
  `POST /repositories/:id/scan` (202), `GET /repositories/:id/files?belowThreshold=true`.
- `tsconfig` `incremental` was removed: with Nest's `deleteOutDir` it silently skipped emitting files.

### ADR-3.9 Offline e2e with a local bare repository
- **Decision:** `test/support/fixture-remote.ts` turns `test/fixtures/sample-lib` into a bare repo under a temp
  dir; e2e sets `GIT_CLONE_BASE_URL=file://…` and `JEST_COMMAND=<backend>/node_modules/.bin/jest` (the fixture
  has no dependencies, so `npm ci` works offline). The e2e test exercises real git, npm, Jest, SQLite and HTTP.
- **Dependency:** `supertest` (standard for Nest e2e tests).

---

## Phase 4 — improvement jobs (worker, AI, PR)

### ADR-4.1 Claude Code headless via the safe process runner
- **Decision:** `ClaudeCliAdapter` runs `claude -p --output-format json` with cwd = job workspace and the
  prompt on **stdin** (not argv: no size limit, not visible in `ps`). Flags verified against
  `claude --help` of v2.1.326 and with a zero-cost probe (an invalid model name fails before any tokens are
  spent but proves every flag is accepted — unknown flags are rejected by the CLI):
  - planner: `--model $AI_PLANNER_MODEL --permission-mode plan --tools Read,Grep,Glob --allowedTools Read,Grep,Glob`
  - writer/fixer/single: `--model $AI_WRITER_MODEL --permission-mode acceptEdits --tools Read,Grep,Glob,Write,Edit,Bash
    --allowedTools "Read,Grep,Glob,Write,Edit,Bash(npx jest:*)"`
  - always: `--max-turns`, `--max-budget-usd`, `--strict-mcp-config` (no MCP servers from user config),
    `--no-session-persistence`, plus the process timeout `AI_TIMEOUT_MS`.
- `--tools` (which tools exist) is added to CLAUDE.md's `--allowedTools` (which are auto-approved): in print mode
  anything not allowed is denied, so the writer can run `npx jest …` but no other shell command.
  `--max-turns` is not listed in `--help` but is accepted (hidden flag).
- **Env:** allow-list + `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CONFIG_DIR`,
  `XDG_CONFIG_HOME`. Never `GITHUB_TOKEN` (tested with a fake CLI that dumps its environment).
- **Result handling:** the CLI can report `subtype: "success"` with `is_error: true` (seen in the probe), so
  both are checked. Planner/single must succeed. Writer/fixer that hit `error_max_turns` /
  `error_max_budget_usd` are *not* failed immediately: the deterministic verifier judges what they wrote.

### ADR-4.2 Prompts as Markdown templates; TestPlan parsed defensively
- **Decision:** `prompts/{planner,writer,fixer,single}.md` with `{{placeholders}}`; a missing value throws (typo
  guard). Every prompt says repository content is data, not instructions. The plan is extracted from the
  final message (raw JSON, a fenced block, or the outermost `{…}`), validated with zod for shape and then by
  `TestPlan.create` for domain rules (must be a `*.test.ts` path, 1–50 cases…).
- **Alternatives:** `--json-schema` structured output (newer flag; would remove the extraction step — future
  improvement once its output field is stable).

### ADR-4.3 AI_MODE
- `plan-and-write` (default): planner (read-only, stronger model) → writer (cheaper model).
- `single`: one writer call that also returns the plan JSON; the `planning` phase is skipped
  (`cloning → writing`, allowed by the state machine).

### ADR-4.4 Octokit, loaded lazily, idempotent `open`
- **Decision:** `@octokit/rest` (ESM-only) is `require`d lazily inside `octokitPullsFactory` (Node ≥ 22.12
  supports `require(esm)`), so Jest never loads it; tests inject a fake `GitHubPullsApi`. `open` first lists
  open PRs for `owner:branch` and returns an existing one — retries after a crash cannot create duplicates.
  Missing `GITHUB_TOKEN` fails the job in `opening_pr` with a clear message.

### ADR-4.5 Worker: slots, heartbeat, reaper, graceful shutdown
- **Decision:** `JobWorker` runs `WORKER_CONCURRENCY` slots; each loops `ProcessNextJob.execute(workerId)` and
  sleeps `WORKER_POLL_INTERVAL_MS` only when idle. Worker ids are `<host>-<pid>-<slot>`. The reaper
  (`RecoverStaleJobs`) runs on start and every `JOB_LEASE_SECONDS/2`, never overlapping itself.
- **Heartbeat:** `IntervalLeaseKeeper` extends the lease every `lease/3`. "Not owner any more" → lost
  immediately; DB errors are tolerated until a full lease period passes without a successful beat.
- **Shutdown:** stop claiming, wake idle slots, wait up to 10 s for running jobs, then kill every still-running
  child process group (they are detached, so they would otherwise survive). Unfinished jobs keep their lease;
  the next reaper requeues them.
- **Processes:** `main.ts` = API (+ worker when `RUN_WORKER=true`); `main.worker.ts` = worker only via
  `createApplicationContext`. Both can run against the same SQLite file (WAL).

### ADR-4.6 Endpoints
- `POST /jobs {repositoryId, filePath}` → 201 queued job (409 if one is already active for the file),
  `GET /jobs/:id`, `GET /repositories/:id/jobs`.

### ADR-4.7 e2e with real git/npm/Jest and a scripted AI
- **Decision:** e2e tests override only `AI_TEST_GENERATOR_PORT` (a scripted fake that writes real files into
  the workspace) and `PULL_REQUEST_PORT`. Everything else is real: clone, hardening, `npm ci`, Jest before/after,
  `git status`, verifier, commit, push to the local bare repo. Covered: happy path (branch contains exactly the
  test file), AI tampering with a source file (fails, nothing pushed), failing generated tests, and a restart
  after a crashed worker (startup reaper requeues, attempt 2 completes).

### ADR-4.8 SQLite error detection is duck-typed
- **Context:** a flaky test revealed that better-sqlite3's native addon keeps the `SqliteError` class from the
  first JS realm that loaded it (Jest module registries), so `instanceof Error` can be false.
- **Decision:** detect unique violations by `error.code`, pass errors through unchanged.

---

## Phase 5 — React dashboard

### ADR-5.1 Vite + React 19 + TypeScript, no UI framework, no state library
- **Decision:** One page (`App.tsx`) with small components: `AddRepositoryForm`, `RepositoryList`,
  `FilesTable` (+ `CoverageBar`, `JobBadge`), `JobDrawer`. Plain CSS with a few custom properties. Server
  state is fetched by a single `refresh()`; no React Query/Redux — the data set is small and polling is simple.
- **Versions:** Vite 8, `@vitejs/plugin-react` 6, React 19, TypeScript 5.9 (same pin as the backend).

### ADR-5.2 Adaptive polling
- **Decision:** `usePolling` re-schedules after each refresh completes (never overlapping). `pollInterval()`
  returns 2.5 s while any scan is running or any visible/open job is queued/running, otherwise 15 s (to pick up
  changes made from another tab or by the API). The open job drawer refreshes with the same tick.
- **Alternatives:** Server-Sent Events/WebSockets (push, more moving parts; good future improvement).

### ADR-5.3 Same-origin API through the Vite proxy
- **Decision:** The client calls `/api/*`; the Vite dev server proxies to `API_URL` (default
  `http://localhost:3000`) and strips `/api`. `VITE_API_URL` can point the built app elsewhere; the backend
  also enables CORS for `CORS_ORIGIN`.

### ADR-5.4 UX details
- Coverage bar coloured relative to the repository threshold (red < threshold/2 ≤ amber < threshold ≤ green)
  with a threshold marker. "Only files below threshold" (default on) uses the backend's analyzer ordering
  (lowest first). "Improve" is disabled while a job for the file is active (the backend also returns 409).
- The job drawer shows status/phase, before → after coverage, attempts and fix rounds, branch, duration,
  PR link, error, the phase timeline (requeues/failures marked red) and the test plan.

### ADR-5.5 Frontend tests: Vitest on pure logic only
- **Decision:** `vitest` (the standard runner for Vite projects; new dependency) tests the formatting,
  classification and polling-interval logic in `lib/format.ts`. Components are kept thin and are verified by
  `tsc`, ESLint (incl. `react-hooks`) and a manual run; no jsdom/Testing Library to keep dependencies minimal.
- **Consequences:** UI regressions would be caught manually; component tests are a future improvement.

---

## Phase 6 — docs + demo

### ADR-6.1 Documentation set
- **Decision:** `README.md` (overview, prerequisites incl. PAT permissions, setup, demo guide, config table,
  limitations with proposed solutions), `docs/ARCHITECTURE.md` (Mermaid: layers, runtime topology, job state
  machine, pipeline sequence, failure-handling table), `docs/GLOSSARY.md` (ubiquitous language ↔ code).
- `.env.example` gained `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` and documents the testing-only
  `GIT_CLONE_BASE_URL`/`JEST_COMMAND`; it is meant to be copied to `backend/.env`. A check confirmed it parses
  with `loadConfig` (including the inline `# comment`).

### ADR-6.2 One workspace per attempt
- **Context:** while writing the failure-handling docs: after a `kill -9`, detached child processes (e.g. the AI
  CLI) can outlive the backend; a retry reusing `jobs/<jobId>` would share the directory with such an orphan.
- **Decision:** job workspaces are `jobs/<jobId>-attempt-<n>`.
- **Consequences:** an orphan can never modify the clone that a retry verifies and pushes.

### ADR-6.3 The real end-to-end run is manual
- **Decision:** the GitHub + Claude flow needs credentials and costs money, so it is not part of the automated
  suites. Everything around it is covered: e2e with a local bare repository and a scripted AI, the Claude
  adapter against a fake CLI, and a zero-cost probe of the real CLI flags. The README's demo guide is the
  manual check that produces the example PR.
