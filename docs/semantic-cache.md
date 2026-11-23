# Semantic answer caching

Implemented locally on 2026-11-01. No deployment or GitHub push is part of this change.

## Reuse decision

1. Look for a trimmed exact question in the current authorization/configuration namespace.
2. If there is no exact hit, consider eligible answers in that same namespace. The namespace includes the account, document revision, model/provider configuration, retrieval settings, verification prompt version, cache policy, and UTC date.
3. Reject candidates with incompatible quantities, explicit time scope, negation, or unresolved contextual references.
4. Embed the query with the existing configured embedding provider. Reuse the query vector in retrieval if the cache misses. Embeddings are not factual verification.
5. Select the nearest candidate above the configured cosine threshold.
6. Ask the configured equivalence model to check whether both questions require the same answer, entities, scope, detail, format, and language. It receives the questions only. Three strictly validated boolean fields must all be true.
7. Check expiry and the account's document revision again before returning the saved answer.
8. On rejection, malformed output, provider failure, or timeout, run the normal RAG pipeline within the original overall deadline.

Only fully verified answers with valid atomic assessments and recorded citation versions are eligible for semantic reuse. Abstentions, partial answers, unresolved conflicts and failed verification cannot enter the semantic candidate set. Exact caching also requires a passing final assessment. Returned answers are cloned to avoid mutating cache contents.

The saved citations, exact passages and repair history remain attached. Cache responses report `cache.kind`, the original question, age, lookup duration and (for semantic hits) embedding similarity. The latter is a retrieval score, not confidence or a probability of correctness. The UI labels equivalent-question reuse explicitly. `modelUsage` on a hit contains the current equivalence calls, not the original generation usage.

## Configuration

Defaults are documented in `.env.example`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SEMANTIC_CACHE_ENABLED` | `true` | Set `false` to retain exact caching only |
| `SEMANTIC_CACHE_THRESHOLD` | `0.92` | Minimum candidate cosine similarity; must be calibrated for the selected embedding model |
| `SEMANTIC_CACHE_TIMEOUT_MS` | `8000` | Total optional embedding/equivalence lookup budget |
| `SEMANTIC_CACHE_MODEL` | verifier/generator fallback | Model used for equivalence classification |
| `ANSWER_CACHE_TTL_MS` | `300000` | Five-minute expiry, not extended by hits |
| `ANSWER_CACHE_MAX_ENTRIES` | `100` | Bounded total entries in each process |

## Measured results

Both comparisons use the same 100 requests: 20 first questions, 20 exact repeats, 20 whitespace-only repeats and 40 paraphrases. Retrieval, answer generation and factual verification are controlled fixtures. The questions and expected answers are authored synthetic data, not user history or an independently reviewed benchmark.

| Run | Exact-only hits | Semantic-enabled hits | Paraphrase hits | Incorrect reuses observed |
| --- | ---: | ---: | ---: | ---: |
| Deterministic wiring/policy test | 40/100 | 80/100 | 40/40 | 0 |
| Live configured embeddings and equivalence model | 40/100 | 50/100 | 10/40 | 0 |

The fixture test uses ideal one-hot vectors and an annotated equivalence gate. Its 80% hit rate is not a semantic model performance claim. The live test used the configured Nemotron embedding and verifier models with a 0.92 threshold. Of the 40 paraphrase requests, 27 missed the similarity threshold and three had unavailable equivalence lookups. Ten were reused. Gate usage reported 2,329 tokens, but usage is incomplete for failed calls; cost was not measured.

Embeddings in the live benchmark are precomputed in batches, so its per-request durations exclude embedding preprocessing. Neither run measures end-to-end answer generation latency or production traffic hit rate. Zero observed incorrect reuses in this small set does not establish a zero false-positive rate.

- `npm run evaluate:cache`: fixture comparison; no provider calls.
- `npm run evaluate:cache -- --live`: real embedding and equivalence calls; consumes configured provider quota.
- `semantic-cache-comparison.json`: fixture decisions for every request.
- `semantic-cache-live.json`: live decisions, models, reported usage and lookup outcomes.
- `cache-comparison.json`: historical exact-only baseline from before semantic caching was added.

Unit tests cover expiry, capacity, invalid vectors, account/model/revision isolation, changed documents during lookup, rejected equivalence, malformed contracts, cache failures, missing evidence versions, and non-cacheable answers. Browser tests cover the reuse label and source links.

Validation on 2026-11-01: all 69 backend tests passed; 13 redesign/browser tests passed with one intentionally skipped duplicate tablet pass. Frontend production build, frontend type checking, and lint passed. Six additional live negative-pair checks produced no reuse: one was rejected by the deterministic time-scope prefilter, four by the model, and one lookup was unavailable and failed closed. This is recorded in `semantic-cache-live-safety.json`; the unavailable check is not counted as successful semantic classification.

## Limits

This cache is bounded and process-local, not stored in Redis or PostgreSQL. It resets on restart; different backend instances warm independently. Redis continues to coordinate request admission, not answers. This implementation adds no new external storage service.

An LLM equivalence decision can be wrong. The conservative threshold and scope checks reduce risk but do not establish semantic correctness. There is no user-specific threshold calibration or independently annotated natural-traffic evaluation. More complex document permissions would need to be represented in the namespace and checked on every hit; the current application authorizes private documents by account.

Similarity lookup considers one candidate and does not create semantic aliases or extend expiry after a hit. This avoids chains of increasingly loose paraphrase matches. Slow equivalence providers can consume the lookup budget and reduce cache usefulness; in that case fresh answering proceeds.
