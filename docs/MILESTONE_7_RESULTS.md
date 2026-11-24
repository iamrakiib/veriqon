# Milestone 7 release validation

## Publication follow-up: 23 November 2026

The user authorized a protected GitHub update and subsequent deployments after checks. Current full dependency audit: zero known vulnerabilities; the previously reported [picomatch advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) was withdrawn upstream. Historical counts below remain dated observations.

Conflict Center dark/light source option contrast and confirmed history clearing are documented in [conflict-history-controls.md](conflict-history-controls.md). Backend/build: 186 passed, zero failed, seven infrastructure-only skips. Eight focused desktop/mobile browser checks passed, as did frontend type check and lint. Source/history audit before this documentation update checked 242 files and 321 Git objects with zero findings.

LIVE-002 now has a reproduced numerical-guard regression (one failure before; focused atomic/reliability suite 63 passed after) and verifier prompt v16. The first live attempt on 23 November failed generation due to provider unavailability and returned source excerpts after 47,477 ms. No factual correction or successful live verification is claimed from that attempt. Broader candidate checks and publication outcomes are tracked in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Continuation: 23 November 2026 (Asia/Dhaka)

This local slice fixes the reproduced LIVE-001 path; full M7 is still incomplete. No deployment or GitHub update occurred. The retained 18 November results below describe the earlier candidate.

The original HTTP reproduction returned a valid disclosure, "The retrieved evidence does not report inference latency in milliseconds." The narrow disclosure recognizer rejected it, and generic retry feedback repeated the failure. Once recognized, the next model call invented an assessment for a zero-length fact list. Both causes are fixed without trusting malformed contracts or exempting arbitrary prose. Unknown disclosures still need factual assessment; compound assertions/instructions cannot use the uncertainty exemption. Distinct document versions still undergo source-conflict comparison.

Valid disclosures now get one additional retrieval attempt. New passages permit generation and fresh verification; no added evidence produces explicit insufficiency. A controlled regression demonstrates new evidence yielding a cited answer with its original version identifier. This is evidence expansion, not a reported factual repair.

| Check | Actual result | Evidence |
| --- | --- | --- |
| Before-fix LIVE-001 regressions | 0 passed / 2 failed as expected | data/m7-live001-regression-before.log |
| Final backend/build | 184 passed / 0 failed / 7 infrastructure-only skips | data/m7-nov23-backend-final.log, 191 total |
| Lint | Passed | data/m7-nov23-lint-final.log |
| Final LIVE-001 real HTTP | Passed, INSUFFICIENT_EVIDENCE, two retrieval rounds, two model calls, 2,830 ms | data/m7-nov23-live-missing-final.log |
| Final LIVE-002 real HTTP | FAILED, PARTIALLY_VERIFIED, 7,165 ms | data/m7-nov23-live-units-final.log |
| PostgreSQL/Redis | 78 passed / 0 failed / 1 dedicated Redis-restart skip, 302.2 s | data/m7-nov23-infra.log |
| Controlled correction protocol | 7/7 passed; scripted inference | data/m7-nov23-research-demo.log |
| Source/private-value audit | 244 files, 11 local private values compared, zero detected findings | data/m7-nov23-source-audit.json; no history/dependency re-audit |

Worker checkpoint/post-commit recovery checks passed. The dedicated Redis restart case was not rerun; earlier restart evidence remains historical. The four implementation/test file hashes are recorded in data/m7-nov23-implementation-fingerprint.json. Frontend/browser and final-image Docker suites were not rerun in this slice.

The units query remains defective: a correct "five milliseconds, not five seconds" contrast is classified CONTRADICTED by the model despite a quote giving five milliseconds. The model proposes no repair. Patient-name privacy remains supported, and the injection string is not followed, but the requested interval is withheld. Generation guidance to state the positive value directly did not resolve this. No general reliability improvement, semantic correctness guarantee, or closed LIVE-002 claim is made. All five current HTTP observations (including intermediate failures) are retained in [milestone-7-live-regressions.json](milestone-7-live-regressions.json). These are synthetic regression fixtures, not independent held-out labels.

Changed application files: src/rag/verification.ts, src/rag/atomic-facts.ts, src/rag/rag.service.ts. Added regressions: src/tests/atomic-facts.test.ts. Four tests cover the disclosure boundary, no-evidence abstention, new-evidence recovery and preserved distinct-version conflict analysis. No frontend, database schema or infrastructure implementation was changed in this slice.

Docker relocation to D: is confirmed. The prior patched Next.js 16.4.5 API/worker/web image build completed on 18 November. Those images do not contain this RAG change; final candidate rebuild/workflow/restart/restore remains pending. Cloud acceptance, the last-known dev-tool dependency advisory, independent review and long mixed-workload soak remain open.

## Retained 18 November candidate results

Updated 18 November 2026. **Local code, browser and infrastructure gates passed; full milestone NOT accepted.** The user explicitly requested milestone 7 while milestone 6 cloud acceptance remains incomplete. Local checks proceed under that instruction; no cloud result is inferred. Nothing was pushed or deployed.

## Changes and confirmed findings

- Dependency audit found moderate advisory GHSA-mfr8-8qww-v76h in Next.js 16.4.4. Updated only Next and its accompanying package artifacts to 16.4.5. No affected `use cache`/`unstable_cache` application path was found; no exploit against this app is claimed. Clean install reports zero known advisories. [Upstream advisory](https://github.com/advisories/GHSA-mfr8-8qww-v76h).
- Added a bounded real PostgreSQL retrieval short-soak command and CI step, with workload/thresholds specified before execution. No production algorithm or service was replaced.
- Added architecture, self-correction, testing and operations guides; updated contributor/security/performance documentation and README links. MIT license and existing attribution retained.
- Final registry audit supersedes the earlier clean-install audit: **13 high dependency findings from one unpatched picomatch advisory**, GHSA-fc5q-39xc-vjpf. Installed paths are `nodemon -> chokidar` and `typescript-eslint -> tinyglobby`; no application import was found. `npm audit --omit=dev --audit-level=high` passed with zero findings. The [upstream advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) lists no patched version. Full CI audit remains failing; do not suppress it or apply the proposed forced downgrade. Production package audit passing does not certify the unrebuilt container. Recheck a compatible upstream fix and rerun lint/watch/build contracts before closing this gate.
- First browser run: 106 passed, one failed, three intentional skips. The failing trace showed two JavaScript chunks rejected by Chromium with `net::ERR_INSUFFICIENT_RESOURCES`, so navigation never appeared. This did not reproduce a retry-button logic defect. Exact host-resource cause remains unconfirmed. The unchanged retry case then passed six isolated desktop/mobile repetitions. CI browser concurrency is now explicitly one; final full rerun remains recorded below.

## Executed evidence

| Gate | Actual result | Evidence / limit |
| --- | --- | --- |
| Backend build/unit/SQLite/HTTP | 180 passed, 0 failed, 7 infrastructure-only skips | `data/m7-backend.log` |
| Clean source export installation + backend | `npm ci` passed; 180 passed, 0 failed, 7 infrastructure-only skips | Export described below; no original private files or parent dependencies |
| PostgreSQL/Redis integration | 78 passed, 0 failed, 1 dedicated restart skip | `data/m7-infra.log`, 325.6 s |
| Dedicated persistent Redis restart | 1 passed, 0 failed, 0 skipped | `data/m7-redis-persistence.log`; owned disposable AOF Redis |
| Production Next 16.4.5 build | Passed | `data/m7-web-build.log` |
| Lint and frontend TypeScript | Passed | `data/m7-lint-final.log`, `data/m7-web-check.log` |
| Compose/export/research-review tooling | 5 passed, 0 failed | `data/m7-release-tools.log` |
| Full dependency audit | FAILED: 13 high findings, one underlying dev-tool advisory | `data/m7-dependency-audit.log`; no safe patched version listed |
| Production dependency audit | Passed, zero known findings | `data/m7-production-audit.log`; excludes development dependencies |
| Source/history/private-value audit | Passed: 243 files, 278 history objects, 11 local private values compared | `data/m7-release-audit.log`; no detected findings, not a security certification |
| Browser full suite | Final: 107 passed, 0 failed, 3 intentional skips | `data/m7-browser-final.log`, 5.5 min; initial failure retained in `data/m7-browser.log` |
| Isolated retry behavior | 6 passed, 0 failed | `data/m7-browser-repro.log` |
| Real-stack lifecycle browser | 1 passed, 0 failed, 1.1 min | `data/m7-lifecycle.log`; real frontend/API/PostgreSQL/Redis, scripted inference; registration, upload, metadata, conflict decisions, automatic correction/history, unsafe-repair rejection and account isolation |
| Scripted correction protocol | 7/7 protocol cases passed | `data/m7-research-demo.log`; adverse paraphrase/new-error outputs withheld, not certified repairs |
| Live correction comparison | Seven completed cases; zero execution/provider failures | [Sanitized observations](milestone-7-live-results.json); fixed drafts/retrieval, no independent review |
| Local retrieval short soak | Passed predefined gates | [Raw report](milestone-7-storage-load.json), [workload](RELEASE_WORKLOAD.md) |
| Fresh Docker rebuild/restore on patched candidate | Not run in M7 yet | M5 tested older image; system drive space prerequisite below |
| Cloud acceptance | Not run | Milestone 6 prerequisites unresolved |

Infrastructure worker observation: 500,000 characters, 774 chunks, 1,536-dimensional fixture vectors, peak worker RSS 146,440 KiB, 11,999 ms, 45-byte ID-only queue payload. Controlled provider, not real embedding throughput. Two-worker checkpoint/post-commit recovery measured 66,710/67,509 ms with **simulated lease expiry**; do not confuse it with M5's natural four-minute lease drill.

Browser skips are intentional viewport exclusions: desktop-only heap observation, desktop-driven tablet coverage, and a desktop-context scroll case that exercises both sizes. They are not failed workflows. Final assertions and timeouts were unchanged; no production retry logic fix is inferred from the resource-related first run.

The short soak used four owners, 80 documents, 1,280 passages and four clients: 1,598 operations, zero errors, p50 37.9 ms/p95 92.2 ms, 111,880 KiB peak Node RSS, post-GC heap delta -667,096 bytes. It is sixty seconds of storage/retrieval, not sustained API/provider/queue capacity or proof of leak freedom.

## Live model observation and limits

The same seven synthetic fixed drafts/evidence sets were compared before correction and with the current RAC-inspired pipeline using `nvidia/nemotron-3-ultra-550b-a55b:free`. This baseline is **uncorrected fixed drafts**, not the previous Veriqon application and not RAC's published model.

The vocabulary-limited numerical scorer measured 6/11 supported numerical mentions in fixed drafts and 11/11 after correction, expected numerical coverage 6/10 versus 10/10, four successful corrections in four designated repair-needed cases, and zero unnecessary repairs in three non-repair cases. Missing evidence produced explicit insufficiency; the correct original remained unchanged. There were 27 model calls and 19,636 reported tokens, case latency p50 11,252 ms/p95 43,450 ms. Cost was not supplied and remains unknown.

All eleven inspected final claim quote references matched their cited passage strings. This is exact-reference integrity, **not independently judged citation entailment**. General factual correctness/precision/recall, semantic citation accuracy and representative retrieval recall remain unmeasured. A successful seven-case run cannot establish 100% accuracy.

`superficial-rewrite` and `new-error-in-repair` inject adverse revisions only in offline mode. Their live runs generated legitimate corrections; those live results do not demonstrate rejection of the forced adverse outputs. Controlled regressions establish that separate behavior.

Raw report: `data/research-live-1794927700558.json`; independent review template: `data/research-live-1794927700558-review.json`. It remains blank/unreviewed. Do not fill reviewer-independence fields on behalf of a reviewer. LIVE-001/LIVE-002 remain open: this fixed-draft comparison is not a reproduction of their original full HTTP questions and evidence paths.

## Candidate and remaining acceptance gates

Clean export `d209850650d93752647e0e70daa8086e7d9ea7ee353b74368c60b0da1baaa7f8` contained 241 source files and installed outside the original checkout at `D:/veriqon-clean-installs/veriqon-release-d209850650d9`. Application code, new load harness and patched dependency lock were present. Subsequent operations/result documentation and one-worker CI selection were added after that export. Final source audit/fingerprint is recorded separately in `data/m7-final-source-fingerprint.json`, with final source-only export metadata in `data/m7-final-export.json`; a source export is not a second installation run. Only disposable M7 test containers and the owned Redis test volume were removed after completion; application data was untouched.

Remaining external/release gates:

0. Resolve the high-severity unpatched development dependency advisory above. Full dependency audit and therefore current CI are not green.
1. Milestone 6 actual Vercel/Render/Neon/managed Redis acceptance, renewed Render authentication, authorized release/budget and monitoring/restore/rollback drills.
2. Independently reviewed representative held-out labels and end-to-end model/retrieval comparison, including the original LIVE-001/LIVE-002 cases. Existing labels are authored synthetic fixtures.
3. Long-duration mixed ingestion/query/revalidation load and soak, realistic semantic recall, API replicas/proxy behavior, per-service resources and workload-specific SLOs.
4. New Docker image rebuild/restore after the Next patch. At the initial checkpoint C: had about 266 MB free; automatic safety review blocked the attempted regenerable npm cache deletion. No cache was deleted. On continuation it had about 1 GB, still below the requested 5 GB build headroom. Fresh Node export checks continued on D:.

A documented command or previous milestone pass is not a new execution result. Full milestone 7 remains open until its required gates have actual evidence.
