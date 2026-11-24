# Veriqon release priorities and first hardening batch

11 November 2026. Local implementation and tests only. No GitHub push or hosted deployment.

## Release decision

Keep the application in a controlled pilot until the release gates below have evidence. A passing regression suite is not a guarantee of bug-free operation, factual truth, or capacity under production traffic. Provider quotas remain external constraints; the application is responsible for bounded retries, saved progress, useful fallback behavior, and honest statuses.

## Ordered work

| Priority | Area | Required release evidence | Status |
| --- | --- | --- | --- |
| P0 | Uploads and recovery | Large files, restart/lease recovery, cancellation, concurrent workers, idempotent publication, quota recovery | Concrete defects fixed in this batch; full real-provider large-PDF trial still needed |
| P0 | Retrieval and answer correctness | Independently annotated real-document questions; relevant evidence, citations, abstention, numerical/table questions, source comparisons | Bounded outage retrieval fixed; independent factuality benchmark remains open |
| P0 | Repair integrity | Correct wrong facts, preserve valid claims, reject superficial rewrites/new errors, final verification | Existing adversarial regressions retained; live-model repair success is not established by fixtures |
| P0 | Security and operations | Account isolation, secure configuration, restored backups, failure alerts, dependency review, sustained load | Isolation/recovery regression coverage exists; production restore/load/monitoring gates remain open |
| P1 | Temporal validity and conflict decisions | Explicit effective periods, source authority/supersession, authorized review and append-only decision history | Incomplete; do not infer precedence from upload time or model preference |
| P1 | Continuous correction | New competing evidence triggers idempotent revalidation; immutable answer revisions and historical validity | Incomplete |
| P2 | Scale and cost | Measured retrieval/query latency and provider usage; ANN/shared cache changes justified by workload | Exact dense search and process-local answer cache remain limitations |
| P2 | Account lifecycle | Secure email recovery, verification and appropriate session/MFA controls | Recovery codes work; email recovery not configured |

## Confirmed defects fixed

1. **Changed chunk profiles could falsely report successful reindexing.** The durable job fingerprint included chunk size/overlap, but the indexer's duplicate check did not compare stored passage boundaries. It could return immediately with the old chunks. Reuse now requires the exact expected chunk indexes and contents. Identical uploads still avoid provider work and revision changes; a real profile change rebuilds and publishes one replacement revision.
2. **A scheduling yield retained an obsolete failure streak.** Successful checkpoints followed by a normal worker yield could leave earlier failures counted against subsequent work. The yield now resets the streak when progress was saved, and retains it when no progress occurred.
3. **Progress was not durable in retry accounting.** A worker that saved vectors on its last allowed attempt and then lost its lease could be marked exhausted by its replacement. The checkpoint transaction now persists the retry reset together with the vectors. A stale worker still cannot publish or overwrite the replacement's state.
4. **Successful progress retained a stale exponential delay.** A productive turn could still schedule its next attempt using the previous six-attempt count, producing a 16-minute base delay. The delay now uses the reset failure streak while respecting provider reset times.
5. **Normal shutdown looked like provider failure.** Aborting an upload during normal shutdown went through timeout/error handling. It now releases the owned lease back to the queue without consuming an attempt or showing a provider error. In-flight, uncommitted work may have to be retried; committed checkpoints are retained. Both progress/no-progress cases are covered. The full Nest application shutdown path was checked and passed; no separate lifecycle rewrite was needed.
6. **Outage retrieval loaded the complete account library and vectors.** The lexical fallback previously deserialized every vector and full document before filtering. It now selects bounded lexical seed windows in SQL, filters by owner and requested sources, and returns passage text without embeddings/original-file payloads. Multi-source comparisons reserve candidates per selected document. At most 80 seed windows are requested, each expanding to up to five adjacent passages; final context still has its existing size limit. This bounds returned data, not database scan cost, and is not ANN search.

## Compatibility boundaries

- No API route, authentication rule, model, API key, document identifier, or frontend layout was changed.
- No database migration or user-document rewrite is required. Previously indexed documents remain searchable. Re-upload under a changed chunk profile invokes the corrected indexing path.
- Lexical fallback remains marked `lexical_fallback`, with no invented semantic score. It does not establish factual support. Empty unscoped lexical matches preserve the provider error instead of supplying unrelated sources.
- Repair, conflict, source-selection, cache, and authorization regressions are included in the backend suite. Existing source-excerpt disclosures and upload/history flows are covered by browser regressions.
- Test providers are synthetic and confined to tests. These runs do not measure real-model factual accuracy, token savings, or provider availability.

## Validation record

Initial backend baseline: 124 passed, one PostgreSQL-only skip. New regressions reproduced the stale chunk profile, retry-yield, shutdown, crash-recovery and unbounded fallback defects before the corresponding fixes. The original failing logs are retained locally under `data/manager-*-before.log` and `data/manager-reproduced-defects.log`.

| Check | Actual result |
| --- | --- |
| Final backend unit/HTTP/regression suite | 132 passed, zero failed, one PostgreSQL-only skip |
| Disposable PostgreSQL/pgvector/Redis integration suite | 29 passed, zero failed; includes changed-profile indexing, bounded lexical fallback, crash recovery and cross-owner isolation |
| Desktop/mobile browser suite | 86 passed, zero failed, two intentional viewport skips |
| Updated localhost API security/readiness checks | 25 passed |
| Small authenticated read burst | 40/40 successful, concurrency five, p50 28 ms, p95 46 ms; not a capacity benchmark |
| Existing synthetic workspace UI check | Passed, zero runtime errors; inspected persisted history, conflicts, corrections and analytics, no new model calls |
| Backend TypeScript build, frontend typecheck, lint | Passed |
| Dependency audit | `npm audit --audit-level=high`: zero known vulnerabilities reported at execution time |

The full application-shutdown and reset-backoff regressions were added after the 29-test infrastructure run and passed in the final local backend suite. They are not counted as PostgreSQL test results. The initial localhost readiness probe ran before startup completed; subsequent API checks passed after readiness. No optimized frontend build was repeated because no frontend source changed in this batch.

The local API was restarted with the updated code after checking there were no active upload jobs or recent pending answers. No user documents were edited or deleted. Disposable infrastructure containers and their own volumes were removed and Docker was returned to its original stopped state. Logs remain ignored local artifacts under `data/manager-*`; browser artifacts are under `test-results/`.

### Files changed in this batch

- `src/rag/ingestion.service.ts`: durable retry resets, normal shutdown/yield handling, backoff calculation.
- `src/vector-store/vector-store.service.ts`: exact passage-layout reuse check and bounded lexical fallback integration.
- `src/database/database.service.ts`: owner/source-scoped lexical candidate windows without vector payloads.
- `src/common/utils.ts`: shared bounded lexical term extraction.
- `src/tests/ingestion.test.ts`: eight additional regressions for these paths; existing restart assertion updated to the corrected consecutive-attempt semantics.
- `README.md`, `docs/production-review.md`, this document: current release priorities and validation evidence.

Other pre-existing working-tree changes were preserved. Nothing was pushed or deployed.
