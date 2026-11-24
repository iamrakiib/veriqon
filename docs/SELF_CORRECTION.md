# Evidence-grounded self-correction

Veriqon is RAC-inspired, not a reproduction of the paper's trained models or reported results. The existing [method/provenance review](rac-method.md) separates the paper's algorithm from additional engineering safeguards. No new fine-tuning is performed.

## Query-time correction

The generator receives authorized retrieved passages as untrusted evidence. Decomposition produces factual claims tied to exact answer spans, retaining qualifiers and separating independently checkable quantities. Strict runtime validation rejects missing/malformed assessment fields and invented quotes. Similarity selects candidates; it cannot mark a claim supported.

Verification distinguishes `SUPPORTED`, `CONTRADICTED`, `INSUFFICIENT_EVIDENCE`, `TEMPORALLY_INVALID` and `CONFLICTED`. Exact evidence references carry passage indices, document identity/version and source text. Numerical and quote/span checks constrain model judgments, but do not constitute a general entailment oracle.

Supported claims are preserved. Missing evidence can trigger bounded targeted retrieval. Contradicted or otherwise repairable claims receive localized correction proposals backed by actual evidence. Repair attempts and the overall query duration are bounded. A repair cannot edit unrelated supported content, fabricate a source, or silently drop uncertainty. The edited answer is decomposed/reverified; new unsupported claims and unchanged factual paraphrases do not qualify as successful repair.

| Final status | Meaning |
| --- | --- |
| `VERIFIED_UNCHANGED` | Original factual content passed the implemented assessment; no accepted correction needed |
| `REPAIRED_VERIFIED` | Evidence-backed substantive correction accepted and rechecked |
| `PARTIALLY_VERIFIED` | Only part of the requested answer is supported |
| `INSUFFICIENT_EVIDENCE` | Accessible evidence could not establish the requested facts |
| `UNRESOLVED_CONFLICT` | Incompatible applicable evidence lacks established precedence |
| `VERIFICATION_FAILED` | Verification could not complete reliably; not a factual verdict |

Provider-unavailable source excerpts are explicitly labeled and are not verified generated answers. Citation markers `[1]`, `[2]` identify evidence passages, so one document can have several markers. A citation is useful only when its exact passage supports the associated proposition.

## Continuous revalidation

Document publication, replacement, deletion, metadata changes and recorded source decisions can affect saved answers. New documents are considered even when absent from an original answer's citations. Jobs use the latest assessment and original temporal scope. Processing checks source revisions and lease ownership before publication, preserves immutable original messages/versions, and records unchanged checks without inventing a correction version.

Explicit historical questions retain the applicable historical source. A newer upload timestamp is not an effective date or authority rule. Conflicts remain unresolved until evidence metadata or a justified authorized decision supplies precedence; stale decisions cannot silently apply to different source versions.

## Evidence needed for a reliability claim

Controlled tests deliberately force wrong numbers, correct originals, missing evidence, superficial revisions, harmful repairs, historical policies and conflicts. They establish orchestration behavior for those cases. Live-model comparisons use fixed synthetic drafts/evidence and exclude initial generation/embedding; they are not end-to-end chat accuracy. Independently reviewed claim/evidence labels, representative held-out questions and failure/abstention coverage are still required for a general claim. Never report only supported-answer precision while hiding questions left unanswered.

Use [research/README.md](../research/README.md), [TESTING.md](TESTING.md) and the current milestone report to reproduce results and distinguish executed from pending checks.
