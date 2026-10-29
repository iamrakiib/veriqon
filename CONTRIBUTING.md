# Contributing

Use Node.js 22.18+ and follow the README to start locally. Work on a branch, use synthetic documents, and focus each change on one reproducible problem. Read `apps/web/AGENTS.md` and relevant installed Next.js guides before frontend changes.

Run lint, backend tests, frontend build/typecheck and relevant browser tests. Use `compose.test.yaml` and `npm run test:infra` for database/Redis changes. Never point tests at production.

Describe the trigger, changed behavior and validation in pull requests. Include synthetic screenshots in both themes and on mobile for visual changes. Regression tests should demonstrate behavior, not mirror implementation details.

Bug reports should include reproduction steps, browser/OS, expected behavior and sanitized errors. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Never attach `.env` files, database exports or personal documents.

Preserve fail-closed verification, account isolation and bounded provider work. Do not describe similarity or model assessments as factual confidence. Research claims require independent labels and reproducible evaluation.
