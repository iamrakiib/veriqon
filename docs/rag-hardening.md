# Local RAG hardening — 4 November 2026

This review continues the [recruiter review](recruiter-review.md). The fixes and validation below are local. No GitHub push, Render deployment or Vercel deployment was performed. Existing working-tree changes were preserved.

## Findings and changes

| Observed problem | Cause and implemented change |
| --- | --- |
| A real research-area follow-up returned `VERIFICATION_FAILED` despite relevant retrieved passages | Both captured decomposition responses contained 11 claims in one sentence; both parsers allowed at most eight. The contract now accepts up to 16 claims per sentence and 32 per answer. Complete span coverage and one assessment per claim remain mandatory. Oversized answers fail rather than silently dropping facts. Regression tests cover the real failure shape, omissions and both budget boundaries. |
| A subsequent live follow-up passed decomposition but failed quote validation | The verifier returned a quotation that did not match its cited passage on both bounded attempts. Its raw responses were not retained in that HTTP trace, so no specific punctuation or wording defect is asserted. Retry diagnostics now identify the affected claim, evidence side and passage index without echoing document text. The verifier prompt explicitly requires contiguous source substrings and separate records for separated fragments. Exact matching remains enforced. The final regular API retry succeeded; this does not guarantee future model compliance. |
| Generation failure discarded useful retrieval results | Generation errors after retrieval now return a structured, persisted abstention with authorized source excerpts and versions. The frontend labels it **Source passages only**, expands its passages and provides a retry action. It contains no generated factual answer, no successful correction and no positive verification. Fallback results never enter the answer cache. |
| A populated library with no matching passages could be described as empty | Empty retrieval now checks the account's library inventory. `no_documents` means an actually empty library; otherwise the reason is `insufficient_context`. |
| Numerical checks could accept the right number with the wrong unit | Literal quantity/unit pairs must occur in the quoted evidence. The checks cover common distance, mass, time, percentage, dataset and architecture units and aliases. Decomposition and edits cannot silently change those units or drop a span's negation. This is not a general arithmetic or unit-conversion engine. |
| Legitimate entity-only corrections could be rejected as superficial | The substantive-change guard now recognizes conservative named-entity replacements and unit changes through validated localized edits, exact correction evidence and final verification. A tested TensorFlow-to-PyTorch correction preserves the supported training sentence. Simple paraphrases still do not qualify. |
| Clearly contradicted claims caused unnecessary retrieval | A contradiction already established by exact evidence proceeds to bounded correction. Missing or temporally inapplicable evidence still triggers targeted retrieval. All candidate revisions require final verification. |
| Repair service failures could be described as missing evidence | Technical failures remain distinguishable from an actual insufficient-evidence assessment. Proposed revisions are withheld and recorded; only complete supported original sentences can survive as a partial answer. |
| Provider retry handling missed some cooldown formats | Parse `Retry-After` from plain header objects and `Headers`, including HTTP dates. Respect cancellation before the first request. Long cooldowns fail promptly instead of blocking the composer. Show a supplied reset delay; do not invent one when absent. |

The current prompt version is `rac-inspired-v8-quote-contracts`. These are engineering safeguards around the RAC-inspired method, not a faithful RAC reproduction or a new factuality guarantee.

## Final automated checks

| Check | Actual result |
| --- | --- |
| `npm test` (includes backend TypeScript build) | **95 passed, 0 failed, 0 skipped** |
| Full desktop/mobile Playwright suite | **70 passed, 0 failed, 2 existing viewport-specific skips** |
| `npm run web:check` | Passed |
| `npm run web:build` | Passed |
| `npm run lint` | Passed |
| `git diff --check` | Passed |
| Local server smoke | API readiness, frontend and proxied health HTTP 200; unauthenticated history HTTP 401 |

The backend suite exercises authentication/ownership, recovery, ingestion, saved history, cache isolation, factual repair, unsupported claims, temporal examples, conflicts and provider failures. New HTTP assertions verify that generation failure returns source excerpts and persists them without leaking provider details. Browser regressions exercise the fallback label, evidence inspection and retry interaction. They use controlled provider/API responses; passing them does not measure live-model accuracy.

The first expanded backend run had two failing test expectations: one still required HTTP 502 for generation failure and one empty-retrieval fixture lacked the library-inventory operation. Both were updated to exercise the intended behavior and the full suite passed. Additional regressions for 11-claim coverage and precise quote-retry guidance also passed. No test was removed to obtain the final result.

PostgreSQL/Redis integration and dependency audit results from the earlier recruiter review were **not rerun in this RAG-only review**. No claim is made about new Docker image builds, load testing or deployment verification.

## Live checks on the existing local account

The account's existing documents and conversation context were used with authorization. Tests added ordinary saved query records and did not reset credentials or delete existing history. Private answers, quotes and diagnostic traces remain under ignored `data/` and are not part of this report.

| Check | HTTP elapsed time | Outcome | Model calls | Reported generation/checking tokens |
| --- | ---: | --- | ---: | ---: |
| Résumé profession question | 10.09 s | `VERIFIED_UNCHANGED`, 1 supported claim | 3 | 5,444 |
| Manuscript objective question | 5.94 s | `VERIFIED_UNCHANGED`, 1 supported claim | 3 | 9,471 |
| Research-area follow-up before claim-limit fix | 6.64 s | `VERIFICATION_FAILED` at decomposition | 3 | 3,267 |
| Follow-up after claim-limit fix, before quote guidance | 24.82 s | `VERIFICATION_FAILED` at quote validation | 4 | 10,519 |
| Final follow-up through the regular API | **11.86 s** | `VERIFIED_UNCHANGED`, 10 supported claims; `contextUsed: true` | 3 | 6,924 |

The final follow-up used passages from the same résumé as the preceding question. The paper question retrieved only the named manuscript. Supporting quotations for the successful checks were inspected against their returned passages. Citation numbers identify passages, so several numbers can refer to one PDF or DOCX.

An additional instrumented diagnostic execution of the follow-up also completed successfully with ten supported claims. It was not an HTTP/persistence test and is not counted as another independent evaluation example. The two failed HTTP runs above are retained, not replaced by the successful result.

These measurements are a small debugging sample using the configured `nvidia/nemotron-3-ultra-550b-a55b:free` model. The displayed token totals sum reported prompt and completion tokens for generation/decomposition/verification; they exclude embedding usage and are not billing measurements. No accuracy percentage, p95 latency, general repair success rate or causal speedup is inferred from these runs. The historical RAC comparison remains unchanged.

## A real-provider factual correction

A separate controlled smoke test supplied a deliberately wrong initial draft and fixed synthetic evidence:

- Draft: “Employees may work remotely three days per week. Manager approval is required.”
- Source, version `approved-v1`: “Employees may work remotely one day per week. Manager approval is required.”
- Returned answer: “Employees may work remotely one day per week. [1] Manager approval is required.”

Decomposition, evidence verification, claim repair, final decomposition and final verification all used the configured live provider through production orchestration. The result was **`REPAIRED_VERIFIED`**, with two supported claims, an accepted localized correction, the unrelated approval requirement preserved and the source version retained. It took **11.65 seconds**, five provider calls and 3,147 reported prompt/completion tokens; retrieval was invoked once.

The source establishes the expected correction before any model call. This demonstrates that the pipeline can perform a genuine factual correction. The initial draft and retrieval were controlled, so it is not an end-to-end retrieval benchmark and cannot establish a population repair rate.

## Changed areas and reproduction

Core changes are in `src/rag/rag.service.ts`, `verification.ts`, `atomic-facts.ts` and `src/common/provider.ts`. Frontend changes are in `apps/web/src/components/chat-panel.tsx`, `answer-details.tsx` and `apps/web/src/lib/api.ts`. Regression changes are in backend atomic-facts/reliability/RAG/auth tests and browser hardening/workspace tests. README, API examples and RAC method documentation describe the revised behavior.

Run from the repository root:

```powershell
npm test
npm run web:check
npm run lint
npm run web:build
npm run test:browser
```

Private execution logs are `data/rag-hardening-tests-final.log`, `data/rag-hardening-browser-full.log`, `data/rag-hardening-web-check.log`, `data/rag-hardening-web-build.log` and `data/rag-hardening-lint-final.log`. The live checks are recorded separately as `data/rag-live-*.json`; do not publish those account-specific files.

## Remaining limits

- The verifier and decomposer are fallible models. Exact quotation and runtime validation cannot prove semantic entailment or complete atomic decomposition. Broad independently annotated evaluation is still missing.
- Provider quotas, variable latency and malformed responses remain possible. When retrieval itself cannot obtain usable passages, the source-excerpt fallback cannot manufacture them. Free-provider availability is not an application-level guarantee.
- Named-entity and quantity checks are conservative heuristics. Lowercase/relational corrections, unit conversion, complex mathematics and lengthy answers may be rejected. The system must expose that limitation, not certify an unverified repair.
- Whole-library conflict scanning, explicit authority/effective-time metadata, immutable document-version graphs, administrator adjudication and durable continuous revalidation remain incomplete. Model-assessed temporal examples are not an authoritative temporal engine; health continues to report `temporal: false`.
- Exact vector retrieval and process-local semantic answer caching remain scaling limits. No ANN recall/latency or distributed-cache benchmark was run here.
- Email verification/recovery, MFA, distributed registration-abuse protection, operational alerting, backup/restore drills and independent security testing remain release work described in the recruiter review.

The supported conclusion is that specific failures were diagnosed, fixed where possible and exercised through tests and live checks. The application is not certified “100% reliable,” “100% secure” or suitable for arbitrary scale.
