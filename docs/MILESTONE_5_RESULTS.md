# Milestone 5: reproducible local Docker installation

17 November 2026. **Accepted within the controlled local boundaries below.** Windows PowerShell host, Docker Desktop Linux containers; no macOS or cloud execution. Nothing pushed or deployed.

## Reproduced gaps and changes

`data/m5-compose-before.log` reproduced the missing independent worker. The prior Compose deployment also used nonpersistent Redis configured as a disposable counter store. The backend worker implementation already existed; it was reused, not rebuilt.

- `compose.yaml`: separate API/BullMQ worker roles with shared configuration, private queue URL, persistent Redis AOF volume, noeviction, worker-specific healthcheck and graceful shutdown. Web startup waits for API and worker health. Existing Dockerfiles and database-backed documents remain unchanged.
- `src/common/worker-heartbeat.ts`, `scripts/worker-health.ts`, `src/rag/job-queue.service.ts`: optional private heartbeat updated only after successful reconciliation. Check freshness and a live PID; clear at startup/shutdown. No new database schema, queue engine or dependency. A dispatcher heartbeat is not proof every job or model answer succeeds.
- `scripts/docker-database.mjs`: streaming custom-format PostgreSQL backup and transactional restore. Refuse overwrite, nonempty targets and running target app services. No shell binary redirection or whole-database buffering. Matching private configuration is backed up separately.
- Setup/environment documentation and portable deployment examples: generated secrets remain private and existing settings are preserved. Removed private machine CLI paths/account resource IDs from active deployment instructions. Historical cloud evidence is explicitly distinguished from the current source.
- Added offline container acceptance scripts and a test-only HTTP provider override. Production Compose never enables this fixture. Added Compose contract checks and a separate GitHub Actions Docker-installation job; remote CI has **not** executed because nothing was pushed.

## Actual acceptance evidence

| Check | Actual result | Local evidence |
| --- | --- | --- |
| Clean source installation | Passed from source-only exports outside the checkout; no original `.env`, data, dependencies, `.next` or deployment credentials | `data/m5-export.json`, `data/m5-final-export.json`, `data/m5-startup.log` |
| Final clean production image rebuild | API, worker and frontend built successfully | `data/m5-rebuild.log` |
| PDF → indexing → cited answer → competing policy → conflict review → automatic factual correction | Passed through real Next proxy, production Nest entrypoints, PostgreSQL/pgvector, Redis/BullMQ and independent worker. Only model/embedding HTTP responses scripted | `data/m5-workflow.log` |
| Corrected answer preserves valid information | Three remote days corrected to one; twenty vacation days, exact citation versions and immutable original retained | Same workflow; `scripts/test-docker-workflow.mjs` |
| Whole-stack restart | Original PDF download hash, source archives, conversations, correction versions and decision history preserved; fresh retrieval/repair passed | `data/m5-restart.log` |
| Real backup → empty second project restore | Passed; restored files/history/audit and fresh query/repair checked through restored frontend | `data/m5-backup.log`, `data/m5-restored-workflow.log` |
| Rebuild/recreate restored containers without deleting volumes | Passed; original document bytes and immutable correction records still match | `data/m5-rebuilt-workflow.log` |
| Hard-kill worker during indexing | Passed with natural SQL lease expiry: 2 saved passages before kill, 12 total, exactly 12 successful embedding inputs, one published document, 242,418 ms recovery | `data/m5-recovery.log`; no SQL clock/lease mutation |
| Bad DB password, unavailable admission Redis, unavailable queue Redis, missing provider key, unavailable model, absent heartbeat | All 6 probes passed; expected errors/failures bounded under 60 seconds | `data/m5-failures-final.log` |
| PDF without readable text | Rejected with explicit OCR guidance in restored/rebuilt workflow; no OCR capability claimed | `scripts/test-docker-workflow.mjs`, restored/rebuilt logs |
| Backup safeguards | Existing archive and populated restore target both refused; neither overwritten | `data/m5-backup-guards.log` |
| Backend build/regression | **180 passed, 0 failed, 7 infrastructure-only skips** | `data/m5-backend.log` |
| PostgreSQL/Redis/worker integration | **78 passed, 0 failed, 1 skip**, 332.1 s | `data/m5-infra.log` |
| Skipped persistent-Redis restart case, separately configured/run | **1 passed, 0 failed, 0 skipped**; queued delivery retained and processed after restart | `data/m5-redis-persistence.log` |
| Compose/release-tool/research-review regressions | **5 passed, 0 failed** | `data/m5-release-tests.log` |
| Lint and whitespace checks | Passed | `data/m5-lint-final.log`, `data/m5-diff-check.log` |
| Source and reachable-history audit | Passed, no findings; 278 history objects checked | `data/m5-source-audit.log`; automated audit is not a security certification |

The infrastructure suite's one skip requires a deliberately named restartable Redis fixture. It was then executed separately against owned persistent Redis; it is not silently counted as passed in the 78-test run. The default seven skips require infrastructure and are covered by that separate suite. Browser regressions from M4 are retained evidence, not a new M5 browser-suite run; frontend source was unchanged. M5 exercised real production HTTP routes via the built frontend proxy.

The initial build was accidentally overlapped with startup, causing a duplicate image-tag export failure. Subsequent startup and final sequential build/recreate passed. This was test orchestration, not a claimed application defect. Do not run build and startup concurrently; the guide documents sequential commands.

## Reproduction and source boundary

[INSTALLATION.md](INSTALLATION.md) gives actual setup, stop/restart, backup/restore and troubleshooting commands. For isolated deterministic acceptance use the additional `compose.acceptance.yaml` override and the scripts in the separate CI job. That override replaces external inference only; it never replaces production database/auth/retrieval/correction implementations. Never use it in a real inference deployment.

Final clean export: `b1e42cb95a4b4e20b0a9c47639bcace52431f814575cf1f9379905687f9cee59` (230 source files at export). The CI Docker job was added after that export; documentation was finalized after testing. Final runtime/test/CI manifest: `data/m5-source-fingerprint.json`, 148 files, SHA-256 `b78fab9a78b225806592a4f8df6714743d1a0d892f761154bc3116e6daa87376`. No runtime code changed after the final tests. Raw private test state/configuration is excluded from release sources.

Environment: host Node 22.19; Docker 28.5.1; PostgreSQL 17.11 with pgvector 0.8.7; Redis 7.4.12. Image tags are not an assurance of the latest security patches; image vulnerability/patch review remains a release gate. Owned disposable Compose projects were removed after evidence capture; the unrelated `aegis-postgres-1` container was preserved.

## Remaining boundaries

No failing M5 acceptance case remains. This does not establish production-scale throughput, zero data loss under arbitrary hardware failures, or live-model quality. AOF every-second persistence has a potential recent-write loss window; SQL remains authoritative for eligible job recovery. Restore was exercised on a small synthetic library, not at quota-scale. Four-minute crash recovery is an observed lease behavior, not instant availability. Docker health marks stale services unhealthy but does not restart a merely unhealthy process automatically.

LIVE-001 and LIVE-002 remain open. Milestone 6 must prepare and validate Vercel/Render/Neon/managed Redis with approved hosting access/resources; milestone 7 must complete independent factual evaluation, capacity/security/restore review and release gates. No GitHub publication or deployment occurred.
