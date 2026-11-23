# Hard-query and feature review — 4 November 2026

This is a local test-and-fix review, not a declaration that every feature or arbitrary question works. No changes were pushed to GitHub or deployed. An isolated evaluation account was created; existing user accounts, documents and history were not changed by these tests.

## Real test corpus and expected behavior

[`scripts/evaluate-hard-queries.mjs`](../scripts/evaluate-hard-queries.mjs) defines six synthetic source documents and nine questions with expectations established before the model calls. The corpus includes competing 2026 engineering policies, a historical 2024 policy, a separately scoped sales policy, a manuscript with a results table, and a sensor specification containing an adversarial instruction. Upload and original-file download checks passed for all six TXT files through the real API. Source versions are content fingerprints.

The grading checks expected statuses, known values, citation references, saved-result replay and Conflict Center persistence. It is independent of the verifier for those fixed expectations, but its vocabulary and string checks are narrow. This is not a representative, independently human-labeled research benchmark. Production authentication, ingestion, retrieval, storage and the configured provider were used; these live questions do not mock model outputs.

| Case | First run | Patched live rerun |
| --- | --- | --- |
| Same department/period, incompatible allowances, unknown precedence | Decomposition contract failed | **Passed:** unresolved conflict saved and exposed in Conflict Center; 44.00 s |
| Different departments, explicitly named files | Failed: a third, unrequested policy entered retrieval | **Passed:** both requested allowances supported without a false conflict; 14.68 s |
| Historical 2024 allowance and approval requirement | Failed: supporting quote omitted the effective-date context | Provider quota blocked decomposition; targeted contract regression passes |
| Incorrect five-dataset premise; source says three datasets/four architectures | Failed: the correct denial “three datasets, not five” was downgraded | Provider quota blocked generation; numeric-denial regression passes |
| Follow-up asking whether backbone weights change | Answer supported, but no usable verified preceding turn existed; context expectation failed | Provider quota blocked generation; context/isolation regressions pass |
| Results table: Cedar accuracy and sample size | **Passed:** 82.4% and 250; 6.72 s | Provider quota blocked generation |
| Exact latency absent from the manuscript | **Passed:** insufficient evidence; 6.08 s | Provider quota blocked generation |
| Milliseconds versus seconds, with a document-instruction attack | Provider quota blocked decomposition | Provider quota blocked generation; live adversarial behavior remains unvalidated |
| Authenticated document inventory | **Passed:** six documents, zero model calls | **Passed:** six documents, zero model calls; 0.02 s |

Each run completed nine HTTP queries. The first had three passing expectations, five failed expectations and one quota-blocked case. The patched rerun had three passing expectations and six quota-blocked cases. Those six are **not passes**. The counts cannot establish a before/after accuracy improvement. The successful conflict query itself needed an evidence-contract retry; provider generation took about 17 seconds and verification calls about 22 seconds combined. Latency is still a material limitation.

The first conflict's precise malformed decomposition was not retained, so a narrower root cause is not asserted. A separate diagnostic execution later returned a valid unresolved conflict. Parser rejection details are now included in the safe failure description to make future diagnosis possible without logging prompts or documents.

## Bugs fixed

1. **Filename scoping:** a numeric year was treated as an uppercase acronym, and inferred matches could join explicitly named files. Exact filename matches now take precedence; bare years are not acronyms. Regression tests run actual retrieval with two requested files and an excluded same-year competitor.
2. **Filename values versus factual dates:** a year inside an actual cited filename no longer requires a numerical quote from document prose. A year asserted as an effective date still requires evidence. Unknown or differently cited filenames do not receive this exception.
3. **Incorrect-premise denials:** an evidenced exact count can rule out a different count of the same unit, as in “three datasets, not five.” This narrow check rejects self-contradictions, unsupported positive counts and approximate counts. It does not implement general inequalities or unit conversion.
4. **Incomplete numerical/temporal quotations:** when a model labels a fact supported but its quotes omit a required value/date/unit, one bounded contract retry requests the missing exact context. If the source cannot supply it, the claim remains unresolved. The historical regression verifies that an exact effective-date quote is added; upload dates are never used as effective dates.
5. **False repair counts:** two generation attempts do not establish a repair. Corrections and its navigation count now require an actual repair event/correction record. Cached copies do not count as new repair attempts or new verified repairs; their provenance remains inspectable in chat.
6. **Analytics classification:** checked workspace records are separate from model-verified answers and do not look like missing model usage. Cached answers have a separate outcome. Technical failures, conflicts and evidence abstentions have separate counts. The inaccurate “up to 100” coverage caption now reports the loaded question count. Metrics remain explicitly scoped to loaded history.
7. **Older conflict links:** Conflict Center can fetch an affected answer outside the current history page through authenticated `GET /rag/messages/:id`. The UI opens its saved answer, source versions and evidence without pretending a history refresh will load it. Cross-account access returns 404, unauthenticated access 401, and private responses use `no-store`.
8. **Quota reset reporting:** the provider returned a daily-limit HTTP 429 with `X-RateLimit-Reset: 1793836800000`. The application now recognizes that absolute millisecond reset in addition to `Retry-After`, avoids retrying through a long cooldown, and reports the reset time. The observed timestamp corresponds to **5 November 2026, 00:00 UTC / 06:00 Asia/Dhaka**. This is the provider's reported reset, not a guarantee of later capacity. [OpenRouter documents its platform quota response headers](https://github.com/OpenRouterTeam/docs/blob/main/api_reference/limits.mdx).

## Actual UI/API integration

[`scripts/check-local-workspace.mjs`](../scripts/check-local-workspace.mjs) signs into only the isolated evaluation account, loads the real local API and compares visible metrics to saved records. It does not route or mock API responses and makes no model calls.

The check passed with six documents, 18 saved responses, three model-verified answers, two recorded conflicts, 23,717 reported prompt/completion tokens and zero recorded repairs. The token total excludes embeddings and missing usage; the UI marks it as partial. The absence of repairs is expected: these regular-generation queries did not successfully execute a factual repair. Corrections showed no fabricated rows. Both sides of a conflict, versioned evidence and the affected saved answer were reachable; there were zero browser runtime errors.

Successful and withheld correction views are separately tested with controlled records, and backend/HTTP regressions execute numerical/entity repairs, preservation of supported claims, final verification, rejection of superficial/unsupported revisions and persistence. They do not establish a live repair success rate. The previous [live-provider controlled correction](rag-hardening.md#a-real-provider-factual-correction) is retained as a separate, dated observation; no new live repair completion is claimed under the exhausted quota.

## Automated verification

- Backend: **99 passed, 0 failed**. Includes the new source-scoping, numeric-denial, temporal-quote and saved-answer authorization regressions.
- PostgreSQL/pgvector and Redis: **8 passed, 0 failed**, including real HTTP authentication, recovery, storage, saved-answer access, leases and migration/import checks. Two disposable containers were removed; Docker Desktop was returned to its initially stopped state.
- Browser: **76 passed, 0 failed, 2 existing viewport-specific skips**, recorded in `data/hard-query-browser-final.log`; desktop/mobile checks include corrections, analytics, conflict links, source inspection, account isolation, recovery, uploads and history.
- Backend compilation, frontend type checking, production frontend build, lint and whitespace checks are recorded in the corresponding `data/hard-query-*.log` files.

The new reporting regression initially failed in both browser viewports, demonstrating the repair-count problem. After the fix, the complete suite exposed an older withheld-repair fixture that supplied only `attempts: 2` with no actual repair record. It was corrected to contain a real withheld event; its assertions still require the withheld explanation and forbid publication of an unsupported draft. No test was removed.

Changes are in `src/vector-store/vector-store.service.ts`, `src/rag/verification.ts`, `rag.service.ts`, `rag.controller.ts`, `src/common/provider.ts`, `src/database/database.service.ts`, frontend workspace/research views and API helpers, corresponding backend/browser tests, the two evaluation scripts and documentation. No provider subscription, model assignment or hosting setting was changed.

## Reproduce and remaining work

```powershell
npm test
npm run test:browser
npm run web:check
npm run lint
npm run web:build
# Requires the isolated test PostgreSQL/Redis endpoints described in scripts/test-infra.mjs:
npm run test:infra
# Consumes configured provider quota; local-only and saves its account under ignored data/:
node scripts/evaluate-hard-queries.mjs --live
# One case only, after quota is available:
node scripts/evaluate-hard-queries.mjs --live --case=historical
# Checks saved real UI/API records without model calls:
node scripts/check-local-workspace.mjs
```

The live evaluator appends observations, preserves failed runs and exits unsuccessfully when expectations fail or quota blocks them. Its credentials, full responses, screenshots and account identifiers stay in ignored `data/`. Keep the isolated account for reproducible retests; do not publish its credentials or mix its synthetic documents into real users' libraries.

The outstanding live cases must be rerun when provider quota is available. Source instructions remain untrusted, but the adversarial live case was blocked and no general injection-resistance claim is justified. Models can still produce malformed assessments or incorrect semantic judgments. Conflict Center remains saved-answer conflict inspection: whole-library scanning, administrator resolution decisions, authoritative temporal precedence and background revalidation are not implemented. Analytics covers loaded records and reported tokens, not global billing or independently measured factual accuracy. Broader scale, security and evaluation limits remain in the [recruiter review](recruiter-review.md).

## Follow-up check: 5 November, Asia/Dhaka

At approximately 00:36 Asia/Dhaka (4 November, 18:36 UTC), a read-only request to OpenRouter's `/api/v1/key` returned HTTP 200 and `free_model_daily_requests: { used: 56, limit: 50, remaining: 0 }`. Local midnight did not reset the UTC-based quota. No further model requests were made, and the six blocked cases remain unvalidated. The reported reset is still 06:00 Asia/Dhaka; future availability must be checked rather than assumed.

The final production frontend build and real UI/API integration check completed successfully. The frontend and API health endpoint returned HTTP 200; unauthenticated document and conflict endpoints returned HTTP 401. Local servers were left running. The safe final status snapshot is in ignored `data/hard-query-final-health.json`.
