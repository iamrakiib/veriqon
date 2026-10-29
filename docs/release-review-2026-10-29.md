# Engineering review — 29 October 2026

This review supersedes the SQLite-era architecture descriptions in earlier audits. Veriqon is deployed with PostgreSQL/pgvector and Redis. It is a public portfolio and early-use application; an enterprise service or validated research claim needs additional evidence.

## Findings addressed

| Finding | Change | Regression coverage |
| --- | --- | --- |
| Refresh timeouts and 503s discarded the workspace | Only rejected credentials expire the session; temporary failures preserve the workspace | Desktop/mobile outage and network-failure recovery preserves an unsent question |
| Temporary session lookup failures displayed sign-in | Connection failures expose retry | Session lookup failure/recovery |
| Full libraries spent embedding quota before rejection | Preflight before provider work; retain the atomic final check | No embedding call when full, replacements allowed, final-write enforcement |
| SQLite counted text characters instead of UTF-8 bytes | Quotas count stored byte length | Multibyte boundary test |
| Queued files appeared to be actively indexing | Distinct queued, indexing, failed and indexed states | Delayed first upload leaves second queued |
| README described PostgreSQL as future work | Current architecture, setup, limits and screenshots | Documentation cross-checked against implementation |

Public registration uses the existing backend: new users become members with empty private libraries. Owner setup still requires its separate code. Browser tests cover sign-up without an owner code; HTTP tests cover account isolation and attempts to supply a privileged role.

UI changes preserve the monochrome layout, colored icons, both themes and mobile composer. Connection labels use plain language. Closed-registration screens now explain private access.

## Security assessment

The foundation includes scrypt, JWT expiry and issuer/audience/algorithm validation, hashed rotating refresh tokens, database revocation, protected cookies, origin checks and rate limits. Files and conversations are account scoped.

Still missing: email verification, MFA, self-service recovery, invitations, token-family replay response, account export/deletion and security monitoring. Public sign-up exposes shared quotas to abuse across multiple accounts. This is a code review and regression-test pass, **not an independent penetration test**. See [SECURITY.md](../SECURITY.md).

## Recruiter and ML engineering assessment

The strongest evidence is the end-to-end implementation: real authentication, stored files and vectors, bounded verification/repair, account isolation, reproducible containers, tests and deployment. It demonstrates practical full-stack and applied-ML integration.

The weakest claim would be calling it a complete temporal research system. There is no effective-time retrieval, immutable source history, continuous revalidation, hybrid search/reranking or independently labeled faithfulness benchmark. A verifier's approval is not ground truth. Exact vector scans and synchronous ingestion have scaling limits; free-host latency and provider quotas preclude an availability guarantee.

Next priorities: measured retrieval/faithfulness evaluation, verified identity and recovery, abuse monitoring, restore drills, durable ingestion and a versioned temporal data model.

## Release verification

Checks cover lint, backend tests, PostgreSQL/Redis integration, frontend build/types and desktop/mobile browser tests. CI builds both Docker images and checks high-severity dependency advisories. Screenshots use synthetic fixtures.

Public publication requires scanning Git history and tracked files, inspecting screenshots, and live registration/isolation verification after deployment. Check results are recorded in CI and the release commit; a passing secret scan cannot guarantee the absence of every sensitive value.
