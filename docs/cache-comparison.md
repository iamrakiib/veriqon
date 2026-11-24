# 100-request cache measurement

20 authored synthetic intent groups, five requests per group: original, exact repeat, whitespace-only repeat, two paraphrases. Fresh service instance; sequential requests within TTL. Real cache orchestration; fixture retrieval/generation/verification. No live LLM calls, user documents, or database writes.

| Request kind | Requests | Cache hits |
| --- | ---: | ---: |
| first_question | 20 | 0 |
| exact_repeat | 20 | 20 |
| whitespace_repeat | 20 | 20 |
| paraphrase_a | 20 | 0 |
| paraphrase_b | 20 | 0 |

Total: **40/100 hits (40%)**. Paraphrases are separate cache keys; the current implementation does not provide semantic answer caching. Owner separation and source-revision invalidation both passed separate probes.

Measures cache matching only. Equivalence labels are authored, not independently reviewed. Does not measure semantic similarity accuracy, model quality, real provider latency, cost savings, TTL expiry, distributed cache behavior, or production traffic hit rate.

Run: `npm run evaluate:cache`. Full per-request records: [cache-comparison.json](cache-comparison.json).
