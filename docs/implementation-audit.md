# TemporalGuard interface and foundation audit

Date: 2026-10-27

Branding update: the user subsequently renamed the product to **Veriqon**. The current UI uses a monochrome palette, a stacked-line mark, and persistent Light / Dark / System appearance controls. The TemporalGuard name below records the original project brief. `theme.css` owns semantic colors for both themes; the first-paint script and theme provider keep persisted appearance consistent through hydration and device preference changes.

## Latest implementation update

SQLite persistence and private account libraries are implemented in `src/database` and `src/auth`. The first owner uses a server-local setup code and receives the preserved legacy documents; later accounts have isolated documents. JWT access cookies, rotating refresh tokens, session revocation, scrypt password hashes, CSRF checks and sign-in limits are covered by HTTP integration tests. PDF/DOCX/TXT/Markdown uploads now retain original file bytes and support authorized downloads. Questions, answers, citations, failures and successful repairs are saved per account in SQLite and reopened through the Chat history sidebar. The former manual snapshot endpoints are removed. The UI includes account onboarding, sign-in, sign-out, account settings and both appearance modes.

The findings below describe the original baseline. Authentication and ingestion gaps identified there have been addressed for a single-host personal-library deployment. Shared workspace membership, password recovery, email verification, MFA, worker isolation, distributed storage and enterprise operations remain future work. See the README for the current API and setup instructions.

## Scope delivered (original baseline)

This increment adapts the supplied three-column interface to the existing project. It adds a real Next.js frontend, retains NestJS and OpenRouter, improves request-time answer repair, and establishes executable validation. It is **not completion of all six phases** in the supplied TemporalGuard specification. The PostgreSQL migration and enterprise authorization remain prerequisites for a multi-user deployment.

## What the original source actually did

| Component | Finding | Decision |
| --- | --- | --- |
| `RagController` | Six `/rag` routes for ingestion, querying, listing and snapshots | Retain routes; add health; enforce DTO validation |
| `VectorStoreService` | Character chunks, per-chunk OpenRouter embeddings, in-memory cosine search, manual JSON snapshots | Retain integration; preserve old document if replacement embedding fails |
| `RagService` | Generation, free-text model verification, one regeneration attempt | Replace verdict regex with structured sentence assessments; verify the repair and abstain on repeated failure |
| Confidence | Average semantic similarity labeled confidence | Remove misleading confidence; present model assessments and explicit evidence |
| Persistence | New documents with the same ID replaced old content; JSON snapshots were manually saved/loaded | Preserve compatibility, explicitly disclose that this is not immutable versioning |
| Validation | Decorated DTOs but no global validation pipe | Enable validation and bound field lengths / batch size |
| Tests | A console message and manual HTTP scripts | Add deterministic unit and HTTP integration tests plus browser tests |
| Frontend | Absent | Add `apps/web` as an npm workspace |
| Documentation | Claimed production readiness without supporting tests | Replace with an accurate implementation status |

## Interface decisions

- Preserve the reference's navigation / knowledge / assistant arrangement. The current branding update uses black/white surfaces, grayscale borders, sans-serif headings and readable contrast in both dark and light modes.
- Keep the assistant available while browsing the knowledge base, evidence, repairs and observed results.
- Use actual API data. No invented document rows, verification percentages, temporal dates, cost metrics or successful scans.
- Support UTF-8 TXT/Markdown up to 100,000 bytes per file, ten files per UI batch. PDF/DOCX support requires a backend ingestion service; changing `accept` alone would be misleading.
- Display full retrieved passages in accessible Radix dialogs. Document content is rendered as text, never injected as HTML.
- Separate immediate answer repairs from continuous revalidation. Current repairs and conversations live only in React memory; no persistent audit history is claimed.
- Explicitly expose capability gaps in the conflict, reliability and settings views. No historical date filter is offered until retrieval can honor it.
- Keep conversations independent: chat history is a session UI, not multi-turn model context.
- The browser talks to same-origin `/api/rag/*`; Next forwards to a server-configured API origin. Provider credentials never enter browser bundles.

## Request-time repair procedure

1. Retrieve up to `TOP_K` chunks (clamped to 1–10).
2. Generate a draft from those chunks, treating source text as untrusted input.
3. Split the draft into sentences. Ask the configured verifier to return one exact assessment per sentence and supporting evidence indexes.
4. Reject malformed JSON, missing/reordered assessments, nonboolean decisions, unsupported statements, out-of-range indexes, and supported statements with no evidence indexes.
5. If verification fails, generate one repair using the original draft and the same evidence, then assess again.
6. Return a supported or repaired answer only after a passing assessment. Otherwise return an abstention.

The JSON validation checks format and reference integrity, not semantic truth. The model can still make mistakes, the sentence splitter is simple, and related sentences are not necessarily atomic claims. Independent entailment evaluation and human-labeled benchmarks remain necessary. Prompt instructions mitigate but do not prove resistance to document prompt injection.

## Dependency changes

The existing NestJS 10 dependency tree had security advisories. Framework packages were upgraded together to 12.2.0 and nodemon to 3.1.14. A `multer` override to `^2.5.0` addresses the remaining transitive advisory. The application does not use multipart ingestion. Keep the override until the upstream adapter's version range includes the patched release, then reevaluate it.

Next.js 16, React 19, Tailwind 4, Radix Dialog and Lucide provide the frontend. Exact resolutions are recorded in `package-lock.json`. TypeScript stays at 5.x because this repository uses `tsc` directly, not the Nest CLI/schematics upgrade path.

References checked: [Next installation](https://nextjs.org/docs/app/getting-started/installation), [Next rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites), [Nest migration guide](https://docs.nestjs.com/migration-guide).

## Next migration phases

1. **Complete persistence foundation:** move the retained API into `apps/api` when introducing shared contracts; PostgreSQL/pgvector migrations, immutable document versions, scoped repositories, and migration of existing JSON snapshots.
2. **Authentication and ingestion:** workspace membership and document authorization enforced before retrieval/model calls; safely parse PDF/DOCX in background workers; upload limits, rate limits and durable job state.
3. **Temporal and conflict services:** explicit effective intervals, unknown metadata, scope and authority rules, supersession, immutable evidence conflicts and authorized resolution history.
4. **Continuous maintenance:** persisted answers/claims/evidence dependencies, transactional versioned repairs, Redis/BullMQ jobs, retries, idempotency, new competing-source detection and historical-answer preservation.
5. **Research and deployment:** deterministic STER policies, independently labeled chronological scenarios, baselines/ablations, cost/latency instrumentation, cross-tenant tests, operational threat model, backups, CI/CD and validated containers.

The supplied 16-step temporal maintenance acceptance scenario is not yet supported. No novelty, benchmark improvement, factual accuracy guarantee or enterprise production readiness is asserted.

## Changed file groups

Created: `apps/web` (app, styling, components, typed API client and configuration); `src/tests/rag.test.ts`; `tests/browser/workspace.spec.ts`; `playwright.config.ts`; `eslint.config.mjs`; `.gitignore`; this audit; CI workflow.

Modified: root package/lock/TypeScript configuration, README and environment example; `main.ts`; RAG controller/service; vector store; chunk utility; evaluation smoke script. Removed the console-only sample test. Existing `.env` credentials were not read or modified.

See the README for commands and the validation record. Browser fixtures are isolated by Playwright network routing and are not production application data.
