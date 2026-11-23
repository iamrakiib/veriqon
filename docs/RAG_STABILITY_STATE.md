# RAG stability state

Latest release follow-up (23 November): backend/build 186 passed, zero failed; the current full dependency audit reports zero known vulnerabilities after upstream withdrawal of the old picomatch advisory. The v16 verifier prompt and exact millisecond/second exclusion regression are implemented, but LIVE-002 remains unverified: its new live attempt encountered provider unavailability before generation. Conflict history clearing affects display only and preserves active evidence decisions. Current progress is at the top of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md); dated historical gates below are not current audit findings.

23 November 2026: LIVE-001 was reproduced through real HTTP and fixed: valid latency disclosures no longer fail decomposition or trigger invented empty-fact assessments. The final live case returns insufficiency after a second retrieval round; four new regression tests cover disclosure safety, retrieval/regeneration and distinct-version conflict checks. Backend/build: **184 passed, 0 failed, 7 infrastructure-only skips**; lint passed. **LIVE-002 remains failing**: a correct unit contrast is misclassified by the model and withheld. Full milestone 7 remains open. See [MILESTONE_7_RESULTS.md](MILESTONE_7_RESULTS.md) and [live regression observations](milestone-7-live-regressions.json). Nothing pushed or deployed.


## Current checkpoint: milestone 7 local release validation

Final security gate: full dependency audit fails on the unpatched development-tool picomatch advisory (13 transitive high findings). Production-only audit passes. This remains an explicit release blocker; passing behavior tests does not override it.

18 November 2026: the user requested M7 while M6 cloud acceptance remains blocked. Next.js advisory patched to 16.4.5; backend/clean-install, PostgreSQL/Redis, production build and short retrieval soak passed. Seven live fixed-draft correction cases completed; independent review remains pending. Current results and limitations are recorded in [MILESTONE_7_RESULTS.md](MILESTONE_7_RESULTS.md). No push or deployment occurred. LIVE-001/LIVE-002 are not closed by the narrow fixed-draft experiment. Earlier checkpoints below retain their original dates and scope.

Updated 17 November 2026. **Milestones 1A, 1B, 2, 3A, 3B, 3C, 4 and 5 accepted within their documented local controlled boundaries.** No push or deployment.

## Current checkpoint: 6 configuration prepared; cloud acceptance pending

17 November: separate Render API/worker Blueprint, single migration owner and canonical cloud deployment/troubleshooting guides prepared. Published schema and synthetic environment contracts passed. Account-aware validation returned HTTP 401; no resources were created, source pushed or application deployed. Cloud Redis/Neon/proxy/worker monitoring and full staging acceptance remain unverified. Broad answer-quality evaluation is deferred per user direction. See [MILESTONE_6_RESULTS.md](MILESTONE_6_RESULTS.md).

## Retained checkpoint: 5 accepted locally

The five-service Docker stack passed clean source installation, separate-worker processing, original-file/history persistence through restart and rebuild, backup/restore into a separate database, and natural-lease crash recovery. Backend 180 passed/7 infrastructure-only skips; infrastructure 78 passed/1 separate Redis-restart skip, then that restart case passed independently; Compose/release regressions 5 passed; production images/lint passed. Zero final failures. Model HTTP responses remain scripted. See [MILESTONE_5_RESULTS.md](MILESTONE_5_RESULTS.md).

## Retained checkpoint: 4 accepted locally

17 November 2026: integrated lifecycle controls, bounded/paginated history, shared write admission and truthful status/health reporting pass controlled acceptance. Backend: 178 passed, 7 infrastructure-only skips; PostgreSQL/Redis: 77 passed; full browser: 107 passed, 3 intentional skips; real frontend/API/PostgreSQL/Redis workflow: 1 passed with scripted inference. All have zero final failures. Production frontend build, TypeScript and lint passed. Client retention/polling and protected in-flight-answer regressions are included. See [MILESTONE_4_RESULTS.md](MILESTONE_4_RESULTS.md). LIVE-001 and LIVE-002 remain open, and no cloud acceptance is claimed.

## Retained 3C accepted checkpoint

Final 3C candidate: backend/build **178 passed, 0 failed, 7 infrastructure-only skips**; PostgreSQL/Redis **77 passed, 0 failed, 0 skipped**; lint and all **7 controlled correction cases** passed. The infrastructure run executes both PostgreSQL-only checks and all worker scenarios omitted from the default run. Inference remains scripted; these results do not establish live factual accuracy or cloud availability.

[MILESTONE_3C_RESULTS.md](MILESTONE_3C_RESULTS.md) maps actual continuous-correction, citation, scope, conflict, retry and locking evidence. Original records remain immutable; unchanged checks have paginated owner-only audit history. Next is milestone 4 UI integration.

## Retained 3B checkpoint

Backend/build: **169 passed, 0 failed, 6 infrastructure-only skips** (`data/m3b-final-backend.log`). PostgreSQL/Redis: **67 passed, 0 failed, 0 skipped** (`data/m3b-final-infra.log`). Lint passed; seven controlled correction cases passed; production dependency audit reported zero known vulnerabilities. These checks are local controlled evidence, not live-provider accuracy or cloud acceptance.

Separate worker/queue mode reuses the existing processors and passed checkpoint/post-commit crash recovery without duplicate publication. Resource/connection observations and limits are in [MILESTONE_3B_RESULTS.md](MILESTONE_3B_RESULTS.md). Next is 3C: complete revalidation/version/citation semantics. Nothing was pushed or deployed.

## Retained 3A checkpoint

- 3A: added immutable archive references and historical lexical retrieval, replacement metadata fencing, scoped server-side review decisions, summary/detail pagination and owner-scoped history endpoints. Existing API array routes remain compatible; UI migration is milestone 4.
- Performance: reproduced and removed whole-library conflict-review text transfer and SQLite named-query materialization; bounded chunk newline search preserves golden passage layouts. [PERFORMANCE.md](PERFORMANCE.md) and [CODE_QUALITY_AUDIT.md](CODE_QUALITY_AUDIT.md) distinguish measured improvements, slower observations and unknown live metrics.
- Additional 3A regressions reproduced historical version-label reuse, oversized archive payload loading and older decisions hidden behind recent unresolved records. Added transactional historical-label checks, SQL-side 8 MiB archive admission and active decision filtering by retrieved identities before the bounded window. Exact cache hits avoid decision reads; controlled decision-driven repair reverifies one-day policy while preserving vacation benefits.
- Final backend: **167 passed, 0 failed, 1 PostgreSQL-only skip**; infrastructure **60 passed, 0 failed/skipped**; lint passed; seven controlled correction cases passed. Logs: `data/m3a-accepted-*`. Manifest: `data/m3a-accepted-source-fingerprint.json` (128 files). [MILESTONE_3A_RESULTS.md](MILESTONE_3A_RESULTS.md) records exact 8 MiB memory/query-plan observations.
- 3A closure: fixed reproduced archived supersession, latest-metadata and selected-source/historical-scope handling; count/byte bounds pass on both databases. Legacy history consumer migration remains explicitly milestone 4; full-quota/concurrent/soak capacity remains a release gate. Next is worker/queue milestone 3B.

### Retained M2 checkpoint

- M2: Reproduced and fixed qualifier loss during decomposition and malformed repair JSON being mislabeled as missing evidence. Production changes only in `atomic-facts.ts` and `rag.service.ts`; five new tests in `atomic-facts.test.ts`.
- M2: Verified genuine five-to-three correction, preserved supported approval/caveat, exact evidence and final checks. One retrieval/six scripted model calls. Existing seven-case protocol remains 7/7 with 25 scripted model calls before and after; no live performance claim.
- M2: Focused tests 58 passed; full backend/build 153 passed, zero failed, one PostgreSQL-only skip; lint passed. Current HTTP/SQLite integration passed. No schema/UI/queue/API-shape change, so prior PostgreSQL/Redis/browser evidence was not rerun.
- See [MILESTONE_2_RESULTS.md](MILESTONE_2_RESULTS.md) for the status contract, attribution, acceptance mapping and comparison limitations. Live inference and independent factual benchmarking remain unmeasured.

### Retained 1B checkpoint

- Fixed reproduced multi-period retrieval, calendar-boundary, inherited source-inspection and semantic-cache inspection/policy defects with changes in three production files.
- Added retrieval/authorization fixtures, nine cache probes and resumed-versus-uninterrupted indexing comparisons; see [MILESTONE_1B_RESULTS.md](MILESTONE_1B_RESULTS.md).
- Backend: 148 passed, zero failed, one PostgreSQL-only skip; build and lint passed. Final infrastructure: 47 passed, zero failed/skipped. The source/test manifest remained unchanged during this continuation.
- Earlier attempts included a migration-lock timeout (not reproduced in isolation or either resumed full run), paused Docker and a temporary SQLite failure on full C:. Final testing used process-local TEMP/TMP on D:, resolving the disk failure without changing production settings or assertions. The first timeout's cause remains unconfirmed. No production data or deployments were touched.
- Post-test Docker removal/status commands stopped returning; cleanup of `veriqon-m1b-postgres` and `veriqon-m1b-redis` is unverified. Remove only those disposable containers once Docker responds. Other containers and Docker Desktop were left alone.

### Retained 1A baseline work

- Reproduced isolated HTTP regression; unmasked cleanup assertion revealed an outdated conflict-history fixture assumption rather than evidence of lost documents.
- Preserved all persistence assertions; replaced completed-answer overwrite with two independent saved assessments and asserted retained history.
- Included lifecycle tests in default and PostgreSQL test commands, already run by CI.
- Added migration 004 upgrade/concurrency/restart and checksum protection coverage without changing migration SQL.
- Corrected capability disclosure: partial backend support is not a complete workflow or an independent deployed worker.
- Updated capability documentation; no lifecycle feature implementation, UI redesign, provider call, publication or deployment in this slice.

## Verification

Historical 1A acceptance: backend 137 passed/0 failed/1 PostgreSQL-only skip; PostgreSQL/Redis 37 passed/0 failed; browser 86 passed/0 failed/2 intentional skips; production frontend build, type check and lint passed. The initial browser run exhausted local memory; the full rerun passed with Docker stopped and one browser worker. Current M2 and retained 1B results are distinguished in [RELEASE_READINESS.md](RELEASE_READINESS.md) and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Frontend checks were not repeated for backend-only changes.

Local logs use the ignored `data/m1a-*`, `data/m1b-*` and `data/m2-*` prefixes. They contain synthetic test data, not a live-account assessment. Browser regressions use mocked API responses; HTTP/infrastructure tests exercise real Nest services and databases with controlled inference. Do not present them as live cloud or factual-accuracy acceptance.

## Next steps

Milestone 6 (cloud configuration and authorized staging acceptance) is next. Milestone 5 has no remaining failing acceptance test within its documented local scope. Publishing, paid provisioning and deployment are not authorized by this checkpoint. Live-model findings, cloud and independent evaluation work remain incomplete. Monitor the unconfirmed historical timeout if it recurs and maintain free space on C: for normal workstation operation. See [RAG_BUG_LEDGER.md](RAG_BUG_LEDGER.md). Preserve the dirty working tree and existing user data. No push or deployment was performed.
