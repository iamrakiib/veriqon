# Veriqon implementation and release plan

Prepared: 11 November 2026. Updated: 26 November 2026. Current release evidence is below; subsequent dated entries retain their original scope.

## Human QA and exploratory testing milestone (26 November 2026)

Status: **IN PROGRESS**, following deployed PR #12 and documentation-only PR #13. Preserve completed development; discover failures in the UI before changing implementation. Evidence: [HUMAN_QA_BUG_REPORT.md](HUMAN_QA_BUG_REPORT.md).

- [ ] Session 1: authentication, navigation, refresh, multiple tabs and interrupted operations.
- [ ] Session 2: PDF, DOCX, TXT and Markdown ingestion, persistence and duplicates.
- [ ] Session 3: chat, retrieval, citations, history and request interruption.
- [ ] Session 4: factual verification and repair; live acceptance requires valid provider authentication.
- [ ] Session 5: continuous correction/versioning; live-model acceptance has the same prerequisite.
- [ ] Session 6: Conflict Center, decisions, correction history and dashboard metrics.
- [ ] Session 7: desktop/tablet/mobile, keyboard access, themes and unusual sequences.
- [ ] Session 8: deployed recovery/reliability and final release verification.

Acceptance per session: record interactions, reproducible defects and evidence; fix confirmed root causes minimally; rerun the original workflow and relevant regressions. Distinguish deployed checks, controlled browser failures, local fixes and blocked workflows. Use synthetic QA data only; no destructive production stress tests or paid resources. Passing automated tests alone does not complete this milestone.

27 November checkpoint: explored deployed authentication/navigation, supported and malformed uploads, saved citations/downloads, provider-failed chat, review/queue empty states and Analytics on desktop/phone. Discovered and locally fixed page Back/Forward/refresh behavior (HQA-001) and misleading completed-answer metric labeling (HQA-003). Each has a failing-before regression. Affected browser suite: **56 passed / two intentional skips / zero failures**; production build, TypeScript and lint passed. Real UI registration, cross-tab logout, cookie-loss handling, original-file SHA-256 and persisted failure states were checked. Exact scope and not-run cases are in the report. Provider authentication still blocks successful indexing/inference/correction (HQA-002); initial gateway HTTP 429 recovered but its cause remains unresolved (HQA-004). This milestone is not accepted; local fixes still need release/deployed retest.

## Chat usability and regression QA: 26 November 2026

Baseline: protected [PR #11](https://github.com/iamrakiib/veriqon/pull/11), commit `9ea7859a96d7da74f288569e8207e0d77837ccfb`, passed required GitHub checks and was verified on Vercel/Render. Its live follow-up passed 18 assertions, including preserved PDF/conversation data, responsive Corrections/history/analytics and one real-provider v17 answer. This supersedes earlier pending-publication language below.

- [x] Reproduced phone theme layout mismatch: dark-theme selector specificity overrode responsive shared spacing. Separated layout tokens from palette selectors. Exact geometry now matches across six routes at 360, 390, 768 and 1440 px.
- [x] Reproduced inconsistent chat search: sidebar searched titles only. Sidebar and Chat history now search the same loaded titles/questions. Recent chats is the sidebar label; older records remain accessible through history pagination.
- [x] Implemented the missing delete workflow: header/history overflow menus, explicit confirmation, preserved UI on request failure and reload persistence. Transactional owner-scoped deletion removes messages, versions and jobs; source documents/review decisions survive. Deleted question text and answer links are removed from retained conflicts. A tombstone and consistent user-lock order stop stale browser requests or late worker/provider completion from resurrecting deleted chats.
- [x] Corrected Analytics' stale statement that no background scheduler exists; it directs users to the actual job status in Corrections.
- [x] Backend/build: **191 passed, zero failed, seven infrastructure-only skips** (`data/qa-backend-final.log`). Focused auth/lifecycle suite: 23 passed. Seven controlled research scenarios passed; lint, production frontend build and subsequent type check passed.
- [x] Focused UI before fixes: five failures / one intentional viewport skip. After fixes: five passed / one skip. Whole browser suite: **121 passed, three failed, four intentional skips**; two failures expected the superseded sidebar label, and the third timed out before slow development JS finished loading. Updated the label assertion; all six affected desktop/mobile authentication/history cases passed on rerun (`data/qa-browser-rerun.log`). The authentication assertion and timeout were unchanged. Required CI will rerun the complete suite on Linux.
- [x] PostgreSQL/Redis: **82 passed, zero failed, one dedicated Redis-restart skip**, 83 total, 349.9 seconds (`data/qa-infra-final.log`). Includes owner isolation, deletion cleanup, in-flight revalidation deletion, standalone-worker checkpoint recovery and post-commit replay.
- [x] Real frontend/API/PostgreSQL/Redis lifecycle: **one passed**, 56.6 seconds (`data/qa-lifecycle-final.log`), including automatic correction, recovery and UI deletion while documents/source decisions remain. Inference is scripted. Four release-tool tests passed; source/history audit found zero findings across 233 files and 599 Git objects.
- [x] Protected [PR #12](https://github.com/iamrakiib/veriqon/pull/12) merged as `3e9f0d05d5aefe9047533f5ef2336bf766f64d14`. Both required checks passed: 191 backend passes, 82 PostgreSQL/Redis passes, **124 browser passes / four intentional skips**, one full-stack lifecycle pass, and Docker installation/restart/crash recovery/backup/restore. The full Linux browser run supersedes the local partial rerun above.
- [x] Render deployment `dep-dc44i8ui0phs7394s75g` is live; Vercel `dpl_94Yfv1HYdpNGWeXbKXJZ58KW8kti` is READY with the public alias and matching commit. **21 live checks passed**: retained original PDF/conversation, six-route theme geometry at desktop/phone sizes, deletion cancellation, confirmed deletion, reload persistence, stale-chat rejection and no frontend runtime errors. Dedicated disposable chats used database-inventory answers; they made no model calls. [Release evidence](https://github.com/iamrakiib/veriqon/pull/12#issuecomment-7195727465).
- [x] Local PostgreSQL retrieval load check passed: 1,688 operations, zero errors, p95 56.98 ms over 60 seconds. This excludes inference, API and queue throughput; it does not establish end-to-end performance.

Three fresh real-provider synthetic fact checks were blocked by HTTP 401 before decomposition (`data/qa-live-facts.json`). No verdict, repair success, accuracy or latency improvement is inferred. A valid OpenRouter key is required to resume live evaluation. LIVE-002, independently reviewed factual evaluation, always-on hosted worker acceptance and longer mixed-workload tests remain open. No paid resources are authorized.

## Current follow-up: layout, correction history and quote recovery

- Published baseline: PR #10 merged as `febdf8bfced91e8e03c474015a00dc5b9a828458`; required `verify` and `docker-installation` checks passed. Vercel and Render were verified on that commit, Neon migrations 1–4 applied, and 11 live PDF/query smoke assertions passed. See [release readiness](RELEASE_READINESS.md). This is the existing free integrated-SQL deployment, not full separate-worker cloud acceptance.
- Reproduced history search growing to 563.6 px on desktop / 199.2 px on mobile and wide-screen Analytics metrics offset by 210 px. Scoped flex sizing and automatic inline margins fix these without changing chat width or composer behavior.
- Added Corrections overflow action and confirmation: server-side, owner-scoped, exact-assessment archival with atomic rollback, optimistic concurrency and idempotent retries. Saved answers, immutable versions and background jobs remain intact. New assessments remain visible. Removed the misleading sidebar count derived from a different, unfiltered history window; the Corrections page displays its authoritative count and coverage.
- Deployed verification failure at 08:34 UTC was an exact-quote contract mismatch after a retry; generation and all provider calls completed. Added exact source-segment references on that existing retry, followed by all normal verification checks. Unknown references, cross-passage IDs, altered values and extra fields remain rejected. No extra provider call or factual-repair badge is introduced.
- Real-provider retry check: one synthetic policy claim passed in 2,356 ms with exact source text retained, 1,133 input / 75 output tokens. Initial malformed assessment and decomposition were controlled. This is narrow contract-recovery evidence, not a general accuracy or latency claim.
- Consolidated 15 superseded audit/status files into [historical reviews](HISTORICAL_REVIEWS.md), retaining immutable originals in Git history. Added [documentation index](README.md) and replaced contradictory current-release summaries. Architecture/methodology, milestone reports, evaluation data and operating guides remain available.
- Backend: **189 passed, zero failed, seven infrastructure-only skips** (`data/current-backend-final.log`). PostgreSQL/Redis: **80 passed, zero failed, one dedicated Redis-restart skip** (`data/current-infra-test.log`), including correction archival on PostgreSQL and worker crash/replay recovery. Final atomic suite: 37 passed. All seven controlled research scenarios and four release-tool tests passed.
- Full browser run: 117 passed, three intentional viewport skips, two confirmation-text assertions failed because the running tests retained the earlier plural wording while the dialog was corrected to singular. The updated tests and final mobile toolbar geometry passed on rerun: **37 passed, zero failed, one viewport skip** (`data/current-ui-final.log`). Earlier focused frontend run: 52 passed / two viewport skips. GitHub CI reruns the full suite on the fixed candidate.
- Full frontend/API/PostgreSQL/Redis lifecycle: **one passed** (`data/current-lifecycle-final.log`), including automatic correction, retained immutable versions, recovery/account isolation and the new Corrections clear action. Inference is scripted for this test; the separate real-provider retry is described above.
- Production frontend build, subsequent TypeScript check and lint passed (`data/current-web-build.log`, `data/current-web-check.log`, `data/current-lint-final.log`). Documentation check: 177 local links checked across 43 Markdown files, none missing. Source/history publication audit passed with no findings. Protected CI and hosting results are recorded with the release candidate.

Local acceptance is complete within the tests above. Publish through the protected PR workflow and record the exact hosting deployments on its release record; do not infer deployment from a frontend page loading. No paid services are authorized. Independent factual evaluation, LIVE-002, complete hosted worker/revalidation/persistence acceptance and longer workload testing remain open; this follow-up does not close them.

## Release gate follow-up: 24 November 2026

- [PR #10](https://github.com/iamrakiib/veriqon/pull/10) contains the audited release. Its initial Linux CI run passed Docker installation/restart/restore acceptance but failed one mobile layout assertion: the conversation measured 363 px against a >365.2 px requirement at a 664 px viewport. The other 112 browser tests passed; three were intentionally skipped. The PR remains unmerged until both required checks pass.
- The CI trace shows the mobile assistant status wrapping onto a second line. Reduced mobile header vertical padding from 8 px to 4 px per side, retaining button sizes and conversation width. The existing layout regression now waits for web fonts before measuring; its height threshold is unchanged.
- Complete local browser rerun: **113 passed, zero failed, three intentional skips** (`data/mobile-height-browser-after.log`). Production build, subsequent type check and lint passed (`data/mobile-height-build.log`, `data/mobile-height-typecheck.log`, `data/mobile-height-lint.log`). CI must validate this exact follow-up commit on Linux.
- Existing cloud environment validation and read-only Neon preflight passed: applied migration checksums 1–2 match, pgvector 0.8.0 is installed. Deployment must apply pending migrations 3–4 and verify persistence. Existing Render service uses integrated SQL processing on its free plan; this is not the separate always-on worker acceptance profile. No paid services will be created.

Remaining release operations: pass protected PR checks, merge, deploy the approved commit to existing hosting, and record actual live checks. Independent factual evaluation, LIVE-002, dedicated worker/cloud lifecycle acceptance and long-running workload validation remain open.

## Release follow-up: 23 November 2026

- The user authorized GitHub publication and connected deployments after checks pass. `main` now requires a pull request, an up-to-date branch and the `verify` / `docker-installation` checks; force pushes and deletion are disabled, including administrator bypass. No paid infrastructure has been authorized.
- Current README and four synthetic UI screenshots replace outdated presentation assets. No history rewriting is involved. Source/history audit: 242 files and 321 Git objects checked, zero findings before this documentation update.
- Conflict Center source selects now set explicit light/dark option colors. A confirmed, filter-scoped clear action sits in the toolbar overflow menu. Transactional, account-scoped archive events hide display history while retaining source decisions, saved answers and audit records. See [conflict-history-controls.md](conflict-history-controls.md).
- Backend/build: 186 passed, zero failed, seven infrastructure-only skips. PostgreSQL/Redis: 79 passed, zero failed, one dedicated restart-only skip. Final focused desktop/mobile conflict browser checks: eight passed. Broader browser run: 112 passed, three intentional skips, one trace-file cleanup failure caused by concurrent test runs sharing an output folder; both mobile upload cases passed with isolated output on rerun. Details and log paths are in [conflict-history-controls.md](conflict-history-controls.md). Type check and lint passed before the final mobile toolbar adjustment; production build/type check is the final local gate.
- Full dependency audit now reports zero vulnerabilities. The former picomatch advisory [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) was withdrawn upstream; the dated findings below are historical, not the current audit result.
- LIVE-002 has an exact numeric/unit exclusion guard regression and a polarity-specific verifier prompt (v16). Two new live attempts could not generate because the provider was unavailable (47,477 ms and 45,090 ms); they safely returned source excerpts. This does not close the live reliability case or complete M7.

Final local frontend gate: production build and subsequent TypeScript check passed (`data/conflict-web-build.log`, `data/conflict-web-check-final.log`); lint passed. An earlier concurrent type check raced Next.js development type generation and was rerun after the browser process stopped. No application change was made to suppress that tooling failure.

Remaining: protected GitHub PR checks/publication, then verify any triggered deployments. Full cloud persistence/worker acceptance, independent factual evaluation and longer mixed-workload testing remain separate unverified gates.

## Decision and scope

**Milestones 1A, 1B, 2, 3A, 3B, 3C, 4 and 5 accepted within their documented local test boundaries.** Milestone 3B has passing separate-worker, queue, crash-recovery and resource tests; see [MILESTONE_3B_RESULTS.md](MILESTONE_3B_RESULTS.md). 3C fixes are recorded in [MILESTONE_3C_RESULTS.md](MILESTONE_3C_RESULTS.md). Milestone 4 UI/API integration passed controlled acceptance on 17 November 2026; see [MILESTONE_4_RESULTS.md](MILESTONE_4_RESULTS.md). Final 3A evidence is in [MILESTONE_3A_RESULTS.md](MILESTONE_3A_RESULTS.md); earlier checkpoints remain labeled below. Milestone 5 passed clean local Docker, persistence and restore acceptance on 17 November; see [MILESTONE_5_RESULTS.md](MILESTONE_5_RESULTS.md). Full release and cloud acceptance remain incomplete.

The original planning checkpoint changed only this plan. The subsequent user instruction authorized milestone 1A implementation; its changes and results are recorded below. Existing unrelated uncommitted changes were preserved. Nothing was pushed or deployed. Milestone 1A changed no dependencies or migration SQL; 3B subsequently adds the pinned queue dependencies documented below.

The master specification and additional cloud requirements define the future acceptance criteria below. Subsequent continuation authorized 3A and then 3B; the latest request prioritizes necessary system-design, code-quality, memory and measured-performance requirements across remaining milestones. Public release and deployment remain later milestones.

Preserve NestJS, Next.js, OpenRouter, PostgreSQL/pgvector, local SQLite support, existing authentication, retrieval and correction services. Preserve the visual identity and existing layout. Do not replace working modules simply to adopt another framework.

## Original planning inspection (11 November 2026)

Inspected the README, existing deployment and capability documents, release/audit reports, package scripts and CI, API bootstrap, database/migration path, knowledge store, ingestion/revalidation workers, temporal retrieval, verification/conflict contracts, frontend proxy configuration and lifecycle controls. Targeted searches checked worker wiring, BullMQ dependencies and machine-specific deployment instructions. This is a source and regression assessment, not an exhaustive penetration test.

### Checks executed at the original planning checkpoint

| Command/check | Actual result | Evidence and limit |
| --- | --- | --- |
| `npm test` (includes backend TypeScript build) | Build passed; **131 passed, 1 failed, 1 skipped**, 133 tests total | `data/plan-baseline-tests.log`; PostgreSQL-only coverage skipped in this local run |
| `node --test dist/src/tests/knowledge-lifecycle.test.js` | **5 passed, 0 failed** | `data/plan-lifecycle-tests.log`; SQLite and controlled pipeline fixtures, not live cloud processing |
| `npm run web:check` | Passed | `data/plan-web-check.log`; type checking is not a production frontend build or browser workflow |
| `npm run lint` | Passed | `data/plan-lint.log` |
| Current PostgreSQL/Redis integration, browser suite, production frontend build, fresh Docker install | Not rerun in this planning checkpoint | Must be rerun against the implementation candidate |
| Actual Neon, managed Redis, Render worker and Vercel acceptance | Not executed | Existing hosted-release reports do not verify the current modified source |

The failed test is `real HTTP authentication, migration, private uploads, refresh, revocation and persistence` in `src/tests/auth.test.ts`. The reported assertion is in its `finally` reopening/persistence checks (`dist/src/tests/auth.test.js`, line 285 in this build). Cleanup can mask an earlier exception. Diagnose the first failure before concluding that authentication or persistence is broken; do not weaken the assertions merely to make the suite green.

The lifecycle test file is **not included** in the current `npm test` file list or `scripts/test-infra.mjs`. A passing ordinary suite would therefore miss those new tests.

Prior release evidence in `docs/research-release.md` records 132 backend passes, 31 infrastructure passes, 86 browser passes and successful Docker/HTTP checks. Those are historical results for an earlier snapshot. They are not current release gates. Similarly, `docs/capabilities.md` still says temporal metadata, decisions and revalidation are absent, while code now partially implements them. Documentation and health flags need reconciliation with actual end-to-end capability.

### Working foundation and gaps at the original checkpoint

Status meanings: `WORKING_AND_TESTED` is limited to the named tested behavior; `PARTIALLY_IMPLEMENTED` means important integration or acceptance is missing; `IMPLEMENTED_NOT_TESTED` means current relevant execution evidence is missing; `MISSING` means no implementation was found; `BROKEN` means a reproduced test/contract fails; `BLOCKED` means a required external prerequisite is unavailable. No status means error-free.

| Area | Observed state | Keep / finish |
| --- | --- | --- |
| Authentication, personal libraries, refresh sessions, recovery codes | Implemented; broader HTTP regression currently `BROKEN` | Preserve authentication; isolate failed test; verify new lifecycle endpoints under the same authorization rules |
| PDF/DOCX/TXT/MD ingestion | Existing durable SQL jobs, checkpoints, bounded provider handling and atomic publication; covered by current regressions | Preserve; test process separation, restart recovery and real document flow. No OCR |
| Original files and index persistence | Database-backed upload bytes/text/chunks; PostgreSQL production path | Keep database storage initially; verify staged and archived data across worker/API restarts |
| Hybrid retrieval | Dense exact ranking, lexical search, passage expansion, source/owner scoping | Preserve; evaluate noisy collections, numerical/table evidence, historical filtering and diagnostics |
| Answer cache | Existing process-local exact/semantic cache with equivalence and revision guards | Keep safety checks; disclose per-instance cache. Shared caching is not a first-release prerequisite |
| RAC-inspired correction | Atomic decomposition, structured verification, targeted retrieval, bounded repair, final checks and abstention exist | Strengthen targeted regressions and measure rather than replace |
| Saved chat, evidence, request-time repairs | Existing storage/UI and tests | Verify new versions do not break existing history or citation navigation |
| Source dates/supersession | `PARTIALLY_IMPLEMENTED`: `temporal.ts`, retrieval filters and metadata endpoints; focused tests pass | Finish scope edge cases, archived-version retrieval, metadata UI and migration coverage |
| Conflict Center | Existing evidence display; new persistent decisions/history backend | Finish deterministic decision application, UI wiring, pagination and stale-decision handling |
| Full-library conflict scan | `MISSING`; health explicitly says false | Keep limitation visible; not necessary to claim saved-answer conflict review works |
| Continuous correction | `PARTIALLY_IMPLEMENTED`: SQL outbox/jobs, leases, retries, conservative answer scheduling and appended versions | Finish real pipeline integration, historical correctness, citation integrity, duplicate/concurrent recovery and visible results |
| Lifecycle UI | `PARTIALLY_IMPLEMENTED`: exports in `knowledge-controls.tsx` exist but are not imported into the main workflows | Wire existing components; no redesign |
| Separate background worker | `MISSING` | Current services poll inside the Nest API process; no independently deployed worker entrypoint/service |
| Redis queues/BullMQ | `MISSING` | Current Redis is for rate limits/leases; jobs are SQL-backed. `package.json` has no BullMQ dependency |
| Local Docker | Existing API/web/PostgreSQL/Redis Compose and Dockerfiles; historical fresh-install success | Add separate worker and queue persistence; rerun current clean-install/restart acceptance |
| Cloud configuration | Existing Vercel proxy, Render API Blueprint and Neon deployment instructions | Blueprint contains only a free API, no worker; latest migrations and lifecycle not cloud-verified |
| Research evaluation | Seven-case synthetic harness and live traces exist | Not independently reviewed general accuracy evidence; expand without mixing functional and factual metrics |
| Operations/security scope | Health/readiness, limits and graceful API hooks exist | Worker observability, restore drills, capacity tests, retention and release review remain incomplete |

Primary source locations: `src/rag/{rag.service,verification,atomic-facts,ingestion.service,revalidation.service,temporal,conflicts}.ts`, `src/vector-store/vector-store.service.ts`, `src/database/{database.service,knowledge-store,sql-store}.ts`, `migrations/001_postgresql.sql` through `004_knowledge_lifecycle.sql`, `apps/web/src/components/`, `compose.yaml`, `render.yaml`, `Dockerfile`, `apps/web/Dockerfile`, `apps/web/next.config.ts`.

## Architecture decisions to preserve

1. **PostgreSQL remains authoritative.** Keep documents, original uploads, evidence, answer versions and lifecycle state durable in PostgreSQL. Existing archived snapshots contain text/chunks/metadata but not original binaries or embeddings; historical retrieval and original-version download requirements must be addressed explicitly.
2. **Add queue transport without two competing schedulers.** For the requested cloud Redis/BullMQ mode, retain SQL checkpoints, outbox and revision fences. Dispatch stable job IDs to BullMQ and consume using the existing ingestion/revalidation algorithms. Only the worker consumes jobs in this mode. Reconcile committed but undispatched SQL work after failures. Do not run the old API polling consumer concurrently or copy the business logic into another engine.
3. **At-least-once delivery, idempotent effects.** Never promise exactly-once queue delivery. A job replay must not publish duplicate indexes or answer versions. PostgreSQL constraints/transactions and source-revision fencing enforce this.
4. **Independent worker, shared code.** Reuse the backend image with a worker entrypoint if practical; a duplicate Dockerfile is unnecessary unless it has a distinct runtime need. Local SQLite may retain a clearly documented single-process mode. Docker/cloud must exercise the real separate worker.
5. **Keep same-origin browser APIs.** Preserve Next `/api/auth/*` and `/api/rag/*` proxying to Render, first-party cookies and exact allowed origins. Do not expose provider/database credentials to the frontend or replace this with wildcard CORS.
6. **No mandatory object store yet.** Existing database-backed originals are durable. Add object storage only if versioned binaries or measured storage needs require it; then require private versioned keys, authorization and lifecycle tests. Ephemeral container files are temporary parsing scratch only.
7. **Finish correctness before scale optimization.** Exact search and process-local caches can support a documented bounded release. ANN, shared semantic caching and full-library conflict scanning require separate measured justification; do not block core stabilization by rebuilding them now.

## Milestone order

`1A baseline → 1B retrieval/ingestion → 2 factual correction → 3A versions/decisions → 3B worker/queues → 3C continuous correction → 4 UI/API integration → 5 fresh Docker installation → 6 cloud deployment → 7 release acceptance`

Tests and security checks accompany each slice. Milestone 7 is the combined release gate, not the first time integration is tested. Documentation can be drafted alongside implementation, but must not state that unexecuted gates passed.

## Code quality and performance gates for remaining work

Added 12 November 2026; applies to every remaining slice, without reopening completed milestones. [CODE_QUALITY_AUDIT.md](CODE_QUALITY_AUDIT.md) records inspected paths and risks. [PERFORMANCE.md](PERFORMANCE.md) records complexity assumptions, measurements and unmeasured metrics.

Before each change: locate reusable code, name input-size variables and expected time/space cost, identify retained buffers and provider/SQL calls, reproduce the defect or measure the bottleneck, and choose a localized implementation. Do not add infrastructure, dependencies or abstractions without a requirement. Remove code only after establishing it is unused.

After each change: run affected correctness/authorization/citation/temporal regressions; compare the same benchmark configuration before/after; report SQL rows/bytes, model calls/tokens and memory where applicable. Unknown measurements stay unknown. Do not skip verification, weaken evidence checks, or silently change API contracts for speed. If measurements regress or host load differs, report it; do not claim an optimization success solely from a smaller diff.

| Slice | Additional acceptance evidence and deliverable |
| --- | --- |
| 3A versions/decisions | Bound history response and archived retrieval memory; test keyset ties, exact snapshot identity, stale decisions and source authorization. Measure conflict review SQL bytes/query counts and history latency at stated sizes; no whole-library text read for a two-source decision. Preserve legacy contracts until consumers migrate. |
| 3B worker/queues | Jobs carry IDs, not full document/vector copies. Bound concurrency, retry/backoff and admission; measure worker + parser peak RSS, connections, queued bytes and cleanup after cancellation/restart. Reuse existing processors; no duplicate scheduler. |
| 3C revalidation | Record answers considered/jobs executed/model calls per update, duration, memory, unnecessary jobs and missed invalidations on labeled cases. Any selective scheduling must preserve new-competing-evidence recall and historical answers, with conservative fallback. |
| 4 UI/API | Migrate lifecycle consumers to paginated summary/detail APIs; cap client history retention and stop obsolete polls. Measure response sizes and repeated-navigation heap behavior; preserve current layout, API compatibility, account isolation and honest status displays. |
| 5 Docker install | Run on a documented ordinary-laptop resource budget without a local LLM/GPU. Record idle/peak API, worker, parser and database memory, maximum-supported ingestion throughput, connection totals and scratch/durable storage use. Run infrastructure/browser suites sequentially on constrained hosts. |
| 6 cloud | Measure actual API/worker resources, pool demand, queue commands and query plans on staging Neon/managed Redis; confirm provider latency/token budgets under hosting deadlines. No ANN change without corpus-size/recall evidence; no cost or live-throughput claim from fixtures. |
| 7 final optimization audit | Repeat baseline/candidate benchmarks on the same source, hardware, corpus, embedding dimensions, models and concurrency; include p50/p95 stage latency, provider usage, query plans, maximum input and soak/cancellation tests. Review duplication, dead code, dependencies and retained memory. Fix measured high-impact issues before release and rerun adjacent correctness suites. Publish negative/unknown results too. |

Release performance thresholds must be set from the intended workload before the final run. A synthetic two-dimensional embedding benchmark is not a production capacity result. Preserve the existing bounded cache and exact search until measurements justify changes.

## Prioritized RAG system-design requirements (13 November 2026)

Prioritize correctness under interruption and bounded provider expenditure over additional infrastructure. Reuse existing SQL transactions, Redis admission control, provider pacing and deployment tooling. A requirement below is not an implementation or acceptance claim.

| Priority / milestone | Requirement and efficient design | Required acceptance evidence |
| --- | --- | --- |
| P0 / 3B | Durable ID-only delivery, SQL reconciliation, revision/lease fences, separate API and worker roles. Retain existing ingestion/revalidation processors; one transport adapter, no duplicate scheduler. | Kill before dispatch, after checkpoint and after database commit/before queue acknowledgement; restart Redis/worker; duplicates publish at most one visible result. |
| P0 / 3B, 7 | Shared admission, bounded jobs and provider budgets. Keep coarse fixed-duration windows for abuse protection and separate concurrency leases. Document account/global limits and burst behavior; add token-bucket/sliding-window logic only if measured provider/cost requirements need smoothing. | Across two processes, simultaneous requests cannot exceed configured concurrency; test window-boundary bursts, lease expiry/renewal, cancellation of in-flight API work after coordination loss, Redis outage (fail closed), account fairness and provider reset handling. Count actual attempts, not just successful answers. |
| P0 / 3B, 3C | Bounded retries/backoff, cancellation and explicit failure states. Reuse provider cooldowns; do not stack unbounded queue retries on provider retries. A circuit breaker is conditional on measured repeated failures, not a mandatory new service. | Persistent 429/5xx/timeout cannot create a retry storm; reset time is respected; original answers/checkpoints survive; outage recovery requires no browser. |
| P0 / 4, 6, 7 | Preserve owner-scoped authorization, private queues/logs, secure cookies, exact origins and trustworthy proxy configuration across replicas. | Cross-account document/job/history access rejected; forged forwarded IP/origin cannot bypass limits or authorization. No source text, credentials or answer bodies in queue telemetry. |
| P1 / 5, 6, 7 | Resource and connection budgets. Budget API replicas x pool size + worker pools + migrations against database capacity; queue concurrency against provider quota and RAM. | Maximum input and concurrent workloads record parser/API/worker/database peaks, queue age, errors and p95 latency. Explicit capacity limits; no arbitrary autoscaling. |
| P1 / 6, 7 | Multi-instance routing using the hosting platform's existing load balancer, readiness and graceful draining. No custom load-balancing service. Keep requests stateless; disclose per-process caches. | Two API instances share auth/admission/storage; terminate one during traffic without losing accepted jobs; unhealthy replicas stop receiving traffic; restart does not require sticky sessions for correctness. |
| P1 / 6, 7 | CI/CD release gates, one migration owner and backward-compatible rollback. Extend existing GitHub Actions instead of introducing another pipeline. | Same immutable candidate passes required suites/build/secret audit before deployment; failed checks prevent promotion; staging smoke and rollback preserve stored data; migration compatibility tested. Publishing remains separately authorized. |
| P1 / 6, 7 | Operational observability and recovery. Structured request/job IDs, queue age, failure rate, worker heartbeat and backup/restore evidence. Use host logging/alerts before adding a monitoring stack. | Define workload-specific availability/latency/queue-age objectives and alert thresholds before the release run; simulate stopped worker, backlog, DB outage and restore. Separate provider outage from app liveness. |
| P2 / measured follow-up | ANN, shared semantic cache, advanced adaptive limiting and autoscaling only after measured bottlenecks. | Compare recall/correctness, memory, latency and cost against the existing implementation. No speculative dependencies or cache correctness shortcuts. |

Scheduling: 3B owns transport/process/retry correctness now; 3C owns complete answer revalidation; 4 owns user-visible integration; 5/6 own installation and topology; 7 owns combined multi-instance/load/release gates. Do not expand 3B into a rewrite of authentication, UI or deployment. Existing fixed-window/concurrency tests remain required regressions; distributed burst and capacity tests are explicit release gates.

## Milestone 1 — Core RAG stability and retrieval

### 1A. Restore a trustworthy current baseline (first implementation)

Dependencies: none.

**Checkpoint — 11 November 2026: COMPLETE; all 1A acceptance checks passed.** This completes slice 1A, not the remaining work in milestone 1B or the full product release.

Completed tasks:

- [x] Reproduced the isolated HTTP failure (`data/m1a-auth-before.log`). Moved reopening/persistence assertions out of `finally` so an earlier failure is not masked. The exposed failure was an outdated fixture expecting one conflict after replacing a completed assessment, while durable audit history retained two.
- [x] Fixed the fixture with separate saved answers and assertions for both conflicts, source-comparison details, original answer version and account isolation. No production history deletion or weakened persistence assertions.
- [x] Included the five lifecycle tests in `npm test` and the PostgreSQL entrypoint. Existing CI invokes both scripts, so no duplicate CI job was needed.
- [x] Added populated schema-003 to 004 upgrade coverage, fresh/concurrent/repeated initialization checks, retained originals/answers/chunks, metadata/snapshot persistence after reopen and rejection of modified applied checksums. Migration SQL remains unchanged.
- [x] Reproduced inaccurate complete-workflow health flags (`data/m1a-health-before.log`); corrected them and added HTTP assertions. `/rag/health` now discloses partial backend support under `implementation`, without claiming complete temporal/decision/version/revalidation workflows.
- [x] Created `RELEASE_READINESS.md`, `RAG_STABILITY_STATE.md`, `RAG_BUG_LEDGER.md` and reconciled `capabilities.md` with current partial implementation.

| Acceptance check | Actual current result | Local evidence |
| --- | --- | --- |
| Backend build and `npm test`, including lifecycle | **137 passed, 0 failed, 1 PostgreSQL-only skip** | `data/m1a-backend-final.log` |
| `npm run test:infra` on disposable PostgreSQL/pgvector and Redis | **37 passed, 0 failed, 0 skipped** | `data/m1a-infra.log` |
| Production frontend build | Passed | `data/m1a-web-build.log` |
| Frontend type check | Passed | `data/m1a-web-check.log` |
| Lint | Passed | `data/m1a-lint.log` |
| Browser regressions, isolated port 3101, `--workers=1 --reporter=line` | **86 passed, 0 failed, 2 intentional viewport skips** | `data/m1a-browser-final.log` |

The first two-worker browser run was interrupted after the Next development server reported a memory-allocation failure while Docker Desktop was running. It is not a pass. The disposable containers were removed and Docker restored to its original stopped state before retrying with one browser worker; that complete rerun passed in 4.0 minutes. No application assertion was relaxed for that retry. Temporary browser profiles used ignored `data/m1a-temp` on the workspace drive because the system drive is low on space. The two skips avoid rerunning desktop-only cross-viewport scenarios under the mobile project. The SQLite suite's single skip is the PostgreSQL concurrency scenario exercised by the separate infrastructure suite.

Source/test fingerprint: `387f8c429c5e6cd6a0643aa2489f4fcf7376cbb558633233c65733aa69ace8a5` across 121 implementation, fixture and configuration files; manifest in `data/m1a-source-fingerprint.json`. This is a dirty-tree fingerprint, not a new commit. Documentation and generated Next declarations are excluded. Existing browser tests use intercepted API fixtures; backend HTTP tests use real Nest services with controlled inference; PostgreSQL/Redis tests use real disposable infrastructure. No live-provider, cloud, factual-accuracy or complete continuous-correction claim is made.

Files changed for this slice: `src/tests/auth.test.ts`, `src/tests/infra.test.ts`, `src/rag/rag.controller.ts`, `package.json`, `scripts/test-infra.mjs`, this plan, `docs/capabilities.md` and the three state/readiness documents. Next regenerated `apps/web/next-env.d.ts` during build/dev checks; no frontend UI implementation was edited.

Remaining: no unresolved 1A acceptance failure. The resource-constrained host needed sequential infrastructure/browser testing and one browser worker; the initial interrupted run remains documented. All 1B–7 work remains unstarted by this checkpoint, including archived retrieval, deterministic conflict-decision application, lifecycle UI integration, separate workers/queues and live cloud acceptance. Passing this baseline does not certify those unfinished capabilities.

Fix/verify:

- Reproduce the failing HTTP test in isolation and retain the original exception when cleanup also fails. Determine whether the defect is fixture behavior, changed persistence semantics or application code before editing.
- Add lifecycle tests to ordinary and PostgreSQL test entrypoints/CI. Verify migration 004 from a fresh schema and an existing schema through 003; do not edit already-applied migration contents.
- Check health capability reporting against complete behavior. A registered service is not proof that its UI/worker workflow is available.
- Create `docs/RELEASE_READINESS.md`, `docs/RAG_STABILITY_STATE.md` and `docs/RAG_BUG_LEDGER.md` with reproducible failures, owners, evidence and next steps; reconcile stale capability text only after verification.

Acceptance:

- Current backend suite and lifecycle suite pass; intentional infrastructure skips remain explicit. No test is removed/relaxed without a justified contract change.
- PostgreSQL migration fresh install, upgrade, repeated startup and concurrent migration locking pass in a disposable database.
- Frontend production build, type check, lint and existing browser smoke pass against the same source revision.

Deliverables: smallest regression fix(es), wired test entrypoints, current baseline report and state/bug ledger. Exit gate: no unexplained baseline failure.

### 1B. Stabilize ingestion, retrieval and query scope

Dependencies: 1A.

**Checkpoint — 12 November 2026: COMPLETE; 1B acceptance checks passed.** No work on milestone 2. See [MILESTONE_1B_RESULTS.md](MILESTONE_1B_RESULTS.md) for reproduction evidence, supported limits and measurement caveats.

Completed tasks:

- [x] Reproduced multiple-period retrieval losing historical sources; retain the enclosing interval of explicit requested dates/years, deduplicate repeated periods and preserve source metadata.
- [x] Reproduced malformed exclusive dates at year 9999; validate supported calendar boundaries and test leap days.
- [x] Reproduced inherited file focus bypassing effective-date filtering, including the real query pipeline. Use the original current question to distinguish explicit source-wording inspection from policy applicability.
- [x] Reproduced semantic-cache reuse across that inspection/policy boundary even with a permissive equivalence result; include the boundary in cache scope.
- [x] Added real SQLite/PostgreSQL retrieval fixtures for noisy collections, table values/units, named files, multiple passages, historical/current periods, unknown metadata and unavailable evidence. Captured generation/verification inputs exclude another account's private evidence, including targeted retrieval.
- [x] Compared resumed ingestion chunks/embeddings with uninterrupted indexing. Retained existing checkpoint, hidden partial index, pacing, duplicate/profile change, retry, extraction and provider-fallback regressions. Added textless PDF rejection with an explicit OCR requirement.
- [x] Measured the controlled retrieval and cache fixtures; wired retrieval regressions into both backend and infrastructure commands.
- [x] Finished the complete PostgreSQL/Redis suite: 47 passed. Concurrent migrations passed in isolation and both resumed full runs. The resumed run exposed a different, confirmed environmental failure: C: had zero free bytes, so a temporary SQLite fixture could not initialize. Setting process-local TEMP/TMP to a workspace directory on D: resolved that failure without changing application behavior, timeouts or test assertions.

| Check | Actual result | Local evidence |
| --- | --- | --- |
| `npm test` including backend build | **148 passed, 0 failed, 1 PostgreSQL-only skip** (149 total) | `data/m1b-backend-final.log` |
| `npm run lint` | Passed | `data/m1b-lint.log` |
| First PostgreSQL/Redis suite | **46 passed, 1 failed** (47 total); failure at concurrent migration advisory lock, PostgreSQL statement timeout | `data/m1b-infra.log` |
| Isolated rerun of failed migration test | **1 passed, 0 failed** | `data/m1b-infra-isolated.log` |
| Interrupted PostgreSQL/Redis rerun | Docker was manually paused; no completed result counted | `data/m1b-infra-final.log` |
| First resumed PostgreSQL/Redis run | **46 passed, 1 failed**: temporary SQLite initialization reported `database or disk is full`; C: free space measured as zero | `data/m1b-infra-resumed.log` |
| Final complete PostgreSQL/Redis run | **47 passed, 0 failed, 0 skipped**, 89.75 seconds; TEMP/TMP set only for the test process to `data/m1b-test-tmp` on D: | `data/m1b-infra-accepted.log` |
| Frontend build/check/browser | Unchanged 1A evidence; not rerun in 1B because frontend source and API response shape were not changed | 1A checkpoint above |

Controlled measurements: **8/8 expected passage references across six questions** on SQLite and PostgreSQL; six query-embedding calls per matrix. PostgreSQL observations were refreshed from the final passing suite. Cache: **two intended hits and seven intended misses**, all nine decisions correct, 16 generation calls across nine warmups plus nine probes. Missing-evidence case: two searches, one generation, one verification and zero unauthorized provider inputs. These are synthetic, controlled-provider fixtures, not live model accuracy or a production cache-hit rate. Independent label review remains milestone 7.

Modified production files in this slice: `src/rag/temporal.ts`, `src/rag/rag.service.ts`, `src/vector-store/vector-store.service.ts`. Tests/entrypoints: `src/tests/retrieval-stability.test.ts`, `src/tests/answer-cache.test.ts`, `src/tests/ingestion.test.ts`, `package.json`, `scripts/test-infra.mjs`. Documentation: this plan, milestone results and readiness/state/bug ledger. Existing unrelated edits remain untouched.

Remaining 1B acceptance blockers: none. The initial migration timeout's cause is **not established**; it did not recur in isolation or either resumed full run, and no migration fix is claimed. The later pause and disk exhaustion have separate observed causes. Keep the timeout observation for operational monitoring; no locks/timeouts/assertions were weakened. C: disk exhaustion remains a local machine issue; test scratch relocation does not free that drive. Temporal range retrieval still uses an enclosing interval; archived same-ID historical retrieval, deterministic precedence, separate workers and cloud acceptance remain later milestones. Source/test manifest: `data/m1b-source-fingerprint.json` (125 files, SHA-256 `5f431f561f64fd0fe76eda147cffd5c78c8d36d964bf0e3196f45ad90c40c761`), verified unchanged before the final rerun. No live inference, frontend changes, push or deployment in this slice.

Fix/verify:

- Preserve durable indexing and provider pacing; reproduce any regression involving changed chunk settings, duplicate upload, incomplete extraction, checkpoint recovery or index visibility.
- Test explicit filename scope versus general policy comparison, follow-up reference scope and irrelevant documents. Separate candidate depth, final context and any measured reranking choice.
- Verify numerical/table questions retrieve results passages rather than relying on introductions. Preserve available values/units/source locations; clearly reject textless scans without claiming OCR support.
- Audit metadata filtering before LLM calls and temporal edge cases (date boundaries, multiple requested periods, missing metadata). Source inspection must not silently become a current-policy assertion.
- Keep timeout/rate-limit/malformed-provider outcomes distinct from missing evidence. Preserve source-excerpts fallback and bounded provider calls.
- Recheck semantic-cache authorization, temporal scope, source versions and library-revision invalidation; never reuse merely similar but materially different questions.

Acceptance:

- Fixtures cover exact terms, paraphrases, numbers, two-passage answers, named file, absent answer, historical/current policies and competing sources mixed with unrelated documents.
- Cross-account passages/metadata never reach generation, verification, cache or target retrieval (assert captured provider inputs).
- Interrupt/restart indexing: committed progress survives, partial index remains invisible, retry ceilings work and final contents match an uninterrupted run.
- Cache positive paraphrase hits and negative date/entity/quantity/scope cases pass. Record actual hit/miss counts, not a promised percentage.
- Record retrieval recall on pre-labeled source passages and provider call counts on a bounded fixture collection; distinguish model-free tests from live-provider results.

Deliverables: focused ingestion/retrieval regressions, minimal fixes, retrieval diagnostics and explicit supported input/size limits. No ANN rewrite in this milestone.

## Milestone 2 — RAC-inspired factual verification and correction

Dependencies: 1B.

**Checkpoint — 12 November 2026: COMPLETE for the specified controlled acceptance cases.** Stopped before 3A. [MILESTONE_2_RESULTS.md](MILESTONE_2_RESULTS.md) documents the status contract, root causes, acceptance mapping and limits; [milestone-2-results.json](milestone-2-results.json) contains observations and the actual five-to-three correction trace.

- [x] Rechecked RAC attribution against paper sections 3–4 and official code pinned to `15d0ae83a7de700a1304b345a54f9878eba51d53`. Kept Veriqon safeguards distinct; no faithful reproduction/performance claim.
- [x] Reproduced two defects before changing production code: decomposition silently dropped qualifiers, and malformed repair JSON became an insufficient-evidence outcome (`data/m2-before.log`: two failures).
- [x] Added conservative qualifier retention and strict repair-contract inspection. Valid empty/ungrounded proposals remain rejected proposals; malformed contracts retain technical-failure semantics. Prompt/cache version updated to `rac-inspired-v13-qualifier-contract`.
- [x] Confirmed `REPAIR_ATTEMPTED` is represented by rejected/accepted history events, not a final API status. Existing UI already distinguishes attempts from verified correction; no frontend edit needed.
- [x] Executed genuine controlled five-to-three correction through generation, decomposition, verification, localized repair and final checks. Retained manager approval, uncertainty, exact quote and source version; one search, six scripted model calls.
- [x] Retained and reran correct-answer, targeted retrieval, missing evidence, temporal, superficial/harmful repair, citation, timeout, malformed response and authorization regressions. Added five tests without new dependencies or schema changes.
- [x] Ran the same seven-case offline comparison before and after. All protocol cases passed with unchanged 25 model calls; no general accuracy or efficiency improvement inferred from scripted responses.

| Executed check | Result | Evidence |
| --- | --- | --- |
| Focused atomic/reliability suite | **58 passed, 0 failed** | `data/m2-focused.log` |
| `npm test`, backend build and HTTP/SQLite integration | **153 passed, 0 failed, 1 PostgreSQL-only skip** (154 total) | `data/m2-backend.log` |
| Lint | Passed | `data/m2-lint.log` |
| Offline research comparison | **7/7 protocol cases passed before and after**, same fixed fixtures | `data/m2-research-before.log`, `data/m2-research-after.log` |
| Live inference/token cost/general factual benchmark | **Not run / unknown** | No live-provider improvement claim; independent benchmark remains milestone 7 |
| PostgreSQL/Redis and browser checks | Not rerun in M2: no schema, queue, UI or response-shape changes | Retained 1A/1B results are explicitly historical |

Changed production files: `src/rag/atomic-facts.ts`, `src/rag/rag.service.ts`. Tests: `src/tests/atomic-facts.test.ts`. Documentation: this plan, `rac-method.md`, milestone report/JSON, readiness/state/bug ledger. No unrelated components were modified. No remaining failing M2 controlled acceptance test; semantic verification remains model-based, qualifier retention is lexical rather than a semantic proof, and live behavior remains unmeasured. Continue with 3A only after the next instruction.

Fix/verify:

- Reuse the existing algorithm and `docs/rac-method.md`; check attribution against the paper and pinned official implementation. Preserve the distinction between RAC steps and Veriqon's safeguards.
- Verify strict claim spans/qualifiers and verdict schemas; malformed responses must fail explicitly, never default to support.
- Formalize backend status transitions, including attempted-but-rejected repair versus accepted `REPAIRED_VERIFIED`. Determine whether `REPAIR_ATTEMPTED` is an event/transient state or API state; keep frontend labels consistent.
- Require an identified factual problem, supporting evidence for the change, preserved supported statements and final verification. Keep uncertainty when new evidence has not resolved it.
- Verify targeted retrieval and bounded repair attempts; preserve citation indices, exact quotes and version IDs after context expansion and localized edits.
- Avoid repeated full-answer regeneration when a safe localized patch suffices. Measure request/token cost before introducing optimizations.

Acceptance:

1. A controlled draft says five remote days; an authoritative applicable source says three. Accepted result says three, preserves an unrelated supported fact and records evidence plus successful re-verification.
2. A correct draft remains unchanged with no repair call.
3. Missing initial evidence causes bounded targeted retrieval; permanently missing evidence causes uncertainty/abstention.
4. A paraphrase retaining the wrong value is rejected; a repair introducing a new unsupported fact is rejected.
5. Unsupported numerical values, fabricated citation IDs, removed qualifiers and malicious document instructions cannot produce a successful verified status in controlled tests.
6. Provider timeout and malformed verification produce technical failure states, not factual contradiction or a green badge.

Deliverables: documented status/repair contract, expanded regression fixtures, actual repair traces and a comparison report. Offline provider fixtures are test-only. Live tests use configured models and separately report latency, tokens, failures and limited factual scoring. No claim of general accuracy or RAC reproduction based on fixture success.

## Milestone 3 — Continuous self-correction after knowledge changes

### 3A. Complete version, temporal and conflict-decision semantics

Dependencies: 2.

**Checkpoint — 12 November 2026: COMPLETE for the specified controlled acceptance cases.** Earlier in this slice, three tests reproduced missing same-ID historical retrieval, inherited effective dates on replacement, and a recorded source decision that did not resolve its exact comparison. Initial reproduction: `data/m3a-before.log`, zero passed/three failed. Added archive snapshot identifiers, historical lexical retrieval without fabricated vectors, metadata reset with a monotonic revision fence, deterministic quote/version/scope decision application and preserved unrelated evidence. Source snapshots keep historical metadata separately from current metadata.

- [x] Added owner-scoped version summary/detail and decision-history endpoints with keyset pagination, input validation and timestamp-tie tests. Kept existing array endpoints compatible. Direct persisted decision/history access no longer depends on inclusion in the recent display window.
- [x] Tested current/historical retrieval after replacement, distinct version passage windows, cross-account access, stale metadata, competing decision writes, explicit disjoint source periods/departments and unrelated supported-claim preservation.
- [x] Reproduced and fixed whole-library conflict-review text transfer and SQLite filtering after full-library loading; optimized chunk boundary search with unchanged golden passage hashes. Added reproducible offline benchmark without inference or private data.
- [x] Created code-quality/performance audit and requirements for all remaining milestones. No provider-stage removal, dependencies or frontend redesign.
- [x] Reproduced an oversized archive window being loaded into Node and historical content-label reuse (`data/m3a-archive-before.log`: two failures). Check an 8 MiB serialized archive budget in SQL before payload transfer; reject a reused historical label for different text. Full-window rejection is explicit, not silent evidence truncation.
- [x] Reproduced an active decision disappearing behind 201 newer unresolved records (`data/m3a-decision-before.log`). Select active decisions matching retrieved source versions before the window limit; fail explicitly above 200 applicable decisions. Valid cache hits skip decision reads. Controlled decision-driven three-to-one repair preserves vacation benefits and reverifies the revised claim.
- [x] Reproduced archived supersession failure (0 passed/1 failed before fix). Read version descriptors before payloads, combine explicit current/historical supersession by historical scope, and honor latest metadata revisions. Historical/range queries, selected-file boundaries, withdrawn precedence and cross-account tests pass on SQLite and PostgreSQL.
- [x] Measured the exact 8 MiB admitted window on PostgreSQL: Node peak RSS 116.5 MiB, database-container peak 128.1 MiB, p50/p95 214.86/336.55 ms; query plan and raw measurements retained. Nine-version oversized window transfers zero snapshot payload. Serial local fixture only; container memory includes caches and is not isolated executor allocation.
- [x] Defined the history API migration boundary: summary/detail APIs and bounds are tested in 3A; existing frontend consumer migration and legacy-route deprecation remain explicitly in milestone 4, which depends on this backend. The compatible legacy endpoint still returns full snapshots; this release limitation is not claimed fixed.

| Earlier 3A checkpoint (before final acceptance) | Actual result | Evidence |
| --- | --- | --- |
| Backend build and `npm test` | 164 passed, 0 failed, 1 PostgreSQL-only skip | `data/m3a-backend-final.log` |
| Disposable PostgreSQL/pgvector and Redis integration | 57 passed, 0 failed, 0 skipped | `data/m3a-infra-final.log` |
| Lint | Passed | `data/m3a-lint-final.log` |
| Controlled correction protocol | 7/7 passed; 25 scripted model-stage calls, unchanged from M2 | `data/performance-research-final.log` |
| Offline performance fixture | Conflict-review SQL-result bytes 5,127,377 → 2,641; selected SQLite source 6,636,422 → 82,903; 500k-character chunking p50 92.00 → 0.42 ms | `docs/performance-results.json`; host-load and synthetic-vector limitations documented |

Changed implementation/test files since M2: `src/common/utils.ts`, `src/database/database.service.ts`, `src/database/knowledge-store.ts`, `src/rag/{conflicts,rag.controller,rag.service,source-decisions,verification}.ts`, `src/vector-store/vector-store.service.ts`, `src/tests/{auth,knowledge-lifecycle,rag}.test.ts`, and `scripts/performance-local.mjs`. No frontend, dependency or migration edits in this slice. Source/test manifest: `data/m3a-source-fingerprint.json` (127 files), verified unchanged after final execution. The two owned disposable containers were removed; unrelated containers were not modified.

Final 3A acceptance, 12 November 2026:

| Acceptance check | Actual result | Local evidence |
| --- | --- | --- |
| Backend build and `npm test` | **167 passed, 0 failed, 1 PostgreSQL-only skip** | `data/m3a-accepted-backend.log` |
| Disposable PostgreSQL/pgvector and Redis integration | **60 passed, 0 failed, 0 skipped** | `data/m3a-accepted-infra.log` |
| Lint | Passed | `data/m3a-accepted-lint.log` |
| Controlled correction protocol | **7/7 cases passed**; scripted inference, not live accuracy | `data/m3a-accepted-research.log` |
| Maximum archive window / PostgreSQL query plan | Exactly 8 MiB admitted; oversized window rejected before payload transfer; 8 serial samples passed | `docs/milestone-3a-archive-performance.json` |

Source/test fingerprint: `896be579386264e391e7193662fb5b5170b229a7ebae56b3783df3ce5583fd7d` across 128 files (`data/m3a-accepted-source-fingerprint.json`). The closing slice changed `knowledge-store.ts`, `vector-store.service.ts`, `knowledge-lifecycle.test.ts` and added `scripts/performance-archives.mjs`; no unrelated implementation changes. [MILESTONE_3A_RESULTS.md](MILESTONE_3A_RESULTS.md) maps acceptance cases and limits. No failing 3A acceptance test remains. Full owner-quota/concurrent/soak capacity, live inference, historical binary downloads and lifecycle UI completion are not established. Next: 3B only; 3C and later milestones remain unstarted.

Fix/verify:

- Make archived same-document versions retrievable with immutable version/chunk identity. Current snapshots alone do not supply archived embeddings or a retrieval path.
- Define version selection for current and historical queries, explicit effective periods, supersession and unknown dates. Publication/ingestion time must never stand in for effective time.
- Apply stored source decisions deterministically only to the matching proposition, source versions, scope and metadata revision. Currently decisions enter model payloads while `parseSourceConflicts` still treats model-asserted precedence as untrusted; complete this integration without trusting an LLM preference.
- Distinguish different scopes/periods from real contradictions. Preserve unresolved conflicts and decision history; invalidate stale decisions.
- Paginate version/decision history instead of returning many full document snapshots; define snapshot quotas, deletion semantics and retention explicitly.

Acceptance:

- Current query selects current applicable evidence; a 2024 question retrieves the historical version even after replacement. Missing historical text is reported honestly.
- Same-period/same-scope contradictory sources remain unresolved without explicit precedence; different departments or non-overlapping periods are not falsely resolved as one policy.
- Authorized decision records actor/reason/time; cross-account decision is rejected; concurrent edits conflict; source/metadata changes invalidate the old decision.
- A preference for one disputed fact cannot silently discard unrelated evidence in the other document.

Deliverables: archived retrieval, scoped precedence integration, audit-safe APIs and SQLite/PostgreSQL tests.

### 3B. Separate workers and integrate durable Redis queues

Dependencies: 3A; preserve SQL job/checkpoint logic from milestone 1.

Checkpoint 13 November 2026: **accepted within local controlled boundaries**. [MILESTONE_3B_RESULTS.md](MILESTONE_3B_RESULTS.md) maps tests and limits; [BACKGROUND_WORKERS.md](BACKGROUND_WORKERS.md) documents setup and failure behavior.

- [x] Reproduced API role starting ingestion polling; fixed role boundaries without changing the integrated default.
- [x] Added standalone worker and a thin ID-only BullMQ adapter around existing SQL processors; retained transaction, checkpoint, owner and revision guards.
- [x] Added bounded dispatch, retries, reconnect/startup/shutdown handling, SQL lease renewal and hourly-budget deferral.
- [x] Added real PostgreSQL/Redis and child-process crash/restart tests, including the actual RAG revalidation pipeline with controlled inference.
- [x] Added maximum-text worker/parser resource probes and documented connection/storage bounds.
- [x] Final same-candidate tests passed; 133-file fingerprint unchanged.

Backend/build: **169 passed, 0 failed, 6 infrastructure-only skips** (`data/m3b-final-backend.log`). PostgreSQL/Redis: **67 passed, 0 failed, 0 skipped** (`data/m3b-final-infra.log`). Lint passed; seven controlled correction cases passed; production dependency audit reported zero known vulnerabilities. These checks are local controlled evidence, not live-provider accuracy or cloud acceptance.

Recovery after simulated lease expiry: 67.0/67.1 seconds, without duplicate checkpoint embedding or answer publication. Maximum-text worker RSS 144.2 MiB, parser RSS 56.1 MiB; ID-only payload 45 bytes. Managed Redis, cloud worker availability, multi-instance load and complete correction semantics remain later gates. No test was weakened to assert successful factual repair from transport completion.

Fix/verify:

- Add API/worker role configuration and a standalone worker bootstrap. API accepts work; worker performs ingestion, outbox dispatch/reconciliation and revalidation without an open browser or API process.
- Add a minimal BullMQ adapter using the supported/pinned client API; reuse existing processors. Define stable IDs, queue prefixes, bounded retries, fairness, provider budgets, lease renewal, stalled-job recovery and failed-job inspection/retry.
- Preserve SQL transactional outbox/state so a database commit followed by a Redis failure cannot silently lose work. Do not acknowledge completion before a revision-fenced database commit.
- Separate Redis queue persistence requirements from disposable rate counters. Configure local persistence and `noeviction`; verify managed service persistence, TCP/TLS, connections, scripts, blocking operations and Streams required by the pinned BullMQ version.
- Distinguish fast-failing HTTP producer connections from reconnecting worker connections. Redact credentials; add structured job/request correlation and shutdown handling.

Acceptance:

- With API polling disabled, separate worker completes real ingestion and revalidation; closing browser and restarting API does not stop it.
- Kill worker after checkpoint, after queue delivery and after answer commit but before acknowledgement. Restart resumes safely; no duplicate visible index or correction version.
- Redis disconnect/restart, exhausted provider quota, delayed retries, duplicate deliveries and expired leases produce bounded, observable outcomes. SQL reconciliation recovers undispatched work.
- Two workers cannot commit the same answer/revision twice; stale source snapshots cannot be published. Another account cannot access job payloads or correction logs.
- Run contract tests against local Redis and, later in milestone 6, the selected managed Redis. A successful `PING` is insufficient.

Deliverables: worker entrypoint, queue adapter/configuration, recovery tests, documented job state machine and environment variables. Reuse one backend image unless a second image is demonstrably needed.

### 3C. Complete revalidation and answer-version correctness

Dependencies: 3B.

14 November 2026 checkpoint: **accepted within local controlled backend boundaries**. Four initial regressions and one PostgreSQL row-lock reproduction failed before their fixes. See [MILESTONE_3C_RESULTS.md](MILESTONE_3C_RESULTS.md) for root causes, API/retention contracts and test boundaries.

- [x] Real-pipeline current correction and historical preservation, including saved year/range scope and reference snapshots.
- [x] Latest-assessment baseline; original answer/evidence retained; current evidence citations restored without factual rewriting or another model call.
- [x] New competing evidence schedules 101 answers across bounded pages; duplicate jobs and cross-owner access rejected.
- [x] Source changes, competing workers, expired leases and publishing row locks prevent stale publication.
- [x] Unresolved conflicts, deleted sources and harmful repairs remain explicit assessments; final verification rejects introduced unsupported content.
- [x] Provider cooldowns preserved, failed retries audited, terminal requests return truthful queue status; unchanged results use audit events instead of duplicate versions.
- [x] Owner-scoped paginated revalidation history endpoint, HTTP authorization/input tests and existing worker recovery regressions passed.

Final 3C candidate: backend/build **178 passed, 0 failed, 7 infrastructure-only skips**; PostgreSQL/Redis **77 passed, 0 failed, 0 skipped**; lint and all **7 controlled correction cases** passed. The infrastructure run executes both PostgreSQL-only checks and all worker scenarios omitted from the default run. Inference remains scripted; these results do not establish live factual accuracy or cloud availability.

Changed implementation/test files: `revalidation.service.ts`, `rag.service.ts`, `verification.ts`, `rag.controller.ts`, `auth.test.ts`, new `revalidation.test.ts`, plus both test entrypoints. No dependencies, migration or frontend changes. Manifest: `data/m3c-source-fingerprint.json` (134 files). UI consumers remain milestone 4; no full-app/cloud acceptance is implied.

Fix/verify:

- Exercise the actual RAG pipeline, not just stubbed revalidation results. Preserve original answer/evidence and append revision-fenced versions.
- Ensure new competing documents can schedule affected answers; retain conservative all-answer scheduling initially with bounded pages/budgets. Optimize selective impact analysis only with recall evidence.
- Preserve explicit historical date/year scope and saved reference context. Revalidate current answers using applicable current evidence.
- Rebuild valid inline citations after revalidation; the current removal of old citation markers must not produce a falsely complete corrected answer.
- Avoid pointless versions for duplicate/no-op work; define unchanged revalidation audit events, manual retry responses and retention. Honor provider reset times instead of wasteful repeated retries.

Acceptance:

- Upload v1, save current and historical answers, then upload v2/new competing source. Worker updates the current answer when evidence justifies it and preserves the historically valid answer.
- Original answer and source excerpts remain inspectable; accepted correction has valid passage/version citations and final verification.
- Concurrent v2/v3 changes, duplicate update events, source deletion and failure to verify never overwrite the original or publish stale successful corrections.
- Missing evidence/conflict/provider failure remains visible in job and answer history, not a fabricated success.

Deliverables: passing continuous-correction integration scenarios, version/event API contract and recovery evidence.

## Milestone 4 — Finish existing frontend and backend workflows

Dependencies: 2 and 3C.

17 November 2026: **milestone 4 accepted within controlled local test boundaries**. See [MILESTONE_4_RESULTS.md](MILESTONE_4_RESULTS.md) for reproductions, changes, measurements and exact test boundaries. Nothing pushed or deployed; milestone 5 has not started.

Completed tasks:

- [x] Connect existing source metadata, conflict review, answer versions and background-job controls; preserve layout and honest statuses.
- [x] Migrate visible history consumers to bounded owner-scoped APIs; preserve legacy routes and exact source/version references.
- [x] Apply the existing shared write quota/concurrency admission; verify stale revisions and cross-account denials.
- [x] Cap retained lifecycle/chat history, preserve drafts and in-flight answers, expose newest/older navigation, and cancel obsolete browser polls.
- [x] Measure response representations and repeated-navigation heap behavior; report record bounds and no demonstrated navigation-heap improvement.
- [x] Real frontend/API/PostgreSQL/Redis acceptance with scripted inference: registration/recovery, queued ingestion, citations, review, automatic accepted correction, rejected unsafe repair, immutable history and account isolation.
- [x] Complete final whole-browser rerun and production frontend build/type/lint checks for the frozen candidate.

Final evidence: backend/build **178 passed, 0 failed, 7 infrastructure-only skips**; PostgreSQL/Redis **77 passed, 0 failed, 0 skipped**; real-stack browser **1 passed** (1.3 minutes); full desktop/mobile browser **107 passed, 0 failed, 3 intentional skips** (7.8 minutes). Production frontend build, TypeScript and lint passed. Two browser skips avoid duplicate viewport scenarios; one avoids repeating the desktop-only heap measurement on mobile. Backend/migration hashes remain unchanged since the complete backend/infra runs; the final 124-file implementation/test manifest was checked unchanged on 17 November. Earlier 105-pass and focused runs are superseded by the final whole-browser result. See [LIFECYCLE_WORKFLOWS.md](LIFECYCLE_WORKFLOWS.md) and [milestone-4-ui-measurements.json](milestone-4-ui-measurements.json).

Remaining release issues are separate: LIVE-001/LIVE-002 from the prior live-model assessment remain open; current clean Docker/restore (5), cloud (6), independent evaluation/load/release acceptance (7) remain incomplete. No universal correctness, speedup or bug-free claim.

Fix/verify:

- Connect `SourceMetadataEditor`, `ConflictReview`, `AnswerVersionHistory` and `RevalidationPanel` to Knowledge Base, Conflict Center, chat and Answer Repairs.
- Show backend statuses, source metadata snapshots, stale decisions, latest versus original answer versions, job progress and meaningful retry/error states. Distinguish current metadata from historical evidence metadata.
- Complete version/decision pagination and access checks; add appropriate admission/rate limits to new writes. Keep personal-library ownership distinct from nonexistent shared-workspace administrator roles.
- Preserve chat width/height behavior, professional history navigation, mobile fit, keyboard focus and existing visual identity.
- Make dashboard counts/latency/token usage derive from persisted measured records, with coverage/window labels; never label model confidence as accuracy.
- Audit every visible action. Wire it, explicitly disable it with a reason, or remove it. Document no full-library scan, no OCR and recovery-code-only account recovery.

Acceptance:

- Real browser + real API + disposable PostgreSQL/Redis + deterministic provider: register/recover, upload, see indexing, query, inspect passages, return to history, inspect accepted/rejected repair, edit metadata, review conflict, see automatic corrected version.
- Second account cannot view or mutate any source, archived version, decision, job or answer belonging to the first.
- Browser refresh/reconnect, expired session, failed request and stale revision do not display fake success or duplicate submissions.
- Desktop/mobile viewport, keyboard and focused accessibility checks pass. Existing browser regressions remain green.

Deliverables: integrated current UI, API/browser regression tests, accurate dashboard and workflow documentation. No redesign or simulated production buttons.

## Milestone 5 — Reproducible GitHub local installation with Docker

Dependencies: 4.

17 November 2026: **accepted within controlled local Docker boundaries**. [MILESTONE_5_RESULTS.md](MILESTONE_5_RESULTS.md) maps each requirement to actual execution evidence. Nothing pushed or deployed; milestone 6 has not started.

- [x] Separate API/worker roles, persistent Redis AOF, worker heartbeat, graceful stop and private service ports.
- [x] Clean source-only install outside the checkout with newly generated private configuration; no developer dependencies or data required.
- [x] Real production containers: PDF indexing, citations, conflict review and automatic verified factual correction with preserved facts/history. External inference alone is scripted.
- [x] Whole-stack restart and final image rebuild/recreate preserve data; actual backup restored into a second project and passed read/query/history checks.
- [x] Hard-killed indexing recovers after natural lease expiry (242.4 s), retaining 2 saved passages and completing 12 with no repeated successful embedding inputs.
- [x] Missing key/model, wrong database password, unavailable Redis and textless PDF checks; safe backup/restore refusal checks.
- [x] Portable installation/troubleshooting documentation, secret-free examples, source/history audit, and CI installation job configured locally.

Final checks: backend **180 passed / 7 infrastructure-only skips**; PostgreSQL/Redis **78 passed / 1 dedicated Redis-restart skip**, followed by that separate restart case **1 passed**; Compose/release regressions **5 passed**. All final executed checks have zero failures. Production images and lint passed. Windows host/Linux containers were tested; macOS and remote CI were not. Final source and measured limitations are in the result report. Live-model issues and cloud/release gates remain open.

Fix/verify:

- Extend `compose.yaml` to frontend, API, separate worker, PostgreSQL/pgvector and persistent Redis queues. Add role-appropriate health/readiness/heartbeat checks and graceful stop behavior.
- Reuse existing Dockerfiles/setup helpers. Keep original files, archived text, conversations, answers and authoritative jobs in persistent database volumes; persist Redis queue data and retain SQL recovery.
- Consolidate `.env.example`, generated `.env.docker` and documented defaults. Explain required models, secrets, registration/setup, private ports and SQLite feature differences. Do not ship default credentials.
- Replace machine/account-specific deployment examples (including the `data/tools/render/render.exe` invocation and fixed resource IDs) with portable placeholders. Audit actual runtime/scripts for path assumptions; historical audit paths are not installation dependencies.
- Test clean source export/clone without original `.env`, `data`, `node_modules`, `.next`, private documents or deployment credentials. Preserve lockfile, MIT license and attribution.

Acceptance:

- In a disposable clean environment, documented commands install/build/start all services, initialize migrations, create an account and complete the sample PDF/chat/correction/update flow.
- Stop/restart and rebuild API/worker/web without removing data volumes: downloads, indexes, conversations, versions and correction records remain available.
- Kill indexing mid-document, restart and confirm checkpoint recovery. Restore an actual database backup into a second disposable stack and repeat read/query/version checks.
- Missing key/model, wrong database credentials, unavailable Redis and scanned PDF produce actionable errors. Ordinary deterministic tests require no private API key.
- Record executed Linux-container and Windows host instructions; only claim macOS verification if actually run there.

Deliverables: complete Compose/configuration, `docs/INSTALLATION.md`, local troubleshooting, tested setup/stop/backup/restore commands and clean-install evidence. Update README to match executed commands. Explicitly warn that deleting volumes deletes data.

## Milestone 6 — Vercel, Render, Neon and managed Redis deployment

Dependencies: 5; authorized staging accounts, model quota and an approved resource budget before provisioning paid services. This plan does not authorize spending or publish anything.

### 6A. Prepare production configuration

**17 November checkpoint: configuration prepared locally; milestone 6 NOT accepted.** The missing Render worker was reproduced before editing. `render.yaml` now defines separate API/worker commands, shared runtime settings and referenced secrets, manual releases, API-only pre-deploy migration, disabled runtime migration, bounded shutdown and worker heartbeat path. The root deployment guide now links the canonical [DEPLOYMENT.md](DEPLOYMENT.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md), replacing outdated single-API instructions. No application algorithm, frontend, migration SQL or package dependency changed.

Checks executed: YAML parsed; Render's published Draft 2020-12 schema **passed**; synthetic API and worker environments passed existing production/background validation, shared-setting/migration-owner contracts and invalid-origin/insecure-cookie/REST-queue rejection; source/history audit **passed**; diff whitespace check passed. Account-aware `render blueprints validate` **blocked: HTTP 401 Unauthorized**. No deployment occurred. See [MILESTONE_6_RESULTS.md](MILESTONE_6_RESULTS.md) for evidence and limits.

Remaining 6A/6B: renewed Render login; authorized release/budget; actual Neon migrations/TLS and pooled connection checks; managed Redis compatibility/command measurements; heartbeat alerting/supervision; staging proxy/upload/deadline/forwarded-header tests; resource and connection measurements; cloud restore/rollback and full acceptance. The initial profile deliberately uses a direct Neon URL for both runtime and migration, with a five-connection pool per process. A pooled/least-privilege runtime migration split remains unvalidated. Starter plans in the template are choices requiring budget approval, not capacity certification.

**Latest user sequencing:** finish implementation milestones before broad answer-quality benchmarking. Do not run the proposed new live benchmark now. Keep necessary configuration/regression checks alongside implementation; deferred or inaccessible acceptance checks do not become passes. Milestone 7's full evaluation remains later, and LIVE-001/LIVE-002 stay open.

- Extend `render.yaml` with separate API and worker roles/start commands, environment groups, health/heartbeat handling, resources and graceful shutdown. Do not put queue consumers in a Vercel function.
- Establish a single migration owner/release step. Verify Neon TLS, pgvector extension/version, schema 001–004 plus later migrations, constraints and upgrade checks in an isolated branch/database. Test pooled runtime connections and appropriate migration connections, transaction locks, cold starts and reconnects.
- Use managed Redis with verified durable queue behavior and quotas. Test required scripting, blocking commands, Streams, TLS and client reconnect behavior using the selected BullMQ version. Do not treat an HTTP REST token as a Redis TCP URL.
- Retain database-backed upload bytes and durable archives. Check actual storage usage/limits and restore options. Introduce private object storage only if needed and test versioned originals/download authorization before relying on it.
- Configure Vercel workspace root/build, HTTPS `API_ORIGIN`, same-origin rewrites, exact `APP_ORIGINS`, Secure/HttpOnly cookies, origin protections and trusted proxy hops. Test direct API requests and hostile origins as well as frontend proxy requests.
- Set end-to-end deadlines below actual hosting proxy limits; test upload body limits and timeouts. Long processing must be asynchronous. Do not assume Next's local proxy setting changes Vercel's platform limits.
- Provide structured redacted logs with request/job IDs, truthful health/readiness and worker last-success/heartbeat checks. Keep provider outages separate from database unavailability and liveness.

Deliverables: production API/worker Blueprint, secret-free environment templates, `docs/DEPLOYMENT.md` and `docs/TROUBLESHOOTING.md`. The deployment guide must give exact setup order, required permissions, variable ownership per service, migrations, Redis persistence, backups, costs/limits, rollback and verification commands. Replace or link the older root deployment guide so two conflicting procedures do not remain.

### 6B. Execute cloud acceptance in isolated staging

Acceptance sequence, with real services and synthetic/non-private documents:

1. Register/log in through Vercel; verify cookies, refresh and origin rejection.
2. Upload a PDF; persist original bytes and complete indexing in the Render worker.
3. Ask a question through the frontend; return supported content with exact passage/version citations and inspect verification.
4. Demonstrate a genuine correction using a controlled incorrect draft passed to the real verification/repair path. Keep draft injection in a private test harness, never an unauthenticated production endpoint; also execute normal generation separately.
5. Upload a revised source changing the fact and record its effective metadata/supersession.
6. Close the browser. Confirm the independent worker revalidates the saved current answer, accepts only a verified correction and persists a new version.
7. Reopen the frontend; inspect original and corrected answers, evidence, decision history and worker outcome. Confirm a historical answer remains applicable.
8. Restart/redeploy API and worker; verify documents, original downloads, embeddings, conversations, archived versions and corrections survive.
9. Repeat duplicate-event, interrupted-job, unauthorized access and provider-failure cases in staging without altering real users' data.

Evidence: deployment source revision, redacted environment/configuration fingerprint, service roles, migration/extension versions, timestamps, queue transitions, API responses, source hashes, answer-version IDs, screenshots and pass/fail results. Frontend HTTP 200 alone is not success.

If credentials, quota, budget or service access are unavailable, finish configuration/local contract checks and mark each live check `BLOCKED` or `NOT RUN` with the exact prerequisite. Do not represent historical cloud smoke results as this acceptance run.

### Hosting constraints checked for this plan

- Render background workers are independent continuous processes. Render's free-instance documentation excludes worker service types and warns against production use of free services. **Budget for a paid worker; select suitable always-on API resources for production reliability.** [Render workers](https://render.com/docs/background-workers), [Render free limits](https://render.com/docs/free).
- BullMQ requires appropriate worker/producer connection behavior and Redis persistence/no-eviction settings. Select a version, verify its client requirements and test the actual managed endpoint. [Connections](https://docs.bullmq.io/guide/connections), [Production guidance](https://docs.bullmq.io/guide/going-to-production).
- Upstash documents BullMQ integration, but that does not establish that the existing account's plan, command allowance or durability meets this application's workload. Measure idle and active queue command usage before choosing the plan. [Upstash integration](https://upstash.com/docs/redis/integrations/bullmq).
- Neon documents pgvector support; actual extension permissions, migrations, connection behavior, storage and restore capability still need staging execution. [Neon pgvector](https://neon.com/docs/extensions/pgvector).
- Vercel supports external rewrites; test the actual deployment's forwarding, cookies, request sizes and time budget. [Vercel rewrites](https://vercel.com/docs/routing/rewrites).

No free-tier availability promise or fixed price estimate is made here. Recheck provider plans and limits when provisioning; resource requirements depend on measured workload.

## Milestone 7 — End-to-end reliability, evaluation and release readiness

Dependencies: 1–6 for a cloud release; local release gates can be evaluated after 5 but cloud status must remain separate.

Fix/verify:

- Execute complete unit, SQLite/PostgreSQL/Redis, API, browser, clean-install and real-cloud suites against the same candidate. Make all new suites part of CI; live-provider tests are separately controlled and secret-protected.
- Run the master specification's 15 cases: correct answer, incorrect draft, correct preservation, missing evidence, paraphrase rejection, real conflict, historical retrieval, updated source, preserved historical answer, harmful repair, duplicate event, provider outage, unauthorized access, restart persistence and fresh installation.
- Add real restore drills, bounded concurrency/load and soak tests. Record supported document/chunk volume, queue delay, resource usage, p50/p95 latency, error rate and provider usage. Define release thresholds from a stated deployment workload before running the test, not after seeing results.
- Build an independently reviewed question/evidence set covering numerical, historical, conflicting, document-specific, multi-passage and unanswerable cases. Keep a held-out set and fixed configurations/budgets for no-correction, existing RAC-inspired and completed-pipeline comparisons.
- Measure retrieval recall, supported-claim precision/recall where labels permit, citation support, accepted/false repairs, preservation, abstention, temporal/conflict accuracy, latency, calls and reported tokens/cost. Report missing usage/cost data as unknown. Model self-grading is not the only evaluator.
- Review security boundaries, dependencies, secret/private-file exclusion, session handling, upload abuse, lifecycle write limits and logs. Record limitations instead of claiming security certification.
- Update README, `docs/ARCHITECTURE.md`, `docs/SELF_CORRECTION.md`, `docs/TESTING.md`, readiness/state/bug ledger, license/attribution and contributor guidance. Link installation/deployment/troubleshooting docs rather than duplicating conflicting instructions.

Acceptance:

- Build/lint/type checks and required automated tests pass with explained skips; no unresolved critical/high release blocker in the intended workflows.
- Complete local and cloud flows have actual evidence, including asynchronous correction and restart persistence. Offline mocks cannot substitute for live acceptance.
- Unsupported capabilities and residual risks are visible. No unsupported accuracy, availability, bug-free or faithful-RAC claims.
- Source export/secret audit and fresh-clone verification pass. Publishing/deploying follows the user's later release instruction, not this planning checkpoint.

Deliverables: `docs/RELEASE_READINESS.md` with requirement-by-requirement evidence, reproducible evaluation outputs, test report, operational runbook and release candidate. Unverified gates remain unverified even if the frontend looks complete.

## Implementation discipline and checkpoint format

### Milestone 7 continuation (18 November 2026)

The user explicitly requested milestone 7 while cloud acceptance in 6 remains incomplete. Local release work is underway; this supersedes the previous deferral of the small live correction comparison. Full milestone 7 is **not accepted** merely because local checks pass.

Completed: Next.js advisory patch to 16.4.5; predeclared PostgreSQL short-soak harness/CI step (1,598 operations, zero errors, p95 92.2 ms); clean source-only installation and 180 backend passes; 78 infrastructure passes plus a separate Redis-restart pass; production frontend build, type check and lint; five release-tool tests; seven controlled correction regressions; seven live fixed-draft correction observations and a blank independent-review template; architecture/self-correction/testing/operations guides. The initial browser run encountered Chromium resource errors; six isolated repeats and the final full rerun passed (107 passes, three intentional skips). The real frontend/API/PostgreSQL/Redis lifecycle test passed with scripted inference. See [MILESTONE_7_RESULTS.md](MILESTONE_7_RESULTS.md) for precise evidence, candidate identity and remaining gates. No push/deployment occurred.

Cloud acceptance, independent held-out review, long-duration mixed workload and a patched-candidate Docker rebuild remain unverified. Low C: space prevents safely starting the Docker rebuild; cache removal was blocked by automatic safety review. Do not weaken acceptance thresholds or count deferred gates as passes.

Final audit update: source/history check passed (243 files, 278 objects, no detected findings). Full `npm audit --audit-level=high` FAILED with 13 high findings from the unpatched picomatch GHSA-fc5q-39xc-vjpf in development tooling. Production-only audit passed with zero findings. This supersedes the earlier installation-time zero count. Keep the CI security gate active; do not force dependency downgrades. A compatible patch or reviewed tooling replacement and affected regressions are required before acceptance.

For each slice: read the state ledger, reproduce the specific failure, add a meaningful regression, make the smallest safe change, run affected tests and adjacent contract tests, then update the ledger. Run broader suites at milestone boundaries or when shared infrastructure changes. Preserve existing user data and unrelated edits. Avoid repeated whole-repository audits and speculative features.

Each checkpoint must report: completed behavior; exact changed files; executed commands/results; failure/root cause; remaining blockers; next action. Use source revision/tree fingerprint and dated evidence. Do not silently carry forward older pass counts.

### Milestone 7 continuation (23 November 2026, Asia/Dhaka)

- [x] Reproduced LIVE-001 through real local HTTP using isolated synthetic documents and the configured provider. The draft disclosed missing inference latency; the validator rejected the unfamiliar disclosure, and an unhelpful contract retry repeated it. After that was corrected, a redundant verifier call on an empty fact list invented a claim ID and failed validation.
- [x] Added failing regressions before the fix. Extended the narrow disclosure vocabulary, supplied per-sentence uncertainty eligibility, made rejected-category retry feedback actionable, and removed empty-fact assessment calls for a single source version. Distinct source versions still undergo conflict comparison. Malformed output and attached factual assertions still fail closed.
- [x] Gave valid disclosures one bounded additional retrieval opportunity. Regeneration requires new evidence and a fresh assessment; no extra evidence means abstention, not a fabricated repair. Tests cover both outcomes and preserved source-version citations.
- [x] Full backend/build: **184 passed, 0 failed, 7 infrastructure-only skips** (191 total). Lint passed. Logs: `data/m7-nov23-backend-final.log`, `data/m7-nov23-lint-final.log`.
- [x] LIVE-001's final full-HTTP regression passed: `INSUFFICIENT_EVIDENCE`, two retrieval rounds, two model calls, 2,830 ms. This closes the reproduced disclosure failure, not arbitrary missing-evidence wording or factual reliability generally.
- [ ] LIVE-002 remains reproduced: the model marks “five milliseconds, not five seconds” contradicted by “five milliseconds.” A generation-prompt clarification did not resolve it; final full-HTTP test still returns `PARTIALLY_VERIFIED` and withholds the sampling interval. No prompt-only fix or successful repair is claimed. The injection text was not followed. Next slice must address this evidence/negation/unit failure without accepting unsupported conversions.
- [x] PostgreSQL/Redis integration: **78 passed, 0 failed, 1 dedicated Redis-restart skip**, 79 total, 302.2 seconds (`data/m7-nov23-infra.log`). Worker checkpoint/post-commit crash recovery passed. The separate Redis restart case was not rerun in this slice; its earlier result is historical. Controlled correction protocol: **7/7 passed** (`data/m7-nov23-research-demo.log`). Source audit: 244 files, zero findings (`data/m7-nov23-source-audit.json`); no history or dependency re-audit in this slice.

Sanitized live observations, including failures, are in [milestone-7-live-regressions.json](milestone-7-live-regressions.json). Production code touched in this slice: `src/rag/verification.ts`, `src/rag/atomic-facts.ts`, `src/rag/rag.service.ts`; regressions: `src/tests/atomic-facts.test.ts`. Existing unrelated edits were preserved.

Docker relocation to D: is verified and the 18 November Next.js 16.4.5 API/worker/web image build completed. It predates these RAG changes: final-candidate container workflow/restart/restore remains pending. The earlier disk-space blocker is superseded; Docker build completion is not workflow acceptance. M6 cloud acceptance, the last-known development dependency advisory, independent held-out review and longer mixed-workload testing remain open. Nothing was published or deployed. Do not advance the milestone on the basis of one fixed live case.

**1A, 1B, 2, 3A, 3B, 3C, 4 and 5 are complete within their recorded acceptance boundaries. M7 local validation proceeded at the user's request; M6 and full M7 remain open.** Next: resolve the reproduced LIVE-002 units/negation assessment failure, then rebuild and execute the container workflow/restart/restore on the final candidate. Prepare independent held-out review and longer mixed-workload evaluation. Complete M6 staging acceptance once account access and release/budget authorization are available. GitHub publication, paid provisioning and deployment require explicit authorization. Local scripted inference and the seven-case live observation do not establish general factual accuracy. Nothing was pushed or deployed.
