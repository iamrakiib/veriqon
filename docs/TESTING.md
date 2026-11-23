# Testing and release evidence

Run commands from the repository root with Node 22.18+ and `npm ci`. Use only synthetic inputs and explicitly disposable infrastructure. Never set test URLs to production or load private documents into evaluation fixtures.

## Checks and what they establish

| Command | Coverage / limit |
| --- | --- |
| `npm test` | Builds backend; unit, SQLite, real HTTP/auth and controlled retrieval/repair regressions. PostgreSQL-specific cases skip here |
| `npm run lint` | Static coding checks, not correctness |
| `npm run web:build` then `npm run web:check` | Production frontend compilation and generated TypeScript contracts |
| `npm run test:browser -- --workers=1` | Desktop/mobile interactions with fixture APIs; intentional viewport skips are recorded |
| `npm run test:infra` | Real PostgreSQL/Redis, isolation, migration, concurrency, durable jobs and crash/retry behavior; inference controlled |
| `npm run test:lifecycle` | Browser + real Nest/SQL/Redis, upload, conflict decision, continuous correction/history and recovery; inference controlled |
| `npm run test:load` | Bounded PostgreSQL retrieval short soak, exact workload/gates in [RELEASE_WORKLOAD.md](RELEASE_WORKLOAD.md) |
| `npm run research:demo` | Seven scripted correction protocol cases, not model accuracy |
| `npm run research:live` | Consumes configured provider quota using synthetic fixed drafts/evidence; excludes initial generation/embedding |
| `npm run test:release` / `npm run release:audit` | Export/annotation tools, private-file/signature/history audit; not security certification |
| `npm audit --audit-level=high` | Known package advisories at execution time; absence does not establish vulnerability-free code |

On a constrained laptop, run browser/build/infrastructure/load suites sequentially. Redirect temporary files and npm cache to a disk with sufficient space; do not delete private data to make room. Ensure browser test ports are unused; `CI=true` prevents silently reusing an unrelated local dev server.

## Disposable infrastructure

```sh
docker compose -p veriqon-tests -f compose.test.yaml up -d --wait
npm run test:infra
```

For lifecycle/load tests, explicitly set:

```text
TEST_DATABASE_URL=postgresql://veriqon_test:local_test_only@127.0.0.1:55432/veriqon_test
TEST_REDIS_URL=redis://127.0.0.1:56379
```

In PowerShell set process variables with `$env:TEST_DATABASE_URL='...'`; in POSIX shells use `export TEST_DATABASE_URL='...'`. Do not write these synthetic settings into a real deployment file. Use random-schema test isolation and the dedicated test ports. The infrastructure runner has those local defaults; it never falls back to `.env` or the application `DATABASE_URL`.

After suites finish, remove only the disposable project you created:

```sh
docker compose -p veriqon-tests -f compose.test.yaml down
```

One Redis persistence regression requires its specifically named disposable `veriqon-m3b-redis` container with AOF storage. An ordinary infrastructure pass can skip that test; report the skip and execute the dedicated fixture separately before claiming persistence coverage. Never rename or restart a real application's Redis to satisfy the test.

## Fifteen acceptance cases

| Requirement | Existing executable coverage |
| --- | --- |
| Correct original / no repair | `reliability.test.ts`, research `already-correct` |
| Incorrect numerical draft / genuine repair | `atomic-facts.test.ts`, research `incorrect-number` |
| Preserve valid facts and caveats | `atomic-facts.test.ts`, `reliability.test.ts` |
| Missing evidence / targeted retrieval | `reliability.test.ts`, research missing/targeted cases |
| Superficial rewrite rejection | `reliability.test.ts`, research `superficial-rewrite` |
| Genuine unresolved conflict | `rag.test.ts`, `revalidation.test.ts`, lifecycle browser |
| Historical source retrieval | `retrieval-stability.test.ts`, `knowledge-lifecycle.test.ts` |
| Updated source / automatic correction | `revalidation.test.ts`, `worker.test.ts`, lifecycle browser |
| Preserve historical answer | `revalidation.test.ts` |
| Harmful repair rejected | `atomic-facts.test.ts`, `revalidation.test.ts`, lifecycle browser |
| Duplicate work / stale revision | `worker.test.ts`, `revalidation.test.ts`, `knowledge-lifecycle.test.ts` |
| Provider outage / bounded retries | `reliability.test.ts`, `ingestion.test.ts`, `worker.test.ts` |
| Unauthorized access | `auth.test.ts`, `hardening.test.ts`, PostgreSQL and lifecycle browser |
| Restart/restore persistence | `infra.test.ts`, `worker.test.ts`, Docker workflow/backup scripts |
| Fresh installation | `docker-installation` CI job, local clean source export and Compose workflow |

Exact research case IDs are in `research/fixtures.json`. A test name is not a pass: report dated execution, candidate fingerprint, failure details and explained skips. Use [INSTALLATION.md](INSTALLATION.md) and the Docker CI job for the full clean-install/backup/restore sequence. A mocked provider in those flows remains a mocked provider even with real SQL and browsers.

## Interface screenshots

Start the frontend locally (`npm run web:dev`), then run `node scripts/capture-screenshots.mjs http://127.0.0.1:3001` with the actual frontend port. The script captures desktop dark/light chat, mobile chat and conflict review into `docs/screenshots/`. All API responses are synthetic fixtures; no personal account or uploaded documents are used. It fails on unexpected API calls, browser errors or horizontal overflow. Review the resulting images before publishing. Screenshot fixtures do not demonstrate model accuracy.

Conflict Center regressions: `npx playwright test tests/browser/conflict-actions.spec.ts tests/browser/conflicts.spec.ts --workers=1`. These cover readable Markdown filenames in source options, dark/light contrast, keyboard selection, filtered clearing, cancellation, failed requests, refresh persistence and mobile layout. Database/HTTP authorization and transactional behavior are covered separately in `knowledge-lifecycle.test.ts` and `hardening.test.ts` against SQLite and PostgreSQL.

## Research review and release decision

Live reports include model usage when supplied, exact answers/evidence and dataset hashes. Generate independent review templates with `scripts/review-research.mjs`; reviewers must inspect all factual propositions and citation support. Reviewer independence is not something the code can certify. Missing token/cost labels remain unknown.

Cloud checks in [DEPLOYMENT.md](DEPLOYMENT.md), representative independent evaluation, long-duration capacity/soak and operational alert/rollback drills remain additional gates. Keep local release checks and public-cloud readiness separate in [RELEASE_READINESS.md](RELEASE_READINESS.md). Do not promote a candidate merely because its frontend builds.
