# Milestone 3B: separate workers and durable queues

Checkpoint: 13 November 2026. **3B accepted within local controlled boundaries.** This is not cloud or complete continuous-correction acceptance.

## What changed

The reproduced role-boundary bug was that API mode still started the ingestion SQL timer (`data/m3b-before.log`: one failed test). Role-aware startup now keeps API and worker scheduling separate. The default integrated SQL mode remains available for local use.

`src/worker.ts` runs the existing Nest application context without an HTTP listener. `JobQueueService` transports SQL job IDs through BullMQ, reconciles committed SQL work after transport failure, and invokes the existing ingestion/revalidation processors. It does not duplicate their parsing, embedding, retrieval or verification algorithms. Stable queue IDs reduce duplicate transport deliveries; SQL leases, owner checks and revision-fenced transactions establish publication authority.

Added bounded transport retries, reconnect behavior, queue startup deadlines, structured job identifiers, shutdown handling, and SQL revalidation lease renewal. Exhausted hourly revalidation budgets defer jobs to the budget reset. API request limiting and provider pacing remain separate controls. BullMQ 6.7.5 and ioredis 6.0.0 are pinned; no migration or frontend change was needed for this slice.

## Acceptance mapping

| Requirement | Executed scenario / boundary |
| --- | --- |
| Separate processing | API role starts neither SQL poller. Child processes run the real worker entrypoint without an API/browser, index documents and execute the real RAG revalidation pipeline with controlled inference. |
| SQL-to-Redis gap | Enqueue directly in SQL without a producer notification; reconciliation discovers and completes it. |
| Checkpoint recovery | Kill two competing workers during an embedding batch; restart after simulated lease expiration. Completed checkpoint inputs are not embedded again. |
| Commit-before-ack recovery | Test-only instrumentation pauses after the real answer transaction commits; kill/restart the worker. The duplicate delivery creates no extra answer version or model call. |
| Redis failure | Disconnect a TCP proxy, keep work in SQL, reconnect and resume. Separately restart the explicitly owned AOF Redis container and verify its queued ID survives. |
| Shutdown | Shut down while Redis is unavailable; require completion within ten seconds. |
| Bounded expenditure | Provider 429 preserves checkpoints and future retry time; repeated dispatch does not spend another attempt before reset. Exhausted hourly revalidation budget records its reset without model work. |
| Isolation / publication | Cross-account access fails; duplicate completed delivery does not increment the library revision. Adjacent lifecycle tests check stale revisions and preserved original answers. |
| Redis contract | Actual Lua, Streams, blocking delivery, reconnect and persistence behavior; a successful PING alone is not used as acceptance. |

Crash fixtures shorten the SQL lease wait and remove the dead worker's Redis lock, then use BullMQ's real stalled checker. They prove recovery after expiration, not a production wall-clock recovery SLA. Early 65/95-second test deadlines failed; a later run observed post-commit recovery taking about 97 seconds. The final deadline is 120 seconds per recovery, with actual durations recorded. No production recovery fix is attributed to increasing a test deadline, and scheduler variance remains a load/soak concern.

## Final execution

| Check | Actual final result | Evidence |
| --- | --- | --- |
| Backend TypeScript build and npm test | 169 passed, 0 failed, 6 infrastructure-only skips | data/m3b-final-backend.log |
| Real PostgreSQL/pgvector and Redis integration | 67 passed, 0 failed, 0 skipped | data/m3b-final-infra.log |
| Lint | Passed | data/m3b-final-lint.log |
| Controlled correction protocol | 7/7 passed; scripted inference | data/m3b-final-research.log |
| Production dependency audit | 0 known vulnerabilities reported | data/m3b-final-dependency-audit.json |
| Isolated parser resource probe | Passed | data/m3b-final-parser-resources.json |
| Working-tree whitespace check | Passed | data/m3b-final-diff-check.log |

Source/test manifest: 133 files, SHA-256 `d0e2e3f39eee95fd1106f06ff5ad32a09a781363aa4fbe089d86b42738229d4d` (data/m3b-source-fingerprint.json), verified unchanged. The six default-suite skips are the PostgreSQL-only regression and five worker infrastructure scenarios; the infrastructure run executes them with explicit disposable services. No failing 3B acceptance check remains. Frontend/browser tests were not rerun for this backend-only slice; historical browser results are not current cloud evidence.

[Machine-readable observations](milestone-3b-results.json): checkpoint recovery **67,038 ms**, post-commit replay **67,085 ms**; nine embedding inputs (eight document passages plus one query), two model calls, exactly two answer versions. Maximum-input worker RSS **147,696 KiB (144.2 MiB)**, heap used 64,853,184 bytes, 774 passages, **10,863 ms** elapsed. Parser RSS **57,420 KiB (56.1 MiB)**, parent RSS 61,752 KiB, **1,155 ms** elapsed. Inference is synthetic, so these times do not predict provider latency.

Connection point sample during standalone recovery: nine Redis clients including two harness producers and one observer, two blocked clients; two PostgreSQL connections labeled veriqon-worker (fixture and child) plus one observer. After suite cleanup, only the observer remained in either service and no Redis client was blocked. This is a cleanup observation, not a measured concurrent peak. Earlier checkpoint infrastructure also passed 67/67; it observed 96,527 ms post-commit recovery. Earlier shorter test timeouts are retained above, not omitted from the record.

## Resource evidence and limits

The maximum-text worker fixture uses 500,000 characters, 774 chunks and synthetic 1,536-dimensional vectors. It exercises real parsing/index persistence with a controlled local embedding endpoint. The declared worker RSS ceiling is 512 MiB. Queue payload contains one ID, 45 JSON bytes, rather than document text or vectors. The parser probe separately exercises process isolation with a 96 MiB V8 heap cap and a declared RSS ceiling of 256 MiB. These are serial synthetic fixtures, not PDF/DOCX worst-case, multiple simultaneous large uploads, or live-model latency/cost measurements.

One worker has a PostgreSQL pool capped at five connections. Each enabled queue has a producer connection and a worker with command/blocking connections; with two queue kinds, budget approximately six Redis connections per worker, plus the existing admission client when configured. This is an implementation-derived budget, not a measured managed-service capacity guarantee. The queue-count target of 100 is soft across simultaneous dispatchers; SQL admission and bounded batches remain authoritative.

## Changed implementation and test files

- Added `src/common/background-config.ts`, `src/rag/job-queue.service.ts`, `src/worker.ts`, `src/tests/worker.test.ts` and `scripts/performance-parser.mjs`.
- Updated `src/rag/ingestion.service.ts`, `src/rag/revalidation.service.ts`, `src/rag/rag.module.ts`, `src/rag/rag.controller.ts`, `src/main.ts`, `src/database/sql-store.ts`, `scripts/test-infra.mjs`, `package.json`, `package-lock.json` and `.env.example`.
- Updated the plan and status/performance documentation; added [BACKGROUND_WORKERS.md](BACKGROUND_WORKERS.md). Existing CI already invokes both modified test entrypoints. Unrelated working-tree changes were retained.

## Reproduction

After npm ci, run npm test and npm run lint. For infrastructure tests, create disposable PostgreSQL/pgvector and Redis services, then set TEST_DATABASE_URL and TEST_REDIS_URL explicitly. scripts/test-infra.mjs uses local fixture defaults on ports 55432 and 56379; it never reads application .env credentials. PostgreSQL fixture credentials are veriqon_test / local_test_only with database veriqon_test. Redis must use AOF and noeviction.

For the container-restart scenario, the explicitly owned container must be named veriqon-m3b-redis and bound to 127.0.0.1:56379; set TEST_REDIS_CONTAINER to that name. The test refuses any other target. Run npm run test:infra. With TEST_REDIS_CONTAINER omitted, only the container-restart scenario is skipped. Never point these tests at user data or a shared deployment.

Run node dist/scripts/research-evaluate.js for the scripted correction protocol and node scripts/performance-parser.mjs for the isolated parser probe. On this workstation TEMP/TMP were process-locally set to data/m3a-test-tmp on D: to avoid the previously full system drive. No global environment settings were changed.

## Remaining work

Milestone 3C owns complete continuous-correction semantics: current versus historical answer updates, citations, unchanged/no-op version handling, manual revalidation retry, and provider-reset-aware revalidation failures. This milestone's queue delivery success is not factual verification success. A queued or completed assessment is not necessarily a corrected answer.

Milestones 4–7 retain UI integration, current Docker topology/healthchecks, managed Redis/Neon/Render/Vercel acceptance, worker heartbeat/alerts, restore drills, full workload/soak testing and independent factual evaluation. API admission lease-loss cancellation and fixed-window burst/load tests remain explicit system-design gates. No load balancer, autoscaler or sliding-window limiter was added speculatively. Nothing was pushed or deployed. The two owned disposable containers (veriqon-m3b-postgres and veriqon-m3b-redis) were removed after testing; the unrelated running container was left untouched. Final source fingerprint and whitespace checks passed.
