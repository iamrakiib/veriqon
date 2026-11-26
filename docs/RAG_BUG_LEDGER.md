# RAG bug ledger

## Usability follow-up (26 November 2026)

- **UI-THEME-001 — fixed:** the dark-theme selector repeated layout tokens with higher specificity than responsive `:root` overrides. Phones used 32 px page gutters in dark mode and 16 px in light mode. Shared layout tokens now have one theme-independent selector; six-route geometry regressions pass at four widths.
- **UI-HISTORY-001 — fixed:** sidebar search inspected only titles while Chat history also searched loaded question text. Both now use the same predicate and loaded history. The sidebar is labelled Recent chats; this does not add full-account search.
- **CHAT-DELETE-001 — implemented and regression-tested:** conversation deletion had no API or interface. Owner-scoped transactional deletion, confirmation menus, error retention, stale-tab tombstones and in-flight completion guards preserve documents/source decisions without resurrecting deleted answers. Exact test results are in the latest implementation-plan checkpoint.
- **LIVE-PROVIDER-001 — blocked:** three synthetic real-provider fact-check attempts on 26 November were rejected with HTTP 401 before decomposition. No factual verdict was produced. Replace the configured OpenRouter key before live evaluation. This is separate from LIVE-002, which remains unverified after its numeric/unit guard change.

The following dated sections retain historical results. Current publication and dependency status are in [release readiness](RELEASE_READINESS.md); historical open advisories or undeployed checkpoints do not override newer evidence.

## Milestone 7 continuation (23 November 2026)

- **LIVE-001: reproduced failure fixed.** The disclosure vocabulary excluded inference latency, and generic retry feedback repeated the rejection. A second defect asked the model to assess zero facts and it invented a claim ID. Explicit uncertainty eligibility, actionable retry feedback, a narrow latency disclosure rule and deterministic empty assessments for a single source version fix this path. Distinct-version conflict checks remain active. Disclosures now receive one bounded evidence expansion. Two initial regressions failed; four added final regressions pass in the 184-pass backend suite. The final real HTTP case passes with `INSUFFICIENT_EVIDENCE`, two retrieval rounds and no repair.
- **LIVE-002: still open/reproduced.** The generator states "five milliseconds, not five seconds"; the model calls it contradicted by "five milliseconds." The repair returns no edit, so the valid interval is withheld. Added generation guidance did not change this outcome. The final live test fails with `PARTIALLY_VERIFIED`. Do not weaken assertions or mark it closed. Preserve exact-unit safeguards and supported privacy content while investigating.
- Docker relocation/build blocker is removed. The built 16.4.5 images predate this RAG fix; final image workflow/restart/restore remains unverified. Other M7/cloud/dependency gates remain open.

[Actual live successes and failures](milestone-7-live-regressions.json); full checkpoint in [MILESTONE_7_RESULTS.md](MILESTONE_7_RESULTS.md). Earlier entries retain their dated scope.

## Milestone 7 findings (18 November 2026)

- **SEC-M7-002 — open release blocker:** final full audit reports 13 high findings caused by picomatch GHSA-fc5q-39xc-vjpf in nodemon/chokidar and typescript-eslint/tinyglobby. Upstream lists no patched version. Production-only audit passes with zero findings; no application import found. CI gate retained. Await a compatible fix or validate a tooling replacement; do not force the suggested breaking downgrade.
- **SEC-M7-001 — patched dependency:** audit identified moderate Next.js advisory GHSA-mfr8-8qww-v76h at 16.4.4. Pinned 16.4.5; clean installation reports zero known advisories and production build passes. No affected cache usage or application exploit was established.
- **TEST-M7-001 — browser resource failure:** initial full suite had 106 passes, one failure and three skips. Chromium rejected JavaScript chunks with `ERR_INSUFFICIENT_RESOURCES`; the navigation never hydrated. Exact resource cause is unconfirmed. Six unchanged isolated repeats passed; final full-suite outcome is in [MILESTONE_7_RESULTS.md](MILESTONE_7_RESULTS.md). No application fix or relaxed assertion is claimed.
- **LIVE-001/LIVE-002 remain open:** seven successful live fixed-draft correction cases do not reproduce the original full HTTP paths. Independent evaluation and original-case reproduction remain required.

Updated 17 November 2026. Scope: completed 1A, 1B, 2, 3A, 3B, 3C, controlled M4 UI/API and M5 local Docker acceptance. Owner for implementation entries: repository maintainer. Status refers to the stated behavior, not the entire product.

| ID | State | Reproduction / root cause | Fix and evidence | Next action |
| --- | --- | --- | --- | --- |
| PERF-001 | Fixed; regression passed | Conflict review loaded every source text; baseline 5.1 MB for one conflict | Read referenced metadata/versions, legacy text only on demand; 2,641 returned SQL-result bytes in controlled fixture | Large-scale database query plans and soak remain |
| PERF-002 | Fixed; regression passed | Named SQLite retrieval loaded all documents/vectors before filtering; grouping repeatedly scanned all chunks | SQL scope in both reads, one-pass grouping and once-per-document fallback hashes; 6,636,422 → 82,903 result bytes | Full-library SQLite retrieval remains materialized |
| PERF-003 | Fixed; golden layouts preserved | Chunking searched an ever-growing prefix for an unusable early newline | Search only the usable window; 500k-character p50 observed 92.00 → 0.30 ms in initial comparison | Preserve golden hashes and resumed-ingestion tests |
| LIFE-001 | Controlled 3A regressions pass | Archived same-ID versions unavailable; dates inherited by changed content; stored preference ineffective (`m3a-before.log`) | Archived snapshot identities, metadata revision fence, source-scoped deterministic review; successful decision-driven repair with final verification | Archived supersession closure covered by LIFE-005 |
| LIFE-002 | Fixed; regression passed | Historical label could identify new text after an intervening version (`m3a-archive-before.log`) | Transaction checks all archived versions before accepting label; rejects without replacing current document | Measure JSON-query cost at release scale |
| LIFE-003 | Transfer guard tested | Archive-count bound allowed multi-megabyte full payloads before resource admission (`m3a-archive-before.log`) | SQL byte preflight rejects above 8 MiB before Node receives snapshots | Exact 8 MiB window measured: Node 116.5 MiB/container 128.1 MiB peak; real query plan retained. Full-quota/concurrent/soak capacity remains |
| LIFE-004 | Fixed; regression passed | 201 newer unresolved records hid an active decision (`m3a-decision-before.log`) | Active status and exact retrieved source identities filter before limit; fail explicitly over 200 matching decisions; cache hits skip read | Historical metadata/precedence tests pass; preserve regression coverage |
| RAC-001 | Fixed and regression-tested | Decomposition retained the original span but dropped “may”, “at most” or “only” from the fact sent for verification; `data/m2-before.log` | Retain recognized qualifiers verbatim and reject invented qualifiers; one existing contract retry then technical failure. New unit and real-orchestration regressions pass | English lexical guard is not general semantic equivalence; independent model evaluation remains |
| RAC-002 | Fixed and regression-tested | Malformed correction JSON and valid no-edit proposals both returned null and became `insufficient_context`; `data/m2-before.log` | Inspect runtime shape separately from grounded-edit acceptance. Malformed output gives `verification_failed`; empty or unsupported proposals remain rejected attempts. Original supported content retained | Full backend: 153 passes/1 PG skip; seven-case protocol unchanged |
| RETR-001 | Fixed; focused tests pass on both databases | Explicit multiple years defaulted to today or retained only the first period; `data/m1b-before.log` | Parse/deduplicate requested periods into an enclosing interval; retain metadata and test actual historical/current retrieval | Full 1B infrastructure gate passed: 47 tests |
| RETR-002 | Fixed; calendar regression passes | Advancing year 9999 produced a malformed truncated ISO date | Reject unsupported date bounds; test leap days and exclusive-end calculation | Keep supported date range documented |
| RETR-003 | Fixed; pipeline regression passes on both databases | File focus inherited from history was mistaken for explicit inspection, bypassing effective dates; direct fix initially missed expanded-history text (`data/m1b-expanded-before.log`) | Original current question controls source inspection for initial and targeted retrieval | Archived same-ID historical retrieval remains separate work |
| RETR-004 | Fixed; cache regression passes on both databases | Semantic cache could reuse expired-source inspection as a policy answer (`data/m1b-cache-before.log`) | Cache namespace distinguishes inspection/policy intent, even when equivalence returns true | Cache remains process-local |
| INFRA-001 | Not reproduced on subsequent runs; monitor | First 1B infrastructure run: PostgreSQL statement timeout at concurrent migration advisory lock; 46 passes/1 failure | Isolated retry and both resumed full runs passed the migration checks. Final full suite: 47 passed. Cause unconfirmed; no lock/timeout fix claimed | Diagnose if it recurs; retained observation does not certify behavior under untested startup load |
| ENV-001 | Test execution unblocked; workstation disk issue remains | Resumed suite: 46 passed/1 failed; temporary SQLite initialization reported `database or disk is full`; C: measured zero free bytes | Process-local TEMP/TMP moved to workspace scratch on D:; identical full suite passed 47/47 (`data/m1b-infra-accepted.log`). No test weakening or user-file deletion | Free C: space separately; local test workaround is not a production storage remedy |
| BASE-001 | Fixed and verified | Isolated HTTP test failed in `finally` because it checked documents/history not yet created after an earlier failure. `data/m1a-auth-before.log` | Moved persistence assertions into the successful test body, retaining all checks. `data/m1a-auth-unmasked.log` exposed the real `2 !== 1` failure | SQLite and PostgreSQL HTTP tests now pass |
| BASE-002 | Fixed and verified | HTTP fixture overwrote a completed conflict assessment and expected its earlier persistent audit record to disappear | Use distinct saved answers; assert both conflicts, source-comparison reason, original version retention and cross-account isolation. No production history deletion | Both database suites pass |
| BASE-003 | Fixed and verified | New lifecycle tests were absent from both standard test entrypoints | Added `knowledge-lifecycle.test.js` to `npm test` and `test-infra.mjs`; existing CI invokes both | All five pass in both databases |
| BASE-004 | Fixed and verified; updated in M4 | Health advertised complete workflows before UI/integration existed (`data/m1a-health-before.log`) | Initially disabled complete-workflow flags; M4 now reports tested local integration separately from unverified live/cloud behavior and actual scheduler configuration | Final backend/infrastructure suites pass; see UI-006 |
| BASE-005 | Coverage added and verified | No explicit populated schema-003 upgrade assertion for migration 004 | Added upgrade, concurrent startup, repeat startup, original bytes/answer retention, metadata/version writes, reopen and checksum protection checks. No migration edited | Disposable PostgreSQL suite: 37 passed |
| LIFE-005 | Fixed; regression passed on both databases | Historical query retained an obsolete policy because superseding version was archived; `data/m3a-supersession-before.log`: 0 passed/1 failed | Descriptor/payload split, current and historical target/scope relationships, latest metadata revision; no outside-focus evidence injection | Full backend 167 passes/1 PG skip; infrastructure 60 passes; controlled scope is not universal temporal proof |
| UI-001 | Fixed; M4 controlled acceptance passed | Lifecycle controls and history summary/detail consumers were not fully wired into normal UI | Connected existing controls and migrated visible consumers to bounded APIs; full browser and real-stack acceptance passed | Legacy array routes remain compatible but are not used by the new UI; live/cloud gates remain |
| WORKER-001 | Worker transport and correction backend locally verified in 3B/3C | API role reproduced starting ingestion poller; separate process/queue mode was absent | Role gates plus thin BullMQ adapter around existing SQL processors; final infrastructure 67/67, backend 169 passes/6 infrastructure skips | 3C accepted: citation/version/scope/retry and PostgreSQL lock tests pass; UI, deployment and load gates later |

Worker, correction backend and UI integration are accepted locally within documented controlled tests; live release gates remain open. Existing provider quotas, exact search, process-local caching and lack of an independent factual benchmark remain documented limitations, not regressions newly discovered here.

3B final evidence: [MILESTONE_3B_RESULTS.md](MILESTONE_3B_RESULTS.md). Early crash tests exceeded 65/95-second deadlines; final and prior full runs pass with a 120-second per-recovery deadline, measuring 67-97 seconds after simulated expiry. No production latency guarantee or fix is inferred from a longer test deadline. API admission lease-loss cancellation and boundary-burst/load tests remain system-design release gates.

## Milestone 3C fixes

| ID | Confirmed issue | Fix / regression evidence |
| --- | --- | --- |
| REVAL-001 | Failed retry insert did nothing but reported queued | Transactional status-aware retry, cooldown preserved, prior failure audit; completed reply queued=false |
| REVAL-002 | Always checked the original answer and forwarded only date scope | Latest assessment baseline; original request context and validated date/year/range retained |
| REVAL-003 | Unchanged supported sentences lost inline citations | Verified-index rendering with shifted spans; no factual rewrite or extra inference |
| REVAL-004 | Provider reset lost when exceptions became failed assessments | Safe retry metadata propagated to SQL next_at; two-hour quota fixture spends no premature retry |
| REVAL-005 | Every successful assessment appended a version | Exact factual/evidence comparison; unchanged audit with revision and telemetry |
| REVAL-006 | PostgreSQL claimant read a publication-locked row | Reproduced blocked stale read; claim SKIP LOCKED and publication FOR UPDATE |

Four initial tests and the separate PostgreSQL lock reproduction failed before fixes. Final backend 178 passes/7 infrastructure skips; infrastructure 77 passes; lint and 7 protocol cases passed. [MILESTONE_3C_RESULTS.md](MILESTONE_3C_RESULTS.md) records scope, immutable history, API tests and remaining gates.


## Milestone 4 integration checkpoint (16 November 2026)

- UI-001: lifecycle controls existed but were unreachable. Connected current source metadata/version history, answer versions/audit, conflict review and job status to existing screens.
- UI-002: recheck always claimed scheduling. Render queued/status/nextAt from the actual response, including completed/no-new-job.
- UI-003: resolved conflict retained a hard-coded unresolved detail label. Reproduced by browser review regression; detail now reflects status/staleness.
- LIVE-001 (OPEN): missing-evidence live fixture returned VERIFICATION_FAILED instead of an explicit insufficiency result.
- LIVE-002 (OPEN): units/injection live fixture withheld a supported interval; injection itself was not followed.

See MILESTONE_4_RESULTS.md for validation boundaries. UI integration does not resolve the open live-model findings.


### Milestone 4 continuation (16 November 2026)

- UI-004: new answer-version pages returned 404 before implementation. Added bounded owner-scoped pages ordered by immutable sequence and migrated the visible consumer; same-timestamp page traversal, malformed cursor, foreign owner and 1-50 limit assertions pass.
- UI-005: 21st lifecycle write bypassed the shared account quota. Metadata/review/recheck now use the existing work admission path; default and PostgreSQL HTTP tests pass.
- UI-006: health metadata still denied already implemented archived retrieval/UI integration. Reproduced stale capability contract, then corrected implementation fields while leaving cloud/live-provider validation explicitly unverified.
- INFRA-002: one paused-Redis check failed (76/77); original isolated test passed. Exact initial scheduling/clock cause is unconfirmed. The test now holds a 30-second pause until explicit cleanup rather than a six-second pause near the five-second deadline; protected-work and <5.9-second assertions retained. Final full infrastructure run: 77/77. This is fixture hardening, not a claimed production limiter fix.
- Combined real frontend/API/PostgreSQL/Redis scenario passes with scripted inference: source updates, review, automatic correction, immutable history, harmful repair rejection, cross-account denial and recovery/session revocation. See [MILESTONE_4_RESULTS.md](MILESTONE_4_RESULTS.md); final whole-browser gate also passed.
- UI-007: pagination bounded individual responses but accumulated every page in browser state. Reproduced 120 retained assessments and 60 conversations. Rolling history windows preserve drafts, current/latest labels and navigation back to newest records; full-window refresh failures do not submit or lose a question. Final desktop/mobile regressions pass.
- UI-008: leaving the library left its current upload-progress request running. Reproduced by a delayed read; cleanup now aborts it. Also cancel superseded workspace reads, serialize quiet polls and bound remembered completion IDs. The server's durable jobs are unaffected.
- UI-009: the new retention candidate could evict an in-flight answer after navigation to another chat. Caught before acceptance by `data/m4-inflight-before.log`; protect conversations containing a pending message. All six desktop/mobile window tests pass after the fix; final combined regressions include the case.

17 November closure: M4 backend 178 passed/7 infrastructure-only skips; PostgreSQL/Redis 77 passed; browser 107 passed/3 intentional skips; real-stack 1 passed; production frontend build, TypeScript and lint passed. Zero final test failures. LIVE-001/LIVE-002 remain open; local controlled acceptance does not resolve them or establish cloud/release readiness.

## Milestone 5 closure (17 November 2026)

- DOCKER-001: the Compose contract test failed because no independent worker was defined. Reused existing worker entrypoint/queue processors, assigned API and worker roles, persisted Redis AOF and supplied a distinct worker healthcheck. Final container workflow and configuration regression pass.
- DOCKER-002: container images only provided API HTTP readiness, which cannot probe a worker without an HTTP listener. Added optional private heartbeat after successful reconciliation, with age/PID validation and shutdown cleanup. Unit and production-container health/error tests pass; cloud supervision remains separate.
- DOCKER-003: active deployment instructions depended on a private Render executable path and account-specific resource IDs. Replaced active examples with portable placeholders; linked tested local installation/backup/restore steps. Historical release evidence is retained as historical.

Actual hard-kill recovery took 242.4 seconds for a four-minute SQL lease, with 12/12 successful embedding inputs and no repeated checkpoints. This is measured recovery, not an instant failover claim. Backup and second-project restore passed; existing backup/nonempty-target guards passed. Final backend 180, infrastructure 78 plus separately executed Redis restart 1, and Compose/release regressions 5 passed. LIVE-001/LIVE-002 remain open. See [MILESTONE_5_RESULTS.md](MILESTONE_5_RESULTS.md); no cloud or live-model repair improvement is inferred.
