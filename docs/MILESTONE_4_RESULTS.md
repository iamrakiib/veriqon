# Milestone 4: frontend and backend lifecycle integration

17 November 2026. Accepted within the controlled local boundaries below. Milestone 5 has not started. Nothing pushed or deployed.

## Confirmed gaps and minimal fixes

- Existing source metadata, conflict review, answer-version and background-job controls were unreachable. Connected them to the existing screens without redesigning chat dimensions or navigation.
- Recheck always claimed a new job was scheduled. UI now uses the actual queued/status/retry response. Conflict detail also follows resolved/stale backend status instead of retaining an unresolved label.
- History consumers used full legacy arrays. Source/decision histories now use bounded pages and archived text loads on demand. Added newest-first, owner-scoped answer-version pages (1-50, default 20) with sequence/answer-bound cursors; same-timestamp versions cannot be skipped. Legacy routes remain compatible but are not used by the new UI.
- Metadata updates, conflict decisions and recheck writes bypassed work admission. They now reuse the existing per-account 20-operations/minute quota and concurrency lease, shared with queries. No new limiter algorithm or dependency.
- Health still reported absent UI integration and archived retrieval after those workflows were implemented. It now distinguishes implemented local capabilities, configured scheduling, controlled local workflow validation and unverified live-provider/cloud acceptance. No truth or availability guarantee is implied.
- Added small spacing/wrapping adjustments in lifecycle forms and version evidence links, preserving existing chat width/height.
- Reproduced unbounded client history accumulation: six answer-history pages retained 120 records and three conversation pages retained 60. Added rolling windows of 100 lifecycle records, 40 conversations and 60 messages, with newest-page navigation, protected drafts and an independently retained latest-assessment sequence. Current-window refresh failures preserve the question and spend no query call.
- Reproduced an upload read surviving library unmount. Abort that request on cleanup; bound the completed-job ID set to the latest job list. Workspace refreshes now serialize quiet polls, abort obsolete requests and skip periodic reads while hidden.

Before-fix evidence: `data/m4-before.log`, `data/m4-chat-before.log` (unreachable UI); `data/m4-api-before.log` (new bounded route returned 404); `data/m4-rate-before.log` (21st lifecycle write returned 404 instead of shared quota 429); `data/m4-health-before.log` (outdated capability flags). These tests failed before their corresponding fixes.

Additional before-fix evidence: `data/m4-retention-before.log` (120 retained versus a 100-record window; uncancelled upload poll), `data/m4-chat-window-before.log` (60 conversations versus a 40-record window). Window/cancellation checks pass in the final whole-browser suite. Navigation memory/response observations are reported separately from factual correctness.

Concurrency review caught a regression in the new eviction logic before acceptance: navigating to another chat could evict the conversation still awaiting its answer. `data/m4-inflight-before.log` reproduces the missing conversation. Protect in-flight messages as well as active chats/drafts; all six desktop/mobile history-window regressions pass (`data/m4-inflight-after.log`). The final expanded suite includes this case.

## Combined-stack acceptance

`npm run test:lifecycle` uses actual Next.js, NestJS, disposable PostgreSQL/pgvector, Redis, ingestion, verification/repair orchestration and automatic SQL revalidation timers. Only model/embedding responses are scripted. No route mocking, direct answer insertion or manually invoked scheduler ticks. Fixture bootstrap is test-only and is not imported by production.

The browser scenario covers:

- Register, acknowledge recovery codes, upload synthetic TXT policies and await real indexing.
- Save metadata, reject a stale concurrent edit, reload the authoritative revision and inspect document history.
- Ask a supported question, inspect exact source passages, return to chat history and reopen the conversation.
- Upload competing evidence; observe an automatically persisted unresolved-conflict assessment.
- Record an explicit review; automatically correct three remote days to one, preserve the supported vacation benefit, retain valid source/version citations and immutable original answer.
- Reload and inspect correction history; introduce an unsupported travel-expense claim in a scripted repair and verify that it is withheld, not published as repaired.
- Reject another account's reads/writes for documents, archives, answers, decisions and jobs.
- Recover using the actual UI in another browser session; old session becomes unauthorized, then signing in with the new password restores persisted history.

This is controlled functional acceptance, not live LLM accuracy, PDF extraction acceptance, independent-worker/cloud deployment or a performance benchmark. Worker transport/crash/restart is covered by the separate infrastructure suite. Live inference uses neither the scripted token counts nor these assertions as an accuracy/cost measure.

## Actual test results

- Backend/build: **178 passed, 0 failed, 7 infrastructure-only skips**; `data/m4-backend-final.log`.
- Final real-stack browser rerun: **1 passed, 0 failed** in 1.3 minutes; `data/m4-real-stack-accepted.log`. It includes the final retention/polling changes and an explicit unsupported-claim verdict after the harmful repair. Earlier pre-retention expanded run: 1 pass in 57.1 seconds (`data/m4-real-stack-final.log`).
- Frontend TypeScript and ESLint passed; `data/m4-types-final.log`, `data/m4-lint-confirmed.log`.
- Full PostgreSQL/Redis rerun: **77 passed, 0 failed, 0 skipped**; `data/m4-infra-final.log` (305.9 seconds). Includes two worker processes, interrupted indexing, Redis restart and post-commit replay without duplicate publication. Simulated-lease recovery: 66.7/66.1 seconds; maximum-text fixture worker RSS: 142.6 MiB. These are controlled observations, not an SLA.
- Full desktop/mobile browser suite: **107 passed, 0 failed, 3 intentional skips** in 7.8 minutes; `data/m4-browser-final.log`. Two skips avoid duplicate viewport scenarios; one skips the desktop-only Chromium heap measurement in the mobile project.
- Production frontend build passed; `data/m4-web-build-confirmed.log`. An earlier combined PowerShell build/typecheck command returned exit 1 despite successful build output and no TypeScript diagnostics; its cause is unconfirmed. Standalone `npm.cmd` commands confirmed successful exit codes without application changes.

Additional historical UI verification: the pre-retention whole-browser run passed **94 tests, 0 failures, 2 intentional skips**. After reproducing/fixing retention and cancellation, the focused lifecycle run passed **13 tests, 0 failures, 1 desktop-only measurement skip**; the focused chat/upload run passed **16 tests, 0 failures**. Final expanded browser/build and combined-stack results above supersede these checkpoints. Backend/migration hashes are unchanged from the 178/77-pass runs, so those completed suites were not repeated solely for frontend edits.

Final implementation/test manifest: `data/m4-final-source-fingerprint.json`, 124 files; SHA-256 `f4267c70577c33fbbf16efbd4929ba396021fd3dc0d20c318bdf3b1124cbc4b2`. Rechecked unchanged on 17 November. Documentation and private operational data are outside this manifest. No failing local M4 acceptance case remains; this is not a universal correctness claim.

Initial full infrastructure run: **76 passed, 1 failed**. The paused-Redis admission check unexpectedly completed during a six-second server pause with a five-second client deadline. The original check passed in isolation; the precise initial scheduling/clock cause is unconfirmed. Strengthened the fixture to keep Redis paused for 30 seconds with explicit UNPAUSE cleanup, retaining the same <5.9-second assertion and requirement that protected work never executes. No production limiter change is claimed from this observation. Evidence: `data/m4-infra-initial.log`, `data/m4-deadline-investigation.log`; full rerun passed all 77 checks.

Earlier browser slice: 93 passed, 2 intentional viewport skips, 1 resolved-detail label failure; its fix passed all 10 affected desktop/mobile checks. The final 107-pass run supersedes this historical result. Early combined-test harness errors (syntax, email selector, repeated citation selector) were fixed in test code; they are not claimed as application defects.

## Browser resource measurements

[PERFORMANCE.md](PERFORMANCE.md) and [milestone-4-ui-measurements.json](milestone-4-ui-measurements.json) record the same synthetic payload and 16 navigation cycles before/after. First-page payload is 32,609 bytes versus a 195,153-byte full array; all six pages total 195,327 bytes, so there is no all-history bandwidth saving. After six pages the open assessment list retains 100 instead of 120 records and remains bounded as more pages load.

Inactive-panel DOM counts stayed at 1,109 after each measured navigation batch. Final forced-GC heap was 10,440,388 bytes before and 10,471,776 after: no meaningful navigation-memory improvement is claimed. The navigation baseline already released panels. These measurements do not prove leak freedom, production capacity, factual accuracy or reduced provider cost. Record-window bounds, browser read cancellation and real source/archive limits are separate mechanisms.

## Visible-action and metric audit

| Surface | Wiring / coverage |
| --- | --- |
| Registration, login/logout, recovery/settings | Real-stack registration/recovery; auth/recovery browser suites cover invalid inputs, refresh, expired sessions and account switching |
| Upload/search/preview/download/delete | Existing API and workspace/upload-queue tests; real queued TXT upload, metadata and archived versions in combined flow |
| Chat, citations, retry, history and evidence tabs | Combined query/citation/history; existing keyboard, error, draft-preservation and viewport regressions |
| Conflict Center | Actual owner review and automatic application; controlled desktop/mobile tests cover resolved/stale filters, failed review and audit paging |
| Corrections | Real accepted and rejected repairs; queue states/retry times and paginated answer/audit history |
| Analytics | Existing tests verify persisted loaded-conversation outcomes, reported tokens, missing usage and cached/record-based cases; loaded-window labels remain explicit |
| Help/settings/theme/navigation | Existing browser keyboard/focus/theme suites; disclosures retain no full-library scan, no OCR and recovery-code-only reset |

Analytics is not a global background-correction/token ledger. The conversation totals and the latest-100-job panel have separate coverage labels. No fake accuracy, activity or global totals were added.

## Changes and reproduction

Production changes in this continuation: `src/database/knowledge-store.ts`, `src/rag/rag.controller.ts`, `apps/web/src/components/knowledge-controls.tsx`, `apps/web/src/app/research.css`, `apps/web/src/components/{workspace,chat-panel,research-views,document-library}.tsx` and `apps/web/src/lib/api.ts`.

Tests/tooling: `src/tests/auth.test.ts`, `src/tests/infra.test.ts`, `tests/browser/{lifecycle,history-window}.spec.ts`, new `tests/integration/lifecycle.spec.ts`, `scripts/test-lifecycle-server.mjs`, `playwright.integration.config.ts`, package script and CI step. Earlier UI slice also changed chat-panel, conflict-center, research-views, workspace-dialogs and workspace.

See [LIFECYCLE_WORKFLOWS.md](LIFECYCLE_WORKFLOWS.md) for user steps, endpoint contracts and test setup. CI is configured locally; it has not run remotely. Existing unrelated working-tree changes remain intact.

## Remaining release limits

LIVE-001 and LIVE-002 remain open: the previous nine-question live run returned a technical verification failure for a missing-evidence question and omitted a supported unit fact in an injection fixture. Injection was not followed. UI and controlled tests do not fix or erase those live findings.

Milestone 5 clean Docker installation/backup restore, milestone 6 current cloud acceptance and milestone 7 independent factual evaluation/load/release checks are not completed by this work. Provider quotas, model error, exact vector search, process-local answer cache and lack of a full-library conflict scan remain explicit limitations. No bug-free or universal factual-accuracy claim.
