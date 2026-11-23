# Research release capability contract

17 November 2026. This describes the current local source, not the previously hosted build. "Implemented" means code and covered regressions exist; it does not mean failure-free or independently validated factual accuracy.

| Requirement | Status | Boundary |
| --- | --- | --- |
| Accounts, JWT sessions, isolation and recovery codes | Implemented | Personal libraries; no shared-workspace membership administration |
| PDF/DOCX/TXT/Markdown ingestion | Implemented | 10 MB, 500,000 extracted characters, 1,000 chunks for the durable queue; no OCR |
| Persistent indexing progress and restart recovery | Implemented | Provider quota/availability still required; incomplete indexes stay hidden |
| PostgreSQL/pgvector and Redis | Implemented | Exact vector ranking; Redis is used for limits/leases and the separate BullMQ worker, not shared answer caching |
| Hybrid retrieval and named-source comparisons | Implemented | Candidate/context budgets can miss evidence; fallback lexical retrieval remains labeled |
| Atomic decomposition, verification and bounded repair | Implemented | Model assessments plus deterministic safeguards, not truth guarantees |
| Final verification and substantive repair status | Implemented | A grammatical rewrite is not a successful factual repair |
| Citations and saved correction attempts | Implemented | Passage references, source IDs and content versions; exact PDF page mapping not guaranteed |
| Conversation history and semantic caching | Implemented | Limited reference context; process-local cache guarded by owner/revision/scope |
| Conflict Center evidence display | Implemented, partial feature | Derived from up to 200 saved answer assessments; no full-library scan |
| Human conflict decisions and authority precedence | Implemented locally | Owner-scoped UI, revision checks, paginated audit and deterministic proposition/source-version matching; no inferred global authority or shared-workspace administration |
| Temporal source metadata and effective-date retrieval | Implemented locally | Explicit metadata UI, current/historical retrieval and archived versions have controlled tests; unknown dates stay unknown, models can still miss scope |
| Continuous answer revalidation | Implemented locally | SQL outbox, separate BullMQ worker, fenced appended versions and integrated UI; real browser/SQL scheduler flow uses scripted inference. Cloud and live-provider acceptance remain open |
| Email recovery, MFA and email verification | Not implemented | One-time recovery codes only |
| Research demonstration and live correction harness | Implemented | Seven synthetic cases; independent review and general-domain benchmark remain external release evidence |
| Local Docker installation and restore | Tested within M5 controlled acceptance | Separate worker, persistent queues, PDF/correction workflow, natural-lease crash recovery and second-project restore; simulated inference, no cloud acceptance |
| Production capacity and availability | Unproven | No production SLA, comprehensive load study or completed production restore drill |

No dormant route, demonstration record or directory should be presented as a completed feature. Controlled local tests demonstrate both request-time and background correction. `/rag/health` describes implemented local capabilities and runtime scheduling separately from unverified live-provider/cloud acceptance; scheduler configuration alone is not proof that an individual job succeeded. See [current readiness](RELEASE_READINESS.md) and [the implementation plan](IMPLEMENTATION_PLAN.md) for current evidence rather than treating older release counts as current results.
