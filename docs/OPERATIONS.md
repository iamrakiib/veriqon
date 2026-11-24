# Operations and release runbook

Use with [DEPLOYMENT.md](DEPLOYMENT.md), [INSTALLATION.md](INSTALLATION.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Procedures are not evidence that a cloud drill or alert configuration has passed.

## Before a release

Record the source commit/export fingerprint, model assignments, embedding identity, migration versions and service roles. Verify source/private-file audit, required CI gates and matching API/worker candidate. Back up the database and privately preserve required configuration. Review any migration for old/new code compatibility. Keep production promotion manual until staging passes; never use a deployment hook from an untrusted pull request.

Use synthetic accounts/documents for acceptance. Close public registration while validating a new deployment unless a deliberate quota and abuse policy is approved. Verify host request/body deadlines, database/Redis allowances and provider data handling for the intended workload.

## During an incident

1. Distinguish availability from factual failure: `/rag/ready` covers SQL/admission Redis; worker shell `node dist/scripts/worker-health.js` covers recent reconciliation. Neither verifies an answer.
2. Record sanitized request/job IDs, timestamps, source revision and failure category. Do not publish keys, source text, answers, sessions or recovery codes in logs.
3. Inspect database/Redis connectivity, worker events and provider reset information. A fresh API health response is not proof that indexing is progressing.
4. Preserve checkpoints, accepted jobs and original answer records. Do not force leases to expire or delete retry jobs to hide an incident. Restore the failed dependency, then observe actual resumed processing.
5. If a rollout caused the issue, stop promotion and redeploy the last compatible API/worker pair. Do not automatically undo migrations or restore a backup over new writes. Close writes and plan a forward fix if compatibility is uncertain.

Authorized operators can inspect aggregate queue state without reading document contents:

```sql
SELECT status, COUNT(*) FROM ingestion_jobs GROUP BY status;
SELECT status, COUNT(*) FROM revalidation_jobs GROUP BY status;
SELECT MIN(created_at) FROM ingestion_jobs WHERE status IN ('queued','retry_wait','processing');
SELECT MIN(created_at) FROM revalidation_jobs WHERE status IN ('queued','retry_wait','processing');
```

Timestamps are epoch milliseconds. A scheduled provider cooldown differs from stuck work; inspect next-at/reset metadata before intervening. Queue command usage and memory must be monitored alongside job age. No automatic cloud heartbeat alert integration is claimed yet.

## Recovery and verification

Restore backups only into an isolated empty target first. Verify account access, original downloads/hashes, conversations, answer versions, source archives, decisions and new ingestion/query/revalidation. Existing Compose backup tooling refuses nonempty restore targets; cloud restore must use the hosting provider's separately rehearsed procedure.

After a restart, verify both worker and API at the intended revision, then check for one visible publication per accepted source/answer revision. Do not promise instant recovery: the measured local hard-kill drill waited for a four-minute SQL lease. Check user-visible source-only, retry and uncertainty states while dependencies are unavailable.

## Release boundaries

The sixty-second local retrieval workload has predetermined regression thresholds in [RELEASE_WORKLOAD.md](RELEASE_WORKLOAD.md). It is not an uptime SLO, public capacity estimate or long-duration leak test. Cloud availability, p95 response, queue-age and recovery objectives must be selected for an approved workload and rehearsed before public release. Independent factual review and a representative held-out evaluation remain separate requirements.
