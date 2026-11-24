# Lifecycle workflows and acceptance testing

The local UI uses the existing authenticated API. Each account owns a personal library; an owner role does not grant access to another account's documents.

## Using the workflow

1. Upload a document in Knowledge base. Wait for indexing to finish; queued or retrying uploads are not searchable complete documents.
2. Open the document, then **Source dates and authority**. Enter dates actually stated by the source and a reason. A concurrent edit returns an error; **Reload metadata** retrieves the latest revision before another save. Upload time does not establish precedence.
3. Ask a question. Open numbered passages to inspect the source and version. Use **History** in the chat header to return to saved conversations.
4. Open **Conflict center** to inspect disagreements found in saved answer assessments. Review both quotes. An explicit source preference requires a reason and applies only to that proposition, scope and source versions. Changed evidence makes old decisions stale. This is not a scan of the entire library.
5. After a source update or review, the configured background processor schedules affected saved answers. Open **Corrections**, then **Refresh background revalidation**. Queued, retry-wait and failed are not completed corrections.
6. **View answer versions** shows the latest recorded assessment and immutable original. A new version may still have insufficient evidence or unresolved conflicts. Only an accepted, finally verified factual change receives the repaired label. **Revalidation audit history** includes unchanged checks and failed attempts; **Recheck current evidence** reports whether a new job was actually queued.
7. **Analytics** describes loaded conversation records and their reported usage, excluding background assessments from its conversation totals. It is neither a global token/cost ledger nor an accuracy measure. Missing provider usage stays partial/unknown.
8. Save recovery codes after registration or regenerate them from account settings. **Forgot password?** uses one saved code and invalidates existing sessions. Email reset delivery is not configured.

Document, answer and audit histories load 20-item pages. Archived text is fetched only when opened. The legacy array routes remain compatible for existing clients; new clients should use the bounded routes below.

History windows keep at most 100 document versions, answer versions or audit events per open panel. Loading older pages removes newer records from the window, not from storage. **Newest answer versions**, **View document versions**, or the audit-history heading reloads the newest page. The latest-assessment label retains its actual sequence even when that assessment is outside the window.

Chat history keeps up to 40 conversations and 60 messages per conversation in memory. The active chat and unfinished drafts are protected while browsing older conversations; if every slot is protected, finish or clear a draft before loading another window. **Newest conversations** reloads saved recent history without clearing drafts. **Latest messages** returns from an older message window before sending; a full current window refreshes automatically before the next question. If that refresh fails, the question remains a draft and no query is submitted. Analytics/search describe this loaded window, not the entire account.

Upload polling is cancelled when the library closes. Workspace refreshes do not overlap; obsolete refresh requests are cancelled, and hidden tabs skip periodic workspace refreshes. Background document processing continues on the server independently of these browser reads.

## API contracts

- `GET /rag/docs/:id/metadata`, `PUT /rag/docs/:id/metadata` with `metadata`, `expectedRevision`, `reason`.
- `GET /rag/docs/:id/version-history?limit=20&cursor=...`, then `GET /rag/docs/:id/versions/:versionId` for the archived text.
- `POST /rag/conflicts/:id/decision` with `action`, `expectedRevision`, `explanation` and, for `PREFER_SOURCE`, `preferredDocumentId`.
- `GET /rag/conflicts/:id/decision-history?limit=20&cursor=...`.
- `GET /rag/messages/:id/version-history?limit=20&cursor=...`, newest first. Cursor is bound to the answer and uses its immutable sequence, avoiding same-timestamp gaps.
- `GET /rag/messages/:id/revalidation-history?limit=20&cursor=...`.
- `POST /rag/messages/:id/revalidate`, `GET /rag/revalidations` (latest 100 jobs).

History pages return `{items, nextCursor}`; page size is 1-50. Treat cursors as opaque. Foreign-account objects return 404. Metadata/review writes use revision checks and share the account's existing 20-work-operations/minute limit and concurrency admission with queries. Invalid revisions must not be retried blindly. Requests require the normal session and mutation origin/header protection.

`/rag/health` describes implemented local capabilities separately from runtime scheduler configuration and unverified cloud/live-provider acceptance. It does not certify provider availability, factual accuracy or worker health; `/rag/ready` checks storage/coordination.

## Reproducing the combined browser test

Use **disposable** pgvector PostgreSQL on `127.0.0.1:55432` and Redis on `127.0.0.1:56379`; do not point it at application data. Set `TEST_DATABASE_URL` and `TEST_REDIS_URL` explicitly. Install the Playwright browser (`npx playwright install chromium`) or set `PLAYWRIGHT_CHANNEL=msedge` when Edge is installed. Then run:

```text
npm run test:lifecycle
```

The test reserves ports 3015/3016, creates a random database schema and Redis namespace, starts the real Next.js frontend and NestJS API, and runs real ingestion/revalidation SQL timers. Only embedding and chat provider responses are scripted. It uses synthetic text policy documents, no private documents or external model key. It does not measure live factual accuracy or token cost. Background BullMQ/separate-process recovery is covered separately by `npm run test:infra`.

Do not run two Next.js builds/dev test servers against the same `.next` directory simultaneously. Stop/remove only the disposable services you created after testing. If Windows terminates the fixture before graceful cleanup, discard its disposable database container; never delete schemas in a real deployment. Traces may contain synthetic test-session credentials and are operational artifacts, not publication material.

The CI definition runs this test after the ordinary desktop/mobile browser suite against its disposable PostgreSQL/Redis services. Local execution evidence is in [MILESTONE_4_RESULTS.md](MILESTONE_4_RESULTS.md); CI has not been published or executed remotely for this candidate.
