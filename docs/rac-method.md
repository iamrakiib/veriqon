# RAC-inspired correction in Veriqon

Implementation review: 30 October 2026. Previous Veriqon implementation: `7b06e3e`. Official RAC code inspected at `15d0ae83a7de700a1304b345a54f9878eba51d53`.

## What the sources actually implement

[Li and Flanigan (2025), sections 3–4](https://aclanthology.org/2025.findings-emnlp.1370/) describes atomic decomposition, evidence verification, fact correction, and answer revision. Its RAG variant reuses retrieved evidence and classifies facts as True, False, or Not Mentioned. It corrects false facts while retaining true and not-mentioned facts; Keep All True optionally preserves answers without false facts.

The [official component prompts](https://github.com/jlab-nlp/Retrieval-Augmented-Correction/blob/15d0ae83a7de700a1304b345a54f9878eba51d53/src/components.py) implement decomposition and verification separately. The [pipeline](https://github.com/jlab-nlp/Retrieval-Augmented-Correction/blob/15d0ae83a7de700a1304b345a54f9878eba51d53/src/refactor-pipe.py), especially lines 300–360 and 423–434, selects false statements for correction and uses corrected statements for answer revision. Flags control not-mentioned filtering and unchanged-answer behavior. We inspected source; we did not run its Python benchmark suite or reproduce its reported performance.

## Audit and changes

The earlier shipped implementation used sentence-level checks and full-answer regeneration. The local `7b06e3e` baseline added exact quotes and substantive-change checks, but combined decomposition with verification and patched entire sentences. It had no connected Conflict Center. See [the earlier audit](reliability-audit.md) for the complete request trace and root causes.

The new production path is:

1. Retrieve authorized evidence and generate a draft.
2. Decompose it without evidence judgments. Validate exact original spans, sentence coverage, quantities and classifications. Cache that decomposition only within this query.
3. Verify those immutable facts against exact passages. Reject changed/omitted facts, malformed output, nonexistent citations and missing numerical anchors.
4. Preserve supported answers. Search once more when support is missing, then reassess the same facts. Withhold unresolved facts; preserve conflicts for inspection.
5. Ask for corrections only to contradicted or temporally invalid claims. Validate claim IDs, quotes, quantities, nonoverlapping spans and preservation of supported spans.
6. Apply the validated span patches deterministically. Rebuild only the edited sentence's citation markers from actual evidence indexes. Decompose and verify the complete revised answer to catch newly introduced errors.
7. Require a substantive numerical/negation change before assigning `REPAIRED_VERIFIED`. Persist the original, proposed edit, quotes, assessments, rejection reasons and model usage with the account-scoped answer.

This is **RAC-inspired, not a faithful reproduction**. Targeted retrieval, abstention instead of retaining unsupported Not Mentioned facts, strict schemas, quoted provenance, deterministic span revision, final re-verification, authorization, deadlines, snapshot checks and the substantive-change guard are Veriqon safeguards. The code does not train models. `DECOMPOSER_MODEL`, `VERIFIER_MODEL` and `LLM_MODEL` select existing providers; decomposition defaults to the verifier model. `MAX_REPAIR_ATTEMPTS=1` bounds repair. Existing authentication, NestJS, OpenRouter, PostgreSQL/pgvector and frontend remain.

New uploads without a supplied version receive a content SHA-256 version identifier. Explicit existing version strings are retained. Older unversioned imports remain visibly unknown until reindexed. Saved answer excerpts retain the evidence used at execution time; this is not a general immutable document-version database.

## Conflict Center

`GET /rag/conflicts` reads only the signed-in account's latest 200 saved answer assessments. Stable conflict IDs link to the affected answer, both quoted passages, source versions and model-assessed scope. The UI supports scope filtering, source inspection, loading/error/retry and explicit unresolved status. It does not invent a library scan, authority hierarchy or automatic resolution. No manual override or background conflict scanner is claimed. Model-assessed temporal scope is not authoritative metadata.

## Reproducing the controlled comparison

Use Node 22 and the repository dependencies. From the repository root:

```powershell
git worktree add --detach data/rac-baseline 7b06e3e
node node_modules/typescript/bin/tsc -p data/rac-baseline/tsconfig.json --outDir data/rac-baseline/dist
$env:EVAL_ENV_FILE = '.env.docker'
npm run evaluate:rac
```

Reuse an existing baseline checkout instead of running `worktree add` twice. Provider credentials stay in the ignored env file. This command consumes the configured provider quota; only synthetic passages are sent. Results go to ignored `data/rac-comparison*.json`. The script verifies the baseline checkout and records its compiled module hash and the dataset hash.

Five cases use programmatic source records and expected values established before any model call. Both implementations receive identical fixed drafts and retrieval fixtures. Generation and embedding are excluded, so measured latency is **correction-pipeline latency**, not end-to-end chat latency or retrieval recall. The grader parses only the benchmark's numeric fact vocabulary and compares values/citations with those records. It does not use either LLM as a judge. These are not independently human-annotated research questions, and the grader does not measure arbitrary semantic entailment. Production orchestration is used with controlled retrieval; retrieval quality requires a separate corpus benchmark.

## Observed results

The [report](rac-comparison.json) and [per-case traces](rac-comparison-observations.json) retain all outcomes from the 29 October run, including failures. Changes afterward added the question to the second verification, cache-control headers, deterministic temporal regression coverage, version fallback, UI labeling, model-aware cache keys, failed-revision audit retention, immutable-verifier prompt clarification and reproducibility metadata; no new live comparison was silently substituted.

| Metric, restricted to these fixtures | Previous Veriqon | RAC-inspired |
| --- | ---: | ---: |
| Correct returned numeric facts | 4/4 | 5/5 |
| Successful repairs of initially wrong answers | 0/2 | 1/2 |
| Unnecessary successful repairs | 0/3 | 0/3 |
| Unsupported returned numeric facts | 0/4 | 0/5 |
| Supported citations for returned numeric facts | 4/4 | 5/5 |
| Expected fact coverage | 4/6 | 5/6 |
| Preserved initially correct numeric facts | 4/4 | 4/4 |
| Mean correction-pipeline latency | 12.70 s | 21.31 s |
| Reported tokens, incomplete totals | 4,062 | 7,774 |
| Request-level execution failures | 0 | 1 |

The new method corrected five datasets to two while retaining four architectures. Both methods preserved the correct answer and recovered missing support through targeted retrieval. Neither completed the historical-policy repair: the baseline repair timed out; the new pipeline withheld a revision after final verification could not complete. The new method also had a provider failure on the missing-evidence case. Failed calls can omit usage, so token totals are lower bounds. Sequential ordering, tiny sample size and variable provider load prevent statistical or causal claims. More abstention can inflate returned-fact correctness; coverage and failures are therefore reported beside it. No claim of general factual superiority or RAC's published speedups is made.

## Validation and remaining limits

Deterministic regression tests cover incorrect numbers, unchanged correct answers, targeted retrieval, insufficient evidence, historical/current policy evidence, superficial paraphrases, unsupported facts introduced by repair, exact span preservation, malformed contracts, citation integrity and private conflict access. A controlled provider-response test runs the real decomposition/verification/span-revision orchestration through a historical correction and verifies the final answer. Mocks are confined to tests and evaluation retrieval fixtures.

Local validation passed: 53 backend tests, 6 PostgreSQL/Redis integration tests, and 49 browser tests across desktop/mobile (one existing desktop-only scenario skipped on mobile). Lint and the production frontend build also passed. These checks establish the tested contracts and regressions, not general factual accuracy.

Semantic correctness and complete fact decomposition still depend on models. The conservative substantive-change guard can reject valid entity-only corrections. There is no temporal authority engine, publication/effective-date database, scheduled revalidation, administrator resolution workflow, human-labeled general-domain benchmark or calibrated confidence. Current source versions and dates are retained when supplied; dates are never derived from ingestion time. Provider failures remain explicit, and failed revisions are never certified as repaired.
