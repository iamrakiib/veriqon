# Local Docker installation

Milestone 5 local acceptance passed on 17 November 2026: Windows host and Linux containers. See [MILESTONE_5_RESULTS.md](MILESTONE_5_RESULTS.md) for clean-install, restart, crash recovery, backup/restore and error-path results. Inference was scripted for these tests; no macOS or cloud deployment is implied.

## Requirements and configuration

Use Git, Node.js 22.18 or newer (for setup/backup helpers), and Docker Engine/Desktop with Linux containers and Docker Compose v2. Allow several GB for images and database growth. Keep enough free host disk for Docker; avoid running concurrent image builds on a memory-constrained laptop.

From a new clone, enter the repository root containing `compose.yaml`:

```sh
git clone https://github.com/iamrakiib/veriqon.git
cd veriqon
node scripts/init-docker.mjs
```

The helper creates `.env.docker` with independent random secrets and never overwrites an existing file. Edit it locally:

| Variable | Required value / behavior |
| --- | --- |
| `POSTGRES_PASSWORD` | Generated URL-safe password; changing the file does not change an existing database user's password |
| `JWT_SECRET`, `SETUP_CODE` | Independent generated secrets; setup code creates the first owner |
| `OPENROUTER_API_KEY` | Your private provider key, never a frontend variable |
| `EMBEDDING_MODEL` | Available embedding model; model/input-mode changes require reindexing |
| `LLM_MODEL` | Available generation model |
| `VERIFIER_MODEL`, `DECOMPOSER_MODEL` | Optional; fall back to generation/verifier model |
| `EMBEDDING_BATCH_SIZE` | Default 1, allowed 1–32; increase only after checking endpoint support |
| `EMBEDDING_MIN_INTERVAL_MS` | Docker default 3000; request pacing does not override provider quotas |
| `REVALIDATION_ENABLED` | Default true; false disables continuous answer checking |
| `REVALIDATION_PER_HOUR` | Default 10 globally, range 1–100; queued work waits when budget is exhausted |
| `ALLOW_REGISTRATION` | Default false; initial owner still uses setup code; true opens public registration |

Compose supplies private database/Redis URLs and the API/worker roles. Do not paste local SQLite `.env` values over these. Optional provider deadlines, retrieval/chunk settings and other forwarded values are listed in `compose.yaml`; native development defaults are in `.env.example`. Environment values not forwarded by Compose do not automatically appear in containers.

## Start and inspect

```sh
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d --no-build --wait --wait-timeout 180
docker compose --env-file .env.docker ps
```

Open **http://localhost:3002**. Register the first owner with the generated setup code; save the one-time recovery codes privately. Password reset uses recovery codes, not email delivery. Upload a small text-bearing PDF, wait for indexing, then ask a source-specific question and inspect passage citations. The selected provider must have quota for embeddings, generation, decomposition and verification.

Five services run: Next.js `web`, NestJS `api`, independent `worker`, PostgreSQL 17/pgvector, and Redis. Only web is published, bound to loopback. API and worker apply checksum-checked migrations under the existing database migration lock. No host Node dependencies or prebuilt `.next`/`dist` are required by the images.

API readiness checks PostgreSQL and admission Redis. Worker health checks a private heartbeat written only after successful SQL/queue reconciliation; it expires after 60 seconds. It is not a factual-accuracy metric or a promise that every job succeeds. Docker marks stale workers unhealthy; Compose does not automatically restart a merely unhealthy process. Process exits restart under `unless-stopped`; inspect unhealthy services and restart after correcting the cause.

```sh
docker compose --env-file .env.docker logs --tail 100 api worker
docker compose --env-file .env.docker exec -T worker node dist/scripts/worker-health.js
```

Uploads, original bytes, extracted text, embeddings, conversations, answer versions, decisions and authoritative job checkpoints live in PostgreSQL's named volume. Archived source versions retain text/chunk/metadata snapshots; historical binary replacements are not an archive feature. Redis uses AOF (`everysec`), `noeviction` and its own named volume. SQL reconciliation recovers eligible deliveries after queue loss. Neither volume is a substitute for an off-machine backup.

## Stop, restart and rebuild

```sh
docker compose --env-file .env.docker stop
docker compose --env-file .env.docker up -d --no-build --wait
# After source changes, build first; do not overlap build and startup:
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d --no-build --wait
```

`down` removes containers/networks but preserves named volumes. **`down -v` deletes database and queue volumes. Never use it for data you need.** Keep the same Compose project name to reconnect existing volumes. Changing the project name creates a separate installation. Frontend `API_ORIGIN` rewrites are compiled at build time.

## Backup and restore into a separate project

Create `data/backups` first (PowerShell: `New-Item -ItemType Directory -Force data/backups`; bash: `mkdir -p data/backups`). The helper streams a PostgreSQL custom archive without shell redirection or buffering the full database in memory. It refuses an existing destination file. Only restore trusted archives.

```sh
node scripts/docker-database.mjs backup --project veriqon --env-file .env.docker --file data/backups/library.dump
```

Protect the archive as private user data. Store a protected copy of `.env.docker` separately; database dumps do not contain container secrets. Reuse the matching JWT secret to retain existing sessions, or rotate it deliberately to require users to log in again. New installations keep their database password stable across restarts.

Restore to a **new** Compose project, initially starting PostgreSQL alone. Stop the original web before starting restored web because both bind port 3002. The restore helper refuses a running target API/worker/web or any existing user tables and uses a single transaction with exit-on-error; it never drops existing data.

```sh
docker compose -p veriqon-restore --env-file .env.docker up -d --wait postgres
node scripts/docker-database.mjs restore --project veriqon-restore --env-file .env.docker --file data/backups/library.dump
docker compose --env-file .env.docker stop web
docker compose -p veriqon-restore --env-file .env.docker build
docker compose -p veriqon-restore --env-file .env.docker up -d --no-build --wait
```

Log in, download an original document, inspect citations/source archives/corrected answer history, and make a new query. Restored SQL checkpoints are authoritative even with a new empty Redis volume. Interrupted active leases may need to expire before jobs resume; do not reset job tables manually. Keep the original stack and backup until the restored copy has passed these checks.

## Troubleshooting and boundaries

- **Docker cannot connect:** start/resume Docker Desktop and select Linux containers.
- **Missing model/key or exhausted quota:** account/history access can work while new inference fails. Configure available models/key, then recreate API and worker with `up -d`; inspect upload retry status. Do not switch embedding models midway through a saved job.
- **Database password failure:** editing `.env.docker` does not rotate the password stored in an existing volume. Restore the matching private setting or perform an explicit database password rotation; do not delete the volume to fix authentication.
- **Redis unavailable/full:** protected operations fail closed and background reconciliation waits. Check logs/storage/memory and restart after repair. Keep `noeviction`; increasing workload needs measured capacity, not silently evicting jobs.
- **Worker unhealthy:** inspect SQL/Redis connectivity and logs. A healthy API alone does not establish functioning background processing.
- **No readable PDF text:** scanned PDFs need OCR before upload. No OCR is implemented.
- **Port 3002 occupied:** stop the other local frontend. Changing the published port also requires matching `APP_ORIGINS` in both API and worker.
- **SQLite development:** integrated SQL polling remains supported locally. Separate worker/BullMQ deployment requires PostgreSQL; do not point the worker at SQLite.

Controlled acceptance uses `compose.acceptance.yaml`, a test-only override containing a simulated HTTP provider. It must never be included in real inference deployments. Live model quality, cloud continuity and production-scale load remain separate gates.

References: [Compose readiness ordering](https://docs.docker.com/compose/how-tos/startup-order/), [PostgreSQL 17 pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).
