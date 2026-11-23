# Reliability and production readiness — 2 November 2026

## Verdict

Follow-up: the [recruiter review](recruiter-review.md) adds pre-buffer upload limits, account-switch consistency checks, paginated history and newer test results. The results below describe the preceding audit.

Veriqon has tested authentication, personal document libraries, ingestion, hybrid retrieval, verification/repair, saved evidence, conflict records, and conservative caching. It is **not yet an enterprise temporal RAG service**, and passing these tests does not prove factual accuracy or unlimited scalability. Zero failure is not a defensible acceptance criterion. Define supported workloads, failure behavior, latency/availability targets, and recovery objectives, then measure them.

This review used localhost only. No GitHub push, hosted database changes, Render deployment, or Vercel deployment occurred. Existing user conversations/documents were preserved. Requested account checks appended new queries; they did not overwrite old failures. Private account reports and screenshots remain under ignored `data/`.

## What the saved failures actually showed

The inspected account initially contained 11 saved messages: 3 verified responses, 1 partially verified response, and 7 technical failures (5 verification failures and 2 request errors). This is a small, selected debugging sample, **not an accuracy benchmark**.

- Older verifier contracts rejected decomposition/assessment structures. Some historical records predate the current contract and were not revalidated automatically.
- Free-provider responses failed or timed out at generation/decomposition. One earlier request hit embedding rate limits. Even a successful profession answer took 73,240 ms and expanded into eleven atomic claims.
- Follow-ups were sent as independent questions. Mentioning a paper while questioning the previous answer triggered a new paper search rather than inspecting saved provenance.
- Workspace inventory was incorrectly handled as document-content RAG. A retrieved subset cannot establish the complete library size.
- Existing legacy documents had null version metadata, preventing eligibility for version-aware semantic-cache reuse.

The live recheck answered the original inventory question from database records in **53 ms**, and the source-history question in **39 ms**, with **zero LLM calls**. The subsequent factual follow-up hit embedding-provider HTTP 429. After adding lexical fallback, retrieval proceeded, but **generation also returned provider HTTP 429**. A successful fresh live factual answer is therefore **not claimed**. No reset time was supplied; the system must not invent one.

## Fixes made

| Area | Change | Safeguard |
| --- | --- | --- |
| Query routing | Workspace counts/file names come from authenticated database inventory; source explanations use saved citations | No LLM, no fabricated explanation of internal reasoning; UI labels these “Checked records” |
| Follow-up context | Up to three recent verified turns from the same account/conversation resolve references | Previous text is untrusted context, never source evidence; current passages are still verified; context-dependent answers bypass answer caching |
| Retrieval focus | Common words in filenames no longer silently narrow a search; explicit filenames override inherited focus | Filename boundaries prevent `a.pdf` matching `data.pdf`; supplied document IDs are intersected with the authorized library |
| Embedding outages | Rate limits/transient provider failures can fall back to keyword retrieval | No invented similarity scores; fallback is disclosed; unfocused searches with no lexical match preserve the provider error |
| Evidence versions | Legacy content gets deterministic SHA-256 fingerprints at read time in SQLite and PostgreSQL | Historical results are not overwritten; changing text changes its fingerprint; this is not a document-version graph |
| Numeric validation | Negative values are distinct from positive values | Applies to claim checks and semantic-cache scope screening |
| Request replay | Replayed saved results report source revision changes | No duplicate generation; old evidence remains historical |
| Provider failures | Error envelopes preserve safe rate-limit/billing classifications; no guessed reset time | No raw provider metadata or credentials in responses |
| Dependencies | Updated the minimatch override to the patched release and checked compatibility | Lint/build/tests and a fresh dependency audit; see the [published advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

Relevant code: `src/rag/query-context.ts`, `rag.service.ts`, `rag.controller.ts`, `verification.ts`, `src/vector-store/vector-store.service.ts`, `src/database/database.service.ts`, `src/common/provider.ts`, and frontend answer labels/notices. Tests cover the new paths in `query-context.test.ts`, `rag.test.ts`, `auth.test.ts`, `infra.test.ts`, and `tests/browser/redesign.spec.ts`.

## Checks and evidence

- Baseline backend suite: 74 passed before these changes.
- Final expanded backend suite: **82 passed, 0 failed**. The targeted retrieval/routing suite also passed all 39 tests.
- Full desktop/mobile browser suite: **64 passed, 2 intentional duplicate-viewport skips**. Subsequent metadata/context/fallback disclosure checks: **2 passed**.
- Isolated PostgreSQL/pgvector and Redis integration run: **6 passed**, covering migrations, ownership, transactions, restart persistence, legacy fingerprints, Redis leases/rate limits, deployment validation, SQLite import, authentication and recovery revocation. Disposable test containers were removed; Docker Desktop was returned to its initial stopped state.
- Dependency audit after the update: **0 known vulnerabilities**. This is not a penetration-test claim.
- Backend compilation, optimized Next production build, frontend type checking, lint and whitespace checks passed. The local production web server returned HTTP 200 for the page and proxied health, HTTP 401 for unauthenticated conversations, and the API readiness endpoint returned HTTP 200.
- No generated `.next`, `node_modules`, `data`, SQLite, environment-secret or dump files were found among Git-tracked files. Their presence on disk is not evidence that they are published source architecture.
- One parallel build attempt failed from local memory pressure after Docker startup. Checks were rerun at lower concurrency. Compilation and UI fixture success do not establish provider availability.

Logs: `data/robustness-*.log`. Account-level evidence: `data/account-history-audit.json`, `data/account-live-recheck.json`, `data/account-followup-recheck.json`. These are deliberately untracked.

## Production priorities, in order

1. **Provider capacity and answer reliability.** The immediate live blocker is quota, not vector indexing. Provision sufficient embedding/generation capacity; choose a privacy-compatible fallback provider/model; test failover, deadlines and quota exhaustion. Monitor failures by stage, p50/p95 latency, token usage and cost. Keep explicit abstention and supported-fact preservation. Set targets from a measured workload rather than claiming 100% availability.
2. **Independent evaluation.** Build a held-out, human-labeled set from representative documents, including resumes, papers/tables, conflicting policies, unanswerable questions and follow-ups. Measure retrieval recall, citation entailment, unsupported answers, appropriate abstention, repair success and regressions. Synthetic fixtures and model self-assessments cannot establish these metrics.
3. **Durable operations and account lifecycle.** Add durable ingestion/revalidation jobs with idempotency and recovery, tested backups/restores, storage retention, request/stage tracing, alerts and resource budgets. Recovery codes work; email recovery, verified email, session-management UI, MFA and multi-user workspace roles remain separate work.
4. **Temporal correctness and conflict review.** Model immutable document versions, publication time, effective intervals, scope, explicit source precedence and supersession. Then add versioned claim dependencies and background revalidation, including newly competing documents. Whole-library conflict scanning needs bounded jobs, deduplication, incremental updates and authorized review decisions. Do not change `temporal: false` until behavior is implemented and tested.
5. **Scale only against measured bottlenecks.** Add a shared, account/model/revision-scoped cache with consistent invalidation when operating multiple API replicas. Evaluate ANN indexes on representative corpus sizes with access filters and recall measurements. ANN trades recall for speed; adding an index alone does not establish safe retrieval or horizontal scalability. See [pgvector indexing guidance](https://github.com/pgvector/pgvector#indexing). Also address history pagination, object storage, memory bounds and DB connection budgets.

## Explicit limits

Conversation context is bounded and heuristic, not unlimited conversational memory. Source provenance reports the latest successfully verified document answer, not arbitrary earlier turns or a model's hidden reasoning. A fingerprint is not temporal validity. Keyword fallback can miss semantic matches and does not remove LLM quota requirements. The verifier and source comparator remain fallible models. Conflict Center covers saved answer assessments, not every document pair, and has no full authority-adjudication workflow. ANN, distributed semantic cache, full temporal semantics, continuous revalidation, and a comprehensive independent benchmark are not implemented by this patch.
