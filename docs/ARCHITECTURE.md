# Architecture

Current source, 17 November 2026. See [RELEASE_READINESS.md](RELEASE_READINESS.md) for executed evidence and unresolved gates; existence of a module is not a reliability claim.

## Processes and ownership

The Next.js frontend uses same-origin `/api/auth/*` and `/api/rag/*` routes forwarded to NestJS. The API authenticates each request and applies origin, account, input and admission checks. Personal libraries are isolated by authenticated owner ID; supplied document IDs do not establish authorization.

Production mode uses PostgreSQL/pgvector and Redis. PostgreSQL stores accounts, hashed refresh/recovery credentials, active original upload bytes, chunks/embeddings, conversations, immutable answer assessments, source snapshots, conflicts/decisions and authoritative work state. SQLite is supported only for single-process local development. Redis provides shared admission counters/leases and BullMQ transport. Source content and full vectors are not queue payloads.

Docker/cloud split API and worker roles. Both use the same source/image; only the worker consumes BullMQ jobs and reconciles SQL work. Integrated local mode uses the same ingestion/revalidation processors with SQL polling. `backgroundConfig` rejects ambiguous role/transport combinations.

## Data paths

1. **Upload:** authorize/admit → bounded file parsing → durable SQL ingestion job → batched, paced embeddings with checkpoints → atomic document/index publication. Provider cooldowns preserve progress; a failed replacement does not publish a partial index. Original active bytes live in SQL, not ephemeral container disk.
2. **Question:** authenticate → resolve conversation/source scope → cache eligibility → owner/temporal-scoped hybrid retrieval → generation → atomic verification → targeted retrieval/minimal correction when justified → final verification/abstention → persisted answer and evidence. The final result remains fenced against library revision changes.
3. **Source change:** version/metadata event → conservative affected-answer planning, including new competing documents → durable revalidation job → fresh assessment against a consistent revision → immutable appended result or unchanged audit. Historical request scope is preserved.
4. **Conflict review:** persisted evidence pairs and exact versions → authorized explicit decision with explanation → revision/staleness checks → revalidation. Upload order and model preference do not create source authority. The Conflict Center covers saved-answer assessments, not a full-library scan.

See [SELF_CORRECTION.md](SELF_CORRECTION.md) for the factual contract and [LIFECYCLE_WORKFLOWS.md](LIFECYCLE_WORKFLOWS.md) for UI/API integration.

## Reliability and scale boundaries

- Queue delivery is at least once. SQL checkpoints, leases, transactions and revision fences prevent stale/duplicate publication; there is no exactly-once delivery promise.
- Admission uses shared Redis windows and concurrency leases. Fixed windows permit boundary bursts; provider pacing is a separate control. Redis failure must not silently bypass protected work.
- Database pools are bounded to five per process. Replica count multiplies pool, provider and memory demand; a load balancer alone does not establish capacity.
- Dense retrieval uses exact ranking; lexical candidates and neighboring passage expansion improve access to evidence. There is no validated ANN capacity claim.
- Exact/semantic answer cache is process-local. Candidate similarity needs an equivalence check and scope/revision guards; it is not factual support. Context-dependent queries bypass reuse.
- Archived snapshots retain text/chunks/metadata, not every replaced original binary. Active originals, histories and jobs are durable in PostgreSQL; recovery requires backups and configuration preservation.
- Model-based verification cannot guarantee truth. Malformed assessments, provider failures, insufficient evidence and unresolved contradictions must stay distinguishable.

## Deployment and operations

Use [INSTALLATION.md](INSTALLATION.md) for local Docker and [DEPLOYMENT.md](DEPLOYMENT.md) for cloud. API readiness checks SQL/admission Redis; worker heartbeat checks successful reconciliation. Neither establishes model quality. Cloud heartbeat alerting, proxy behavior, managed Redis compatibility and restore/rollback still need live acceptance.

Key implementation paths: `src/auth`, `src/database`, `src/vector-store/vector-store.service.ts`, `src/rag/{rag,ingestion,revalidation,job-queue}.service.ts`, `src/rag/{atomic-facts,verification,temporal,source-decisions}.ts`, `apps/web/src/components`, and `migrations/`.
