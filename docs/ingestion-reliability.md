# Upload reliability — local hardening milestone

Date: 10 November 2026. This milestone addresses document ingestion. It does not establish that every RAG feature is production complete. No repository publication or hosted deployment is part of this work.

## Reproduced problems

- The old parser and indexer rejected documents above 100,000 extracted characters, even when the compressed DOCX/PDF was below the 10 MB file limit.
- Indexing happened inside the upload request. A provider failure after several successful batches lost that progress; repeating the upload paid for the successful batches again.
- There was no durable upload state after a browser reload or an API restart. The browser could only show a synchronous success or failure.
- Embedding batches were fixed at 32 inputs. Provider HTTP failures, malformed vectors and incompatible embedding configurations needed separate handling.
- The configured free endpoint produced HTTP 502 for multiple inputs and intermittent HTTP 429. A later controlled probe accepted one 830-character input (200, 2,048 dimensions) but rejected two 20/19-character inputs (502). Two 830/880-character inputs failed with both explicit float encoding and the SDK's default base64 encoding. This isolates a current endpoint incompatibility with multi-input requests; it does not establish the provider's internal cause or prove that every earlier failure had the same cause. Local `EMBEDDING_BATCH_SIZE` is now **1**. Credentials and models are unchanged.

## Implemented behavior

`POST /rag/uploads` parses and validates the file, then returns **202** with an owned, durable job. The UI polls saved job states. Queued, processing and retrying uploads are never represented as searchable documents. `GET /rag/docs` continues to contain only committed indexes.

The worker saves each successful batch of vectors in the same database as the job. Failed calls retain those checkpoints. Retries resume at the first missing passage. Final publication, document revision increment, completion status and checkpoint cleanup are one transaction. A replacement upload retains the existing searchable document until publication succeeds.

PostgreSQL workers coordinate through transactional claims and an advisory lock. SQLite uses its existing serialized transaction boundary. Each worker processes one job; across workers, the queue allows two active jobs and one active job per account. Four-minute leases are renewed after successful batches. An expired lease can be recovered; its old token cannot publish or overwrite the replacement worker's state. A discarded job cannot publish a late response. Cancellation aborts a local request when possible; a request on another instance may already be in flight, but cannot commit after its lease is removed.

Provider errors receive at most three consecutive automatic attempts without checkpoint progress, with delayed exponential backoff and provider reset headers respected. Manual retry permits up to six consecutive unproductive attempts. A successful checkpoint resets that failure streak. Each worker turn has a five-minute deadline, but yields between batches after 25 batches or two minutes; scheduling yields do not consume failure attempts. The finite 1,000-chunk bound prevents unbounded progress resets. Invalid credentials, insufficient credits, forbidden/model-invalid requests and malformed vectors stop automatic retries. Raw provider errors and document contents are not returned in the job list.

Request starts are paced in a database transaction shared by all instances using the same database, gateway, API key and embedding model. The default minimum interval is 3 seconds for `:free` models and zero otherwise; `EMBEDDING_MIN_INTERVAL_MS` overrides it. This is a conservative precaution, not a measured provider quota. HTTP 429 records a shared cooldown using the supplied reset or a 60-second fallback. Waiting workers make no upstream call during that cooldown. Embedding rate limits go directly to durable scheduling instead of an immediate transport retry. These changes reduce bursts and wasted retries; they cannot increase a provider's quota.

Files allow **10 MB**, **500,000 extracted characters** and **1,000 chunks**, whichever limit is reached first. Existing synchronous `/rag/upload`, `/rag/add` and `/rag/bulk-add` contracts retain the 100,000-character limit. The parser keeps its process heap/deadline limits; scanned PDFs still require OCR.

There are at most three unfinished jobs per account and 100 unfinished jobs across the installation. Library quotas are checked before enqueue and again at publication. Completed jobs release staged file/text/vector payloads. Completed receipts and failed jobs expire after seven days. Discard removes a queued job or completed receipt, not an indexed document. Deleting an indexed document also removes its job record, fencing any reindex in progress.

The SQLite-to-PostgreSQL cutover copies unfinished jobs and vector checkpoints and expires stopped-worker leases. Migration `003_ingestion_jobs.sql` adds the PostgreSQL tables; earlier migrations are unchanged.

## Embedding compatibility

`EMBEDDING_BATCH_SIZE` defaults to 8 and accepts 1–32. This localhost configuration explicitly uses **1**, based on the current free endpoint's measured behavior. Deployments using that endpoint must keep single-input requests until multi-input support is successfully tested. No new model or paid provider is selected automatically. Smaller requests are a capacity control, not a promise of provider availability.

`EMBEDDING_DOCUMENT_INPUT_TYPE` and `EMBEDDING_QUERY_INPUT_TYPE` are optional and must be configured together. OpenRouter documents an [`input_type` parameter](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request); NVIDIA documents [query/passage semantics for its embedding models](https://build.nvidia.com/nvidia/nemotron-3_5-embed-1b/modelcard). Exact accepted values depend on the configured provider/model. This session did not verify the routing of those modes through the rate-limited endpoint, so the live configuration retains its existing mode.

Configured input modes and a custom gateway identity are recorded in the embedding identity. Job fingerprints additionally include chunk size, overlap and chunker version. A settings change cannot silently append new vectors to an incompatible checkpoint. Re-uploading a completed source with changed settings creates a new job instead of incorrectly reusing an old completed receipt. Existing incompatible indexes require deliberate reindexing; no stored library is silently deleted.

## Acceptance tests

The added regressions use the real SQL schema, worker, vector-store orchestration and HTTP authorization. Synthetic provider responses are substituted only in tests to reproduce failure timing deterministically. They cover:

- Partial success followed by HTTP 429; checkpoint persistence, cooldown and successful resume without repeating saved embeddings.
- Late responses after cancellation, expired leases, competing workers, stale publication attempts and exactly one committed document revision.
- Owner isolation for list/retry/discard, pending queue bounds and retry exhaustion.
- Credential errors, HTTP-200 error envelopes, zero/nonfinite/nonnumeric/misaligned vectors and inconsistent dimensions.
- Documents above the former character cap and the 500,000-character boundary in the isolated parser.
- Changed input-mode/gateway identity, rejection of mixed embedding spaces and re-upload after a configuration change.
- Actual HTTP 202 ingestion, authenticated polling, cross-account rejection and visibility only after completion.
- Desktop/mobile queued, retrying, failed, retried and completed states, including a page reload.
- Offline database cutover preserving a pending file, vector checkpoint and recovered lease.

### Execution results

| Check | Actual result |
| --- | --- |
| Full controlled backend suite (`npm test`) | **116 passed, 0 failed**. The subsequently added PostgreSQL-only publication-race regression is included in the infrastructure result below. |
| PostgreSQL/pgvector/Redis suite | **19 passed, 0 failed**, including migration/cutover, authenticated upload routes, lease recovery and the publication race. |
| Full desktop/mobile browser suite | **82 passed, 2 intentional viewport skips, 0 failed**. |
| Upload browser tests after the final polling/button changes | **4 passed, 0 failed**. |
| Backend TypeScript build, lint, frontend production build and diff whitespace check | **Passed**. The frontend production build also completed its TypeScript check. |
| Actual localhost API assessment | **25/25 passed**; a 40-request authenticated read burst at concurrency 5 also passed (p50 12 ms, p95 29 ms). This is not a sustained capacity benchmark. |
| Actual localhost workspace check | **Passed**, no browser runtime errors; saved analytics/history/conflict views matched the synthetic account's stored records. No new factual-accuracy claim follows from viewing those records. |
| Live configured-provider upload | A **2,490-character, four-passage synthetic file** was accepted with HTTP 202, indexed **4/4 passages on its first attempt**, and appeared in the library. Its source and job receipt were removed afterward. A separate one-passage live upload also succeeded. |
| Final local readiness | Frontend **200**, API readiness **200**, `durableUploads: true`; `temporal` and `conflictLibraryScan` remain **false**. |

The initial backend run caught an outdated test expectation for the former batch size; it was corrected. The first infrastructure run had 16 connection failures after Docker stopped; it was not treated as a pass. After restoring the isolated services, the full infrastructure suite passed, followed by the final 19-case run including the publication-race regression. No remaining failure in these executed suites is being concealed.

Logs are ignored under `data/ingestion-*.log`. Sanitized live observations are `data/ingestion-live-multipassage.json`, `data/embedding-format-probe.json` and `data/embedding-shape-probe.json`. A private SQLite snapshot was taken before the local API restart. The two labeled test containers and their anonymous volumes were removed; Docker was restored to its initially stopped state. Local API and frontend servers were restarted with the updated implementation.

These tests establish specific recovery, compatibility and isolation behaviors. They do not measure real-model factual accuracy or large-library throughput. The user's failing PDF/DOCX was not supplied as a local file, so that exact file has not been retested.

## Remaining release gates

1. **Provider availability and spending controls:** the live free endpoint has returned both successful responses and 429/502 errors during this session. Small-file success does not validate large-file indexing or sustained concurrency; those and a held-out RAG evaluation remain pending adequate capacity. More retries do not create quota. Shared spending budgets and privacy-compatible failover require separate work.
2. **Temporal correctness:** effective dates, authorized supersession, library-wide conflict scanning, human adjudication and continuous answer-version revalidation are still incomplete. Health capability flags remain conservative.
3. **Public-account abuse and lifecycle:** verified email/bot controls, MFA, session management and account deletion/retention remain open. Recovery codes exist; they are not email recovery.
4. **Scale:** exact vector search, process-local answer cache, database-stored originals and aggregate storage growth remain limitations. The upload queue is bounded, not a replacement for storage capacity planning, ANN indexing or distributed-cache validation.
5. **Operational evidence:** production restore drills, sustained concurrency tests, alerts, privacy review and independent factuality annotations remain necessary. Controlled local tests cannot certify a bug-free application.
