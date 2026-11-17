# Glossary

Ubiquitous language used in code, API and UI.

| Term | Meaning | In code |
| --- | --- | --- |
| **Repository** | A GitHub repository registered with the service. Aggregate root holding its latest coverage snapshot and scan state. | `domain/repository/repository.ts` |
| **GitHubRepoUrl** | Value object identifying a repository (`owner/name`); accepts HTTPS and SSH forms, compares case-insensitively. | `github-repo-url.ts` |
| **Scan** | Clone + install + run the whole Jest suite with coverage, producing a snapshot. Has a status: `never_scanned`, `scanning`, `succeeded`, `failed`. | `ScanCoverage` |
| **Coverage snapshot** | Coverage of every measured file at one commit SHA. Immutable; history is kept, the latest is shown. | `CoverageSnapshot` |
| **File coverage** | Lines / branches / functions / statements percentages of one file. | `FileCoverage` |
| **Coverage percentage** | Value object in [0, 100], two decimals; computed from covered/total counts (empty file = 100%). | `CoveragePercentage` |
| **Threshold** | Minimum **line** coverage a file should have (default 80%). | `CoverageThreshold` |
| **File path** | Repository-relative POSIX path to a `.ts`/`.tsx` file; rejects `..`, absolute paths and odd characters. | `FilePath` |
| **Coverage analyzer** | Domain service: files below the threshold, lowest coverage first (tests and `.d.ts` excluded). | `CoverageAnalyzer` |
| **Target file** | The source file an improvement job writes tests for. | `ImprovementJob.targetFile` |
| **Improvement job** | Aggregate for one "raise coverage of this file" request: status, phase, attempts, coverage before/after, plan, PR, error, timeline. | `ImprovementJob` |
| **Status** | Lifecycle of a job: `queued → running → completed | failed` (and `running → queued` on requeue). | `JobStatus` |
| **Phase** | Step of a running job: `cloning, planning, writing, verifying, fixing, opening_pr`. A failed job keeps the phase it failed in. | `JobPhase` |
| **Timeline** | Ordered list of status/phase events with timestamps, shown in the job drawer. | `TimelineEntry` |
| **Attempt** | One claim of a job by a worker. Incremented on every claim; capped by `JOB_MAX_ATTEMPTS` for crash retries. | `attempts` |
| **Fix attempt** | One run of the AI fixer after a failed verification within an attempt; capped by `AI_MAX_FIX_ATTEMPTS`. | `fixAttempts` |
| **Test plan** | The planner's validated proposal: test file path (`*.test.ts`), summary and cases. Included in the PR body. | `TestPlan` |
| **Planner / writer / fixer** | The three AI roles: read-only analysis → writes tests → repairs tests from verifier feedback. `single` mode merges planner and writer. | `ClaudeCliAdapter` |
| **Verification** | Deterministic gate (no AI): only `*.test.ts` added/modified, tests pass, target line coverage strictly increased. | `ImprovementVerifier` |
| **Flaky check** | After a passing verification the tests run `VERIFY_RUNS - 1` more times; all runs must pass with identical line coverage (`stableAcrossRuns`). | `ProcessNextJob.verify` |
| **Reverted files** | Non-test files the AI changed that the pipeline restored from git before verification; listed in the PR body. | `GitPort.restoreNonTestChanges`, `ImprovementJob.revertedFiles` |
| **Job budget** | Per-job limits: total AI spend (`AI_JOB_MAX_BUDGET_USD`) and a deadline counted from the request (`JOB_DEADLINE_MS`). | `JobBudget`, `ImprovementJob.aiCostUsd` |
| **Uncovered branch** | A branch point with a path no test took, e.g. "line 42 if: else path never taken"; given to the AI. | `CoverageReportParser.uncoveredBranches` |
| **Style example** | The shortest existing test file of the repository, shown to the AI to match conventions. | `TestFileScanner.styleExample` |
| **Hardening** | Deleting `.claude/`, `CLAUDE.md`, `CLAUDE.local.md` from the clone so the target repo cannot instruct the AI agent; plus minimal env, restricted tools, `--ignore-scripts`. | `HARDENING_PATHS` |
| **Workspace** | Scratch directory for one scan or job: `WORKSPACE_DIR/{scans,jobs}/<id>`. | `WorkspacePort` |
| **Worker / slot** | Background loop that claims and processes jobs; a process runs `WORKER_CONCURRENCY` slots, each with its own worker id. | `JobWorker` |
| **Claim** | Atomically taking the oldest queued job whose repository has no running job (`BEGIN IMMEDIATE`). | `JobQueuePort.claimNext` |
| **Lease** | Time-limited ownership of a running job (`lease_until`). Extended by the heartbeat. | `JobQueuePort.extendLease` |
| **Heartbeat** | Periodic lease extension while a job runs; reports the lease as lost if ownership changed. | `IntervalLeaseKeeper` |
| **Reaper** | Recovery routine for expired leases (requeue or fail) and stale scans; runs on startup and on an interval. | `RecoverStaleJobs` |
| **Abandon** | What a worker does when it lost the lease: stop without writing; the job belongs to someone else now. | `ProcessOutcome.abandoned` |
| **Scheduling policy** | One running job per repository, one active job per file. | `JobSchedulingPolicy` |
| **Port / adapter** | Application-defined interface / infrastructure implementation of it. | `application/ports`, `infrastructure/*` |
