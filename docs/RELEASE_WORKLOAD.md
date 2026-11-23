# Local release workload and predetermined gates

Defined before the milestone 7 load run, 17 November 2026. These gates detect a gross local regression; they are not production SLOs or an independent benchmark.

`node --expose-gc scripts/test-storage-load.mjs` uses only explicit disposable PostgreSQL at `127.0.0.1:55432/veriqon_test`. It creates a random private schema, migrates it, inserts synthetic sources, invokes real hybrid retrieval and drops only that schema afterward. No `.env`, user library, embedding API or language model is used.

Workload: four owners, twenty documents per owner, sixteen passages per document, 1,536-dimensional deterministic vectors (1,280 passages total), four concurrent retrieval clients for sixty seconds, 100 ms pause after each operation. Every returned document must belong to the requesting owner. Eight warm-up operations precede measurement. This intentionally covers vector width, bounded retrieval and isolation; identical vectors do not establish semantic recall.

Predetermined pass conditions: at least 200 operations, zero retrieval/isolation errors, p95 below 2,000 ms, post-GC retained heap growth below 64 MiB. Report p50/p95, operation count, elapsed time, Node peak RSS and retained heap; database size includes the disposable database's other schemas. Do not reinterpret a failure by changing the thresholds after the run.

This short soak is not an hour/day stability test, API load-balancer test, queue throughput test or provider cost measurement. Long soak, realistic labeled embeddings, concurrent ingestion/query/revalidation, per-service memory, queue-age SLOs and cloud proxy behavior remain separate release gates. Existing worker crash/retry and database concurrency suites complement this test but do not substitute for those measurements.
