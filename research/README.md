# Reproduce the correction workflow

This directory contains **synthetic, redistributable research fixtures**, not user uploads or an independently annotated benchmark. The source text and expected answers in `fixtures.json` were written before any model run. They are MIT licensed with the project.

## Offline demonstration

From a fresh source checkout with Node 22.18+:

```sh
npm ci
npm run research:demo
```

No API key, database, account, private baseline checkout or running web server is needed. The command invokes the production `RagService`, decomposition/verification schemas, targeted retrieval orchestration, span edits, final verification and repair-status rules. Only provider responses and retrieval candidates are scripted. Nothing mocks the production app at runtime.

Seven protocol scenarios must pass: incorrect number, already-correct answer, targeted evidence retrieval, missing evidence, historical policy scope, superficial rewriting, and a revision introducing an unsupported qualifier. The demo fails its process exit status when an expected behavior fails. It is also run in CI.

In the numerical correction example, the draft says five datasets and four architectures. The supplied source establishes two datasets and four architectures. The accepted answer changes only the dataset count, retains the architecture count, cites the source, and passes final verification. Rejected revisions remain in the report's `repairHistory`.

**Seven passing fixtures are not 100% model accuracy.** The fixture provider intentionally supplies predetermined decisions. Offline timing is local orchestration time; token consumption and API cost are unknown/not applicable, never fabricated.

## Live provider evaluation

```sh
npm run setup:local
# Configure OPENROUTER_API_KEY and explicit model names in .env.
npm run doctor -- --require-provider
npm run research:live -- --case=incorrect-number
# Omit --case to run all seven cases.
```

Use `EVAL_ENV_FILE` to select another private configuration file. These commands send only the synthetic fixture passages to the configured provider and consume its quota. There is no automatic switch to another or paid model. The seven-case run can make multiple verification/repair calls per case; start with one case. A provider or verification execution failure produces a nonzero exit code and remains in the report.

Live comparison uses the same fixed initial drafts and source candidates for an **uncorrected fixed-draft baseline** and **current RAC-inspired correction**. Generation and embedding are deliberately excluded; this measures correction behavior, not end-to-end retrieval or chat latency. Do not describe the baseline as the previous Veriqon implementation. The historical comparison still exists as `npm run evaluate:rac:legacy` and requires its documented old worktree.

Each timestamped `data/research-*.json` report includes dataset hash, exact answers/passages/versions, verification and repair records, stage/model usage, latency, failures, supported numerical coverage and repair outcomes. Numeric grading recognizes only the fixture vocabulary and cannot grade arbitrary factual statements. Missing token usage stays incomplete; costs and general citation entailment are `null`. Reported model names identify the models actually returned by the gateway when available.

The superficial/new-error cases inject adverse repair responses **only offline**. In live mode the model chooses its own revision; those case IDs do not imply that a real model actually produced the scripted adverse behavior.

## Independent review

For a real reliability claim, recruit an independent reviewer who did not design the corrections. Give them the source corpus and both variants, blind the variant labels where practical, enumerate every factual proposition, and adjudicate disagreements with a second reviewer. Include unanswerable cases, failures and abstentions; do not report precision without coverage.

```sh
node scripts/review-research.mjs data/research-live-<timestamp>.json --template
# Independently complete the generated *-review.json.
node scripts/review-research.mjs data/research-live-<timestamp>.json --score data/research-live-<timestamp>-review.json
```

The scorer rejects missing reviews, modified answers and invented evidence quotes. Required claim fields are `text` (an exact answer span), `verdict` (`SUPPORTED`, `CONTRADICTED`, `INSUFFICIENT_EVIDENCE`), `citationSupported` (boolean), and `evidence` (array of `{documentId, quote}`). Review completeness and reviewer independence are declared by the reviewer; software cannot establish them. No independent human review is bundled or claimed.

## Algorithm provenance and limitations

[RAC](https://aclanthology.org/2025.findings-emnlp.1370/) and its [official implementation at the audited commit](https://github.com/jlab-nlp/Retrieval-Augmented-Correction/tree/15d0ae83a7de700a1304b345a54f9878eba51d53) separate fact decomposition, verification and correction. Veriqon retains this separation and adds bounded targeted retrieval, strict quote/span contracts, abstention and final re-verification. These additions make it **RAC-inspired**, not a reproduction of RAC's reported accuracy or speedups. See `docs/rac-method.md` for the differences.

This harness does not evaluate document parsing, embedding recall, full-library conflict scanning, authoritative temporal metadata, or continuous revalidation. Their status is recorded in `docs/capabilities.md`. Use the backend/infrastructure/browser suites for integration behavior and a separately annotated corpus for general factuality claims.
