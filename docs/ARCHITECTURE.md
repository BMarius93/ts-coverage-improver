# Architecture

## Layers (DDD / ports & adapters)

Dependencies point inward. `domain` has no framework or I/O imports; `application` talks to the outside world
only through ports. Both rules are enforced by ESLint (`no-restricted-imports`).

```mermaid
flowchart LR
  subgraph interface["interface (Nest controllers, zod DTOs)"]
    RC[RepositoriesController]
    JC[JobsController]
  end
  subgraph application["application (use cases, ports, views)"]
    UC1[RegisterRepository]
    UC2[ScanCoverage]
    UC3[RequestImprovement]
    UC4[ProcessNextJob]
    UC5[RecoverStaleJobs]
    UC6[GetDashboard]
    P[["Ports: GitPort · WorkspacePort · CoverageRunnerPort · AiTestGeneratorPort<br/>PullRequestPort · JobQueuePort · LeaseKeeperPort · LoggerPort"]]
  end
  subgraph domain["domain (pure TypeScript)"]
    R[Repository aggregate]
    J[ImprovementJob aggregate<br/>state machine]
    CV[Coverage VOs + CoverageAnalyzer]
    POL[JobSchedulingPolicy]
    VER[ImprovementVerifier]
  end
  subgraph infrastructure["infrastructure (adapters)"]
    SQL[(SQLite<br/>better-sqlite3)]
    GIT[GitCliAdapter]
    JEST[JestCoverageRunner]
    AI[ClaudeCliAdapter]
    GH[OctokitPullRequestAdapter]
    WRK[JobWorker + IntervalLeaseKeeper]
    PROC[runProcess<br/>timeout · minimal env]
  end

  interface --> application --> domain
  infrastructure -. implements .-> P
  infrastructure --> domain
  GIT & JEST & AI --> PROC
  WRK --> UC4 & UC5
```

`src/composition/*.module.ts` is the composition root: it binds adapters to port tokens
(`{ provide: GIT_PORT, useFactory: … }`) and builds the framework-free use cases with `useFactory`.

## Runtime topology

```mermaid
flowchart LR
  UI[React dashboard<br/>Vite :5173] -- "/api/* (proxy)" --> API
  subgraph backend["NestJS process(es)"]
    API[HTTP API :3000]
    W[Worker slots × WORKER_CONCURRENCY<br/>+ reaper]
  end
  API <--> DB[(SQLite WAL<br/>data/app.db)]
  W <--> DB
  W -- "git clone/push (token via GIT_CONFIG_* env)" --> GHR[(GitHub repo)]
  W -- "npm ci --ignore-scripts, jest" --> WS[("workspaces/jobs/:id")]
  W -- "claude -p (cwd = workspace)" --> WS
  W -- "Octokit pulls.create" --> GHAPI[GitHub API]
```

`main.ts` runs the API and, with `RUN_WORKER=true`, the worker in the same process. `main.worker.ts` runs
only the worker; any number of worker processes can share the database because claiming is atomic.

## Job state machine

```mermaid
stateDiagram-v2
  [*] --> queued: RequestImprovement
  queued --> running: claim, attempts + 1
  queued --> failed: fail
  running --> completed: PR opened
  running --> failed: error or attempts exhausted
  running --> queued: lease expired (reaper)
  completed --> [*]
  failed --> [*]

  state running {
    [*] --> cloning
    cloning --> planning: plan-and-write mode
    cloning --> writing: single mode
    planning --> writing
    writing --> verifying
    verifying --> fixing: checks failed, fixes left
    fixing --> verifying
    verifying --> opening_pr: checks passed
  }
```

Constraints enforced at two levels:

| Rule | Domain | Database |
| --- | --- | --- |
| One running job per repository | `JobSchedulingPolicy.canStart` | `one_running_job_per_repo` partial unique index + `NOT EXISTS` in the claim |
| One active job per file | `JobSchedulingPolicy.canRequest` | `one_active_job_per_file` partial unique index |
| No lost updates | `ImprovementJob.version` | `UPDATE … WHERE version = ?` |

## Job pipeline (ProcessNextJob)

```mermaid
sequenceDiagram
  autonumber
  participant W as Worker slot
  participant Q as JobQueue (SQLite)
  participant G as Git
  participant C as Jest runner
  participant A as Claude CLI
  participant V as ImprovementVerifier
  participant H as GitHub API

  W->>Q: claimNext(workerId, lease)
  Note over W: heartbeat extends lease every lease/3
  W->>G: shallow clone, create branch coverage/file-slug-jobid
  W->>W: delete .claude/, CLAUDE.md (hardening)
  W->>C: npm ci --ignore-scripts; jest --findRelatedTests (before)
  W->>A: planner (read-only tools) → TestPlan JSON (zod + domain validation)
  W->>A: writer (Read/Write/Edit, Bash(npx jest:*))
  loop until verified or fix attempts exhausted
    W->>C: jest --findRelatedTests (after)
    W->>G: git status
    W->>V: only *.test.ts changed? tests pass? coverage up?
    alt failed and attempts left
      W->>A: fixer (failures + Jest output)
    end
  end
  W->>G: git add test files, commit, push --force (job-owned branch)
  W->>H: open PR (returns existing open PR for the branch on retry)
  W->>Q: complete(prUrl, coverageAfter)
```

Every phase change is persisted *before* the slow work of that phase, so the dashboard shows live progress and
a crash leaves an accurate record. Each save first checks the lease handle and then the optimistic version:
a worker that lost its job abandons it without writing.

## Failure handling summary

| Situation | What happens |
| --- | --- |
| Clone / npm / Jest / AI / push / PR error | Job `failed` in the phase where it happened, error stored, workspace kept if `KEEP_FAILED_WORKSPACES` |
| Verification fails | Fixer runs with failures + Jest output, up to `AI_MAX_FIX_ATTEMPTS`; then `failed` |
| External process hangs | Killed (whole process group) after `PROCESS_TIMEOUT_MS` / `AI_TIMEOUT_MS` |
| Worker crashes / is killed | Lease expires; reaper (on startup and every lease/2) requeues, or fails after `JOB_MAX_ATTEMPTS`; the retry clones into a fresh per-attempt workspace |
| Worker paused, job reassigned | Heartbeat reports "lost" or the next save hits a version conflict → job abandoned by the stale worker |
| Crash after push / after PR | Retry force-pushes the same job branch; PR adapter returns the already open PR |
| Server restarts during a scan | Scan older than 3 × `PROCESS_TIMEOUT_MS` is marked failed by the reaper |
| Graceful shutdown (SIGTERM) | Stop claiming, wait ≤ 10 s, kill child process groups; leases expire and jobs are requeued |
