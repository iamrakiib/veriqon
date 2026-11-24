# Background processing contract

Milestone 3B implementation, 13 November 2026. Local acceptance passed; results are in [MILESTONE_3B_RESULTS.md](MILESTONE_3B_RESULTS.md) and IMPLEMENTATION_PLAN.md; this document is not a claim of cloud deployment or complete continuous-correction acceptance.

## Roles and setup

The default `VERIQON_PROCESS_ROLE=integrated`, `JOB_QUEUE_MODE=sql` retains local single-process SQL polling. To separate processes, both must use the same PostgreSQL database, embedding settings and queue namespace:

| Setting | API | Worker |
| --- | --- | --- |
| Command after `npm ci` / `npm run build` | `npm run start:prod` | `npm run worker:prod` |
| `VERIQON_PROCESS_ROLE` | `api` | Entrypoint sets `worker` |
| `JOB_QUEUE_MODE` | `bullmq` | `bullmq` |
| `DATABASE_URL` | PostgreSQL URL | Same database |
| `QUEUE_REDIS_URL` | Durable Redis TCP/TLS URL | Same URL |
| `QUEUE_PREFIX` | Deployment-specific namespace | Same namespace |
| `REDIS_URL` / `REDIS_PREFIX` | Shared admission/counters | Same admission store/namespace |
| `REVALIDATION_ENABLED` | Exposes configuration | `false` disables planning/consumption |
| `REVALIDATION_PER_HOUR` | Default 10 | Same global SQL budget; range 1–100 |

Production retains the existing required auth, origin, provider and storage settings. Never put secrets in frontend variables. Separate workers require PostgreSQL; SQLite remains integrated/local only. The API does not open queue connections or poll background jobs. It commits accepted uploads/manual requests to SQL; the worker reconciles them every five seconds. Legacy synchronous upload/document endpoints retain their existing contracts; the background upload endpoint is the durable asynchronous path.

The worker uses Nest application context and the existing backend image/code, with no HTTP listener. Compose now overrides the API HTTP healthcheck with `node dist/scripts/worker-health.js`. Its private `WORKER_HEARTBEAT_PATH` advances only after successful SQL/queue reconciliation, is cleared at startup/shutdown and expires after 60 seconds. Use one path per worker process; unset it for deployments without file-based supervision. A healthy dispatcher is not evidence of factual correctness or successful completion of every job. Cloud heartbeat/alert integration remains milestone 6. Do not interpret API readiness as proof a worker is alive. `implementation.revalidation` exposes configured role/transport separately from complete-workflow capability.

## Durability and state machine

1. API commits an ingestion job, or source update plus library-change record, in PostgreSQL.
2. Worker expands library changes in existing bounded pages and selects due SQL job IDs. Queue payload is only `{id}`; no document text, vectors, credentials or answer content.
3. Stable `sql-<id>` queue IDs suppress concurrent duplicate deliveries. SQL leases, budgets, current revision and status must still permit execution.
4. Existing processors checkpoint vectors or commit an answer version transactionally. Publication is fenced by lease/revision. Only then does the queue handler return.
5. Expected quota/failure outcomes remain SQL `retry_wait`/`failed`, with due time and an owner-scoped error. A transport acknowledgement means a delivery was handled, not that an answer was verified.
6. If Redis delivery is lost, SQL reconciliation resubmits eligible work. If a worker dies after SQL commit but before acknowledgement, replay observes terminal SQL state and does not publish again.

Delivery is at least once. Idempotent database effects, not a promise of exactly-once transport, protect user-visible records. Completed/failed transport records are removed; durable inspection uses SQL job lists and correction history. Existing ingestion retry/discard APIs remain owner-scoped. Milestone 3C adds audited failed-job retries, provider-reset-aware scheduling and unchanged-assessment events; see [MILESTONE_3C_RESULTS.md](MILESTONE_3C_RESULTS.md) for the owner-scoped API and retention contract.

## Bounds and failure behavior

- One active ingestion and one revalidation delivery per worker; Redis global concurrency two per kind. SQL additionally enforces two active ingestion jobs and two revalidation jobs globally, with one active job per owner per kind. Request admission and embedding provider pacing remain separate controls.
- Dispatch at most two IDs per owner and 100 IDs per pass. A queue-count check targets 100 outstanding transport entries; concurrent dispatchers can race that admission check, so it is not a strict storage quota. Stable IDs and SQL admission remain authoritative. Full backlog/load limits require milestone 7 evidence.
- Ingestion provider retry times and saved checkpoints stay in SQL. Revalidation now also preserves structured provider cooldowns instead of replacing them with a short generic retry. Exhausted hourly revalidation budget moves `next_at` to its reset time instead of repeatedly delivering unaffordable work.
- Queue infrastructure attempts are bounded to three with exponential backoff; stalled recovery is bounded. SQL reconciles nonterminal work after transport failure without resetting its application attempt budget.
- Producer connections fail promptly, disable offline buffering and have a five-second command timeout. Worker connections reconnect with capped exponential delay. Queue startup has a ten-second readiness deadline; credentials are not included in startup errors.
- Shutdown stops dispatch, aborts active processors, waits for their SQL cleanup and closes queue connections before database disposal. Crashed leases expire; deletion/cancellation removes publication authority.
- SQL revalidation leases renew every 30 seconds during bounded work. Lost lease or revision change forbids final publication. Shared provider/request concurrency tests remain required regressions.

## Redis compatibility and operations

Pinned queue dependencies: BullMQ 6.7.5 and its default TCP client ioredis 6.0.0. The existing node-redis client remains unchanged for admission control; no custom client bridge or second job-processing engine is introduced. The dependency is the queue's supported connection driver, not another infrastructure service.

Use Redis persistence and `noeviction`. For local queue Redis, use `redis-server --appendonly yes --appendfsync everysec --maxmemory-policy noeviction` with a persistent `/data` volume. Do not copy a disposable-cache configuration. Back up PostgreSQL; it retains authoritative work even after queue loss. Namespace separation does not isolate Redis memory/eviction policy: prefer a separate managed queue instance if the rate-counter instance is disposable or cannot provide required durability.

Startup checks the reported memory policy. Integration exercises Lua, Streams, blocking worker delivery, duplicates and reconnects; `PING` is not compatibility acceptance. Managed Redis permissions, persistence guarantees, TLS, idle command cost, memory and connection quotas must be tested in milestone 6. If INFO is restricted, deployment needs an explicit verified compatibility approach; this implementation fails startup rather than assuming safety.

Logs use event/kind/jobId/duration and sanitized transport failures. Inspect SQL status before interpreting a queue delivery as successful indexing or factual verification. Avoid unrestricted queue dashboards or logging payloads. Alerts, worker heartbeat/age dashboards, restore drills and measured workload thresholds remain milestones 6/7.

Design references: [BullMQ connection requirements](https://docs.bullmq.io/guide/connections), [persistence and noeviction](https://docs.bullmq.io/guide/going-to-production), and [job ID deduplication boundaries](https://docs.bullmq.io/guide/jobs/job-ids). Runtime tests against the pinned versions take precedence over assuming compatibility from documentation alone.
