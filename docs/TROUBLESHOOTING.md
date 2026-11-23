# Deployment troubleshooting

Use [INSTALLATION.md](INSTALLATION.md) for local Docker and [DEPLOYMENT.md](DEPLOYMENT.md) for cloud. Never paste credentials, setup codes or document contents into public logs/issues.

| Symptom | Check and corrective action |
| --- | --- |
| Render validator returns 401 | Renew the official CLI login for the intended workspace. No service was deployed by validation. Local schema validation does not verify account permissions or resource availability. |
| API/worker says migrations are not current | Inspect API pre-deploy logs, Neon connectivity/permissions and versions 1–4. API owns migration; deploy worker after migration succeeds. Do not alter existing migration checksums. |
| Worker fails while API is ready | API readiness does not check the queue. Verify `JOB_QUEUE_MODE=bullmq`, shared PostgreSQL, queue TLS URL, `INFO`/Lua/blocking command access and noeviction. Check worker logs and heartbeat independently. |
| Jobs stay queued with browser closed | Confirm worker is running, not a free sleeping web service; same DB, queue prefix, provider/embedding settings; revalidation enabled. Query/ingestion checkpoints are durable—do not delete jobs or reset leases manually. |
| Worker heartbeat is stale | Run `node dist/scripts/worker-health.js` in worker shell. Inspect `dispatch_deferred`, SQL and Redis connectivity, then restore dependencies. A stale file does not identify which dependency failed; automatic heartbeat alert/restart integration is still pending. |
| Provider rate limit / timeout | Check provider quota/reset and selected model. Preserve queued checkpoints; let bounded retries run. A different model can require reindexing if it is the embedding model. Never relabel excerpts as verified answers. |
| Login fails only on cloud | Check exact `APP_ORIGINS`, Secure cookies, HTTPS API origin and frontend proxy routing. Send required `x-veriqon-request: 1` on modifying requests. Do not enable wildcard CORS or insecure cookies. |
| Sessions stop working after redeploy | Confirm stable `JWT_SECRET` and Blueprint sync after any intentional rotation. Do not generate a new secret on every deployment; existing sessions depend on it. |
| Vercel returns 413/504 | Compare proxy size/deadline with application limits; test a small text PDF and short query. Indexing is asynchronous, but parsing/upload transport still has a deadline. Do not assume Next's local timeout overrides Vercel. |
| Neon TLS/connectivity failure | Use direct TLS URL with `sslmode=verify-full`, correct database/role and sufficient pool capacity. Do not disable certificate checks. Cold-start and pooled compatibility require staging verification. |
| Files disappear after redeploy | Verify PostgreSQL is configured, not SQLite/ephemeral paths, and both roles target the same DB. Active original bytes and archived text belong in SQL. Old replaced binaries are not archived by current functionality. |
| Redis quota exhausted | Measure idle reconciliation plus active queue commands and leases. Select suitable capacity; do not switch to an evicting cache or HTTP REST token. SQL remains authoritative but service availability depends on Redis. |
| Incorrect model answer despite a green health check | Health checks establish service/dependency availability, not factual correctness. Capture a private reproducible question/evidence/version case for later evaluation. |

Before retrying a failed release, record commit, migration versions, service roles, event IDs and sanitized error category. Keep the last working release available. Never test recovery by dropping production databases, removing data volumes or forcing historical answers to overwrite current records.
