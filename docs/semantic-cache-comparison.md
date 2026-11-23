# Semantic cache comparison

Same 100 requests per mode: 20 original questions, 20 exact repeats, 20 whitespace-only repeats, 40 authored paraphrases. Real production cache orchestration with a fresh instance per mode. Retrieval, answer generation and evidence verification use fixed synthetic ground truth. No user data or database writes.

Ideal one-hot vectors and an annotated equivalence gate are fixtures. This run measures wiring and policy, NOT semantic model accuracy.

| Mode | Requests | Hits | Incorrect reuses |
| --- | ---: | ---: | ---: |
| exact-only | 100 | 40 | 0 |
| semantic | 100 | 80 | 0 |

Equivalence labels are authored, not independently reviewed. Positive paraphrases only in the 100-request set; adversarial scope and isolation checks are separate unit tests. No live answer generation, independently measured factual accuracy, provider cost estimate, or production hit rate. Reported request duration excludes batched embedding preprocessing and actual answer-generation latency.

Run: `npm run evaluate:cache`. See JSON for each request, model usage and actual cache decisions.
