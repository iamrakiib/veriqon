# Conflict Center display and history controls

23 November 2026. Scope: local candidate; deployment is recorded separately.

The decision form used a transparent select background and did not set native option colors. It now uses the theme's explicit foreground/background for source and decision choices, including Markdown filenames. Selected values and keyboard navigation are unchanged.

The toolbar's three-dot **Conflict actions** menu contains **Clear visible history**. Search and status filters determine the selected records; each confirmation clears at most 200. The dialog states the exact count, supports cancellation and returns keyboard focus to the menu. Failed requests leave the visible records intact. Clear history is unavailable while loading or after a failed refresh.

Clearing archives display records; it does not resolve disagreements, revoke source preferences, delete documents or rewrite answers. An append-only `CONFLICT_ARCHIVED` event hides the record from the normal history query, including records extracted from older saved answers. Existing decisions still participate in scoped evidence evaluation. New conflict identities remain visible. Decision/audit records remain available through authenticated history endpoints.

`POST /rag/conflicts/archive` accepts 1-200 distinct `{id, expectedRevision}` references. It uses the authenticated account, strict nested input validation, existing request/session guards and workload admission. A transaction locks the PostgreSQL account row, verifies ownership and revisions, then appends the events. Mixed-owner or stale batches roll back fully. Repeating a successful request is idempotent. No migration or additional dependency is needed.

## Validation

- Backend suite: 186 passed, 0 failed, 7 infrastructure-only skips (`data/conflict-full-backend.log`). Includes HTTP request validation/authentication, cross-account rejection and archive behavior.
- Focused desktop/mobile browser suite: 8 passed, 0 failed (`data/conflict-browser-tests.log`). Tests both themes, at least 4.5:1 computed text contrast on select/options, Markdown filename selection, keyboard input, focus restoration, filtered clearing, cancellation, stale error retention and refresh persistence. Browser API fixtures are synthetic.
- Frontend type check and lint passed (`data/conflict-web-check.log`, `data/conflict-lint.log`). Dark desktop and mobile dialog screenshots were visually inspected.
- PostgreSQL/Redis: 79 passed, zero failed, one dedicated restart-only skip (`data/conflict-infra-tests.log`). Includes the archive transaction/ownership tests on PostgreSQL and existing worker crash/replay checks.
- Broader browser run: 112 passed, three intentional skips, one harness failure closing an upload-test trace (`ENOENT`). A concurrent focused Playwright run shared its output folder and removed the active recording; no upload assertion failed. Re-running both mobile upload cases with a separate output folder passed (`data/conflict-upload-recheck.log`). Final focused conflict run, including mobile toolbar center alignment, passed all eight cases (`data/conflict-browser-accepted.log`). Do not overlap Playwright invocations using the same output directory.
- These controlled checks do not establish live-model factual accuracy. Two separate live RAG attempts encountered provider unavailability before generation; that preexisting reliability gate remains open.
- Final production frontend build and subsequent type check passed (`data/conflict-web-build.log`, `data/conflict-web-check-final.log`). An earlier concurrent check raced development type generation; the sequential run used unchanged application code. Lint passed.
