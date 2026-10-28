# Deploy Veriqon

## Current deployment — 29 October 2026

| Resource | Location |
| --- | --- |
| Live application | **https://veriqon-two.vercel.app** |
| API readiness | https://veriqon-api.onrender.com/rag/ready |
| Private source repository | https://github.com/iamrakiib/veriqon |
| Vercel project | https://vercel.com/boycool7823-4129/veriqon |
| Render service | https://dashboard.render.com/web/srv-dbgo0ahsrm7s73ecc8eg |
| PostgreSQL | Neon project `veriqon` (`little-queen-41211260`), PostgreSQL 17 + pgvector, Singapore, Free |
| Redis | Upstash database `veriqon`, Singapore, Free, TLS enabled |

Sign in with your existing Veriqon email and password. The owner already exists, so a setup code is unnecessary and public registration is disabled. The primary frontend origin above is allowed by the backend; use it for sign-in.

The local PostgreSQL snapshot was restored into a separate Neon database and verified against the original records: one user, two documents, 158 chunks, one conversation, and one message. Existing sessions were excluded. The original local databases and Docker volume were preserved. These are separate copies: new cloud activity does not synchronize back to localhost. The two legacy documents contain extracted text and embeddings but had no original upload bytes in the source database; re-upload them if you need their original files available for download.

Live checks through the Vercel frontend passed for sign-in, Secure/HttpOnly cookies, origin protection, account isolation, upload/embedding, exact original-file download, a supported answer with a citation, saved chat history, refresh-token rotation, and logout revocation. The synthetic answer took about eight seconds on that run; this is a smoke check, not a latency guarantee or retrieval-quality benchmark. The temporary test account and its data were removed.

Render's free service sleeps when idle. The initial workspace connection allows up to 90 seconds and explains when the server is waking. Failed connections have a retry button. Hosting is on the free plans; model calls remain subject to the configured provider's separate free quotas.

### Release updates

GitHub Actions validates pushes. Releases are currently **manual**: Render automatic deploys are off, and Vercel's GitHub connection still needs a GitHub Login Connection in the Vercel account. The authenticated CLI can deploy the frontend without that integration.

From the repository root, after committing, pushing, and checking CI:

```powershell
# Deploy the backend when backend code/configuration changes.
.\data\tools\render\render.exe deploys create srv-dbgo0ahsrm7s73ecc8eg --wait --confirm

# Deploy the frontend using the saved project link and production API_ORIGIN.
npx --yes vercel@65.5.0 deploy --prod --yes
```

On another machine, install/authenticate the Render CLI and use `render` in place of the local executable path; run `vercel link --project veriqon` before the first frontend deployment. Do not deploy from inside `apps/web`: the linked Vercel project already sets that root directory and needs the workspace lockfile above it.

Backend credentials are in Render secret environment settings. The frontend has only `API_ORIGIN=https://veriqon-api.onrender.com`. Local deployment helpers, database snapshots, and credentials remain ignored under `data/` and `.env.deploy`; `.vercelignore` also excludes them from CLI uploads. Do not commit or share those files.

The supported cloud layout is **Vercel frontend → Render API → Neon PostgreSQL + pgvector**, with **Upstash Redis** for shared limits and active-work leases. Docker Compose runs the same application locally.

PostgreSQL is the source of truth for users, hashed passwords, revocable sessions, documents, original upload bytes, embeddings, conversations, and answers. Redis holds disposable rate counters and leases; losing Redis does not delete documents or history. Redis failures reject new protected operations. Short-lived answer/embedding caches remain bounded and local to each API process, with database revision keys for invalidation.

This is a deployable application configuration, not an uptime guarantee or completion of the separate temporal-revalidation research target. Paid resources, restore drills, load tests, and security review are required before promising an enterprise service.

## 1. Run the complete Docker stack locally

Requirements: Docker Desktop with Linux containers. From **sc-rag**:

```powershell
node scripts/init-docker.mjs
```

This creates **.env.docker**, generating separate random PostgreSQL password, JWT secret, and first-owner setup code. Existing settings are never overwritten. Add your `OPENROUTER_API_KEY`, `LLM_MODEL`, and optional `VERIFIER_MODEL` in that private file. Embeddings also require an available model/account quota. Keep the generated PostgreSQL password URL-safe; changing it after creating the volume does not automatically change the database password.

```powershell
docker compose --env-file .env.docker up --build -d
docker compose --env-file .env.docker ps
```

Open **http://localhost:3002**. On a new database, use the setup code from `.env.docker` to register the owner. Public registration defaults to disabled; the first owner can still register with the setup code. The existing non-Docker app on port 3001 uses its own database until explicitly migrated.

The API, PostgreSQL, and Redis are private to the Docker network. Only the frontend is published, bound to loopback. The local profile explicitly permits loopback HTTP cookies; **do not copy `ALLOW_INSECURE_LOCAL_HTTP=true` to a cloud deployment**. Database files live in the named `veriqon_postgres-data` volume. `docker compose ... down` preserves it; `down -v` destroys it and should never be used on data you need.

Frontend rewrites are compiled at build time. Changing the backend hostname requires rebuilding the frontend image with a new `API_ORIGIN` build argument.

## 2. Create free accounts

Create accounts on [GitHub](https://github.com/), [Vercel](https://vercel.com/), [Render](https://render.com/), [Neon](https://neon.com/), and [Upstash](https://upstash.com/). These are separate services; an OpenRouter key does not create hosting accounts. Keep each service on its free plan unless you intentionally choose an upgrade.

Verified against provider documentation on 2026-10-27:

| Service | Role | Free-tier limitation relevant here |
| --- | --- | --- |
| Vercel | Next.js frontend and external API rewrites | Hobby is for personal/non-commercial use; external proxy requests have a 120-second timeout. |
| Render | Long-running Docker API | Sleeps after 15 minutes idle, may take about a minute to wake, and has ephemeral files. Free services cannot scale beyond one instance. |
| Neon | Durable PostgreSQL with pgvector | Storage/compute/transfer quotas and scale-to-zero cold starts; no free uptime SLA. |
| Upstash | Redis counters and leases | Command/data quotas; exhausting them blocks protected requests until recovered. |

Do **not** use free Render PostgreSQL for durable deployment: its free database expires after 30 days. Never store production SQLite/uploads on Render's ephemeral disk. Provider plan terms can change; verify them before launch.

Sources: [Render free services](https://render.com/docs/free), [Neon plans](https://neon.com/docs/introduction/pro-plan), [Upstash pricing](https://upstash.com/pricing/redis), [Vercel rewrites](https://vercel.com/docs/routing/rewrites), [Vercel limits](https://vercel.com/docs/limits), [Vercel Hobby](https://vercel.com/docs/plans/hobby).

## 3. Put the project in GitHub

Create an empty private GitHub repository. Use **sc-rag itself as the repository root**, so `Dockerfile`, `render.yaml`, `package.json`, and `.github` are at its root. The supplied configurations assume this layout.

```powershell
git init
git add .
git status --short
# Confirm no .env files, data directory, setup codes, or database backups are staged.
git commit -m "Add PostgreSQL, Redis and deployment configuration"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/veriqon.git
git push -u origin main
```

`.gitignore` excludes credentials and local data; `.dockerignore` excludes them from both image build contexts. Do not upload the entire folder through a mechanism that ignores these rules. GitHub Actions checks lint, local and real-infrastructure tests, frontend build/browser tests, and both Docker builds. It uses only synthetic fixtures, never your provider key.

## 4. Create Neon and Upstash

1. Create a Neon PostgreSQL project near the backend region. Copy its **pooled** connection URL into Render's secret `DATABASE_URL`. Prefer `sslmode=verify-full` for certificate and hostname verification. Do not disable certificate verification. Startup migrations enable pgvector and create the schema; the migration account needs extension/table creation privileges.
2. Create an Upstash Redis database in a nearby region. Copy its **TLS Redis URL** (`rediss://...`) into Render's secret `REDIS_URL`. Use the Redis protocol connection URL, not the HTTP REST URL/token.
3. Use separate databases or schemas and Redis prefixes for staging and production. Do not point integration tests at either one.

## 5. Deploy the API on Render

In Render, choose **New → Blueprint**, connect your repository, and select `render.yaml`. It creates a free Docker web service with `/rag/ready` as the health check. The supplied Blueprint does not create a temporary Render database.

Required configuration:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon pooled PostgreSQL URL, private |
| `REDIS_URL` | Upstash TLS Redis URL, private |
| `JWT_SECRET` | Generated automatically by the Blueprint; keep stable across deploys |
| `SETUP_CODE` | Separately generated by the Blueprint; used once to create the first owner |
| `APP_ORIGINS` | Exact frontend HTTPS origin, e.g. `https://your-project.vercel.app` |
| `OPENROUTER_API_KEY` | Your private provider key |
| `LLM_MODEL` | A model actually available to your account |
| `EMBEDDING_MODEL` | Current document embedding model; changing it requires re-indexing |
| `VERIFIER_MODEL` | Optional; defaults to `LLM_MODEL` |

Other Blueprint settings already select production mode, secure cookies, private registration, automatic migrations, and a 90-second RAG budget. The API respects Render's `PORT` and binds to `0.0.0.0`. `TRUST_PROXY_HOPS=1` trusts only the immediate proxy; do not set unrestricted proxy trust. IP limits are conservative behind shared proxies, with additional per-email limits.

If the frontend URL is not assigned yet, use your intended Vercel project URL and correct `APP_ORIGINS` immediately after Vercel deploys. Authentication mutations remain rejected from unlisted browser origins. Do not use wildcard domains or allow every Vercel preview.

After deployment, check `https://YOUR-API.onrender.com/rag/ready` returns `{"status":"ready"}`. `/rag/health` reports `storage: "postgresql"`; liveness and readiness are deliberately separate. An unconfigured provider still permits account/document-history access but cannot generate new embeddings/answers.

## 6. Deploy the frontend on Vercel

Import the same GitHub repository:

| Setting | Value |
| --- | --- |
| Framework | Next.js |
| Root Directory | `apps/web` |
| Node.js | 22.x |
| Install Command | `cd ../.. && npm ci` |
| Build Command | `npm run build` |
| Output Directory | Default Next.js setting |
| Include files outside Root Directory | Enabled for the npm workspace/lockfile |
| Environment variable | `API_ORIGIN=https://YOUR-API.onrender.com` |

Only `API_ORIGIN` belongs here. Do not put database, Redis, JWT, setup-code, or provider secrets in the frontend, especially not `NEXT_PUBLIC_*` variables. Set the origin before building and redeploy after changing it.

The browser calls `/api/auth/*` and `/api/rag/*` on its **own Vercel origin**. Next's external rewrites forward these to the Render API. This preserves first-party HttpOnly cookies and avoids third-party-cookie/CORS dependencies. Do not change the browser to call the Render hostname directly.

Copy the final Vercel URL into Render's `APP_ORIGINS` and redeploy the API. Add a custom domain as another comma-separated exact HTTPS origin if needed. Preview deployments need their own explicitly allowed origin and preferably a staging backend.

On a fresh database, register the owner with Render's private `SETUP_CODE`. For an existing SQLite migration, sign in using the migrated account instead.

## 7. Migrate existing SQLite data safely

The import is explicit; merely setting `DATABASE_URL` does not silently move local data. Stop writes to the old application during the cutover and back up its database consistently (include WAL state or use SQLite's online backup API). Keep the original until validation is complete.

The PostgreSQL target must be **empty**. Run this locally before opening public registration on the new deployment:

```powershell
npm run build
node dist/scripts/snapshot-sqlite.js --from=data/veriqon.sqlite --to=data/postgres-cutover.sqlite
# Configure DATABASE_URL privately in your local environment or .env.
npm run db:migrate
npm run db:import-sqlite -- --from=data/postgres-cutover.sqlite
```

The snapshot command uses SQLite's online backup API, refuses existing destinations, and creates a standalone journal so a read-only container mount works without writable WAL/SHM files. Choose a new destination name for subsequent backups. The importer opens that snapshot read-only, uses one target transaction, refuses a nonempty target, and verifies row counts. It preserves account IDs, password hashes, source files, vector data, document revisions, chat history, and answer evidence. Sessions and old rate limits are intentionally excluded: everyone signs in again. The original database is not overwritten or deleted. PostgreSQL migration checksums detect edits to an already-applied migration.

For the local Docker database, first stop the API to prevent concurrent writes, then use an ephemeral service container with a read-only source mount:

```powershell
docker compose --env-file .env.docker stop api
docker compose --env-file .env.docker run --rm --no-deps -v "${PWD}/data:/import:ro" api node dist/scripts/import-sqlite.js --from=/import/postgres-cutover.sqlite
docker compose --env-file .env.docker start api
```

Do not import again after new data has been created. The command will refuse it. For future changes, add ordered migrations and test forward/backward application compatibility before rollout. The current runner applies the initial schema only; extend it when introducing version 2.

## 8. Verify the deployed application

- `/api/rag/ready` responds 200 through Vercel, and `/api/rag/docs` responds 401 before signing in.
- Register/sign in, refresh the page, open another tab, sign out, and verify the old session no longer works.
- Upload a small PDF/TXT with known content, retrieve the original, ask a supported question, and check the exact cited passage. This uses provider quota.
- Sign in as a separate test account and verify it cannot see the first account's documents or conversations.
- Restart/redeploy the API, then verify files and chat history still exist. Check both light/dark mode and mobile chat fit.
- Inspect browser cookies: HttpOnly, Secure, SameSite=Lax. Inspect network responses: private/no-store and no secrets.
- Run a backup/restore rehearsal before storing valuable documents.

Local deterministic checks (no provider calls):

```powershell
npm test
docker compose -f compose.test.yaml up -d --wait
npm run test:infra
npm run lint
npm run web:build
npm run web:check
npm run test:browser
docker compose -f compose.test.yaml down
```

Infrastructure tests use dedicated localhost ports 55432/56379, unique schemas/prefixes, and disposable fixtures. They do not use `DATABASE_URL` from `.env`. The test PostgreSQL container uses temporary storage; the application database uses a persistent named volume.

## Operations and remaining limits

Local validation on 2026-10-27: 29 backend tests, 5 real PostgreSQL/Redis tests (including read-only snapshot/import and authenticated HTTP flows), and 29 browser tests passed; one duplicate mobile test was intentionally skipped. Both Docker images built and all four application containers reported healthy. The production frontend browser smoke had no runtime errors or horizontal overflow. These checks used mocked model calls and do not validate live provider availability, cloud DNS/TLS, or platform billing/account configuration.

- Store encrypted PostgreSQL backups outside the API host. With a compatible `pg_dump`, use custom format (`pg_dump -Fc --file=backup.dump`) and connection environment variables/private password files. For local Docker, write the dump inside the database container and `docker cp` it out; avoid PowerShell text redirection of a binary dump. Restore into a separate empty database with pgvector available and verify file bytes, row counts, logins, and histories before switching traffic.
- Rotate provider/JWT/setup/database credentials through secret settings. A JWT-secret rotation signs everyone out; database-password rotation also needs pool restart. Never log connection URLs, request cookies, or document bodies.
- Original files use PostgreSQL BYTEA for this bounded deployment. Each private library is limited to 100 documents or 100 MB of source files/text; chunks and saved answers consume additional space. Monitor database usage. Move originals to private object storage and add organization-wide quotas before large public use.
- PostgreSQL performs exact pgvector cosine ranking and returns candidate windows. It does not yet use an ANN index or hybrid search. Benchmark a fixed-dimension/model index before scaling; do not advertise unmeasured retrieval recall/latency.
- Redis leases expire after five minutes and renew every 30 seconds. Lease loss is reported; persisted request IDs protect duplicate message creation. This is admission control, not exactly-once distributed execution or a durable job queue. Requests interrupted by process death remain marked interrupted in history.
- Free Render cold starts and free-model limits can delay/fail requests. Reload after the backend wakes. A 90-second pipeline budget bounds normal requests; it cannot override hosting proxy timeouts. Longer ingestion/generation requires a durable asynchronous job queue and polling.
- Production file parsing runs in a separate process with a 96 MB JavaScript heap, a 20-second deadline, and one parser per API process. Parser children do not inherit provider/database secrets. This is not an OS sandbox or a hard bound on native allocations; use dedicated sandboxed ingestion workers before accepting hostile public uploads at scale. Keep registration private pending broader security/load testing.
- Continuous temporal revalidation, workspace RBAC, password recovery/email verification, independent ML evaluation, and enterprise observability remain separate work documented in `docs/production-review.md`.
