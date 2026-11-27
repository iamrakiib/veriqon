# Human QA and exploratory testing

Exploration: 26–27 November 2026 (Asia/Dhaka). Deployed baseline: `https://veriqon-two.vercel.app`, application commit `3e9f0d05d5aefe9047533f5ef2336bf766f64d14`; local baseline `5c185e0` contains its documentation follow-up. This is the pre-release checkpoint for [PR #14](https://github.com/iamrakiib/veriqon/pull/14); subsequent deployment/retest evidence belongs on that release record. Fixes are **not deployed** at this checkpoint.

Method: explore the actual UI first, inspect network responses and visible persisted state, then inspect relevant code and write regressions for reproduced defects. Edge control host was unavailable; Playwright Chromium drove the real deployment without API mocks. Controlled local regressions are identified separately. Only synthetic QA accounts/documents were used. Private credentials and raw evidence stay in ignored `data/human-qa/`; do not publish that directory.

## Session coverage

| Session | Executed through deployed browser | Not established / remaining |
| --- | --- | --- |
| 1 — Authentication/navigation | Empty and invalid form validation; existing-account sign-in; real public registration with eight recovery codes and acknowledgement; refresh persistence; distinct empty library for new account; cross-tab logout clears both workspaces; subsequent sign-in to a different QA account removes the first account's documents and draft from the old tab; interrupted sign-out retains workspace and shows failure; recovery form inspected; removing cookies then refreshing clears private UI with session-expired notice; page Back/refresh defect reproduced | Actual recovery-code redemption and forced server-side expiration not executed in this session. Cookie removal is not a JWT-expiry-clock test. Navigation fix requires deployed retest. |
| 2 — Documents | Unsupported extension and empty file rejected locally; malformed PDF rejected by API with HTTP 400; valid TXT, PDF, DOCX and Markdown saved as durable uploads (202), then failed at 0/1 with explicit provider-key error; failed progress survives reload and none is published in indexed library; re-uploading the same failed PDF returns its existing failed record with no duplicate row | Successful new indexing and duplicate/version publication blocked by provider authentication. No repeated retry loop was initiated. |
| 3 — Chat/evidence | Reopened existing saved answers; inspected exact PDF passage and immutable source hash; original PDF download matched stored SHA-256; new numerical question returned explicit source-only fallback with lexical-search notice; saved failed response reopened after a new login | No new verified AI answer; multi-document, historical, ambiguous and follow-up factual correctness remain blocked. |
| 4 — Factual correction | Provider failure is not mislabeled as a verified answer or repair | Correct/incorrect drafts, substantive repairs, paraphrase rejection and preservation need real inference. Previous controlled tests are not fresh live passes. |
| 5 — Continuous correction | Corrections loads real queue status: enabled, ten attempts/hour, no recorded jobs in this QA account | No successful new source index; automatic revised-source correction and independent-worker persistence not demonstrated. No production worker restart performed. |
| 6 — Reviews/metrics | Corrections reports zero repair attempts across three real assessments; queue refresh works; Conflict Center refresh reaches backend; Analytics includes two verified responses and one actual provider failure | Headline calls failures “Completed answers” (HQA-003). No conflict decisions fabricated to populate the empty account; substantive decision/downstream checks remain untested. |
| 7 — Responsive/unusual sequences | Desktop 1440×1000, tablet 768×1024 and phone 390×844 explored; phone citation drawer displays full source hash/passage without horizontal overflow; Escape closes drawer; tablet menu focuses its close control and restores opener focus on Escape; tablet settings dialog retains exact geometry in both themes; help describes actual limitations; offline sign-out does not falsely succeed | Complete keyboard sweep and every dialog remain unfinished. Existing theme regressions are separate automated evidence. |
| 8 — Deployment/recovery | Initial Vercel auth-status HTTP 429, subsequent backend readiness and retry recovery; real Vercel-to-Render login/uploads/query; persisted original PDF and conversations | Gateway 429 cause unresolved; live provider unavailable; no full worker/redeploy/restore acceptance in this session. |

## HQA-001 — Workspace navigation ignores browser history

- **Severity:** Medium.
- **Affected feature:** Every main workspace page.
- **Reproduction:** Sign in; open Chat workspace, Chat history, then Analytics. Press browser Back. Separately refresh Chat history.
- **Expected:** Back returns to Chat history; Forward returns to Analytics; refresh restores the selected page. An unsent draft survives in-app Back/Forward.
- **Actual:** URL stays `/` throughout. Back leaves the app (`about:blank` in a fresh browser context); refresh opens Knowledge base.
- **Evidence:** Deployed UI exploration; `data/human-qa/history-before-refresh.png`; failing regression `navigation-before.log` at the first Back assertion.
- **Root cause:** `Workspace.navigate` changed only React state; its initial view was always `knowledge`.
- **Fix:** `apps/web/src/components/workspace.tsx` records allowlisted page fragments and restores the view on hash/history navigation. Same-page selection adds no duplicate history entry. Accessibility `#main` remains a focus anchor. No document/chat contents enter the URL; authentication remains unchanged. This is page navigation, not a permanent link to individual conversations.
- **Retest:** Desktop and mobile regression passed (2/2): Back, Forward, refresh, unsent draft preservation, same-page selection and unknown fragment fallback. Evidence: `navigation-after.log`. An intermediate run exposed unknown-fragment fallback; corrected before the passing run.
- **Deployment status:** Local fix only; old deployed behavior remains until release.

## HQA-002 — Configured provider rejects authentication

- **Severity:** High; blocks successful fresh indexing, generated answers and live correction acceptance.
- **Affected feature:** Document embeddings and model inference.
- **Reproduction:** Upload `human-qa-policy.txt`, a one-passage synthetic policy; refresh. Ask a numerical question about the existing synthetic `release-acceptance.pdf`.
- **Expected:** A valid deployment credential permits embedding and generation. If rejected, preserve upload progress and expose a truthful failure rather than claim success.
- **Actual:** Upload accepted with 202, then saved at 0/1 with “The provider rejected the API key.” Query returns source passages only, explicitly unverified; lexical fallback is disclosed. Failed upload is not published in indexed documents.
- **Evidence:** `data/human-qa/upload-provider-failure.png`, real browser network and visible state; earlier authenticated provider probe recorded HTTP 401. No credential contents are included here.
- **Root cause:** Configured inference credential is rejected. The precise provider-side reason (revocation, invalid key, account condition) is not established. This is not evidence of quota exhaustion.
- **Fix:** Requires a valid privately configured replacement key. Do not weaken verification, fabricate model output or endlessly retry rejected credentials.
- **Retest:** Failure handling passes; successful inference/indexing **BLOCKED**. No factual correctness or repair-success measurement from this session.
- **Deployment status:** Blocker reproduced on deployed application.

## HQA-003 — Analytics calls failed assessments completed answers

- **Severity:** Medium.
- **Affected feature:** Analytics headline and activity chart descriptions.
- **Reproduction:** With two saved verified answers, submit a question while model authentication fails; open Analytics.
- **Expected:** Metrics distinguish recorded responses from completed generated answers and disclose whether failures enter response-time summaries.
- **Actual:** “Completed answers: 3 / Includes abstentions” includes a response that explicitly says it could not generate an answer. The detailed breakdown correctly records one generation/verification failure. Average response includes its fast failed attempt.
- **Evidence:** `data/human-qa/analytics-failed-count.png`; failing `analytics-before.log` regression added after deployed observation.
- **Root cause:** The aggregate selects all messages with a `result`, including `VERIFICATION_FAILED`, but labels that aggregate completed answers. The numeric aggregation itself is not an accuracy calculation.
- **Fix:** `research-views.tsx` labels the existing aggregate “Recorded responses,” explicitly including abstentions/failures; clarifies timing scope and activity-chart accessible name. No records are removed, no failure is hidden and no statistical denominator changes silently.
- **Retest:** Passed on desktop and mobile in affected suite; assertions cover four recorded results plus a separate transport error and their distinct outcome counts.
- **Deployment status:** Local fix only.

## HQA-004 — Initial deployment-path HTTP 429 before sign-in

- **Severity:** High if persistent; observed as intermittent.
- **Affected feature:** Initial `/api/auth/status` request through Vercel.
- **Reproduction:** First fresh browser visit in this session. One read-only follow-up returned the same response. Later retry recovered; repeatability is not established.
- **Expected:** Sign-in form loads, or actionable temporary failure offers recovery.
- **Actual:** Plain-text `Too Many Requests`, HTTP 429, no `Retry-After`. UI correctly withheld the form and offered Retry connection. Direct Render auth status and proxied readiness then returned 200; UI retry and sign-in succeeded.
- **Evidence:** `data/human-qa/auth-status-failure.png`, `initial-probes.json` and captured browser response. This was before any deliberate load testing; no stress test was run.
- **Root cause:** **Unresolved.** Plain-text response does not identify whether hosting edge, forwarding or upstream infrastructure generated it. Do not attribute it to OpenRouter or change application rate limits speculatively.
- **Fix:** No speculative runtime change. Need correlated hosting logs/request identifiers if it recurs.
- **Retest:** Retry recovered and subsequent ordinary navigation succeeded; transient root cause remains open.
- **Deployment status:** Observed on deployment, not claimed fixed.

## Validation and release status

Automated evidence supplements UI discovery:

- Navigation regression before fix: **1 failed** at browser Back. Final targeted rerun: **2 passed** (desktop/mobile).
- Analytics regression before fix: **1 failed** at misleading aggregate label.
- Affected auth, usability and redesign browser suites: **56 passed, zero failed, two intentional viewport skips**, 2.5 minutes (`data/human-qa/regressions.log`). Includes adjacent deletion, theme geometry, session renewal, pagination-related navigation, corrections, source rendering and metrics checks. API responses in these regression tests are controlled; they are not live-model evidence.
- Production frontend build, subsequent TypeScript check and ESLint: **passed** (`build.log`, `typecheck.log`, `lint.log`).
- Real deployed browser sessions had **zero captured frontend runtime exceptions**. Failed HTTP calls and provider failures are recorded above; absence of JavaScript exceptions is not absence of defects.
- Initial full CI on `290dfb1`: backend **191 passed / seven infrastructure-only skips**; PostgreSQL/Redis **82 passed / one dedicated-restart skip**; browser **124 passed / two failed / four intentional skips**. Both failures were the same account-switch test on desktop/mobile: it assumed the page resets to Knowledge base, while browser page restoration now keeps Chat. Captured UI showed Account B and the request-header ownership assertions passed. Updated that test to assert preserved `#chat`, Account B identity and cleared old draft, then explicitly navigate to Knowledge base; no authorization check or timeout was weakened. Full rerun is required before merge.
- Docker clean installation, restart, crash recovery, backup/restore and failure checks **passed** in that CI run. Local PostgreSQL short soak in CI: 2,090 operations, zero errors, p95 19.24 ms, 60 seconds; no inference/API throughput claim.
- No backend logic, schema, model verification safeguards or dependencies changed. Backend/infrastructure suites were not rerun locally for this frontend-only slice; results above are actual GitHub CI execution.

No production deployment, paid provisioning or destructive production test has been performed at this checkpoint. HQA-002 is a live high-severity blocker; HQA-004 remains unresolved. Real correction, new successful indexing, populated conflict decisions, complete keyboard exploration and independent worker/redeploy/restore acceptance remain incomplete. This report is not a certification that all features work or that all defects have been eliminated.
