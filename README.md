# TS Coverage Improver

A NestJS + SQLite service (with a React dashboard) that raises TypeScript test coverage in GitHub repositories:

1. **Register** a GitHub repository by URL.
2. **Scan** it: clone, `npm ci`, run Jest with coverage, list every `.ts` file below the threshold (default 80 % lines).
3. **Improve** a file on request: a background job clones the repo, asks an AI agent (Claude Code, headless) to
   write or extend `*.test.ts`, **verifies the result deterministically** (only test files changed, tests pass,
   coverage went up), pushes a branch and opens a pull request with before/after coverage and the test plan.
4. **Watch** it in the dashboard: files with coverage bars, live job phase, timeline, errors and PR links.

```
backend/    NestJS service — domain / application / infrastructure / interface (DDD, ports & adapters)
frontend/   Vite + React dashboard
docs/       ARCHITECTURE.md (Mermaid diagrams), DECISIONS.md (ADRs per phase), GLOSSARY.md, PLAN.md
```

Demo target used during development: [`coverage-demo-target`](../coverage-demo-target) — a small TS library
(date parser, price calculator, validators, TTL cache, HTTP-client service) with 0–32 % line coverage per file.

---

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | **≥ 22.12** (developed on 22.23) | `require(esm)` for Octokit, `process.loadEnvFile` |
| npm | ≥ 10 | installs target repositories (`npm ci`) |
| git | ≥ 2.31 | `GIT_CONFIG_COUNT` env-based auth header |
| [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) | developed against 2.1.x | the AI agent; must be **logged in** (`claude` → `/login`) or have `ANTHROPIC_API_KEY` set |
| GitHub fine-grained PAT | — | **Repository access:** the target repo(s). **Permissions:** *Contents: Read and write*, *Pull requests: Read and write* (Metadata: read is implied) |

Check the AI CLI works non-interactively before a demo: `claude -p "say hi" --output-format json`.

## Setup

```bash
# 1. Backend
cd backend
npm install
cp ../.env.example .env          # then set GITHUB_TOKEN (and adjust anything else)
npm run start:dev                # API on :3000 + worker (RUN_WORKER=true)

# 2. Dashboard (second terminal)
cd frontend
npm install
npm run dev                      # http://localhost:5173 (proxies /api → :3000)
```

Optional: run the worker as a separate process (set `RUN_WORKER=false` for the API, then `npm run worker`).
Production build: `npm run build && npm start` / `npm run worker:prod` in `backend`, `npm run build` in `frontend`.

## Demo guide

1. **Prepare the target.** Push `coverage-demo-target` to your GitHub account (e.g. `you/coverage-demo-target`)
   and give the PAT access to it.
   ```bash
   cd ../coverage-demo-target && gh repo create coverage-demo-target --public --source . --push
   ```
2. **Start** backend and dashboard (see Setup). Open http://localhost:5173.
3. **Register** `https://github.com/<you>/coverage-demo-target` with *Add repository*.
4. **Scan.** Click *Scan*; the card shows *Scanning…* and then the average coverage and how many files are below
   80 %. The table lists files lowest-coverage first (toggle *Only files below 80 %* to see all).
5. **Improve.** Click *Improve* on e.g. `src/price-calculator.ts`. The badge moves through
   *Queued → Cloning → Planning → Writing tests → Verifying (→ Fixing) → Opening PR → PR opened*.
   Click the badge to open the job drawer: timeline, coverage before → after, test plan, branch, errors.
6. **Review the PR** via the link: branch `coverage/src-price-calculator-<job id>`, only the test file changed,
   body with the before/after table, the plan and the verification checklist.
7. **Parallelism & safety (optional):** click *Improve* on two files of the same repository — the second waits
   (one running job per repository); a second click on the same file returns 409. Kill the backend mid-job
   (`kill -9`) and restart it: once the job's lease expires (`JOB_LEASE_SECONDS`), the reaper requeues it and a
   worker runs it again (`attempts: 2` and a *Requeued* entry in the drawer).

The same flow via the API:

```bash
curl -s -X POST localhost:3000/repositories -H 'content-type: application/json' \
     -d '{"url":"https://github.com/<you>/coverage-demo-target"}'               # → { id, … }
curl -s -X POST localhost:3000/repositories/<id>/scan                            # 202, scans in background
curl -s 'localhost:3000/repositories/<id>/files?belowThreshold=true'
curl -s -X POST localhost:3000/jobs -H 'content-type: application/json' \
     -d '{"repositoryId":"<id>","filePath":"src/price-calculator.ts"}'            # → queued job
curl -s localhost:3000/jobs/<jobId>                                              # status, phase, timeline, prUrl
curl -s localhost:3000/repositories/<id>/jobs
```

## Configuration

All variables are validated at startup (zod); invalid values stop the process with a list of problems.
Paths are relative to the backend's working directory.

| Variable | Default | Description |
| --- | --- | --- |
| `GITHUB_TOKEN` | — | PAT used for clone/push (as an HTTP header via env, never stored) and the GitHub API. Never passed to npm, Jest or the AI CLI. |
| `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` | `TS Coverage Improver` / `coverage-improver@users.noreply.github.com` | Identity of the bot's commits. |
| `PORT` | `3000` | HTTP port. |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin (the Vite proxy makes CORS unnecessary in dev). |
| `DATABASE_PATH` | `./data/app.db` | SQLite file (WAL mode). |
| `WORKSPACE_DIR` | `./workspaces` | Clones for scans and jobs. |
| `KEEP_FAILED_WORKSPACES` | `true` | Keep a failed job's clone for inspection. |
| `COVERAGE_THRESHOLD` | `80` | Line coverage below which a file is listed. |
| `COVERAGE_SOURCE_GLOB` | `src/**/*.ts` | `collectCoverageFrom` for scans (tests, `.d.ts`, `node_modules` excluded). |
| `RUN_WORKER` | `true` | Run the worker inside the API process. |
| `WORKER_CONCURRENCY` | `3` | Parallel job slots per worker process (still max one running job per repository). |
| `WORKER_POLL_INTERVAL_MS` | `2000` | Idle polling interval. |
| `JOB_LEASE_SECONDS` | `60` | Lease length; heartbeat every third, reaper every half. |
| `JOB_MAX_ATTEMPTS` | `2` | Claims allowed before an expired job is failed instead of requeued. |
| `PROCESS_TIMEOUT_MS` | `600000` | Hard timeout for git/npm/Jest; stale scans are failed after 3×. |
| `AI_CLI_PATH` | `claude` | Claude Code executable. |
| `AI_MODE` | `plan-and-write` | `plan-and-write` (read-only planner, then writer) or `single` (one call). |
| `AI_PLANNER_MODEL` / `AI_WRITER_MODEL` | `opus` / `sonnet` | Models (aliases or full names). |
| `AI_PLANNER_MAX_TURNS` / `AI_WRITER_MAX_TURNS` | `10` / `30` | `--max-turns` per call. |
| `AI_MAX_BUDGET_USD` | `3` | Cap for a single AI call; each call gets `--max-budget-usd` = min(this, the job's remaining budget). |
| `AI_JOB_MAX_BUDGET_USD` | `5` | Total AI spend per job across all calls and attempts; the job fails with "AI budget exceeded" once reached. |
| `JOB_DEADLINE_MS` | `1800000` | Wall-clock limit per job, counted from the request (queue time included); then "Job deadline exceeded". |
| `AI_TIMEOUT_MS` | `600000` | Hard timeout per AI call. |
| `AI_MAX_FIX_ATTEMPTS` | `2` | Fixer rounds after a failed verification. |
| `AI_RESTRICT_WRITES` | `true` | Run the writer/fixer in `dontAsk` mode with permission rules that allow writes only to `*.test.ts(x)`. Non-test edits are reverted by git either way. |
| `VERIFY_RUNS` | `2` | Test runs during verification; all must pass with identical coverage (flaky check). `1` disables it. |
| `GIT_CLONE_BASE_URL` | `https://github.com` | *Testing:* clone/push from elsewhere (e.g. `file:///tmp/remotes`). |
| `JEST_COMMAND` | `npx --no-install jest` | *Testing:* how Jest is invoked inside a clone. |

## How it works (short)

- **DDD layering.** `domain` (aggregates `Repository` and `ImprovementJob` with its state machine, value objects,
  `CoverageAnalyzer`, `JobSchedulingPolicy`, `ImprovementVerifier`) has no framework imports; `application` (use
  cases + ports) only knows interfaces; `infrastructure` implements ports; `interface/http` maps HTTP ↔ use cases.
  ESLint enforces the import rules. Use cases are plain classes wired by Nest factories.
  → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Reliable jobs.** Atomic claim in `BEGIN IMMEDIATE` (proven by a 6-process race test), partial unique indexes
  (one running job per repo, one active job per file), optimistic versioning, lease + heartbeat, reaper on startup
  and interval, attempts cap, idempotent push/PR on retry, timeouts that kill whole process groups, graceful
  shutdown.
- **Safety.** The AI runs with cwd = clone, restricted tools (`--tools`, `--allowedTools`, only `Bash(npx jest:*)`),
  writes allowed only for `*.test.ts(x)` (`dontAsk` + permission rules), turn/budget/time limits (per call and per
  job), no MCP servers, and an environment without `GITHUB_TOKEN`; `.claude/` and `CLAUDE.md` are deleted from the
  clone; `npm ci --ignore-scripts`; non-test edits are reverted before every verification; tests must pass
  `VERIFY_RUNS` times with identical coverage; only verified `*.test.ts` files are committed, by name.
- Every decision and trade-off is recorded in [docs/DECISIONS.md](docs/DECISIONS.md); terms in
  [docs/GLOSSARY.md](docs/GLOSSARY.md).

## Development

```bash
cd backend
npm test            # 313 unit/integration tests (domain 100 % covered; SQLite, git, process, AI adapter with a fake CLI)
npm run test:e2e    # 8 e2e tests: real git/npm/Jest against a local bare repo, scripted AI, crash recovery
npm run lint        # ESLint (incl. layer rules) + Prettier
npm run test:cov

cd frontend
npm test && npm run lint && npm run build
```

The e2e suite needs no network or credentials: it builds a bare repository from `backend/test/fixtures/sample-lib`,
points `GIT_CLONE_BASE_URL` at it and replaces only the AI and GitHub-API ports.

## Assumptions and known limitations

| Limitation | Why | Proposed solution |
| --- | --- | --- |
| **Jest only** (with a Jest config at the repo root; npm lockfile or none) | Coverage commands and report parsing are Jest/istanbul specific. | Add a `CoverageRunnerPort` per runner (Vitest, Mocha + nyc), selected by detecting the config; support pnpm/yarn by lockfile. |
| **Single-node SQLite** | Simple, transactional, enough for one host; WAL allows API + several worker processes on the same machine. | Swap the persistence adapters for PostgreSQL (`SELECT … FOR UPDATE SKIP LOCKED` claim) to run workers on many hosts. |
| **No container isolation** | The AI agent and the target's tests run on the host (mitigated: restricted tools, minimal env, `--ignore-scripts`, timeouts, hardening). | Run each job in a disposable container/VM (Docker with no network except the npm registry, read-only mounts, resource limits). |
| **Third-party repositories need a fork** | The PAT must be able to push a branch to the repository. | Fork via the API (`repos.createFork`), push to the fork and open a cross-repo PR (`head: fork-owner:branch`). |
| **Monorepos** | One Jest root and one `COVERAGE_SOURCE_GLOB` per repository. | Detect workspaces (npm/pnpm/yarn, Nx, Turborepo), scan per package and run Jest from the package directory. |
| Scans run inside the API process | Simpler than queueing scans; they are tracked on the aggregate and recovered when stale. | Run scans through the job queue as a second job type. |
| Failed pipeline steps are not retried automatically | Only crashes/expired leases are retried; a failed job can be re-requested by the user. | Classify transient errors (network, rate limits) and requeue with backoff. |
| Polling dashboard | Simple and robust. | Server-Sent Events from the API. |
| A hard-killed (`kill -9`) backend leaves its child processes running | Children run in their own process group so timeouts can kill grandchildren; `SIGKILL` cannot be intercepted. Graceful shutdown kills them; each retry uses a fresh per-attempt workspace, so orphans cannot interfere. | Run jobs in containers (see above) or a supervisor that owns the process groups. |
| Barrel files (`index.ts` with re-exports) appear with low coverage | The scan glob overrides the target's own `collectCoverageFrom`. | Respect the target's Jest config when present, or ignore files with no executable lines besides exports. |
| AI output format | The plan is extracted from the final message text and validated (zod + domain rules). | Use the CLI's `--json-schema` structured output once relied upon. |
| Write restriction for the AI relies on Claude Code permission rules (`dontAsk` + `Edit(**/*.test.ts)`) | Flags verified against v2.1.326 and the docs, but enforcement can only be observed in a paid run; `AI_RESTRICT_WRITES=false` falls back to `acceptEdits`. | Correctness does not depend on it: non-test edits are reverted by git and rejected by the verifier. Add a recorded real run to CI with a small budget. |
| Flaky detection is heuristic | `VERIFY_RUNS` identical runs catch most nondeterminism, not all (e.g. rare races, time-of-day). | Run with `--randomize` / in a different order, or more runs for files with timers. |
| Budget is a hard stop | A job that spends its budget on the writer fails at the next phase change, even if its tests might have verified; the deadline counts queue time. | Allow a final free verification after the last AI call, or a separate queue-time limit. |
| Context scan repeats on every measurement | `existingTestFiles`/`styleExample` are part of each `FileMeasurement`; the walk is bounded (5 000 entries) but repeated. | Compute them once per job in a dedicated port. |
| Only line coverage gates a PR | Branch coverage is reported (PR body) but may even decrease. | Make the gate configurable (lines and/or branches). |
| The real GitHub/Claude flow is not part of the automated tests | Needs credentials and costs money. | Covered by fakes/e2e with a local bare repo; run the demo manually (above). |
