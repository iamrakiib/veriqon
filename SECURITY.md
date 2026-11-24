# Security

Veriqon is an early public research application, not a security-certified service. It includes account-scoped storage, salted scrypt passwords, expiring JWTs, rotating hashed refresh tokens, logout revocation, protected cookies, origin checks, input validation and shared rate/concurrency limits.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/iamrakiib/veriqon/security/advisories/new). Do not put credentials, session cookies, private documents or exploit details in public issues. If private reporting is unavailable, ask the maintainer to enable it without disclosing the vulnerability publicly.

Include the affected revision, reproduction with synthetic data, expected/actual behavior and impact. There is no promised response SLA or bug bounty.

## Current boundaries

The [9 November local security/reliability audit](docs/security-reliability-audit.md) records tested fixes and remaining risks. Refresh attempts have a separate shared limit; registration and its first session commit together. Uncertainty wording cannot exempt an attached assertion from verification, and model-only precedence cannot silently resolve a source conflict. These safeguards do not constitute a security certification.

- Browser requests bind the displayed account to the authenticated session. An account switch in another tab cannot silently replay a private read/write as the new account. This consistency header never replaces server-side authorization.
- Upload admission runs before multipart buffering, with per-process/per-account concurrency bounds and a receiving deadline. Production parsing has a separate heap/deadline, but is not an OS sandbox. Deployment-level connection limits and malware scanning remain separate controls. History responses are bounded and paginated; total retention is not yet bounded.

- Email addresses are login identifiers, not verified identities. Recovery uses eight 128-bit random one-time codes stored as SHA-256 hashes. Generating replacements requires the current password. Recovery consumes a code atomically, revokes every session and records a security event; unknown accounts and invalid codes receive the same response. There is no email reset, MFA, session-management screen or invitation system.
- Public registration consumes shared quotas. Per-account limits do not prevent a determined attacker from creating many accounts. Edge abuse protection and monitoring remain operational work.
- Rotation rejects old refresh-token replay but does not implement token-family compromise detection or revoke every session on replay.
- Retrieved text is untrusted. Model verification does not eliminate prompt injection or establish factual correctness.
- Original files and extracted text persist. AI providers receive text for embedding and retrieved passages for answers. Review provider handling before using confidential data.
- Local Docker backup/restore and a bounded PostgreSQL retrieval soak have been exercised; see the dated milestone reports. No independent penetration test, cloud restore drill, long-duration production load test or security certification has been completed.

## Deployment responsibilities

Use HTTPS, exact allowed origins, separate random secrets and TLS database/Redis connections. Keep `.env*`, `data/`, database exports and password-reset files private. Never expose provider keys through `NEXT_PUBLIC_*`. Back up PostgreSQL and verify restores. Rotate disclosed credentials and monitor capacity and abuse.

Only the current main branch is maintained. Passing tests or scans is not proof that no vulnerabilities exist. Security work is informed by the [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html); this project does not claim full OWASP compliance.
