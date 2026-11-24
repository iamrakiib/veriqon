# Milestone 3A acceptance results

12 November 2026. Local, controlled acceptance of archived versions, temporal selection and scoped source decisions. This is not acceptance of the separate worker, lifecycle frontend integration, production load or cloud deployment.

## Final reproduced defect and fix

`data/m3a-supersession-before.log` contains one failing regression: after replacing a superseding document, a historical question returned both the superseded policy and the applicable archived replacement. The retrieval filter inspected only current document metadata. It also compared archived targets against their current department and could miss a supersession relationship outside explicitly selected files.

`historicalSources` now reads small archived version descriptors before payload selection. It uses the latest metadata revision for each content version, includes relevant superseding relationships outside selected sources, and preserves owner filtering. Retrieval combines current and archived relationships by explicit target and normalized scope. Only a relationship applicable throughout the requested interval suppresses a source. A comparison spanning periods retains the earlier policy.

Evidence loading still respects selected document IDs: an outside-scope relationship may disqualify an obsolete source but does not add that source's replacement text to the prompt. Missing evidence remains missing. Retrieving a source's current wording explicitly retains the existing source-inspection behavior.

The descriptor/payload split reuses the existing snapshot SQL and lexical archive path. No embeddings are fabricated, no new model call is needed, and no authority is inferred from title, upload time or LLM preference. Supersession lookup uses a set of target/scope keys instead of repeatedly scanning every pair of versions.

## Acceptance mapping

| Requirement | Executed coverage |
| --- | --- |
| Retrieve a 2024 version after same-ID replacement | Historical/current/range retrieval, distinct snapshot/window identities, unknown dates and cross-account exclusion |
| Apply archived supersession | Historical archived replacement suppresses old current or archived target; selected old file returns no outside-scope text; 2023/2024 comparison retains both periods |
| Respect revised metadata | Latest archived metadata revision wins; withdrawing supersession before replacement retains both competing passages; current Sales scope cannot replace historical Engineering scope |
| Preserve uncertainty and unrelated facts | Same-scope conflicts remain unresolved without a valid decision; explicit disjoint departments/periods are separated; decision-driven three-to-one repair preserves vacation benefit and reverifies the revision |
| Scope and audit decisions | Actor/reason/time, concurrent revision rejection, stale metadata, exact source/version/snapshot matching, conflicting preferences, old decisions behind newer records, cross-account access |
| Immutable versions and bounded access | Historical label reuse rejected transactionally; summary/detail pagination with tied timestamps and malformed cursors; archived data removed with the source; oversized/count overflow rejected explicitly |
| Preserve adjacent behavior | Full backend, PostgreSQL/Redis, HTTP authorization, ingestion resume, cache and controlled repair suites; no frontend contract replacement |

| Acceptance check | Actual result | Local evidence |
| --- | --- | --- |
| Backend build and `npm test` | **167 passed, 0 failed, 1 PostgreSQL-only skip** | `data/m3a-accepted-backend.log` |
| Disposable PostgreSQL/pgvector and Redis integration | **60 passed, 0 failed, 0 skipped** | `data/m3a-accepted-infra.log` |
| Lint | Passed | `data/m3a-accepted-lint.log` |
| Controlled correction protocol | **7/7 cases passed**; scripted inference, not live accuracy | `data/m3a-accepted-research.log` |
| Maximum archive window / PostgreSQL query plan | Exactly 8 MiB admitted; oversized window rejected before payload transfer; 8 serial samples passed | `docs/milestone-3a-archive-performance.json` |

Earlier 3A checkpoints and failed reproduction runs remain available; they are not silently relabeled as final passes. Final source/test manifest: `data/m3a-accepted-source-fingerprint.json`, 128 files, SHA-256 `896be579386264e391e7193662fb5b5170b229a7ebae56b3783df3ce5583fd7d`.

## Maximum admitted archive window

Reproduce against a disposable **local** `veriqon_test` PostgreSQL database:

```powershell
npm run build
$env:TEST_DATABASE_URL='postgresql://veriqon_test:local_test_only@127.0.0.1:55432/veriqon_test'
$env:PERF_DATABASE_CONTAINER='veriqon-m3a-close-postgres'
node --expose-gc scripts/performance-archives.mjs data/m3a-archive-performance.json
```

The credentials above identify only the disposable test database, not an application account. The script refuses nonlocal endpoints or another database name, creates a random isolated schema, and removes that schema in `finally`. It never reads `.env` or calls an inference provider. Container sampling supports cgroup v1 and v2; the initial instrumentation run assumed v2 and failed on this v1 host, then the corrected harness completed. This was a benchmark portability issue, not an application failure.

Raw evidence and real PostgreSQL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`: [milestone-3a-archive-performance.json](milestone-3a-archive-performance.json).

| Measurement | Actual observation |
| --- | --- |
| Corpus | Nine archived versions; 499,900 characters/version; default 800-character chunks, 120 overlap; synthetic text, including multibyte characters |
| Accepted window | Seven versions, exactly **8,388,608 serialized bytes** (8 MiB) |
| Rejected window | Nine versions, **10,612,494 bytes**; **zero snapshot-payload bytes transferred** before rejection |
| Sampling | One warmup, eight serial samples; concurrency 1; zero model calls |
| Full archive-load latency | p50 **214.86 ms**, p95 **336.55 ms** |
| Peak Node process RSS | **122,109,952 bytes**, about 116.5 MiB; below the harness's predeclared 512 MiB local budget |
| Largest sampled Node heap | **38,222,656 bytes** |
| Database-container memory | Current 84,934,656 → 85,704,704 bytes; recorded peak 114,483,200 → **134,311,936 bytes** (about 128.1 MiB) |
| Broad-window descriptor query | **119.259 ms** execution, **0.175 ms** planning; existing owner/document primary-key indexes used; no temporary block reads/writes |
| Sort memory | Small in-memory sorts; exact node-level values retained in JSON |

Node RSS includes fixture preparation/imports. Database cgroup memory includes shared buffers, tmpfs and filesystem cache and retains a high-water mark across runs; it is not isolated query-executor allocation. The plan exposes repeated JSON parsing, which remains a measured scaling consideration. Nine synthetic versions/eight serial samples do not prove performance at the full owner quota, concurrent capacity, or leak freedom. No speculative ANN or migration change was made.

## Supported limits and remaining release work

- At most **1,000 applicable archived descriptors** (including relevant superseders), **100 loaded archived snapshots**, and **8 MiB serialized archive payload per request**. Overflow fails explicitly; evidence is not silently truncated to fit. Owner archive storage remains capped at 200 MiB. Descriptor/count boundaries are covered on both databases.
- At most 200 active decisions matching retrieved source identities. Overflow fails explicitly. Decisions do not grant access to a source and cannot make unsupported rewritten facts verified without the normal final check.
- Summary/detail backend APIs are available. Migrating the existing frontend consumers and deprecating the heavy compatible legacy array routes is explicitly milestone 4 work. That remaining endpoint cost is a release limitation, not a claim that pagination is already used throughout the UI.
- Historical archives contain text, chunks and metadata, not old embeddings or original file binaries. Archive retrieval is lexical. Original-version binary download is not claimed.
- Multi-tenant load, full 200 MiB history scaling, long-running memory/cancellation tests and live-provider latency/cost remain later release gates. Continuous revalidation and independent workers are milestones 3B/3C.

This completion slice changes `knowledge-store.ts`, `vector-store.service.ts`, `knowledge-lifecycle.test.ts`, adds `scripts/performance-archives.mjs`, and updates the plan/performance/state documents. Existing unrelated changes are preserved. No dependencies, migration SQL, frontend layout, hosting configuration, GitHub push or deployment changed.

Final housekeeping: the 128-file source/test fingerprint remained unchanged after all tests; `git diff --check` passed. Only the two owned disposable containers (`veriqon-m3a-close-postgres`, `veriqon-m3a-close-redis`) were removed. Unrelated containers and user data were left intact.
