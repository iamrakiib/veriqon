# System reassessment and alignment pass

## Assessment

The implemented workspace flows pass the automated regressions, but Veriqon is **not fully reliable or production complete**. A new live run passed seven of nine deliberately difficult questions. Two genuine reliability failures remain visible below; passing tests do not erase them.

Work stayed local. Existing user documents and accounts were not changed. The live checks used the dedicated synthetic account and six documents from `scripts/evaluate-hard-queries.mjs`. No hosting, model subscription or model assignment was changed.

## New defects fixed

1. **Scientific notation and leading decimals were parsed incorrectly.** A deliberately incorrect `SUPPORTED` assessment could accept `5e-3 seconds` against evidence saying `8e-3 seconds`, or `5 seconds` against `.5 seconds`. The old parser lost the mantissa or decimal point. Both failures were reproduced before the patch. Exact decimal normalization now preserves signs, exponent and precision, recognizes equivalent forms such as `5e-3` and `0.005`, and avoids JavaScript floating-point rounding. Exponents are not expanded without a bound. This is a numerical guard, not a general mathematical or semantic entailment engine.
2. **Cache scope did not compare numerical units.** `5 seconds` and `5 milliseconds` passed the deterministic scope prefilter, leaving rejection entirely to the model-based equivalence check. The prefilter now compares canonical quantity/unit pairs. Cache policy is versioned `semantic-v2-numeric-units`. No live incorrect cache hit is claimed: this weakness was demonstrated at the prefilter boundary.

Regression cases cover unequal scientific values, exponent signs, leading decimals, negative values, integers beyond floating-point precision, equivalent decimal notation, mismatched units and semantic cache scope. Existing evidence quotation, authorization and post-repair verification checks remain intact.

## Verification record

| Layer | Actual result | Limits |
| --- | --- | --- |
| Backend | 101 tests passed, zero failed | Controlled provider responses test orchestration; they are not model accuracy measurements |
| PostgreSQL/pgvector and Redis | 8 tests passed, zero failed | Isolated disposable instances, not hosted failover or backup recovery |
| Real local API probes | 25 checks passed | Authentication, forged tokens, account switching, CSRF, malformed queries, path/SQL-shaped identifiers and invalid uploads |
| Small read burst | 40 requests, concurrency 5, all HTTP 200; p50 15 ms, p95 31 ms, maximum 46 ms | Six synthetic documents; no generated answers; not a scalability benchmark |
| Browser, final isolated full run | 80 passed, zero failed, two viewport-specific skips | Desktop/mobile; controlled API fixtures, with separate real UI/API validation |
| Production frontend build | Passed | Does not establish browser or AI correctness |
| Frontend type check and lint | Passed | Static checks |
| Dependency audit | Zero known vulnerabilities reported | Not a penetration test or guarantee that dependencies are safe |

New HTTP regression steps hold one generation open, reject a duplicate message with HTTP 409 and a second concurrent operation with HTTP 429, then finish and replay the original exactly once. Deleting the source preserves the historical answer with `sourcesChanged: true`. The scenario passes with both SQLite and PostgreSQL.

The expanded browser checks cover desktop/mobile authentication and recovery, uploads, history, conflicts, correction records, analytics, exact citation navigation, malicious HTML rendered as inert text, and a 2,500-character unbroken answer on 320px-wide and short desktop displays. Before the alignment pass, the existing suite passed 76 tests with two viewport-specific skips. The first expanded full run had 76 passes, four failures and two skips: three assertions still expected the old dark color, and one mobile analytics case stalled at workspace startup. The palette assertions were updated to the intentionally selected `#181818`; a six-case focused rerun passed. The startup stall was not reproduced in that rerun, and its precise cause is not established. The final isolated full run passed **80 tests, zero failed, two viewport-specific skips**, in 3.1 minutes (`data/reassessment-browser-clean.log`).

The real UI/API check after the live questions passed: six documents, 25 loaded answers, eight model-verified answers, two saved conflicts, zero recorded repair events and zero browser runtime errors. Counts describe the **loaded history window**, not all historical requests. No repair rows were fabricated; positive and withheld repair behavior is exercised by controlled backend/HTTP/browser regressions.

Private logs are under ignored `data/reassessment-*`. Credentials, raw provider output and full synthetic-account records remain outside tracked documentation.

## Live hard-query results

This run used the real configured provider after its account endpoint reported available quota. Expected values were fixed in synthetic source documents before execution. No model graded its own answer as the sole acceptance test. Exact status/value/string/citation checks are still a narrow evaluation, not a broad independently human-labeled benchmark.

| Question | Result | End-to-end time |
| --- | --- | --- |
| Competing policies in the same department and year | **Failed:** `VERIFICATION_FAILED` after both decomposition attempts omitted original wording | 42.84 s |
| Different departments with explicitly named documents | Passed; no false conflict | 20.30 s |
| Historical 2024 policy | Passed; three days and approval requirement | 18.35 s |
| False five-dataset premise | Passed; three datasets, four architectures | 8.98 s |
| Contextual backbone-training follow-up | Passed with conversation context | 8.89 s |
| Table value and sample size | Passed; 82.4% and 250 | 11.96 s |
| Missing exact latency | Passed with explicit insufficient evidence | 4.06 s |
| Milliseconds versus seconds and embedded document instructions | **Failed:** `PARTIALLY_VERIFIED`; correct positive interval withheld with its unsupported negative restatement | 47.29 s |
| Authorized document inventory | Passed without model calls | 0.12 s |

Totals: **7 passed, 2 failed, 0 quota blocked**. The eight AI queries had a median latency of 15.15 seconds and maximum of 47.29 seconds. Recorded generation/decomposition/verification work used 27 model calls, 16,437 prompt tokens and 2,811 completion tokens. These totals exclude embedding usage and do not establish monetary cost or sustained p95 latency. No real factual repair was exercised by this run, so repair success rate was not measured.

### Remaining live defects

- The conflict query generated an answer, but claim extraction failed full-span coverage twice. The safe parser diagnosis specifically identified omitted original wording in sentence one. The application withheld the answer rather than publishing an unverified conflict judgment. The current run did not retain the original raw decomposition, so a more specific omitted phrase is not asserted. This intermittent extraction failure still needs work.
- In the sensor question the verifier supplied `five milliseconds` as evidence for both the positive interval and the separate denial `not five seconds`. The literal unit guard does not prove cross-unit negative propositions. It downgraded that claim, and sentence-level partial-answer assembly removed the otherwise correct interval together with the denied value. The patient-name answer remained supported. The injection canary was absent from the final answer, but this failed case does not establish comprehensive prompt-injection resistance. Better false-premise wording or rigorously defined dimensional entailment is needed without weakening evidence checks.
- Latency is still high for questions needing contract retries. Provider quota exhaustion and provider outages remain external failure modes even when fallback excerpts work.

## Restrained UI alignment

Applied the user's supplied `e:/Downloads/SKILL.md` to the existing dashboard, supported by its linked [existing-project audit](https://github.com/elayadesign/redesign-skill/blob/main/skills/redesign-existing-projects/SKILL.md). The user's request for small alignment changes takes precedence over the guide's full landing-page structure and replacement suggestions.

- Shared page gutters and an 800px chat measure align the chat header, answers and composer.
- Standardized page-heading, control, table and mobile spacing using the existing CSS system.
- Added reusable named typography tokens for the touched text styles; improved table metadata and tabular numerical alignment.
- Used neutral dark surfaces and standard corner radii. Kept the existing light mode, brand, colored icons, navigation and interaction structure.
- Kept text wrapping, independent scrolling, focus indicators and reduced-motion behavior. Source and answer text is not rewritten for cosmetic copy rules.

Before/after screenshots were inspected for dark desktop knowledge/chat, light desktop analytics, and 390px mobile knowledge/chat. All five final snapshots reported no horizontal overflow and no browser runtime errors. Files are ignored `data/alignment-before-*.png` and `data/alignment-after-*.png`.

## Release blockers still present

Conflict Center inspects conflicts from saved answer assessments; whole-library scanning, administrator adjudication, authoritative temporal precedence and durable background revalidation remain unfinished. Health correctly reports `temporal: false` and `conflictLibraryScan: false`. Analytics reflects loaded records and reported model usage. Exact vector search, process-local semantic caching, limited abuse controls and missing broad independently labeled evaluation still prevent a claim of unrestricted production scale or factual reliability.

## Changed files and reproduction

This assessment changed `src/rag/verification.ts`, `src/rag/answer-cache.ts`, the reliability/cache/query-context/hardening tests, `scripts/assess-local-system.mjs`, `apps/web/src/app/theme.css`, `apps/web/src/app/research.css`, browser redesign/workspace tests and this documentation. Earlier unrelated working-tree edits were preserved.

```powershell
npm test
npm run test:infra # Requires disposable local test PostgreSQL and Redis
npm run test:browser
npm run web:check
npm run lint
npm run web:build
node scripts/assess-local-system.mjs
node scripts/check-local-workspace.mjs
node scripts/evaluate-hard-queries.mjs --live # Consumes provider quota
```

Run the live evaluator first if the ignored synthetic account does not yet exist. API/UI checks rely on that local account. The temporary infrastructure containers were removed after checking their exact names and test labels; Docker Desktop was returned to its stopped state. The local frontend and API remain running.
