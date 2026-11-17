# TS Coverage Improver — project context for Claude Code

## What we are building

A NestJS + SQLite service that improves TypeScript test coverage in GitHub repositories:

1. **Register** a GitHub repo by URL.
2. **Scan**: clone it, run Jest with coverage, list every `.ts` file below the threshold (default 80% lines).
3. **Improve** (per file, on user request): a background job clones the repo, asks an AI CLI to write/extend
   `*.test.ts`, verifies the result, pushes a branch and opens a pull request.
4. **Dashboard** (React): files + coverage %, job progress, PR link.

This is a take-home assignment for Kraken. It is evaluated on: correctness, **DDD layering**, code quality,
GitHub automation (a real PR must be created), and **reliability of job handling**. The author must be able
to explain every decision, so keep code readable and record decisions in `docs/DECISIONS.md`.

## Repository layout

```
backend/                 NestJS service (required folder name for submission)
  src/
    domain/              Pure TypeScript. NO imports from @nestjs/*, better-sqlite3, simple-git, octokit, node:child_process.
      shared/            Result/Either, DomainError, Clock interface
      repository/        Repository aggregate, GitHubRepoUrl VO, RepositoryRepository interface
      coverage/          CoverageSnapshot, FileCoverage, CoveragePercentage VO, CoverageThreshold VO,
                         FilePath VO, CoverageAnalyzer domain service
      job/               ImprovementJob aggregate + state machine, JobStatus/JobPhase, TestPlan VO,
                         PullRequestUrl VO, JobSchedulingPolicy, ImprovementJobRepository interface
    application/
      ports/             GitPort, CoverageRunnerPort, AiTestGeneratorPort, PullRequestPort, WorkspacePort, JobQueuePort
      use-cases/         RegisterRepository, ScanCoverage, RequestImprovement, ProcessNextJob,
                         RecoverStaleJobs, GetDashboard
    infrastructure/
      persistence/sqlite/  better-sqlite3, SQL migrations, repository implementations, atomic job claim
      git/               simple-git or spawn('git'); token passed via http.extraHeader, never in remote URL
      coverage/jest/     runs jest, parses coverage-summary.json + coverage-final.json
      ai/claude/         ClaudeCliAdapter (planner + writer via `claude -p`)
      github/            Octokit PullRequestAdapter
      process/           safe spawn helper: timeout, clean env, output capture, kill on timeout
      worker/            polling worker, lease heartbeat, reaper
      config/            typed config from env (zod)
    interface/http/      Nest controllers + DTOs (thin: map HTTP <-> use cases)
    main.ts              API (+ worker if RUN_WORKER=true)
    main.worker.ts       worker only (NestFactory.createApplicationContext)
  test/                  unit tests mirror src/, e2e under test/e2e
frontend/                Vite + React + TypeScript dashboard (polls the API)
docs/                    PLAN.md, DECISIONS.md, GLOSSARY.md, architecture diagram (Mermaid)
```

## Architecture rules (non-negotiable)

- Dependencies point inward: `interface` → `application` → `domain`; `infrastructure` implements ports.
- Domain objects enforce their own invariants (constructors/factories validate; no public setters).
- Wire adapters to ports with Nest injection tokens, e.g. `{ provide: AI_TEST_GENERATOR, useClass: ClaudeCliAdapter }`.
  Domain and use-case classes must be constructible in plain unit tests without Nest.
- Use cases return results; controllers translate domain errors to HTTP status codes.
- No business logic in controllers or SQL.

## Domain model (summary)

- **Repository** (aggregate): id, GitHubRepoUrl (owner/name), defaultBranch, latest CoverageSnapshot.
- **CoverageSnapshot**: list of FileCoverage (FilePath, CoveragePercentage for lines/branches/functions/statements),
  taken at a commit SHA.
- **CoverageAnalyzer** (domain service): given a snapshot + CoverageThreshold → files needing improvement, sorted lowest first.
- **ImprovementJob** (aggregate): id, repositoryId, targetFile, status, phase, attempts, coverageBefore,
  coverageAfter, testPlan, prUrl, error, timestamps.
  - status: `queued | running | completed | failed`
  - phase (while running): `cloning → planning → writing → verifying → fixing → opening_pr`
  - methods: `start(workerId)`, `advanceTo(phase)`, `recordPlan(plan)`, `complete(prUrl, coverageAfter)`,
    `fail(reason)`, `requeue()`. Illegal transitions throw a DomainError.
- **JobSchedulingPolicy**: at most one running job per repository; jobs for different repos may run in parallel.

## Job pipeline (ProcessNextJob)

1. Claim next job atomically (SQLite `BEGIN IMMEDIATE`, see below).
2. `cloning`: fresh clone into `WORKSPACE_DIR/jobs/<jobId>`, create branch `coverage/<file-slug>-<jobId-short>`,
   delete any `.claude/` dir and `CLAUDE.md` from the clone (prompt-injection hardening), `npm ci`.
3. Measure coverage of the target file (before).
4. `planning`: AI planner (read-only tools) returns a TestPlan JSON, validated with zod.
5. `writing`: AI writer creates/extends the test file following the plan.
6. `verifying` (deterministic, no AI):
   - `git diff --name-only` contains only `*.test.ts` files,
   - tests pass,
   - target file coverage increased.
7. On verification failure → `fixing` (writer again with Jest output), up to `AI_MAX_FIX_ATTEMPTS`, else fail.
8. `opening_pr`: commit, push, Octokit `pulls.create`; PR body contains before/after coverage and the test plan.
9. Clean workspace on success; keep on failure if `KEEP_FAILED_WORKSPACES=true`.

## Reliability

- Atomic claim:
  ```sql
  UPDATE jobs SET status='running', phase='cloning', worker_id=?, lease_until=?, attempts=attempts+1
  WHERE id = (SELECT j.id FROM jobs j WHERE j.status='queued'
              AND NOT EXISTS (SELECT 1 FROM jobs r WHERE r.repository_id=j.repository_id AND r.status='running')
              ORDER BY j.created_at LIMIT 1)
  RETURNING *;
  ```
  inside `BEGIN IMMEDIATE`; `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000`.
- DB-level invariant: `CREATE UNIQUE INDEX one_running_job_per_repo ON jobs(repository_id) WHERE status='running';`
- Heartbeat extends `lease_until` while a job runs; a reaper requeues expired jobs (or fails them when
  `attempts >= JOB_MAX_ATTEMPTS`). Reaper also runs on startup.
- Every external process has a timeout and is killed on expiry.

## Security

- `GITHUB_TOKEN` only in the backend process env; never passed to AI CLI, npm or jest child processes
  (spawn with an explicit, minimal env). Never logged; never written into `.git/config`.
- AI CLI runs with `cwd` = job workspace, restricted `--allowedTools`, `--max-turns`, `--max-budget-usd`, timeout.
- Docker isolation is a documented future improvement unless time allows.

## AI CLI (Claude Code headless)

- Planner: `claude -p <prompt> --model $AI_PLANNER_MODEL --permission-mode plan --allowedTools "Read,Grep,Glob" --output-format json --max-turns $AI_PLANNER_MAX_TURNS`
- Writer/fixer: `claude -p <prompt> --model $AI_WRITER_MODEL --allowedTools "Read,Write,Edit,Bash(npx jest:*)" --output-format json --max-turns $AI_WRITER_MAX_TURNS`
- Prompts live in `backend/src/infrastructure/ai/claude/prompts/*.md`.
- `AI_MODE=single|plan-and-write` selects one combined call or the two-step flow.
- Check flags against `claude --help` of the installed version before relying on them.

## Coverage (Jest only — documented assumption)

- Scan: `npx jest --coverage --coverageReporters=json-summary --coverageReporters=json --collectCoverageFrom='<COVERAGE_SOURCE_GLOB>' --collectCoverageFrom='!**/*.d.ts' --collectCoverageFrom='!**/*.test.ts' --passWithNoTests`
- Per-file verify: `npx jest <testFile> --coverage --collectCoverageFrom=<targetFile> --coverageReporters=json-summary`
- `coverage-summary.json` → percentages; `coverage-final.json` → uncovered lines for the AI prompt.

## Commands

```
cd backend && npm run start:dev      # API + worker
cd backend && npm run worker         # worker only
cd backend && npm test               # unit tests
cd backend && npm run test:e2e
cd backend && npm run lint
cd frontend && npm run dev
```

## Conventions

- TypeScript strict mode. ESLint + Prettier.
- Tests: Jest + ts-jest. Domain has close to 100% unit coverage; adapters tested with fakes/mocks or e2e.
- Small, focused commits with conventional commit messages.
- After each phase: all tests and lint pass, then append the key decisions and trade-offs of that phase
  to `docs/DECISIONS.md` (short ADR style: context, decision, alternatives, consequences).
- Ask before adding a dependency not listed here or in `docs/PLAN.md`.
