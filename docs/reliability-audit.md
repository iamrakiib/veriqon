# Reliability audit — 29 October 2026

Baseline: `70d96fe`. Audit performed before implementation changes.

## Execution trace and observed repair failure

`Workspace.send` → `api.query` → session-aware same-origin proxy → `AuthGuard` → `RagController.query` → account work lease/rate limit → persisted pending message → `RagService.queryPipeline` → revision cache → vector search → generation → sentence verification → optional full-answer generation → second verification → stored result → ChatPanel.

The repair is conditional, verification is structured, and a second check already exists. Similarity scores are used for retrieval, not as factual confidence. Those are not the observed defects.

The actual defects are that `runPipeline` calls any second passing answer `repaired`, without checking a factual difference, preservation of supported content, or preservation of uncertainty. `factCheck` uses sentences as indivisible claims and requires evidence even for disclosures of missing information. This can cause a valid caveat to trigger a rewrite. The repair receives exactly the original passages and performs no targeted retrieval. A second model can approve the same unsupported proposition, and the code accepts that approval without checking quoted evidence or numerical support. The original failed assessment is not persisted, so the precise cause of an old individual model decision cannot be reconstructed from its correction record alone.

## Functional inventory

| Area | Baseline implementation and limits |
| --- | --- |
| Ingestion | PDF/DOCX/text parsing, production subprocess limit, account quota and atomic persistence; DOCX raw text loses table structure; character windows can split rows |
| Embeddings | Batches of 32, dimension/model checks, nonzero vectors; original/model requests share provider client |
| Retrieval | Dense exact pgvector ranking (SQLite in memory), adjacent windows, final 18k-character cap; no lexical/hybrid or targeted retry |
| Generation | Evidence-only prompt, at most eight sentences; untrusted-data instructions; no absolute prompt-injection guarantee |
| Verification | JSON boolean per sentence and valid evidence indexes; no atomic propositions, quotes or temporal judgments |
| Repair | One full rewrite and recheck; no substantive improvement guard |
| Citations | One number per retrieved passage window, not per document; several numbers can correctly reference one DOCX; inline text is not directly clickable |
| Persistence | Account-scoped conversations, results and revision warnings; historical excerpts stored; no immutable answer versions or original failed assessment |
| Temporal/conflicts | Optional page/version strings only; health flags explicitly false; Conflict Center is a labeled placeholder with no routes/tables/engine |
| Revalidation | No durable jobs/workers/dependency graph; revision changes invalidate query cache and flag saved answers |
| Provider reliability | SDK timeout 25s, SDK retries disabled; wrapper retries selected HTTP errors once but not connection timeouts; overall pipeline 90s |
| Tests/evaluation | Deterministic provider stubs, HTTP/account isolation, PostgreSQL/Redis, browser workflows; existing evaluation script is a smoke test without labeled ground truth |

## Implementation boundaries

Prioritize the requested password recovery, misleading repair classification, evidence contract, targeted retrieval, provider deadlines and citation clarity. Recovery codes are explicitly selected by the user; no email service is configured. The broader temporal/Conflict Center/revalidation specification requires versioned metadata, authorization and evaluation work and must not be represented as already functional merely because verification statuses exist.

Tests establish software behavior on controlled fixtures, not real-world factual accuracy. Report deterministic regression metrics separately from live model quality; independent human annotation and controlled baseline experiments remain required for research claims.

## Implemented changes

- Added single-use, hashed recovery codes, password reauthentication for replacement, atomic consumption, session revocation and security events. PostgreSQL migration 002 and SQLite initialization preserve existing accounts. Login rechecks the password hash under the user lock so a concurrent reset cannot create a session from the old password.
- Strict claim schema retains original spans, exact supporting/contradicting quotes, missing information and model-assessed scope. Invalid JSON, invented quotes, invalid citations and missing numeric anchors fail closed. Compound dataset/architecture counts must be split.
- Added account-filtered lexical candidates alongside dense candidates, reciprocal-rank fusion, one targeted retrieval round, bounded context and DOCX table-row preservation. Initial candidate depth and final context size are separate.
- Supported answers remain unchanged. Insufficient evidence triggers retrieval or withholding. Contradictions can receive localized edits; supported spans and uncertainty are preserved, followed by final verification. Numerical/negation changes are checked conservatively; unchanged paraphrases cannot receive a successful repair label. Failed attempts retain reasons and before/after assessments.
- Added timeout/connection retries within stage and overall deadlines. Optional model reasoning defaults off; low is an explicit option. A concurrent library revision withholds the result rather than certifying a mixed snapshot.
- Citation numbers identify passage windows, with clickable inline references and passage/document counts. Historical repair records without the new contract are labeled not revalidated.

## Actual validation

Backend regression, HTTP recovery, PostgreSQL/Redis and browser results are recorded with the release. See [synthetic model execution records](reliability-smoke-results.json) for measured latency, token usage and model IDs. The supported example completed in 12.540 seconds; the deliberately wrong count was corrected and checked in 22.351 seconds. The wrong initial draft was injected by the test; all verification and repair calls in that case used the actual configured provider. These two examples do not measure precision, recall or a population-level repair success rate.

The first live attempt had a connection error. A second timed out during verification with optional reasoning enabled. Disabling optional reasoning allowed subsequent examples to complete; this small sequential sample does not establish causation or typical latency. Free-provider availability remains variable.

## Remaining limitations

Claim decomposition and semantic entailment still depend on the model. Quote membership and numeric guards prevent particular failures; they do not prove entailment, complete proposition coverage, correct units in every domain, or calibrated confidence. Minimal edits are made at sentence boundaries while retaining supported spans. The substantive-change guard intentionally declines entity-only and other semantic rewrites it cannot establish deterministically. At most one meaningful repair candidate is currently attempted; a larger configured cap does not force redundant calls.

No effective-date/authority metadata engine, persisted conflict-resolution workflow, durable continuous revalidation, immutable answer-version graph, human-review Conflict Center, or controlled A?E research comparison was added in this release. Model conflict verdicts are preserved as unresolved and are not a replacement for those systems. There is no independent human-labeled evaluation set, real-world precision/recall estimate, retrieval recall estimate, cost benchmark or security certification. PDF table structure and DOCX cell source coordinates remain limited. Model errors and quota exhaustion still produce explicit failures.

## Follow-up: RAC-inspired implementation

The subsequent [RAC implementation review](rac-method.md) supersedes the sentence-level repair and disconnected Conflict Center limitations above. It separates decomposition from verification, patches validated claim spans, and connects unresolved saved-answer conflicts. Broader temporal authority and continuous revalidation remain unimplemented.
