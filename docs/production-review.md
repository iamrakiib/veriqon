# Veriqon engineering and product review

> **Deployment follow-up (27 October 2026):** This review records the earlier baseline. PostgreSQL/pgvector, asynchronous storage, Redis shared limits/leases, parser subprocess limits, Docker, Vercel/Render configuration, CI, and tested SQLite import are now implemented. See [DEPLOYMENT.md](../DEPLOYMENT.md) for the current architecture. References below to SQLite-only persistence, process-local-only limits, in-process production parsing, or missing containers are superseded. Temporal revalidation, workspace administration, independent ML evaluation, durable jobs, and service objectives remain unresolved.

Review date: 27 October 2026. Scope: current source, original TemporalGuard brief, deterministic backend/HTTP tests, desktop/mobile browser flows, build and dependency audit. No production traffic, live provider accuracy study, penetration test or load test was performed. No claim that every bug has been found.

## Verdict a recruiter can defend

This is a working single-host RAG application with a useful engineering foundation, not yet the complete enterprise temporal knowledge system in the brief. A good portfolio presentation demonstrates upload -> retrieval -> verification -> repair/abstention -> saved evidence, explains failure modes, and shows isolation tests. It should not claim autonomous continuous correction, temporal intelligence, measured hallucination reduction or enterprise readiness.

Strengths: real API integration, authenticated personal libraries, explicit abstention, preserved citations, durable conversations, regression tests, and honest capability disclosure. Weaknesses: no independent retrieval/entailment evaluation; linear vector scans and synchronous SQLite; no shared-workspace administration; no worker recovery system; no version graph or temporal policy; monolithic JSX; no measured service objectives. Calling an account `owner` does not implement administrator authorization or workspace membership.

Defensible resume claim: "Built a NestJS/Next.js RAG workspace with JWT session revocation, account-scoped SQLite storage, PDF/DOCX ingestion, evidence verification, bounded answer repair, persistent citations and automated isolation tests."

## Original acceptance scenario

| Step | Current implementation | Result |
| --- | --- | --- |
| 1. Administrator creates an authorized workspace | Personal account library only; no workspace CRUD or membership | Missing |
| 2. Upload Policy v1 | PDF/DOCX/TXT/MD uploads; source/version fields are not immutable version entities | Partial |
| 3–7. Ask, retrieve, generate, verify, optionally repair | Implemented and deterministically tested; live factual quality unmeasured | Implemented with limits |
| 8. Persist answer and claims | JSON answer/assessment/citations in SQLite, no normalized claim dependency graph | Partial |
| 9. Upload Policy v2 | Another document or replacement; no explicit supersession/validity model | Partial |
| 10. Detect substantive information change | Library revision detects any write/delete, not semantic change | Missing semantic detection |
| 11. Identify affected answers | Conservative library-change notice only; no claim-level impact analyzer | Missing |
| 12. Workers revalidate selected claims | No durable queue or selective scheduling | Missing |
| 13. Repair unsupported current claims after updates | Only request-time repair; no continuous correction | Missing |
| 14. Preserve historically valid answers | Stored citation text survives changes; historical validity cannot be established | Missing temporal semantics |
| 15. Inspect history/citations | Saved conversations and successful/withheld repair outcomes | Implemented for request-time results |
| 16. Report actual processing and reliability | Counts/outcomes for loaded recent conversations; no worker, token or cost telemetry | Partial |

Unauthorized-access and failed-verification abstention have automated coverage. The full 16-step scenario has **not** passed.

## Bugs addressed in this review

| Priority | Finding | Change and evidence |
| --- | --- | --- |
| High | Replaying a request could create duplicate messages/provider work | Optional UUID `messageId`, owner-scoped replay, mismatched-payload conflict, pending/failed-request conflict. HTTP tests assert one saved message and one generation. |
| High | No admission control on expensive authenticated operations | One active operation per account, four across this API process, 20 operations/account/minute persisted in SQLite; released on errors. Unit/HTTP limits tests. This is not a distributed quota system. |
| High | Draft could cite nonexistent sources despite verifier approval | Reject out-of-range numeric references; supported inline references must match verifier evidence indexes. Repair or abstain on failure. Regression tests. |
| High | Incomplete/content-filtered provider output could be accepted | Require a normal stop, retaining separate truncation/empty errors. Tests cover filtered/tool-call/incomplete responses. |
| Medium | Zero embeddings produce meaningless similarity rankings | Reject all-zero and nonfinite vectors before storing. Regression test. |
| Medium | Re-uploading an identical document repeated embedding calls | Reuse indexed text when ID, text, metadata and embedding model match; attach original bytes without re-embedding. Test verifies provider call count. |
| Medium | Library could change during generation; saved answers appeared current | Save library revision; avoid caching results generated across a revision change; mark saved answers when their revision differs. This warning is conservative, not temporal reasoning or automatic revalidation. |
| Medium | No way to remove a mistaken upload | Authorized delete with explicit UI confirmation; chunk cascade and revision invalidation. Saved historical citation excerpts intentionally remain. Cross-account deletion/download checks. |
| Medium | Two tabs could race refresh-token rotation | Serialize renewal using the browser Web Locks API, while retaining per-tab single flight. Two-tab browser regression test. Browsers without Web Locks retain only the per-tab fallback. |
| Medium | Chat state leaked between selected conversations in the UI | Key the chat panel by conversation, resetting unsent composer/tab state on selection. Saved messages remain unchanged. |
| Medium | History search and repair discovery were poor | Search loaded recent titles; explicit no-match/retry states; show withheld repair attempts without presenting unsupported text as an accepted answer. |
| Medium | Evidence tabs lacked keyboard navigation; completion feedback and timing were unclear | Roving tab focus with arrows/Home/End; response/copy announcements, explicit mobile navigation close/Escape and focus containment, elapsed wait feedback, separate abstention labels, reduced-motion scroll, copy action and library-change notices. |

## Remaining release blockers

1. **Authorization and account lifecycle.** Workspace membership, administrator actions, invitations, email verification, password recovery, session management UI and MFA are absent. Signup should be closed for a private deployment. Current per-address limits see the proxy address unless deployment topology is configured correctly.
2. **Persistence and scale.** The requested PostgreSQL/pgvector/object-storage stack is not implemented. SQLite synchronous access, JSON vector parsing, whole-document listing, recent-100 conversation loading and brute-force cosine search have not been load-tested. Original files and historical excerpts increase database size. Storage quotas, deletion/retention policy and a tested backup/restore procedure are needed.
3. **Untrusted files.** Size/type checks exist, but PDF/DOCX parsing remains in the API process. A malicious compressed document can exhaust CPU/memory before extracted-text limits apply. Move parsing into isolated workers with memory/CPU/wall-time limits, scan uploads as appropriate, and record durable ingestion jobs. The current limiter reduces concurrent work but does not fix parser isolation.
4. **Knowledge integrity.** Add immutable document versions, publication/effective periods, scope, authority and explicit supersession. Do not infer authority from upload recency. Document-level source metadata and chunk ranges do not replace exact PDF page/section provenance.
5. **Continuous correction.** Model normalized claims, evidence dependencies and versioned answer revisions; introduce Redis/BullMQ with idempotent jobs, retry/dead-letter handling and concurrency-safe revision commits. Preserve earlier answers. Then implement conflict adjudication and budget-aware revalidation.
6. **ML reliability.** Character chunking and vector-only ranking are baselines. Evaluate structure-aware chunking, lexical/semantic hybrid retrieval and reranking before changing defaults. Sentence splitting is not atomic claim extraction. Generator and verifier may share correlated failure modes. Prompt-injection instructions do not prove resistance. Citation index checks establish reference integrity, not entailment.
7. **Operations.** OpenAPI, deployment containers, OpenTelemetry, worker/readiness metrics, token/cost accounting, alerting and restore drills are absent. Local loopback servers and passing unit tests are not a reviewed public hosting configuration. API admission limits are single-process and not a substitute for edge limits or provider budgets.
8. **HCI and access.** No user study or complete WCAG audit has been performed. Search currently covers loaded recent chat titles. Questions remain independent, so pronoun-based follow-ups are not resolved automatically. Conflict center is clearly marked Planned. Unverified generation is deliberately not streamed as if it were a final answer.

## Research evaluation required before performance claims

Freeze a versioned corpus and held-out question set with answerable, unanswerable, conflicting and time-dependent cases. Have independent annotators label supporting passages, atomic claims and valid time intervals; report disagreements. Keep tuning examples separate from test examples. Compare vector-only RAG, generation plus verification, verification plus repair, and the later temporal/maintenance system on the same corpus and provider settings.

Measure retrieval recall@k and ranking quality; claim support precision/recall; citation entailment; abstention precision/coverage; repair success and regressions; contradiction and historical-time accuracy. Record p50/p95 latency, actual tokens/cost, failed requests and per-update revalidation work. Report uncertainty and failure examples. Stored model verdicts are not ground truth. The existing `evaluate` script is a live smoke test, not this benchmark. No novelty or accuracy improvement is established by this review.

## Recommended delivery sequence

1. Complete account/workspace authorization and a bounded, observable ingestion pipeline.
2. Migrate repositories to PostgreSQL/pgvector and object storage with reversible, tested data migration and backups.
3. Implement document version/temporal models and human-reviewable conflicts; run the Policy v1/v2 acceptance fixture.
4. Add durable claim dependencies, revalidation workers and history-preserving corrections.
5. Run independent benchmark ablations, load/security/accessibility tests and deployment recovery drills before a production-readiness review.

These are remaining engineering requirements, not features silently supplied by the UI or by adding another API key.

## Validation record for this review

- 28 backend tests passed, including owner-scoped request replay, deletion isolation, revision warnings, invalid citations, incomplete output, embedding reuse/zero rejection, and admission-control cleanup.
- 29 desktop/mobile browser tests passed; one duplicate mobile invocation of the multi-viewport test is intentionally skipped. Coverage includes multi-tab renewal, saved history, keyboard evidence tabs, document deletion/cancellation, mobile navigation, withheld repairs and viewport fit.
- Backend TypeScript build, frontend type checking, lint and optimized Next build passed.
- `npm audit` reported zero known dependency vulnerabilities at review time. This does not establish application security.
- Desktop/mobile screenshots were inspected; the live frontend proxy returned 200 for health and 401 for unauthenticated history. No real user documents were deleted and no live model calls were used in this review.

Current API examples are in `POSTMAN_TESTS.md`; they now include authentication, CSRF headers, saved conversations, idempotency and authorized deletion.
