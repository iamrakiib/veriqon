# Milestone 1B: ingestion, retrieval and query scope

Implementation started 11 November; accepted 12 November 2026. Local implementation only; no deployment or live-provider calls. Milestone 1A's completed baseline was read, not repeated as a new audit. Changes are confined to retrieval/temporal/cache scope and relevant regression coverage. **Milestone 1B acceptance passed; stopped before milestone 2.**

## Reproduced defects and minimal fixes

| Defect | Before evidence | Root cause and fix |
| --- | --- | --- |
| Multiple requested years lost historical evidence | `data/m1b-before.log`: explicit period and retrieval comparisons failed | The parser accepted only one year and otherwise used today. It now deduplicates explicit periods and returns their enclosing interval, retaining metadata on each passage. Dates/years in comparisons are supported; unrelated dataset/model numbers are not treated as dates |
| Extreme date produced a malformed exclusive boundary | Same log: calendar bounds failed | Advancing the end of year 9999 produced an expanded ISO year then truncated it. Supported user dates are now years 0001–9998; leap-day and inclusive-day boundaries are tested |
| Inherited file focus bypassed validity filtering | Same log; `data/m1b-expanded-before.log`: pipeline follow-up still failed after the direct-search fix | A selected filename was mistaken for explicit historical inspection. Only explicit source-wording requests can inspect expired wording, and the original current question—not expanded history or targeted search text—controls that decision |
| Cached historical inspection reused as policy answer | `data/m1b-cache-before.log`: semantic hit where a miss was required | Cache scope omitted the inspection/policy distinction. Shared deterministic intent classification is now included in the cache namespace, so even a permissive equivalence result cannot bypass this boundary |

No inference provider, database schema, UI or repair algorithm was replaced. The cache remains process-local. No ANN index was added.

## Regression measurements

The matrix lives in `src/tests/retrieval-stability.test.ts`. Expected passage IDs/chunk indices were specified before execution. It uses real database retrieval with deliberately tied, controlled two-dimensional embeddings and synthetic documents. Thus it tests lexical/hybrid selection, passage expansion and scoping, not the quality of a live embedding model. These annotations have not undergone independent human review; the independent benchmark remains milestone 7.

Corpus: seven manuscript chunks (objective, background, methods, evaluation and results table), two conflicting policy files, eight unrelated files and another account's private paper. Six labeled questions cover exact terminology, paraphrasing, numerical table results, multiple manuscript passages, a named policy and comparison of named conflicting files. Separate regressions cover unavailable answers, historical/current/multiple periods, unknown effective dates and private-source rejection.

SQLite and PostgreSQL matrix results: each **8/8 expected passage references retrieved across 6/6 questions**, six controlled query-embedding calls, final budget three passages and candidate setting 30. Table text retains `MAE (kWh)`, `Alpha | 2.4` and `Beta | 3.1`. Passage IDs/ranges and retrieval modes are logged per question; no relevance score is presented as entailment. PostgreSQL observations in the machine-readable report come from the final passing infrastructure suite.

Cache matrix (`src/tests/answer-cache.test.ts`): nine independent warmups followed by nine probes. **Two intended hits** (one exact, one paraphrase), **seven intended misses** (different date, quantity, entity, scope, owner, revision and explicit as-of date). All nine decisions match the expected result. The controlled fixture recorded 16 generation calls across the 18 total queries and two equivalence calls. This is not a measured production hit rate; the equivalence evaluator and provider are controlled. A separate real-store regression proves the expired-source boundary despite an equivalence response of true.

Missing-evidence/isolation scenario: **two searches, one generation, one verification, zero unauthorized generator/verifier inputs**. Private evidence is available in account B but never reaches account A's model-bound inputs or citations. With no new authorized support, the numerical assertion is withheld. Existing tests separately cover cache owner isolation, unauthorized context, embedding/provider failure and invalid verifier responses.

## Ingestion and supported behavior

Existing checkpoint, provider pacing, duplicate upload, retry ceiling, changed embedding/chunk profile, cancellation, worker lease, shutdown and bounded lexical-fallback tests were preserved and rerun. The checkpoint-resume test now compares every published chunk's text, index and embedding with uninterrupted indexing, in addition to asserting hidden partial indexes and no repeated successful embeddings.

A newly generated textless PDF fixture is rejected with the explicit OCR-required message; it is not falsely indexed. Existing PDF/DOCX extraction and DOCX table-value/unit tests remain in the regression suite. No OCR capability was added.

Limits remain: 10 MB upload; durable ingestion up to 500,000 extracted characters and 1,000 chunks; the synchronous compatibility path retains its smaller limit. Complex PDF layout, table reconstruction, exact page provenance and independently measured retrieval recall remain limitations. Provider rate limits cannot be removed by these changes.

Temporal comparisons use an enclosing interval and may retrieve intermediate versions; passage metadata must still establish applicability and factual support. Unknown effective dates remain explicitly absent—publication date is not substituted. The parser covers documented explicit date/year phrases, not arbitrary natural-language temporal reasoning. Historical retrieval from archived same-ID replacements and deterministic source precedence remain milestone 3 work.

## Validation boundary

Backend build and regression suite: 148 passed, zero failed, one PostgreSQL-only skip. Lint passed. **Final PostgreSQL/Redis suite: 47 passed, zero failed/skipped, 89.75 seconds** (`data/m1b-infra-accepted.log`). Source/test manifest was unchanged across the continuation; backend/lint were not repeated without source changes.

Earlier attempts remain recorded: the first suite had 46 passes and one concurrent migration advisory-lock statement timeout. That test passed in isolation and in both resumed full runs; its first failure is not conclusively diagnosed or declared fixed. A subsequent retry was interrupted because Docker was manually paused. After resumption, another run had 46 passes and one temporary SQLite failure (`database or disk is full`). C: was measured at zero free bytes. The final run used process-local `TEMP` and `TMP` pointing to `data/m1b-test-tmp` on D:, resolving that fixture failure without changing production settings or assertions. No timeout or migration-lock behavior was changed. C: still needs space for normal workstation operation; the test workaround does not clean user files.

Reproduce the final Windows run from the repository root with disposable PostgreSQL/Redis endpoints configured by `scripts/test-infra.mjs`:

```powershell
$milestoneTemp = Join-Path (Get-Location).Path 'data\m1b-test-tmp'
New-Item -ItemType Directory -Force -Path $milestoneTemp | Out-Null
$env:TEMP = $milestoneTemp
$env:TMP = $milestoneTemp
node scripts/test-infra.mjs
```

Run this in a temporary shell so TEMP/TMP changes remain confined to validation. The relocation is needed only when the default temporary drive cannot hold test files.

Cleanup note: after the passing suite, Docker CLI removal/status requests stopped returning. Removal of disposable containers `veriqon-m1b-postgres` and `veriqon-m1b-redis` is therefore unverified. Once Docker responds, remove only those two test containers. Other project containers and user files were not targeted; Docker Desktop was not stopped globally. This operational cleanup does not change the completed test results.

Current final results are recorded in `IMPLEMENTATION_PLAN.md` and `RELEASE_READINESS.md`; logs use ignored `data/m1b-*`. Relevant new tests are wired into both standard and PostgreSQL test entrypoints. The frontend and API response shape were not changed, so the unchanged browser suite was not rerun merely to repeat the 1A result. Full backend/API and database regressions are required because query behavior changed. No live model accuracy, token cost, production performance or full continuous-correction claim is made.
