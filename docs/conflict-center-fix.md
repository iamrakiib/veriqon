# Conflict Center regression fix — 2026-11-01

## Observed failure

A localhost test indexed two authored text policies for Dhaka engineering employees, both effective January–December 2026. One permitted three remote-work days per week and the other one. Neither established precedence. These were disposable fixtures, not the user's PDFs.

Both passages were retrieved, but the answer returned `PARTIALLY_VERIFIED` and the Conflict Center showed zero records. The numerical guard treated the source reference “One policy states…” as a separate quantity requiring a matching 1 in the source. It also failed to ground “two conflicting policies” in the retrieved document set. Conflict records depended solely on an atomic answer claim receiving `CONFLICTED`; correctly reporting what each source said could therefore hide a source-level disagreement.

The first earlier attempt also suffered a provider response failure. Its exact remote cause was not captured. Inspection found malformed completion envelopes could throw before useful classification and were logged as successful transport calls before their contents were validated.

## Changes

- `src/rag/verification.ts`: narrowly distinguish source references from substantive quantities; validate explicit retrieved-source counts against distinct source IDs/versions. Incorrect values and incorrect document counts still fail. Add runtime validation for independent source comparisons, requiring exact quotes on both sides and distinct source versions. Different/unknown scope, disjoint/unknown periods, and explicit precedence do not become confirmed unresolved conflicts.
- `src/rag/atomic-facts.ts`: production assessments require both `claims` and `conflicts`. An omitted comparison field is a contract failure, not an implicit no-conflict verdict. Legacy parser callers remain supported, but production requires the new contract.
- `src/rag/rag.service.ts`: assess relevant source disagreements separately in the existing verification call; preserve supported attributed claims, expose unresolved conflicts, prevent repair/cache certification of those answers. All-uncertainty drafts also receive source comparison. Validate completion envelopes inside the existing bounded retry and record failed calls accurately. Prompt version changes invalidate prior answer-cache entries.
- `src/rag/conflicts.ts`: derive saved conflict records from source comparisons as well as legacy atomic conflicts, retaining exact passages, versions, answer references and stable IDs; deduplicate identical evidence pairs.
- Regression tests in `src/tests/atomic-facts.test.ts` and `src/tests/auth.test.ts`: attributed numbers, document counts, invented quantities, exact quote requirements, scope/period exclusions, mandatory comparison contract, production orchestration, no repair/cache on conflict, malformed provider retry, persistence and account isolation.

## Executed checks

- Backend build and complete test suite: **74 passed, 0 failed**.
- Conflict Center browser checks: **2 passed** (desktop and mobile; controlled API fixtures, not live-model accuracy tests).
- Real localhost OpenRouter query: **passed**. Same question and same two authored policy passages as the failed test. Answer status `UNRESOLVED_CONFLICT`; one saved conflict record with both original passages and versions; all four source-attributed/explanatory claims remained supported. The browser displayed the actual record with no page errors. Disposable account/documents were deleted afterwards.
- Live query latency: **62,836 ms**. Generation 10,731 ms; decomposition 17,952 ms; evidence verification/source comparison 33,603 ms. Reported model tokens: 1,842 prompt and 1,181 completion. These are one execution's observations, not a benchmark or cost estimate.

Local execution artifacts: `data/conflict-fix-tests.log`, `data/conflict-fix-browser.log`, `data/conflict-live-test.json`, `data/conflict-live-test.png`. They contain synthetic fixture results and remain untracked.

## Limits

Source comparison still uses a fallible LLM. Exact-quote/schema checks do not prove entailment or correct scope classification. Unknown scope/period comparisons are not promoted to confirmed contradictions; broader human-review workflows remain future work. These tests do not establish PDF extraction quality, corpus-wide conflict recall, or production factual accuracy. Conflict Center covers saved answer assessments, not every document pair. Provider latency/outages remain possible despite bounded retries. No automatic authority selection or manual resolution workflow was added. Existing saved answers are not retroactively rewritten; ask again to run the new verification contract. All changes are local; nothing was published or deployed.
