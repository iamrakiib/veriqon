# Security

Veriqon is an early public research application, not a security-certified service. It includes account-scoped storage, salted scrypt passwords, expiring JWTs, rotating hashed refresh tokens, logout revocation, protected cookies, origin checks, input validation and shared rate/concurrency limits.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/iamrakiib/veriqon/security/advisories/new). Do not put credentials, session cookies, private documents or exploit details in public issues. If private reporting is unavailable, ask the maintainer to enable it without disclosing the vulnerability publicly.

Include the affected revision, reproduction with synthetic data, expected/actual behavior and impact. There is no promised response SLA or bug bounty.

## Current boundaries

- Email addresses are login identifiers, not verified identities. There is no MFA, self-service recovery, session-management screen or invitation system.
- Public registration consumes shared quotas. Per-account limits do not prevent a determined attacker from creating many accounts. Edge abuse protection and monitoring remain operational work.
- Rotation rejects old refresh-token replay but does not implement token-family compromise detection or revoke every session on replay.
- Retrieved text is untrusted. Model verification does not eliminate prompt injection or establish factual correctness.
- Original files and extracted text persist. AI providers receive text for embedding and retrieved passages for answers. Review provider handling before using confidential data.
- No independent penetration test, restore drill, sustained load test or security certification has been completed.

## Deployment responsibilities

Use HTTPS, exact allowed origins, separate random secrets and TLS database/Redis connections. Keep `.env*`, `data/`, database exports and password-reset files private. Never expose provider keys through `NEXT_PUBLIC_*`. Back up PostgreSQL and verify restores. Rotate disclosed credentials and monitor capacity and abuse.

Only the current main branch is maintained. Passing tests or scans is not proof that no vulnerabilities exist. Security work is informed by the [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html); this project does not claim full OWASP compliance.
