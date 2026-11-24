# Recruiter and engineering review — 2 November 2026

## Hiring assessment

Veriqon addresses a concrete problem: a reader needs to ask questions about private documents, inspect the exact passages behind an answer, and distinguish supported answers, corrections, missing evidence and conflicting sources. The strongest portfolio evidence is the implementation of those decisions across authenticated storage, retrieval, claim checks, repair, citations and saved history.

The honest positioning is **a document research application with a tested evidence-checking and repair pipeline**. “Perfect”, “hallucination-free”, “100% secure”, “enterprise scale” and “faithful RAC reproduction” are not supported claims. The verifier is a fallible model; a fixture proves that a policy is enforced, not that a model reliably recognizes truth in unfamiliar papers. See [the RAC method](rac-method.md) and [prior reliability findings](robustness-review.md).

A recruiter should ask for a reproducible demonstration, the failure cases, the contribution beyond the cited paper, and measurements on unseen, independently labeled documents. A polished dashboard or a passing build alone is insufficient. The engineering contribution is the bounded orchestration and audit trail; research novelty and superiority still require controlled evidence.

## Issues addressed in this review

| Finding | Consequence | Implementation and validation |
| --- | --- | --- |
| Upload work limits ran after multipart buffering | Concurrent authenticated requests could allocate upload buffers before admission control | A pre-Multer interceptor bounds active uploads to four per API process and one per account. Oversized declared bodies are rejected before reading, multipart parts/headers are bounded, and receiving has a 30-second absolute deadline. HTTP tests hold a chunked upload, reject a second upload, abort the first and successfully upload again. Existing distributed work limits still protect processing. |
| Browser identity could change during an old tab's request/refresh | An old draft could be submitted using another account's newly shared cookies | The browser snapshots its displayed account in a request header; the authenticated backend rejects a mismatch before private reads or writes. The header is a consistency check, never an authorization credential. HTTP tests verify both reads and writes; browser tests check workspace reset and draft isolation. |
| Recovery codes could remain in component state after session changes | Codes from the preceding account could reappear | Clear recovery codes on expiry, logout and cross-tab account changes. Reuse the existing BroadcastChannel so a tab does not process its own notification and erase the codes it just generated. Registration/download/acknowledgment regression tests cover the flow. |
| History loaded every result in up to 100 conversations | Unbounded response size and JSON parsing cost; older conversations were inaccessible | Stable cursor pagination returns 20 conversations with ten recent messages each; older messages load in pages of 30. SQL ranks message keys before loading bounded result blobs, with a batched query rather than per-conversation round trips. UI load/retry controls preserve drafts and disclose search/analytics coverage. Tests traverse 25 conversations and all 47 messages in a long chat, including timestamp ties and cross-account denial. |
| Cursor input lacked a strict HTTP contract | Malformed query shapes could silently select the default page | Validate the query DTO and cursor shape; reject malformed, oversized and injected inputs with HTTP 400. Values remain bound SQL parameters. |
| A correction demonstration could bypass actual HTTP/persistence wiring | A unit-only success might not represent a usable application flow | Added an isolated HTTP scenario with real authentication, ingestion, retrieval, production verification/repair orchestration and answer persistence. Only provider responses/embeddings are controlled. It corrects “five datasets” to “three datasets”, preserves the supported training sentence, verifies again and persists the exact source fingerprint. This is a regression demonstration, not a live-provider benchmark. |

Source changes: `src/rag/upload-admission.interceptor.ts`, `rag.controller.ts`, `src/auth/auth.guard.ts`, `src/database/database.service.ts`, `history-cursor.ts`, frontend session/auth/history components, API types, test scripts and new backend/browser hardening tests. Earlier uncommitted improvements were preserved. All work stays local; no GitHub push or hosting deployment is part of this review.

## Verification record

Actual executions on this local working tree:

- Backend suite: **84 passed, 0 failed**. The expanded HTTP correction scenario also passed in its subsequent focused run.
- Desktop/mobile browser suite: **68 passed, 2 existing viewport-specific skips, 0 failed** on the final complete run. Recovery/history focused run: **10 passed**.
- Isolated PostgreSQL/pgvector and Redis suite: **8 passed, 0 failed**, including authentication/recovery, history pagination, upload abort recovery, numerical correction/persistence, database restart/ownership, Redis leases and SQLite import. The two disposable containers were removed, and Docker Desktop returned to its initial stopped state.
- Backend compilation, production Next build, frontend type checking, lint and whitespace checks passed.
- Production-server smoke: frontend page, proxied health and API readiness returned HTTP 200; unauthenticated history returned HTTP 401. The local development frontend was restored afterward.
- Dependency audit: **0 known vulnerabilities**. Generated data, `.next`, `node_modules`, SQLite/dump files and secret environment files were absent from the tracked-path check. These are not exhaustive secret-history scans or a penetration test.
- No live-model accuracy, repair-rate, p95 latency, sustained-load or API-cost benchmark was executed in this review. No Docker application image rebuild or hosted deployment was performed.

Logs are private operational files under ignored `data/recruiter-*.log`; no account data or secrets belong in the repository.

The initial browser pass found two failures: a genuine recovery-code display regression introduced during this patch, and an ambiguous test locator matching both the sidebar and history list. Both were corrected; a focused ten-case desktop/mobile rerun passed. No failure is being hidden by deleting or weakening the behavioral tests.

## What still blocks a production claim

| Priority | Area | Required evidence or next change |
| --- | --- | --- |
| P0 | Provider capacity | Real prior requests returned embedding and generation HTTP 429. Provision a privacy-compatible provider with sufficient capacity, bounded failover, budgets and measured availability. No new API subscription or fallback data recipient was configured here. Free quota cannot be repaired in application code. |
| P0 | Evaluation | Use held-out human-annotated questions with exact supporting passages, unanswerable cases, tables, conflicting versions and follow-ups. Report citation entailment, incorrect acceptance, repair precision, unnecessary repair, abstention, latency and cost. Synthetic regression tests and the verifier's own labels are insufficient. |
| P0 | Credential hygiene | Rotate any passwords, recovery codes, provider keys or connection strings previously disclosed if they remain active. This patch does not silently reset real accounts or rotate external services. Keep secrets out of public history, screenshots and logs. |
| P1 | Account abuse and lifecycle | Public registration has no verified email, MFA or edge bot defense. Per-account/IP throttles do not stop distributed multi-account abuse. Session inventory/revocation UI, account deletion/export and retention need implementation. Recovery codes work; email recovery is not configured. |
| P1 | Durable operations | Ingestion/revalidation need durable, idempotent jobs. Add request/stage correlation, metrics, alerts, quota/cost budgets and a real backup/restore drill with recovery targets. A database readiness check does not prove that an AI provider is usable. |
| P1 | Prompt injection and files | Source text is untrusted; strict schemas and exact quotes cannot establish semantic truth or comprehensive injection resistance. Parser isolation is a process boundary, not an OS sandbox or malware scanner. Add adversarial evaluation and deployment-level body/connection limits. Full CSP hardening and an independent penetration test remain work. |
| P1 | Temporal/authority behavior | Immutable versions, effective intervals, explicit source precedence, whole-library conflict jobs, human adjudication and continuous revalidation remain incomplete. The health endpoint correctly keeps `temporal: false`. Do not market these roadmap items as implemented features. |
| P2 | Measured scale | Exact vector retrieval, process-local semantic cache and full document-text refreshes remain bottlenecks for larger/multi-instance deployments. Add revision-aware metadata reads, then measure retrieval recall/latency before choosing ANN; use scoped shared caching and consistent invalidation when replicas are required. History pagination bounds responses, not total data retention or every database operation. |

Do not add infrastructure solely to lengthen the technology list. Stabilize the supported workload and demonstrate useful outcomes first. For an initial release, publish explicit document/account limits and describe which failure states are supported rather than promising no failures.

## A credible demonstration

1. Create an isolated account, save recovery codes, upload a small document and reopen the saved library.
2. Ask a factual question; inspect the cited passage and its document fingerprint. Multiple citation numbers can refer to passages from one file.
3. Demonstrate the controlled incorrect-number regression and inspect the preserved sentence, accepted edit and final verification.
4. Ask a question the document cannot answer; show explicit insufficient evidence without an invented value.
5. Show genuine competing source evidence in Conflict Center and its unresolved status. Explain that this is saved-answer analysis, not whole-library adjudication.
6. Simulate quota/timeout and account-switching failures; verify understandable errors, preserved history and isolation.
7. Run the checks and disclose the distinction between mocked provider contracts and live-model evaluation.

The upload and session review uses the [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) and [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) as guidance. This is not a claim of OWASP compliance or exhaustive security coverage.
