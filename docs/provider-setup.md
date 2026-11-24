# Provider setup and predictable failure handling

The offline research demo needs no provider. To upload/search/generate with the app, configure your own OpenRouter key, `EMBEDDING_MODEL`, and `LLM_MODEL` in an ignored `.env` (local) or `.env.docker` (Docker). Optionally choose `VERIFIER_MODEL` and `DECOMPOSER_MODEL`; otherwise they use the generation/verifier defaults. `npm run doctor -- --require-provider` checks configuration presence without exposing credentials or making network calls. It cannot check remaining quota.

Confirm model availability and privacy rules in your provider account. Model identifiers and free-tier limits change; this project does not promise a permanently available free model. No automatic provider/model substitution is made. Retrieved text leaves your computer when sent to the configured provider; use only data permitted by your deployment's privacy requirements.

Start new installations with `EMBEDDING_BATCH_SIZE=1`. Some endpoints reject multiple inputs even though individual embeddings work. Increase batch size only after testing that endpoint. Shared request pacing and provider cooldowns coordinate across instances using the same database. `EMBEDDING_MIN_INTERVAL_MS=3000` is a conservative starting value, not a measured quota. Changing input modes or embedding models requires reindexing; query and stored vectors must share an embedding space.

| Symptom | Meaning and next step |
| --- | --- |
| 401/403 | Key, permissions or privacy settings rejected; correct configuration before retrying |
| 402 | Provider credit requirement; do not repeatedly retry a depleted account |
| 429 | Request/token/account/model quota reached; honor the supplied reset, or wait for the bounded scheduler |
| 502/503 | Provider/gateway failure; saved upload checkpoints are retained and retries are bounded |
| Timeout | A stage exceeded its deadline; the app must not label an incomplete answer verified |
| Invalid embeddings | Wrong dimensions, zero/nonfinite vectors or incompatible response; no partial index is published |
| No readable text | The file may be scanned, damaged, unsupported, or empty; OCR is a separate capability |

Keep the API process running for background indexing. Reloading the browser does not discard queued jobs. Retry a failed upload after resolving the provider problem; the server resumes saved checkpoints. An interrupted uncommitted request may be repeated, while committed successful batches are reused. Provider limits do not imply unlimited automatic retries.

Useful controls: `PROVIDER_TIMEOUT_MS`, `RAG_TIMEOUT_MS`, `MAX_REPAIR_ATTEMPTS`, `TOP_K`, `RETRIEVAL_CANDIDATES`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, and `EMBEDDING_JOB_BATCHES_PER_TURN`. Docker now forwards these settings. Increasing all budgets is not an accuracy optimization; measure recall, supported coverage, latency and token consumption on held-out questions first.

When embeddings fail, bounded lexical retrieval may still supply passages. When generation fails after retrieval, the UI shows **Source passages only**. Those excerpts are useful inspection material, not a verified generated answer. Missing evidence, provider failure and unsuccessful correction are distinct outcomes.
