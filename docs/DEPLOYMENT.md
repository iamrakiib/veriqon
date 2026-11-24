# Cloud deployment: Vercel, Render, Neon and Redis

Updated 24 November 2026. The existing Vercel frontend and free Render API are deployed at commit `febdf8bfced91e8e03c474015a00dc5b9a828458`; Neon migrations 1–4 and a real PDF/query smoke passed. That service uses integrated SQL processing, not the separate always-on worker/BullMQ profile documented below. Full cloud lifecycle acceptance remains open. See [RELEASE_READINESS.md](RELEASE_READINESS.md) for exact evidence and limitations; [INSTALLATION.md](INSTALLATION.md) covers local Docker installation.

## Architecture and prerequisites

Vercel serves Next.js and proxies `/api/auth/*` and `/api/rag/*` to the Render API. A separate Render worker runs the existing ingestion and revalidation processors. Both use Neon PostgreSQL; BullMQ uses a compatible persistent Redis TCP endpoint. PostgreSQL is authoritative for source bytes, checkpoints, conversations, versions and correction decisions. Redis is transport and admission coordination, not the only record of accepted jobs.

Use `sc-rag` as the Git repository root. Obtain release approval and a resource budget before creating services. The supplied `render.yaml` selects one paid Starter API and one paid Starter worker, Singapore region, manual deployments. These are initial configuration choices, **not measured production capacity**. Render free services do not provide a free background worker. Verify current costs, region availability and plan limits before applying the Blueprint. [Render workers](https://render.com/docs/background-workers), [free-service limits](https://render.com/docs/free).

Staging must have separate Neon data, Redis namespaces and provider spending limits. Do not use existing personal documents or production accounts in acceptance tests. Keep original credentials private; templates contain no credentials. CLI authentication was renewed for the 24 November release; future deployments must check their own authorization.

## 1. Establish the release candidate

Finish required local CI checks, review the source/private-file audit, and record the Git commit. Only then publish the approved source. Both Render services and Vercel must use that candidate. `autoDeployTrigger: 'off'` deliberately prevents independent automatic Render rollouts. Vercel Git integration must also have automatic production promotion disabled or be restricted to the approved release workflow.

The existing GitHub workflow validates code and Docker installation; it does not currently implement an automated staged cloud promotion or rollback. Configure protected-branch required checks in GitHub before public release. Do not infer branch protection from the YAML file.

## 2. Create isolated Neon storage

Create a PostgreSQL database/branch near the Render region. Use a TLS connection URL with `sslmode=verify-full`; retain certificate and hostname verification. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0` or use a developer's local CA file path. The existing deployment passed extension/migration checks; repeat them for each fresh target and whenever migrations change. [Secure connections](https://neon.com/docs/connect/connect-securely), [pgvector](https://neon.com/docs/extensions/pgvector).

For the initial staged deployment, put the **direct** URL in `DATABASE_URL`. The API pre-deploy command owns migrations and uses that URL. API and worker startup both have `DB_MIGRATE_ON_START=false`; the worker must never be the migration owner. The existing migration runner obtains a PostgreSQL transaction advisory lock and checks migration checksums. Do not edit an applied migration or import a local SQLite database into an existing populated cloud database.

Current runtime pools are bounded to five connections per process. One API + one worker can use ten runtime connections, with additional headroom needed for migrations, rolling replacements and operator connections. Neon pooled runtime URLs are a future staging validation step, not silently substituted here; transaction locks, session parameters and reconnect behavior must be exercised before changing the profile. A distinct least-privilege runtime role versus migration role is also a release hardening task.

After the API migration step succeeds, check in Neon's SQL editor:

```sql
SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version;
SELECT extversion FROM pg_extension WHERE extname = 'vector';
SELECT pg_size_pretty(pg_database_size(current_database()));
```

Expect schema versions 1 through 4 for this source. Record actual PostgreSQL and pgvector versions, not assumed defaults.

## 3. Configure Redis for queues and admission

Set `QUEUE_REDIS_URL` to a private authenticated `rediss://` TCP URL. An HTTPS REST endpoint/token is not interchangeable. Queue Redis needs persistence, `noeviction`, Lua scripting, blocking operations and enough concurrent connections. The worker explicitly checks `INFO` for `maxmemory_policy:noeviction`; a managed endpoint that hides or contradicts that field will fail startup. Do not weaken this guard to make an incompatible endpoint appear healthy.

Set `REDIS_URL` for shared admission counters/leases. It may use the same compatible persistent instance initially, with the documented capacity tradeoff; do not share staging counters with production. The Blueprint sets `REDIS_PREFIX=veriqon-staging` and `QUEUE_PREFIX=veriqon-staging-jobs`. Change both for each isolated deployment.

Existing queue producers have bounded request retries and five-second command deadlines; consumers use `maxRetriesPerRequest=null` and blocking connections. SQL reconciliation recovers committed work after missed delivery. Redis persistence does not replace SQL backups. [BullMQ production requirements](https://docs.bullmq.io/guide/going-to-production), [connection behavior](https://docs.bullmq.io/guide/connections).

Before release, test the exact managed endpoint with the pinned BullMQ/ioredis versions. Measure command usage while idle and processing: two queues reconcile every five seconds, so a small free command allowance may be unsuitable even with little chat traffic. Record the provider's persistence, eviction, connection and command allowances. Existing local Redis passes do not establish managed-service compatibility.

## 4. Configure Render API and worker

After approval, connect the repository and create a Blueprint from `render.yaml`. Review resources and cost before confirming. Validate with the official CLI (`render blueprints validate render.yaml`) using an authenticated account. [Blueprint field reference](https://render.com/docs/blueprint-spec).

Required API inputs (worker copies them through `fromService`):

| Variable | Value / owner |
| --- | --- |
| `DATABASE_URL` | Private Neon direct TLS URL; API migration and both runtimes |
| `REDIS_URL` | Private admission Redis TLS URL |
| `QUEUE_REDIS_URL` | Private persistent BullMQ Redis TLS URL |
| `APP_ORIGINS` | Exact stable Vercel HTTPS origin(s), comma-separated; no paths or wildcard |
| `OPENROUTER_API_KEY` | Server-only inference credential with an approved data/privacy policy |
| `LLM_MODEL` | Explicit model available to that account |
| `EMBEDDING_MODEL` | Explicit embedding model; changing it requires reindexing |
| `JWT_SECRET`, `SETUP_CODE` | Independently generated by Blueprint for new services; preserve existing values on migrations |

Shared non-secret settings live in `veriqon-runtime`. API role is `api`; worker role is `worker`; both use `JOB_QUEUE_MODE=bullmq`. Optional `VERIFIER_MODEL`, `DECOMPOSER_MODEL` and embedding input modes must be configured consistently in that shared group. Never create different provider/embedding settings accidentally on the two services. Service references refresh on Blueprint sync; resync and redeploy both after changing referenced secrets/settings.

First deployment ordering:

1. Apply configuration with production traffic closed. API runs `node dist/scripts/migrate.js` before `node dist/src/main.js`.
2. Confirm migration success and API `/rag/ready` HTTP 200.
3. Deploy/redeploy worker at the same source commit; command is `node dist/src/worker.js`.
4. Confirm `worker_ready`, then actual queue processing. Blueprint service references are not a migration-readiness barrier: initial worker startup can fail before API migrations finish. Redeploy it only after step 2 succeeds.
5. Open frontend traffic only after worker acceptance. Never enable automatic migrations in every process as a shortcut.

Both services receive 30 seconds for graceful shutdown. SIGTERM invokes existing shutdown hooks; interrupted jobs retain SQL checkpoints and leases. Render web health uses `/rag/ready`, which checks SQL and admission Redis. It **does not prove** inference availability or worker health. `/rag/health` reports capabilities, not acceptance results.

Worker heartbeat is `/tmp/veriqon-worker-heartbeat.json`; run `node dist/scripts/worker-health.js` in the worker shell for exit 0 (fresh successful reconciliation) or 1. Render workers do not have the API's HTTP health endpoint. The Blueprint does not install a heartbeat watchdog or automatic stale-heartbeat alert: wiring and testing monitoring remains a cloud release gate. Do not assume the image's API HTTP healthcheck supervises the worker.

## 5. Configure Vercel

Import the approved repository using Next.js, root directory `apps/web`, Node 22, with access to files outside the root for the workspace lockfile. Use the workspace's normal install/build detection; confirm it resolves the repository lockfile and produces a successful Next build. Set server/build variable `API_ORIGIN=https://YOUR-API.onrender.com`; no credentials, path or trailing slash. Never put provider or database credentials in `NEXT_PUBLIC_*`.

Use the existing Next rewrites; no frontend fetch URL rewrite is necessary. Browser requests remain on the frontend origin and cookies stay first-party. API cookies are Secure, HttpOnly, SameSite=Lax with no cross-domain cookie setting. Keep the frontend's exact origin in `APP_ORIGINS`. Use a stable staging domain rather than allowing every preview domain. Cross-origin browser access is intentionally not opened with wildcard CORS. [Vercel external rewrites](https://vercel.com/docs/routing/rewrites).

`TRUST_PROXY_HOPS=1` trusts only Render's immediate proxy. Do not increase it simply to get a different client IP: direct Render traffic and Vercel-forwarded traffic have different paths. Confirm forwarded-header handling in staging; retain account-based limits. Spoofed Origin and forwarded-IP requests belong in acceptance.

The cloud profile budgets 90 seconds per RAG query and 30 seconds per provider request. These are application limits, not Vercel guarantees. Verify actual upstream body/time limits; the application accepts files up to 10 MiB, but the deployed proxy may impose a smaller limit. Test near-limit multipart uploads, long queries and downloads through Vercel. Local `proxyTimeout` cannot override a hosting platform limit. Indexing/revalidation continue in the worker after the HTTP request/browser ends.

## 6. Persistence, observability and recovery

No persistent Render disk or object store is required by the current database-backed design. Original active upload bytes, staged work, embeddings and historical text/chunk/metadata snapshots live in PostgreSQL. **Replaced historical original binaries are not archived**; do not advertise download of every old binary. Ephemeral disk holds parsing scratch and heartbeat only.

Enable Neon backup/restore retention appropriate to the budget. Perform an actual restore to an isolated branch before release; never test restoration over live data. Preserve private JWT/setup configuration separately. Local streaming backup/empty-target restore tooling and its tested scope are in [INSTALLATION.md](INSTALLATION.md); it targets Compose, not arbitrary Neon projects.

Record source commit, schema versions, service roles and sanitized event IDs with each release. Existing worker logs identify job IDs/kinds/durations without source text. Do not publish provider credentials, document text or private answer bodies in logs or CI artifacts. Required cloud monitoring still includes queue age, failed/retry jobs, worker heartbeat, SQL/storage usage, provider errors and API latency. Choose measured SLO/alert thresholds before the final acceptance run.

Rollback: stop promotions, preserve the database, and redeploy the last known-compatible API and worker commit together. Do not automatically run down migrations or restore a backup over new writes. If schema compatibility is uncertain, close writes and review a forward fix. Rehearse rollback in staging before calling it supported.

## 7. Required staged acceptance (not yet executed)

| Check | Required evidence |
| --- | --- |
| Login/register/recovery and hostile origins | Browser cookies, successful refresh/recovery, rejected cross-account and hostile-origin requests |
| PDF upload/index/query | Persisted file hash; worker checkpoints/completion; exact passage/version citations |
| Controlled factual correction | Incorrect draft corrected from evidence; preserved valid facts; final verified version (private harness only) |
| Source update without browser | New source metadata/version; worker revalidation; appended correction; historical answer preserved |
| Restart/redeploy | Same documents, downloads, conversations, archived versions and decisions; no duplicate corrections |
| Provider/Redis outage and recovery | Bounded attempts, honest failure/excerpt state, retained checkpoints and resumed work |
| Proxy and resources | Upload size/deadline results, forwarded-header checks, pool/Redis usage and service memory |
| Restore and rollback | Isolated restored database and compatible old candidate complete read/query/version checks |

All rows are **NOT RUN for this candidate in cloud**. Account validation needs renewed Render authentication; provisioning/deployment needs explicit release approval and budget; inference needs available approved models/quota. Follow [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Broad answer-quality benchmarking is deferred until implementation milestones are ready, per the user's latest direction; basic change checks still accompany implementation.
