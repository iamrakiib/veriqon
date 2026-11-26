# Release readiness

Updated 26 November 2026. Veriqon has a deployed research application and tested local workflows. It is not certified bug-free, independently proven factually accurate, or covered by an availability SLA.

## Published baseline

[PR #11](https://github.com/iamrakiib/veriqon/pull/11) merged commit `9ea7859a96d7da74f288569e8207e0d77837ccfb`. Required GitHub `verify` and `docker-installation` checks passed, including container recovery/backup/restore. Both hosting services were verified on that commit:

- [Frontend](https://veriqon-two.vercel.app): Vercel deployment `dpl_GJWMh6zFAiKAgSnv24A8ffSA2tiE`, READY.
- [API](https://veriqon-api.onrender.com): Render deployment `dep-dc2vaqetlv9c738rto2g`, live.
- Neon: pgvector 0.8.0, migrations 1–4 applied. A predeployment backup was restored into an isolated local database.
- Eighteen live follow-up assertions passed with the existing synthetic account: login, private cache controls, original PDF hash and conversation persistence, desktop/mobile history/analytics/Corrections in both themes, no browser errors and a versioned v17 answer. That one real-provider answer took 7,071 ms; it is not an average or accuracy benchmark. Initial registration/PDF-indexing acceptance was recorded with PR #10.

The free Render service runs integrated SQL-backed background processing. It is **not** the separate always-on API/worker/BullMQ profile in the deployment Blueprint. Vercel was published through the CLI; automatic Git repository linking remains unconfigured. Main is protected against deletion/force-push and requires pull requests plus the two passing checks.

## Current follow-up

The current follow-up fixes theme-dependent mobile spacing and inconsistent sidebar/history search, adds confirmed conversation deletion, and guards deletion against stale tabs and running jobs. Its validation and publication state are recorded at the top of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Hosting results for the eventual follow-up commit belong in its protected PR release record.

On 26 November three real-provider fact-check attempts were rejected with HTTP 401 before decomposition. A valid OpenRouter key is required for further live AI evaluation; this is not evidence that documents lack an answer or that factual verification passed. The existing deployment evidence above is historical, not a guarantee of current provider availability.

A deployed answer at 08:34 UTC on 24 November failed because the model returned a supporting quote that did not match the cited passage, including after its bounded retry. All four provider calls completed successfully. This was an invalid assessment contract, not a provider outage or a finding that the document lacked the answer. Two later observed answers passed the model-based verification contract; these observations do not establish general accuracy.

## Functional boundaries

| Area | Demonstrated | Remaining boundary |
| --- | --- | --- |
| Authentication and private storage | Sessions, account isolation, recovery codes, SQLite/PostgreSQL regressions | No email reset delivery, email verification, MFA or shared-workspace administration |
| Ingestion and retrieval | Durable checkpoints, batched embeddings, lexical/dense retrieval, scoped/versioned evidence | Provider quotas, OCR, ANN-scale retrieval and broader recall benchmarks |
| Verification and factual repair | Atomic claims, strict quotes, targeted retrieval, bounded minimal repair, final verification, honest abstention | Models can misjudge entailment or return malformed output; independent factual evaluation incomplete |
| Conflict Center | Exact source pairs, metadata, explicit review decisions, audit history, display archival | Not an exhaustive library-wide conflict scanner |
| Continuous correction | Versioned revalidation, new competing evidence, retries and crash recovery tested locally with controlled inference | Full hosted document-update/correction/restart acceptance remains unverified |
| Frontend | Desktop/mobile workflows, themes, history, citations, corrections and analytics regression coverage | Metrics describe observed records, not global billing or factual accuracy |
| Docker | Clean installation, separate worker, persistence and restore tested | Capacity beyond the recorded workload is unknown |
| Cloud | Vercel + Render + Neon deployment and narrow live PDF/query smoke | Dedicated worker, managed BullMQ validation and uninterrupted background processing are not established |

## Open release gates

1. Broaden quote-reference validation beyond the one passing synthetic real-provider retry (2,356 ms; 1,133 input and 75 output tokens). Its initial malformed quote and decomposition were controlled; it does not establish recovery of every real document question. LIVE-002 and independently reviewed factuality results remain open.
2. Run the full hosted lifecycle: authoritative document update → automatic revalidation → corrected immutable version → API/worker restart → persistence verification.
3. Establish always-on worker resources and validate the selected managed Redis service for BullMQ before claiming continuous cloud processing.
4. Complete independent held-out annotations, retrieval/citation support evaluation and repeatable latency/token measurements. Test passes are not a factual accuracy percentage.
5. Complete longer mixed-workload, monitoring and restore drills for the intended production capacity.

Historical measurements remain in the [milestone reports](README.md) and [historical review index](HISTORICAL_REVIEWS.md). See [TESTING.md](TESTING.md) for what controlled, integration, browser and live tests actually establish.
