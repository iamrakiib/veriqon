# Milestone 3C: continuous revalidation and answer versions

14 November 2026. **Milestone 3C accepted within local controlled backend boundaries.** This is not live inference, frontend acceptance, or cloud deployment.

## Confirmed defects and fixes

The first four regressions failed before changes (`data/m3c-before.log`: 0 passed, 4 failed). A separate PostgreSQL contention reproduction failed (`data/m3c-lock-before.log`: 0 passed, 1 failed).

| Defect | Root cause and targeted fix |
| --- | --- |
| A failed manual retry said queued without restarting | The unique owner/message/revision insert did nothing for an existing failed row. Request handling now inspects that row transactionally, resets only failed jobs, preserves their cooldown, and records the previous attempt state in an audit event. Completed jobs return queued=false. |
| Revalidation ignored a previous correction | It always loaded messages.result. It now uses the latest persisted assessment as the factual baseline while retaining the original request context and historical period. The original message/version is never overwritten. |
| Supported sentences lost citation markers | Old passage numbers were stripped before verification, but only edited sentences acquired new citations. A deterministic rendering helper appends references from the new verified evidence to supported sentences and shifts claim offsets accordingly. It changes no factual wording and makes no extra model call. |
| Historical scope could be lost | Only single-date scope was forwarded. Stored date/year/range intervals are now validated and preserved, including ambiguous follow-up wording; current questions recompute current time. |
| Provider reset was replaced by a generic short delay | The pipeline converted provider exceptions into failure assessments without structured retry information. Safe retryability/reset fields now survive that conversion; SQL schedules the later of provider cooldown and exponential backoff. Nonretryable failures stop automatic attempts. |
| Unchanged assessments created pointless versions | Compare persisted factual output, evidence identities, scope and verification outcomes, excluding execution telemetry and transient repair labels. Identical assessments create an unchanged audit event instead of another answer version. This is conservative exact comparison, not an LLM equivalence judgment. |
| A reclaim could race publication | A PostgreSQL claimant read a publication-locked row without locking it. Claims now use FOR UPDATE SKIP LOCKED; final publication holds the job-row lock through the fenced transaction. Revision and lease checks remain in place. |

## Acceptance scenarios

The new `src/tests/revalidation.test.ts` runs against SQLite and PostgreSQL. Only external model inference is scripted in real-pipeline scenarios; retrieval, strict claim contracts, repair, verification, source filtering and persistence use the actual services.

- New policy changes Engineering remote work from three days to one. The current answer is repaired and reverified; twenty vacation days remain supported. A historical 2024 answer retains the old fact and period.
- Every supported factual sentence in the tested final verified answers has a real passage reference. Claim spans match displayed text; referenced citations contain document versions. Original answer and original quoted evidence remain unchanged.
- A saved historical range survives an ambiguous question. Identical real historical assessments create an audit event without a duplicate version.
- Same-scope contradictory sources create a persisted unresolved conflict; no preferred source is invented.
- A repair introduces an unsupported travel-expense claim. Final verification rejects it; the unsafe claim is withheld, the supported benefit remains, and no successful correction is reported.
- Removing a specifically selected source produces explicit source-selection uncertainty while preserving original evidence history.
- Two workers cannot concurrently execute the same job. A revision change or expired lease prevents stale publication. A publishing transaction's row lock prevents reclamation of its job.
- New competing evidence schedules 101 saved answers through bounded pages without duplicate jobs or cross-account scheduling.
- A real verifier-stage 429 with a two-hour Retry-After schedules that cooldown without another model call on the next worker tick or an answer version.
- Manual retry, completed-job response, owner isolation and unchanged-event records are covered. HTTP integration checks history authentication, cross-account 404, bounded pagination, cursor validation and invalid limits.

## Version and event API contract

- `GET /rag/messages/:id/versions`: existing owner-scoped immutable answer assessments, ordered by sequence. Sequence zero is the original. A new assessment may be verified, partially verified, unresolved, or insufficient; the existence of a version is not a successful factual-repair label.
- `POST /rag/messages/:id/revalidate`: returns `{queued, jobId, status, nextAt}`. New work is queued. Active/waiting jobs retain their state and budget. A failed job receives another bounded budget after explicit owner action, with its existing cooldown preserved. A completed/skipped/superseded job is not falsely reported as queued. Disabled revalidation rejects requests.
- `GET /rag/revalidations`: existing owner-scoped latest 100 jobs, including status, attempts, error and next retry time.
- `GET /rag/messages/:id/revalidation-history?limit=20&cursor=...`: new authenticated, owner-scoped audit page. Limit 1–50, default 20, stable timestamp/ID cursor and `nextCursor`. Reuses the existing knowledge-event pager.
- `ANSWER_REVALIDATED`: a new assessment was appended; inspect its verificationStatus before describing it as corrected.
- `ANSWER_REVALIDATED_UNCHANGED`: evidence and factual output are unchanged; records job/revision, assessment status, model usage and duration without another version.
- `REVALIDATION_RETRY`: preserves prior failed attempt count/error/cooldown before the owner requests another budget.

No automatic history purge was introduced. Answer versions and jobs belong to their message and cascade on message deletion. Knowledge audit events remain owner-scoped until owner deletion or a future explicit retention policy. Deleting a source removes that source's archive but does not erase its already saved answer excerpts. Original source binaries are not copied into answer versions. The legacy versions-array endpoint remains compatible; consumer integration/pagination improvements remain milestone 4.

No-op identity comparison excludes current-day timestamps and performance telemetry, but includes citation identities/metadata, historical scope, claim verdicts/quotes and applied decisions. A no-op audit identifies the library revision checked; it does not mutate the historical sourceRevision of an old answer version. Current frontend freshness/history presentation must consume this distinction in milestone 4.

## Test results

| Check | Actual result | Evidence |
| --- | --- | --- |
| npm test, including backend build and HTTP history authorization | 178 passed, 0 failed, 7 infrastructure-only skips | data/m3c-final-backend.log |
| node scripts/test-infra.mjs with disposable PostgreSQL/Redis | 77 passed, 0 failed, 0 skipped | data/m3c-final-infra.log |
| npm run lint | Passed | data/m3c-final-lint.log |
| node dist/scripts/research-evaluate.js | 7/7 controlled protocol cases passed | data/m3c-final-research.log |
| git diff --check | Passed | data/m3c-final-diff-check.log |

Source/test manifest: **134 files**, SHA-256 `930b2408439362bce06418bd722e69c58714c03d8937c8ebb0c6478076bdd695` (data/m3c-source-fingerprint.json). No failing 3C acceptance test remains. Frontend/browser, live-provider and cloud tests were not run in this backend slice.

The worker regression retained exactly two answer versions and made no extra model call after commit-before-ack replay. Recovery after simulated expiry took 71,534 ms and 101,414 ms; these remain within the existing 120-second fixture deadlines, not production recovery SLAs. Its 500,000-character / 774-passage synthetic-vector fixture used 143,220 KiB worker peak RSS and took 17,977 ms; no speedup is claimed from cross-run host timing differences. Existing 3B crash-expiry simulation and workload limitations still apply.

Earlier checkpoints (before final HTTP history assertions): focused SQLite 9 passed; focused PostgreSQL 10 passed; backend 178 passed / 0 failed / 7 skips; infrastructure 77 passed / 0 failed / 0 skips. Initial build attempts exposed TypeScript union-narrowing issues, corrected before execution. One test compared a serialized original with undefined-valued properties in an in-memory object; comparing the actual JSON representation preserves the immutability assertion. These fixture/type issues are separate from the five failing pre-fix application reproductions.

## Scope and remaining gates

Changed production files: `src/rag/revalidation.service.ts`, `src/rag/rag.service.ts`, `src/rag/verification.ts`, `src/rag/rag.controller.ts`. Added `src/tests/revalidation.test.ts`, extended `src/tests/auth.test.ts`, and registered the suite in `package.json` / `scripts/test-infra.mjs`. No dependency, migration, frontend, deployment or model-training changes.

Reuses milestone 3B transport and existing ingestion/retrieval/repair logic. The full infrastructure regression includes standalone workers, Redis restart/disconnection and checkpoint/post-commit crash tests. Continuous-update scenarios invoke the same worker processor with actual databases and scripted inference; they are not browser or live-provider end-to-end tests.

Remaining: milestone 4 frontend integration and status presentation; 5 current Docker installation; 6 real managed-service/cloud acceptance; 7 independent factual evaluation, load/soak/restore tests and operational monitoring. Global hourly revalidation budgets bound attempts, not guaranteed provider token expenditure. Conservative all-answer scheduling can be expensive for large libraries; selective impact analysis needs recall evidence before replacing it. Foreground Redis admission lease-loss cancellation remains a separate release gate. No bug-free, accuracy or production-capacity guarantee is established by these controlled tests. Nothing was pushed or deployed.

Final housekeeping: all 134 manifest files still match the tested candidate (data/m3c-final-fingerprint-check.json). Removed only the two disposable veriqon-m3b test containers after acceptance; unrelated application containers were left running.
