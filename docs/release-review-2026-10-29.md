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

[CI for the deployed code](https://github.com/iamrakiib/veriqon/actions/runs/40829342650) passed: 31 backend tests, 5 PostgreSQL/Redis checks, 41 desktop/mobile browser tests (one duplicate mobile layout invocation intentionally skipped), lint, frontend build/type checks and both Docker builds. The dependency audit reported zero vulnerabilities. Screenshots use synthetic fixtures.

Before publication, Gitleaks found no leaks in Git history, the tracked snapshot or previous CI logs. An additional comparison checked 96 tracked files and history against private local credential values. These scans are evidence of a check, not a guarantee that every sensitive value is detectable. GitHub secret scanning, push protection, vulnerability alerts, Dependabot security updates and private vulnerability reporting are enabled.

Code release `61a67da` is live on Vercel and Render. The live smoke test passed public member registration, origin rejection, Secure/HttpOnly cookies, account isolation, upload/embedding, exact original download, a supported cited answer, persisted history, refresh rotation/replay rejection and logout revocation. The answer took 15.2 seconds in that run; this is not a latency guarantee. The temporary test account and its documents/history were removed. Existing owner data was preserved.

Releases remain manual through the authenticated hosting CLIs. The Vercel GitHub integration could not be linked from the CLI even after public publication; this did not prevent deployment.
