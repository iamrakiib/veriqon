# Performance and memory evidence

17 November milestone 7 addition: [predeclared workload](RELEASE_WORKLOAD.md) and [raw short-soak results](milestone-7-storage-load.json). Four clients completed 1,598 PostgreSQL retrieval operations against 1,280 synthetic passages with 1,536-dimensional vectors in 60.1 seconds: zero errors, p50 37.9 ms, p95 92.2 ms, Node peak RSS 111,880 KiB, retained heap delta -667,096 bytes after GC. No inference or API/queue throughput measured. This is a distinct workload from the earlier two-dimensional SQLite benchmark below, so it is not a before/after speedup or a memory-leak guarantee.

The [seven-case live correction observation](milestone-7-live-results.json) used 27 model calls and 19,636 reported tokens; case latency p50 11,252 ms/p95 43,450 ms. It excludes initial generation/embedding and independent review. API cost is unknown. Do not combine these times with the storage soak into an end-to-end latency claim.

12 November 2026. Local checkpoint during milestone 3A; not a cloud capacity, live-model quality or leak-free certification. Raw observations: [performance-results.json](performance-results.json). Findings and follow-up priorities: [CODE_QUALITY_AUDIT.md](CODE_QUALITY_AUDIT.md).

## Reproduce

```sh
npm run build
node --expose-gc scripts/performance-local.mjs data/performance-local.json
node dist/scripts/research-evaluate.js
```

The microbenchmark creates only an in-memory SQLite database and synthetic documents. It clears external database/Redis settings, never reads application data and never calls a provider. Five warmups, 40 sequential timed samples per operation; nearest-rank p50/p95. SQL result bytes/query counts are measured in a separate invocation, excluding instrumentation serialization from the timing samples. The SQL byte metric is serialized returned rows, not on-disk IO or wire-protocol bytes. Assertions validate selected records and pagination on every sample. Pool/database cleanup runs in `finally`.

Host: Windows, Node 22.19.0, Ryzen 5 5500U, 12 logical CPUs, 7,931,146,240 bytes physical memory. Fixture: 80 documents of 64,000 characters, 20 stored chunks/document, two-dimensional fixture embeddings, 13 metadata snapshots. Stored chunks intentionally cover only part of each document to isolate transfer costs; this is not representative ingestion or a realistic embedding footprint. One deterministic query-vector call is reused by the query cache. No LLM/GPU required.

Baseline preceded the three performance changes. Intermediate run includes only the conflict-review optimization and coincided with Docker startup. Final run includes all three changes, after correctness/infrastructure tests and disposal of the two test containers. Other host activity was not controlled. Raw intermediate timings are retained; no universal speedup is inferred. Future release benchmarks must isolate load and use realistic embedding dimensions/corpora.

## Measured comparison

Times in milliseconds; these measure local methods, not HTTP or inference latency.

| Operation | Baseline p50 / p95 | Candidate p50 / p95 | Baseline → candidate SQL result bytes |
| --- | ---: | ---: | ---: |
| Conflict review, one two-source conflict | 2.52 / 3.82 | 0.26 / 0.51 | 5,127,377 → 2,641 |
| Named SQLite dense candidates, one selected source | 33.72 / 38.74 | 0.28 / 0.50 | 6,636,422 → 82,903 |
| Chunking 500k characters without newlines | 92.00 / 99.04 | 0.42 / 0.86 | 0 → 0 |
| Four concurrent conflict reads (batch duration) | 15.16 / 23.67 | 0.56 / 0.84 | 20,509,508 → 10,564 |
| Five version summaries | 0.65 / 1.14 | 0.84 / 1.78 | 1,374 → 1,374 |
| Legacy 13 full snapshots | 2.34 / 3.38 | 2.93 / 4.21 | 1,054,112 → 1,054,112 |
| SQL lexical retrieval | 8.17 / 8.76 | 11.12 / 13.19 | 49,835 → 49,835 |
| Full-library hybrid retrieval | 38.55 / 47.03 | 36.63 / 45.30 | 6,639,546 → 6,639,546 |

Conflict review uses three SQL operations instead of five in the no-legacy-hash/no-archive fixture; four concurrent reads use 12 instead of 20. Named retrieval still uses two SQL operations but moves scope filtering into SQL. Approximate returned-byte reductions: 99.95% for conflict review and 98.75% for named candidates. Full-library retrieval transfer did not improve, and several measured timings worsened. Those paths are not claimed as optimized. Host contention is a possible factor, not a demonstrated explanation for every timing difference.

Peak benchmark-process RSS observations: baseline 277,732 KiB; candidate 126,716 KiB. Final candidate heap used: 15,292,368 bytes; external memory 2,831,862 bytes. These are a short isolated harness's process observations, not backend-plus-database or worker peaks. Windows memory accounting, GC and other host load affect them; do not extrapolate a production percentage saving. Individual post-GC heap deltas, including negative deltas, are recorded in JSON. Forty repetitions cannot establish absence of leaks; a long-running soak remains required.

## RAG/provider measurements and unknowns

The existing seven-case controlled correction harness was rerun: **7/7 protocol cases passed, 25 scripted model-stage calls**, matching the milestone 2 call count. Current pipeline durations are 27, 1, 2, 2, 5, 2 and 3 ms (p50 2 ms, p95 27 ms over seven heterogeneous cases). Fixture model-stage durations are predominantly zero; these values measure orchestration overhead, not provider responsiveness. The fixed-draft comparator has no timed generation baseline. This is not evidence of a live RAG speedup.

Two genuine controlled numerical repairs are accepted; two deliberately invalid repairs are rejected. Reported numerical coverage is 8/10 expected facts, with 8/8 returned numerical facts supported by fixture labels. The aggregate repair-success metric is 0.5 because its denominator includes deliberately unsuccessful adversarial cases. These synthetic annotations are not an independently reviewed broad factuality benchmark. No general 100% correctness claim follows.

| Requested metric | Current evidence / remaining requirement |
| --- | --- |
| End-to-end RAG p50/p95 | Controlled seven-case values above; live-provider/HTTP distribution **not measured** |
| Retrieval latency | Local dense/lexical/hybrid matrix above; realistic PostgreSQL concurrency **not measured** |
| Verification/correction latency | Scripted stage records in JSON; live stage latency **unknown** |
| LLM calls/query | Exact stage counts in seven case records, 25 total; no stages removed for optimization |
| Input/output tokens and cost | **Unknown**: fixtures report null, no provider usage billed or fabricated |
| Indexing throughput | Chunking timing measured; embedding/index publication throughput **not measured** |
| Peak backend/worker memory | Harness peak above; serving backend, parser aggregate and separate worker peaks **not measured** |
| Database query performance | SQLite result sizes/counts and method timings measured; PostgreSQL query plans at release scale **not measured** |
| Concurrent request handling | Four concurrent SQLite method calls only; HTTP saturation/fairness **not measured** |
| Continuous revalidation | Existing controlled correctness regressions pass; update latency, jobs avoided/missed and cost **not measured** |
| Retained-memory/leak behavior | Short forced-GC samples recorded; soak/cancellation stress **not run** |

## Complexity and assumptions

Variables: `L` extracted characters, `W` chunk size, `S` minimum forward stride, `C` chunks, `D` documents, `d` embedding dimensions, `T` query terms (at most 24), `K` database candidate depth (normally at most 80), `P` retrieved candidate passages, `F` atomic facts, `E` evidence characters, `A` repair attempts (at most two), `V` archived snapshots, `B` serialized archive bytes, `M` saved answers, `J` queued jobs, `H` bounded cache entries. SQL complexities are conservative algorithmic bounds, not actual query-plan proofs. LLM inference complexity is provider-dependent and is not derivable from client TypeScript.

| Operation / source | Current time bound | Current space and safe follow-up |
| --- | --- | --- |
| PDF/DOCX extraction, `document-parser.ts` | Library/content dependent; no justified universal linear bound for compressed PDF/DOCX | Whole upload plus expanded/parser representations; production child heap 96 MiB, 20s deadline, one parser/process. Measure total RSS/IPC; do not claim streaming. |
| Chunking, `utils.ts` | Before: worst `O(L²/S)` prefix scans on newline-free text. After: `O(L·W/S)` including slices, linear in `L` when the configured overlap/stride ratio is bounded | Output `O(L·W/S)`, temporary search window `O(W)`. Same boundaries/golden hashes. |
| Embedding, `vector-store.service.ts` | Client validation/serialization `O(Cd + L)`; provider latency opaque; nominal `ceil(C/batchSize)` calls excluding retries/checkpoints | `O(Cd + L)` retained; batch requests bounded 1–32; resumed vectors copied. Identical existing chunks skip embeddings. Measure high-dimensional checkpoints. |
| SQLite candidate materialization, `database.service.ts` | Grouping changed `O(DC)` to `O(D+C)` plus decoding `O(Cd)` and legacy hashing; now only scoped documents when selected | Full authorized-library case still `O(L+Cd)`; named case proportional to selected records. Streaming exact candidate selection remains unimplemented. |
| PostgreSQL dense candidates | Exact distance `O(Cd)`; conservative sort/window upper bound `O(C log C)`; top-k plans may use less sort memory | Database executor may scan all scoped chunks; transferred windows bounded by dense+lexical seed depth. Validate real plans before indexes/ANN. |
| SQL lexical fallback | Worst `O(C·T·W + C log C)` for LIKE scoring/ranking; production text-search plan depends on PostgreSQL | Candidate windows bounded; SQL sort/materialization memory not measured. Owner predicates preserved. |
| Hybrid fusion/expansion | `O(Pd + P·T·W + P log P)` plus bounded final-window scans; SQLite `P` can equal library chunks | Ranked copies/maps `O(P)` and candidate payload; final context 18k characters, augmented repair context 24k. Lowercase-per-term duplication is an opportunity, not a claimed fix. |
| Claim decomposition/verification | Strict parsing/quote validation roughly `O(FE)` plus span searches, bounded contracts and one contract retry; provider inference opaque | Batched fact verification avoids one call per claim. Model context bounded, generated results retained for audit. |
| RAC-inspired repair | At most `A` local revisions and final verifications; cross-claim repair checks can be `O(F²)` with string/quote costs | Original/candidate/evidence retained; supported claims preserved. Do not cache verdicts without source/version/scope/prompt identity. |
| Targeted retrieval | At most one additional search per pipeline; uses up to three unresolved claim descriptions | Context capped 24k, evidence dedup includes document version/snapshot. No unrestricted retrieval loop. |
| Conflict review / archive lookup | Referenced version/hash checks replace whole-library text transfer; archive ranking still `O(B + V log V)` conservatively due to JSON parsing/sort | Conflict window bounded 200; archive transfer now checked against 100 versions / 8 MiB before payload loading. The final 3A serial fixture below measures aggregate Node/container memory and the JSON query plan; isolated executor allocation and concurrent capacity remain unknown. Active review filters retrieved identities before the limit and fails explicitly on overflow. |
| Revalidation planning | Conservative `O(M)` candidates and inserts per library revision, pages of 100; actual verification cost depends on jobs executed | Page result payloads plus small durable ID-based jobs; no dependency-only filtering until missed-invalidation tests exist. |
| Scheduling / DB lifecycle | Indexed due-job lookup depends on plan/distribution (`J`); owner/global transaction locks serialize critical sections | Five PG connections/process, bounded attempts, single in-process tick. Separate worker/Redis queue pending; aggregate connection/queue caps need validation. |
| Semantic cache | Current candidate comparison/sort `O(Hd + H log H)` plus question checks | Entry cap/TTL, cloned results; no aggregate byte cap. Keep useful cache until measured byte policy is available. |

## Executed correctness checks at this checkpoint

- Backend build and `npm test`: **164 passed, 0 failed, 1 PostgreSQL-only skip**, 165 total, `data/m3a-backend-final.log`.
- Real disposable PostgreSQL/pgvector and Redis: **57 passed, 0 failed, 0 skipped**, `data/m3a-infra-final.log`; migrations, HTTP auth, lifecycle and retrieval included.
- Lint passed, `data/m3a-lint-final.log`.
- Seven-case offline correction protocol passed, `data/performance-research-final.log` / `data/research-demo-1794503988505.json`.
- Frontend/browser and live cloud tests not rerun; no frontend edits, existing routes retained and additive routes exercised by HTTP tests. Milestone 4 must exercise actual lifecycle consumers.

The preceding results are the earlier 3A checkpoint. No push, deployment, dependency or migration changes.

## Final 3A archive acceptance

[Milestone results](MILESTONE_3A_RESULTS.md) and [raw PostgreSQL observations](milestone-3a-archive-performance.json) record the final maximum-window fixture. Seven archived versions total exactly 8,388,608 serialized bytes; nine versions total 10,612,494 bytes and are rejected before transferring any snapshot payload. Descriptor relationships are capped at 1,000, loaded versions at 100, and payload at 8 MiB; overflows fail explicitly.

Eight serial samples after one warmup: p50 214.86 ms, p95 336.55 ms. Node peak RSS 122,109,952 bytes (116.5 MiB), database-container peak 134,311,936 bytes (128.1 MiB). The broad-window descriptor query took 119.259 ms with existing primary-key indexes and no temporary block I/O. Node measurements include setup; container high-water marks include buffers, tmpfs/cache and prior runs. This is not isolated executor memory or a concurrent/soak capacity result.

Reproduction: `node --expose-gc scripts/performance-archives.mjs data/m3a-archive-performance.json` with the explicitly local disposable PostgreSQL settings in the milestone report. No model calls or private data. Archived supersession uses target/scope set lookups, expected O(D + V) for relationship construction, while SQL JSON processing remains proportional to inspected archive data.

Final correctness: backend/build 167 passed, 0 failed, 1 PostgreSQL-only skip; real PostgreSQL/Redis 60 passed, 0 failed/skipped; lint passed; controlled correction protocol 7/7 passed. Milestone 3A is accepted within these boundaries. Worker resources (3B), frontend legacy-history migration (4), full-quota/concurrent/soak measurements (7) and live-provider behavior remain unverified.

Current source/test manifest: `data/m3a-source-fingerprint.json`, 127 files, SHA-256 `c5d75d9f0eee85ab87cdf26c498a677c7b551d7d122a37f7338db304b0cd891a`, checked unchanged after final tests/benchmarks. Earlier runs are retained in raw JSON, including slower hybrid timing (46.69/80.04 ms) at the preceding optimization checkpoint; the repeated final measurement is 36.63/45.30 ms. This variation reinforces why a single microbenchmark is not a production latency guarantee.

## Milestone 3B worker and parser measurements (13 November 2026)

[MILESTONE_3B_RESULTS.md](MILESTONE_3B_RESULTS.md) records the final candidate, resource results and crash-recovery durations. The probe covers a 500,000-character TXT input with synthetic 1,536-dimensional embeddings, not a live-provider speed comparison. The queue carries only a 45-byte ID payload. Parser memory is measured in its isolated process; worker RSS includes real indexing/persistence.

Declared fixture ceilings: worker RSS below 512 MiB; parser RSS below 256 MiB with a 96 MiB V8 heap cap. These are test gates, not deployment sizing guarantees. Production PDF/DOCX complexity, two-worker peak memory, full owner quota, burst behavior and soak throughput require later capacity testing. Connection snapshots include harness/observer clients and are reported separately from implementation-derived budgets.

## Milestone 4 browser history measurements (16 November 2026)

[Raw observations](milestone-4-ui-measurements.json) compare the same synthetic 120-assessment payload and 16 navigation cycles on this Windows/Edge host, Next development server and one browser worker. These use intercepted HTTP fixtures, not live inference or a database throughput benchmark.

| Observation | Before | Candidate |
| --- | --- | --- |
| Retained answer records after six 20-item pages | 120, growing with every page | 100-record rolling window; older and newest records remain reachable |
| Legacy full array / initial paginated response | 195,153 bytes for the complete array | 32,609 bytes for the initial page (83.29% less initial transfer) |
| Total transfer when explicitly reading all six pages | 195,153-byte array | 195,327 bytes including page envelopes; **not** a total-bandwidth saving |
| Post-GC heap, navigation cycle 4 / 16 | 10,105,168 / 10,440,388 bytes | 10,152,564 / 10,471,776 bytes |
| Post-GC DOM nodes at cycles 4, 8, 12, 16 | 1,109 each | 1,109 each |

Inactive panels released their records before and after. The navigation probe does not demonstrate a meaningful heap improvement or prove leak freedom: final candidate heap is 31,388 bytes higher, and both runs retain modest runtime growth. The confirmed improvement is bounding history while it stays open, not a claim that navigation previously leaked. Production builds, long sessions, larger result bodies and concurrent users need the milestone 7 soak/capacity evaluation.

For H loaded lifecycle records with mean record size S, retained record data changes from O(H*S) to O(min(H,100)*S) per open panel. Each page loads at most 20 records in the UI; independent panels can each retain a window. Conversation state is limited to 40 conversations and 60 messages each. Active chats/drafts are protected; further windows are refused if every slot is protected. Current-chat sending refreshes a full window first. These are record bounds, not a byte-level memory guarantee; source archives and record bodies have separate server limits. No database records are deleted.

New browser regressions reproduce unbounded conversation/assessment growth and an in-flight upload poll surviving unmount. Cancellation now aborts obsolete reads; periodic workspace refreshes cannot overlap. No model call, verification rule, provider-token budget, retrieval score or SQL plan was changed for this UI optimization. Reproduce with `npx playwright test tests/browser/lifecycle.spec.ts tests/browser/history-window.spec.ts --workers=1`; `M4_BENCHMARK_PHASE` changes only the ignored local measurement filename.
