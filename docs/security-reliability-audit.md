# Backend security and reliability audit

> **10 November ingestion follow-up:** [Upload reliability](ingestion-reliability.md) records durable jobs, provider batching diagnostics, larger-document support and subsequent test results. The ingestion-related limitations below describe the earlier audit baseline.

Session: 9–10 November 2026, Asia/Dhaka (execution logs use UTC). Local changes only; no GitHub push or hosted deployment.

This is a source review and adversarial regression exercise, not an independent penetration test or a security certification. Existing uncommitted work and real user records were preserved. Destructive and concurrency checks used temporary databases, synthetic accounts and disposable PostgreSQL/Redis instances. No production accounts were attacked.

## Findings and fixes

| Risk | Finding | Correction and evidence |
| --- | --- | --- |
| High: verification integrity | The uncertainty recognizer matched substrings. `The device is safe, missing details are not available.` was accepted as an uncertainty-only sentence by both decomposition and verification, skipping the safety assertion. | Only complete, narrowly recognized disclosures can bypass factual checking. Mixed assertions, appended instructions and arbitrary trailing clauses are rejected. Adversarial regression cases retain ordinary missing-evidence disclosures. The original bypass was reproduced before the fix. |
| High: conflict integrity | Comparisons with unknown scope/effective periods disappeared. An LLM's `EXPLICIT` precedence label could also hide a disagreement without an authorized precedence decision. | Different scopes and disjoint periods still exclude incomparable pairs. Unknown applicability remains a visibly qualified review candidate. Model-asserted precedence is recorded as unconfirmed, not accepted as an administrator's decision. Unresolved results are not cached as supported answers. Tests cover the final response and Conflict Center records, including unknown temporal validity. |
| Medium: live query reliability | A live policy comparison repeatedly failed decomposition because the validator treated the conjunction `while` between otherwise covered claims as missing factual content. | Accept this connecting word alongside the existing conjunctions. All assertion/qualifier coverage checks remain; retries identify the omitted character position. Controlled coverage tests pass. A fresh real-provider comparison now returns `UNRESOLVED_CONFLICT`, with both exact sources. |
| Medium: answer usefulness | A valid five-millisecond claim was discarded because a separate negative five-second claim in the same sentence lacked literal support. | Partial output can retain the already assessed standalone supported claim, with citations drawn from its supporting quotes. It remains `PARTIALLY_VERIFIED`, retains unresolved counts, is not cached, and is never called a successful repair. Controlled production-orchestration regression passes; a complete fresh live test of this case is still pending provider quota. |
| Medium: registration consistency | User creation and recovery codes committed before the initial session insert. A storage failure could finish owner setup but leave the user without a successful registration response or delivered codes. | User, legacy import, recovery codes and initial session are now one transaction. Injected session-write failure rolls everything back; a normal retry succeeds. Tested with SQLite and PostgreSQL. This does not make delivery of the HTTP response transactional. |
| Medium: availability | Redis reconnects could keep startup pending indefinitely; commands on a connected but stalled socket had no application response deadline. | Ten-second startup deadline, five-second command response deadline, bounded command queue, and fail-closed admission. A real isolated Redis server paused for six seconds does not execute the protected task; readiness works after recovery. A late Redis write may still execute and its lease expires; a timeout is not treated as server-side cancellation. |
| Medium: auth abuse | Refresh requests had no dedicated limit and malformed tokens still queried session storage. | Shared Redis/local SQLite refresh limit of 120 requests per IP per minute, separate from password-attempt limits. Invalid refresh-token format is rejected before session lookup. Rotation, logout, recovery revocation and browser renewal regressions pass. Edge protection and token-family compromise detection are still separate work. |
| Medium: database parity | Null bytes in JSON text fields and oversized page numbers passed DTO validation but fail PostgreSQL storage. | Reject invalid account names, questions, document identifiers/text/source/version and page values before persistence/provider calls. HTTP regressions run on both database engines. Password semantics are unchanged. |
| Medium: scoped retrieval | PostgreSQL checked embedding compatibility across the entire account even when retrieval explicitly selected one compatible document. | Apply the same authorized document filter to compatibility checking and retrieval. Tests include an unrelated obsolete model/dimension, successful scoped retrieval, and rejection when incompatible sources actually participate. |
| Medium: ingestion budget | A bulk request could receive a fresh 90-second provider budget for each document, monopolizing admission long after the caller stopped waiting. | Share one 90-second embedding budget across the batch, stop new provider work after expiry and reject late embeddings before persistence. Preserve completed documents and report each unfinished document. Cancellation regression confirms one completed document survives and later work does not commit. Database commits retain their own storage timeouts. |
| Low: error robustness | An extremely large numeric provider `Retry-After` could overflow date formatting while building the safe error response. | Ignore implausibly long cooldowns and preserve the sanitized 429 response. Tests cover huge and malformed headers. |
| Low: logging hygiene | Ingestion logs included client-controlled document identifiers and per-document error records. | Routine ingestion logs now contain counts/outcomes rather than identifiers and document-specific details. |

## Actual validation

| Execution | Result | Boundary |
| --- | --- | --- |
| `npm test` | **106 passed, 0 failed** | Backend compilation, SQLite/HTTP integration and controlled provider regressions; fixtures do not establish live model accuracy. |
| `node scripts/test-infra.mjs` after final compilation | **8 passed, 0 failed** | Disposable PostgreSQL/pgvector and Redis, storage rollback, authorization, recovery, migrations, shared limits and stalled Redis. Some test scenarios also appear in the SQLite suite. |
| `npm run test:browser` | **80 passed, 2 intentional skips, 0 failed** | Desktop/mobile workflows, stored HTML treated as text, account switching, recovery, source views, conflicts, correction display and layout. Most browser cases use controlled API responses. Run after initial backend fixes; later changes were backend-only and covered by the final backend/infra runs. |
| `npm run lint`, `npm run web:check` | **Passed** | Static checks; no frontend redesign in this audit. |
| `npm audit --json` | **0 known dependency advisories** | Registry advisory coverage is not proof of application security. |
| `node scripts/assess-local-system.mjs` | **25/25 checks passed** | Actual localhost API: unauthenticated access, forged token, account mismatch, CSRF, malformed queries/cursors, path/SQL-shaped IDs and invalid uploads. No provider calls. |
| Read burst | **40/40 successful**, concurrency 5; p50 **15 ms**, p95 **213 ms**, max **305 ms** | Small authenticated reads, not a sustained capacity or RAG-load benchmark. |
| Live policy conflict diagnostic | **Expected unresolved conflict**, 38,157 ms, 4 model calls, 1 source conflict | Synthetic documents through real configured retrieval/providers. Diagnostic did not persist a new chat message. Not a new full nine-question benchmark. |
| `node scripts/check-local-workspace.mjs` after final restart | **Passed; no runtime errors** | Actual synthetic account and local UI/API: 6 documents, 25 loaded completed answers, 8 marked verified, 2 conflict records, 0 recorded repairs. These are observed saved records, not new model evaluations or global analytics totals. |

Final localhost checks returned frontend **200**, API readiness **200**, and unauthenticated document access **401**. Both local servers remain running. The two labeled test containers and their anonymous volumes were removed; Docker Desktop was restored to its initially stopped state.

The live conflict was first reproduced as `VERIFICATION_FAILED` with two rejected decomposition contracts. After the coverage fix, the fresh live diagnostic produced both source-attributed policy values and a qualified unresolved outcome. It did not establish a unique policy value or perform a factual repair.

The provider's authenticated quota response reported **49 used / 50 allowed / 1 remaining** after the live diagnostics. A complete generation/decomposition/verification cycle needs more than one call. The unit-and-injection live rerun and a fresh full nine-case run are therefore **not claimed as passed**. No provider/model was switched and no additional subscription was used. The earlier seven-of-nine live result remains historical evidence, not the result of this audit.

Raw local logs are ignored under `data/security-*.log`; the dependency report is `data/security-dependencies.json`. The synthetic live diagnostic is `data/hard-query-diagnosis-genuine-conflict.json`. These operational files are not publication artifacts and are not a substitute for the reproducible tests.

## Files changed in this audit

- Authentication: `src/auth/auth.service.ts`, `src/auth/auth.controller.ts`.
- Infrastructure/errors: `src/common/redis.service.ts`, `src/common/provider.ts`, `src/database/database.service.ts`.
- RAG/retrieval: `src/rag/atomic-facts.ts`, `verification.ts`, `rag.service.ts`, `rag.controller.ts`, `conflicts.ts`, and `src/vector-store/vector-store.service.ts`.
- Regressions: `src/tests/atomic-facts.test.ts`, `auth.test.ts`, `infra.test.ts`, `rag.test.ts`, `reliability.test.ts`, `hardening.test.ts`.
- Documentation: this report, `README.md`, `SECURITY.md`, and the link at the top of the historical production review.

Other working-tree changes predate this audit and were not discarded.

## Remaining release risks, in priority order

1. **Provider capacity and factual evaluation.** A shared free quota is inadequate for a reliable public service with multi-call verification. Provision appropriate capacity and privacy-compatible failover, enforce per-account spending budgets, and rerun held-out live cases. Strict schemas and exact quotes do not prove entailment or eliminate prompt injection. No independent correctness percentage or repair-success improvement is established here.
2. **Internet-facing abuse and account lifecycle.** Public signup lacks verified email, MFA and bot defenses. Many accounts can consume shared resources despite per-account/IP limits. Reverse-proxy trust must match the real deployment. Refresh replay does not revoke a token family. Full session management, deletion/retention policy and recovery delivery still need product work.
3. **Temporal knowledge and adjudication.** There is no complete valid-time model, authorized supersession registry, library-wide conflict scan, manual resolution workflow or durable background answer revalidation. Conflict Center exposes actual saved assessments and review candidates; it is not a complete policy adjudication system. Capability flags remain honest.
4. **Scale and storage.** Exact pgvector search and process-local semantic answer cache remain. Original files/history live in the database; history retention and aggregate account growth need quotas/operations policy. Durable ingestion jobs, independently tested backups/restores, realistic sustained workload and service-level objectives are not supplied by passing local tests.
5. **Isolation and resilience.** Parser heap/deadline isolation is not an OS sandbox or malware scanner. Deployment connection limits, telemetry/alerts, safe network policy and incident handling still need operational validation. A lost coordination lease fails closed at completion but does not roll back work already committed; interrupted work requires inspection of saved state.
6. **Model edge cases.** Unknown wording can still cause a strict verifier contract rejection. Negative claims across different units can remain unresolved; partial assembly now retains their supported neighbors. Source-count prose can still produce conservative numerical downgrades. These are exposed limitations, not reasons to silently approve uncertain answers.

The application is better defended against the specific reproduced failures. These results do not justify describing every feature as complete, the application as bug-free, or factual verification as guaranteed.
