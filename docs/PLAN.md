# Build plan — one Claude Code session per phase

Run `claude` from the repo root. Paste one prompt per session. Review the diff, run the app/tests yourself,
then commit (or let Claude commit) before starting the next phase. Use plan mode (Shift+Tab) for phases 1 and 4.

---

## Phase 0 — demo target repo (separate folder / GitHub repo `coverage-demo-target`)

> Create a small TypeScript library for a demo: 4–5 modules in `src/` (e.g. a date parser, a price
> calculator with discounts and rounding, a string validator, an in-memory cache with TTL, a small
> service that calls an injected HTTP client). Realistic branching and error cases. Set up Jest with
> ts-jest and write only a few tests so coverage per file is between 0% and 40%. Add `npm test` and a
> README. Keep it dependency-light.

Push it to GitHub. This is where the example PRs will be opened.

---

## Phase 1 — scaffold + domain layer

> Read CLAUDE.md. Scaffold `backend/` as a NestJS app (strict TS, Jest + ts-jest, ESLint, Prettier).
> Implement the full domain layer described in CLAUDE.md: value objects, Repository aggregate,
> CoverageSnapshot/FileCoverage, CoverageAnalyzer, ImprovementJob with its state machine, TestPlan,
> JobSchedulingPolicy, repository interfaces, DomainError. No framework imports in `domain/`.
> Write thorough unit tests, including illegal state transitions. Add an ESLint rule
> (no-restricted-imports) that forbids @nestjs/* and infrastructure libs inside `src/domain`.
> Record decisions in docs/DECISIONS.md.

## Phase 2 — persistence + application layer

> Read CLAUDE.md. Implement SQLite persistence with better-sqlite3: migrations (repositories,
> coverage_snapshots, file_coverages, jobs), WAL + busy_timeout, the partial unique index,
> repository implementations, and the atomic job claim inside BEGIN IMMEDIATE.
> Define the application ports and implement the use cases (RegisterRepository, ScanCoverage,
> RequestImprovement, ProcessNextJob, RecoverStaleJobs, GetDashboard) against the ports.
> Unit-test use cases with in-memory fakes; integration-test the SQLite layer on a temp DB,
> including a test that two concurrent claims never return the same job or two jobs of one repo.

## Phase 3 — scan pipeline (git + Jest coverage adapters)

> Read CLAUDE.md. Implement the safe spawn helper (timeout, minimal env, output capture), WorkspacePort,
> GitPort (clone/branch/commit/push with token via http.extraHeader), and the Jest CoverageRunner that
> parses coverage-summary.json and coverage-final.json. Wire ScanCoverage to a controller:
> POST /repositories, POST /repositories/:id/scan, GET /repositories/:id/files?belowThreshold=true.
> Add an e2e test that scans a local fixture repo (no network).

## Phase 4 — improvement jobs (worker, AI, PR)

> Read CLAUDE.md. Implement the worker (polling, WORKER_CONCURRENCY, lease heartbeat, reaper on
> startup and on interval), ClaudeCliAdapter (planner + writer/fixer, prompts in .md files,
> zod-validated TestPlan, AI_MODE single|plan-and-write), the deterministic verifier (only *.test.ts
> changed, tests pass, coverage increased), the fix loop, and the Octokit PullRequestAdapter with a PR
> body containing before/after coverage and the plan. Endpoints: POST /jobs, GET /jobs/:id,
> GET /repositories/:id/jobs. Add main.worker.ts. Unit-test the pipeline with fake ports, including
> failure at every phase and recovery after a simulated crash.

## Phase 5 — React dashboard

> Read CLAUDE.md. Create `frontend/` with Vite + React + TypeScript. One page: add repo by URL,
> trigger scan, table of files (path, coverage % with a colored bar, status/phase of latest job,
> PR link), "Improve" button per file, job detail drawer showing phase timeline, error and test plan.
> Poll every 2–3 s while jobs are active. Minimal, clean styling, no UI framework needed.

## Phase 6 — docs + demo

> Read CLAUDE.md. Write README.md: overview, prerequisites (Node, git, Claude Code CLI logged in,
> GitHub fine-grained PAT with Contents + Pull requests read/write), setup, step-by-step demo guide,
> configuration table from .env.example, assumptions and known limitations with proposed solutions
> (Jest only, single-node SQLite, no Docker isolation, forks for third-party repos, monorepos).
> Write docs/GLOSSARY.md and a Mermaid architecture + job state diagram in docs/ARCHITECTURE.md.

Then run the full flow locally against `coverage-demo-target` and keep the resulting PR as the example.
