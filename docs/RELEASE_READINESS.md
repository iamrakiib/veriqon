# Release readiness

Latest release follow-up (23 November): conflict dropdown contrast and confirmed history clearing are implemented; backend 186 passed, focused browser eight passed, type check/lint passed. Current full dependency audit is clean (zero known findings); the earlier picomatch advisory was withdrawn upstream. Publication is now user-authorized after required checks, with protected-main PR workflow. See the top of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for current publication status. Earlier dated statements below retain their original test scope. Full cloud acceptance and independent factual reliability remain unverified.

23 November 2026: LIVE-001 was reproduced through real HTTP and fixed: valid latency disclosures no longer fail decomposition or trigger invented empty-fact assessments. The final live case returns insufficiency after a second retrieval round; four new regression tests cover disclosure safety, retrieval/regeneration and distinct-version conflict checks. Backend/build: **184 passed, 0 failed, 7 infrastructure-only skips**; lint passed. **LIVE-002 remains failing**: a correct unit contrast is misclassified by the model and withheld. Full milestone 7 remains open. See [MILESTONE_7_RESULTS.md](MILESTONE_7_RESULTS.md) and [live regression observations](milestone-7-live-regressions.json). Nothing pushed or deployed.


## Milestone 7 checkpoint: 18 November 2026

**Security gate remains failed:** final full dependency audit reports 13 high findings from one unpatched picomatch advisory in development tooling. Production-only audit reports zero. The earlier installation-time zero count is historical; full CI is not green. See the M7 report for exact dependency paths and upstream advisory.

Local release validation is underway; **full release remains blocked** by cloud acceptance, independent representative evaluation, long-duration mixed-workload testing and the patched-candidate Docker rebuild. See [MILESTONE_7_RESULTS.md](MILESTONE_7_RESULTS.md) for current results, exact scope and unresolved gates. The sections below retain earlier milestone evidence rather than implying those runs used the new candidate.

Next.js is patched to 16.4.5. The current backend and clean source installation each passed 180 tests; PostgreSQL/Redis passed 78 plus the dedicated Redis-restart test. The new sixty-second retrieval workload completed 1,598 operations with zero errors and 92.2 ms p95. Seven live fixed-draft correction cases completed, including four numerical corrections; this small synthetic observation is not an independent factual benchmark or comparison against the former application. LIVE-001/LIVE-002 remain open.

Updated 17 November 2026. **Milestones 1A, 1B, 2, 3A, 3B, 3C, 4 and 5 accepted within controlled local boundaries; full release not ready.** Performance evidence is in [PERFORMANCE.md](PERFORMANCE.md), with findings in [CODE_QUALITY_AUDIT.md](CODE_QUALITY_AUDIT.md). No cloud or live-provider improvement claim.

## Current milestone 5 evidence

Milestone 6 configuration update (17 November): current API/worker Blueprint and cloud guides are prepared; schema and synthetic configuration validation passed. Account-aware Render validation returned 401. Live deployment, managed Redis/Neon verification, monitoring and cloud acceptance are still pending. Full release status is unchanged. See [MILESTONE_6_RESULTS.md](MILESTONE_6_RESULTS.md).

Clean source-only Docker installation, independent processing, original-byte/history persistence through restart and rebuild, and backup/restore into a separate project passed. A hard-killed worker resumed after natural lease expiry in 242.4 seconds without repeating saved embedding batches. Backend 180 passed/7 infrastructure-only skips; infrastructure 78 passed/1 dedicated Redis-restart skip, then that restart case passed separately; Compose/release regressions 5 passed. Final production image builds, lint and source/history audit passed. [MILESTONE_5_RESULTS.md](MILESTONE_5_RESULTS.md) records exact evidence and limits.

These are Windows-host/Linux-container checks with simulated external inference, not live model accuracy or cloud deployment. Current cloud acceptance and independent evaluation/capacity/security gates remain 6/7; LIVE-001/LIVE-002 remain open. CI installation automation is configured locally but not executed remotely.

## Retained milestone 4 evidence

Backend/build: **178 passed, 0 failed, 7 infrastructure-only skips**. PostgreSQL/Redis: **77 passed, 0 failed, 0 skipped**. Full desktop/mobile browser: **107 passed, 0 failed, 3 intentional skips**. Real frontend/API/PostgreSQL/Redis workflow: **1 passed** with scripted inference. Production frontend build, TypeScript and lint passed. [MILESTONE_4_RESULTS.md](MILESTONE_4_RESULTS.md) records exact logs, reproducible failures, fixes, frozen source manifest and measurement limits.

Source metadata, conflict review, automatic accepted/rejected corrections, immutable history, account isolation and recovery now have integrated local acceptance. Client history has bounded retained windows, protects drafts/in-flight answers and cancels obsolete reads. No navigation-heap improvement is claimed. LIVE-001 (missing evidence reported as a technical verification failure) and LIVE-002 (supported unit fact withheld) remain open from the earlier live-model assessment. At that M4 checkpoint, Docker/restore and cloud/release gates remained. M5 has since passed the local installation/restore checks recorded above; cloud and independent evaluation/load remain milestones 6/7.

## Retained milestone 3C evidence

Final 3C candidate: backend/build **178 passed, 0 failed, 7 infrastructure-only skips**; PostgreSQL/Redis **77 passed, 0 failed, 0 skipped**; lint and all **7 controlled correction cases** passed. The infrastructure run executes both PostgreSQL-only checks and all worker scenarios omitted from the default run. Inference remains scripted; these results do not establish live factual accuracy or cloud availability.

[MILESTONE_3C_RESULTS.md](MILESTONE_3C_RESULTS.md) documents accepted backend correction/history behavior and unchanged/retry events. Normal UI consumers remain milestone 4; health complete-workflow flags remain conservative. No dependency or frontend changes in this slice.

## Retained milestone 3B evidence

Backend/build: **169 passed, 0 failed, 6 infrastructure-only skips** (`data/m3b-final-backend.log`). PostgreSQL/Redis: **67 passed, 0 failed, 0 skipped** (`data/m3b-final-infra.log`). Lint passed; seven controlled correction cases passed; production dependency audit reported zero known vulnerabilities. These checks are local controlled evidence, not live-provider accuracy or cloud acceptance.

[MILESTONE_3B_RESULTS.md](MILESTONE_3B_RESULTS.md) records crash/restart, resource and connection-cleanup evidence. Complete continuous-correction semantics (3C) and deployment/load acceptance remain unverified.

## Retained milestone 2 evidence

| Check | Executed result | Local log |
| --- | --- | --- |
| `npm test`, including lifecycle/retrieval/repair tests and backend build | **153 passed, 0 failed, 1 PostgreSQL-only skip** | `data/m2-backend.log` |
| Focused atomic/reliability regression | 58 passed, 0 failed | `data/m2-focused.log` |
| Offline correction protocol comparison | 7/7 cases passed before and after, 25 scripted model calls in each | `data/m2-research-before.log`, `data/m2-research-after.log` |
| `npm run test:infra` / equivalent `node scripts/test-infra.mjs` | Prior 1B: **47 passed, 0 failed, 0 skipped**, not rerun in M2 | `data/m1b-infra-accepted.log` |
| `npm run web:build` | Prior 1A pass; frontend unchanged by 1B | `data/m1a-web-build.log` |
| `npm run web:check` | Prior 1A pass; frontend unchanged by 1B | `data/m1a-web-check.log` |
| `npm run lint` | Passed | `data/m2-lint.log` |
| `npm run test:browser -- --workers=1 --reporter=line` | Prior 1A: 86 passed, 0 failed, 2 intentional viewport skips; not rerun in 1B | `data/m1a-browser-final.log` |

The PostgreSQL/Redis runs use disposable local services and no application database or cloud credentials. Earlier 1B attempts had one migration-lock timeout, an interrupted run with paused Docker, and then a temporary SQLite failure because C: had zero free space. Using process-local TEMP/TMP on D: resolved the disk failure; the complete final suite passed. The initial migration timeout did not recur in isolation or either resumed full run, but its cause remains unconfirmed and no production lock fix is claimed. Details and reproduction commands are in [MILESTONE_1B_RESULTS.md](MILESTONE_1B_RESULTS.md). In 1A, an initial two-worker browser run exhausted local memory; the full one-worker retry passed. Browser APIs are fixture-controlled, while HTTP/database integration tests exercise real services with controlled inference.

Historical manifests: `data/m1a-source-fingerprint.json`, `data/m1b-source-fingerprint.json` and `data/m2-source-fingerprint.json`. Final 3A manifest: `data/m3a-accepted-source-fingerprint.json` (128 files). Current backend/build: 167 passes, zero failures, one PostgreSQL-only skip; infrastructure: 60 passes, zero failures/skips; lint and seven controlled correction cases passed. See MILESTONE_3A_RESULTS.md for acceptance mapping and measured archive limits. Historical correction observations: [milestone-2-results.json](milestone-2-results.json); retrieval observations: [milestone-1b-results.json](milestone-1b-results.json). This is not a cloud release, security certification or independent factual benchmark.

## Feature readiness

| Feature | State | Boundary / remaining gate |
| --- | --- | --- |
| Personal accounts, sessions, isolation, recovery codes | WORKING_AND_TESTED within automated scenarios | SQLite and PostgreSQL HTTP/regression coverage passed; no independent security certification |
| Durable ingestion and hybrid retrieval | WORKING_AND_TESTED within stated controlled scenarios | Resumed/uninterrupted chunks match; 8/8 labeled passage references on each database; four temporal/cache bugs fixed; full 1B infrastructure gate passed |
| Immediate RAC-inspired verification/repair | WORKING_AND_TESTED within controlled acceptance | Numerical correction, preserved facts/caveats, strict contracts and rejected unsafe repairs pass; M7 adds seven live fixed-draft observations, latency and tokens. Independent accuracy and cost remain unknown |
| Metadata, conflict decisions, archived snapshots, answer versions | WORKING_AND_TESTED within 3A/4 controlled acceptance | Historical versions, scoped decisions and bounded APIs pass database tests; integrated UI, revision conflicts and account isolation pass. Full-quota/concurrent capacity remains |
| Continuous revalidation | WORKING_AND_TESTED within 3C/4 controlled acceptance | Real-pipeline current/historical, missing/conflicting evidence, unsafe repair, retries, versions, audit API and concurrency tests pass; integrated automatic correction/history passes with scripted inference. Live/cloud acceptance remains 6/7 |
| Separate worker and BullMQ transport | WORKING_AND_TESTED within 3B controlled acceptance | Separate role, real SQL/Redis recovery and bounded resource probes pass; local image healthcheck/heartbeat now pass M5; managed service and production load remain 6/7 |
| Full-library conflict scanning | MISSING | Only saved-answer assessments; explicit supported boundary |
| Current production frontend/browser baseline | WORKING_AND_TESTED within M7 automated scenarios | Next 16.4.5 production build, type check, lint and 107 browser regressions passed. See M7 report for combined real-stack result. No live cloud acceptance |
| Docker installation and restore | WORKING_AND_TESTED within M5 controlled acceptance; M7 rebuild pending | Five-service clean installation, restart/rebuild, hard-kill recovery and second-project backup/restore passed on M5 image. New Next image, quota-scale restore and cloud remain unverified |
| Current Vercel/Render/Neon/managed Redis deployment | IMPLEMENTED_NOT_TESTED | M6 configuration prepared; account validation returned 401 and live acceptance remains pending |
| Independent factual evaluation and operational capacity | PARTIALLY_IMPLEMENTED | Synthetic harness exists; independent labels, workload/restore/soak evidence remain |

Status vocabulary follows the implementation plan. `WORKING_AND_TESTED` names the exercised behavior, never implies all scenarios pass. Missing email delivery/MFA/shared-workspace roles remain documented unsupported features. A provider timeout is not proof of an unsupported factual proposition.
