# Milestone 2: RAC-inspired factual verification and correction

Accepted 12 November 2026 for the controlled local acceptance scenarios. No application rebuild, new dependencies, deployment, account access or live inference. Stop before milestone 3A. Machine-readable results and the executed correction trace: [milestone-2-results.json](milestone-2-results.json).

## Attribution and existing implementation

Rechecked the [RAC paper, sections 3–4](https://aclanthology.org/2025.findings-emnlp.1370.pdf) and official [component prompts](https://github.com/jlab-nlp/Retrieval-Augmented-Correction/blob/15d0ae83a7de700a1304b345a54f9878eba51d53/src/components.py) and [pipeline](https://github.com/jlab-nlp/Retrieval-Augmented-Correction/blob/15d0ae83a7de700a1304b345a54f9878eba51d53/src/refactor-pipe.py) at commit `15d0ae83a7de700a1304b345a54f9878eba51d53`. RAC decomposes answers, checks individual facts against retrieval, corrects false facts and revises the answer. Its RAG variant reuses retrieved passages; optional flags control Not Mentioned filtering and Keep All True behavior. We did not execute its Python benchmark or reproduce its performance claims.

Veriqon's bounded targeted retrieval, strict runtime contracts, exact quotes, deterministic span editing, final verification, abstention and authorization are additional engineering safeguards. This remains RAC-inspired, not a faithful reproduction. Existing algorithms were preserved.

## Reproduced defects and changes

1. **Qualifier loss before verification.** `parseFactPlan` checked span coverage, numbers, units and negation but accepted a standalone claim that dropped “may”, “at most” or “only” while retaining the full original span. The verifier therefore received a different proposition. A conservative lexical guard now retains recognized modal, conditional and bound qualifiers and disallows invented qualifiers absent from the original sentence. The prompt asks for verbatim retention. Invalid decomposition gets the existing one contract retry, then a technical failure; it never reaches evidence verification.
2. **Malformed repair presented as missing evidence.** `parseClaimEdits` returned the same null value for malformed JSON and a valid unavailable/unsafe edit. `repairAnswer` converted both to the insufficient-information sentinel. `inspectClaimEdits` now distinguishes an invalid response contract from a well-formed empty or ungrounded proposal. Malformed contracts produce `reason=verification_failed`; supported original content may still be shown, and the attempt is recorded as rejected. Well-formed ungrounded edits remain conservative rejections, not invented provider errors.

Both new regression tests failed before the production changes (`data/m2-before.log`: 0 passed, 2 failed). The focused suite afterward passed 58 tests. The production changes are confined to `src/rag/atomic-facts.ts` and `src/rag/rag.service.ts`; five new tests are in `src/tests/atomic-facts.test.ts`. No database schema or response fields changed. Prompt version is `rac-inspired-v13-qualifier-contract`; existing cache namespace hashing includes it.

## Status and repair contract

| Outcome | Final status and behavior |
| --- | --- |
| All factual claims supported, valid citations, no source conflict | `VERIFIED_UNCHANGED`; original retained, no repair call |
| Localized factual edit, preserved supported spans, complete final support and substantive change | `REPAIRED_VERIFIED`; original/revision, exact edit evidence, before/after checks and accepted event retained |
| Some original facts supported but remaining claims unresolved or repair rejected | `PARTIALLY_VERIFIED`; only supported content and relevant uncertainty shown; no successful correction object |
| Accessible evidence cannot establish the answer | `INSUFFICIENT_EVIDENCE`; bounded targeted retrieval then abstention |
| Unresolved claim/source disagreement | `UNRESOLVED_CONFLICT`; both quoted sides remain inspectable; no arbitrary source winner |
| Generation/decomposition/verification failure with no usable verified answer | `VERIFICATION_FAILED`; technical failure distinguished from an evidence finding; generation failure shows source excerpts |

`REPAIR_ATTEMPTED` is **not an API status**. Attempts are persisted as `repairHistory` events with `accepted: false` until the proposed correction passes all gates. Frontend `VerificationBadge` and `RepairEvents` already distinguish final verified status from “Attempt not accepted”; no UI change was necessary. Partial output can have `reason=verification_failed`: its original supported facts remain usable even though the correction service failed.

Initial verification occurs before repair. Missing/temporally inapplicable evidence can trigger at most one additional retrieval round. Established contradictions use available corrective evidence directly. Repairs default to one attempt, clamped to at most two, subject to the total deadline. Supported spans and standalone caveats cannot be edited. Citation indexes in edited sentences are rebuilt from validated correction quotes and preserved supporting claims. The complete candidate is decomposed and verified again; unresolved new claims, bad citations, source conflicts and superficial changes cannot yield an accepted repair.

## Executed acceptance evidence

| Requirement | Actual evidence |
| --- | --- |
| Five remote days corrected to three | New real-orchestration controlled-provider test: `REPAIRED_VERIFIED`; one retrieval, six model-stage calls; exact quote and `approved-v2` source version retained |
| Preserve valid content and caveats | Same test retains manager approval and “Quantitative results are not reported.” unchanged; one localized edit; final check passes |
| Correct answer unchanged | Existing production and research cases pass without a repair call |
| Targeted retrieval and permanent missing evidence | Existing pipeline/research cases pass; one extra search, no unsupported numerical answer when support remains unavailable |
| Paraphrase and harmful repair rejected | Both research adversarial cases return `PARTIALLY_VERIFIED`; no accepted correction; existing claim-level regressions pass |
| Strict spans, IDs, quotes, quantities, citations and qualifiers | Atomic/reliability regressions pass, including malformed schemas, invented references, numerical anchors, compound claims, supported-span protection and the new qualifier tests |
| Malicious source instructions | New test asserts source instructions are never placed into the system prompt and all stages retain the untrusted-data instruction; this tests prompt separation, not live-model injection resistance |
| Provider timeout / malformed verification | Existing bounded timeout and contract-retry cases pass; new malformed repair case retains technical-failure semantics |
| Real HTTP and persistence wiring | Full backend run includes authenticated Nest HTTP/SQLite ingestion, query, genuine controlled correction, stored history and cross-account checks in `hardening.test.ts` and `auth.test.ts` |

Executed commands/results:

- `node node_modules/typescript/bin/tsc`: passed.
- Focused atomic/reliability suite: **58 passed, 0 failed** (`data/m2-focused.log`).
- `npm test`, including build: **153 passed, 0 failed, 1 PostgreSQL-only skip**, 154 total (`data/m2-backend.log`). Process-local TEMP/TMP used D: scratch to avoid the previously full default temporary drive.
- `npm run lint`: passed (`data/m2-lint.log`).
- `node dist/scripts/research-evaluate.js`: **7/7 protocol cases passed before and after**, same fixture hash and 25 scripted model calls (`data/m2-research-before.log`, `data/m2-research-after.log`).

No SQL, Redis, frontend or API shape changes: the PostgreSQL/Redis and browser suites were not repeated in this milestone. Their milestone 1A/1B results remain historical evidence, not newly executed M2 results. Current HTTP/SQLite integration is included above.

## Comparison and limitations

The seven fixed drafts and synthetic sources are unchanged. Both before and after M2 yield 8 correct returned numeric facts out of 8, 8/10 expected numeric-fact coverage, no unsupported returned numeric facts and no unnecessary successful repairs. Two ordinary incorrect drafts are repaired; two deliberately bad repair proposals are rejected. The harness's 2/4 repair-success denominator includes those deliberately rejected proposals and must not be presented as a real-world repair rate. Uncorrected fixed drafts contain 6/11 correct numeric facts and 6/10 expected coverage. Offline latency is recorded per case but is execution overhead, not provider performance; token use, API cost and general citation entailment accuracy are unknown.

The demonstrated improvement is protection against the two newly reproduced failure modes, with unchanged outcomes/call count on the existing harness. The fixtures are authored annotations, not independently human-reviewed data. Scripted model responses cannot establish model truthfulness or general factual accuracy. The qualifier guard is an English lexical safeguard, can reject valid paraphrases, and does not establish full preservation of arbitrary geographical, relational or conditional semantics. A plausible exact quote is still not a formal proof of entailment. Live-provider evaluation was not run; no claim of accuracy, latency or token-cost improvement is made. Broader independent evaluation remains milestone 7.

Archived same-ID historical retrieval, deterministic conflict decisions, separate worker queues, continuous correction acceptance, lifecycle UI and cloud acceptance remain milestones 3–7.
