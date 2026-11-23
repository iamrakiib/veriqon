# Veriqon API testing guide

For Docker, use `http://localhost:3002/api` as the base URL. For Vercel, use `https://YOUR-FRONTEND.vercel.app/api`, or the Render HTTPS origin when testing directly. `GET /rag/ready` checks PostgreSQL and Redis availability. PostgreSQL owner setup uses the private `SETUP_CODE` environment setting. See [DEPLOYMENT.md](DEPLOYMENT.md).

Use `http://127.0.0.1:3000` as the API base URL. Start it with `npm run start:dev` if necessary. Use a dedicated test account: live ingestion and answer generation consume the configured provider's quota. Automated `npm test` and `npm run test:browser` use mocks instead.

## 1. Authenticate first

Public checks:

- `GET /rag/health`: API status, provider-key presence and supported capabilities. It does not test the provider.
- `GET /auth/status`: whether initial owner setup or regular registration is available.

For every POST and DELETE request, add:

```text
X-Veriqon-Request: 1
```

For JSON bodies, also add `Content-Type: application/json`. Keep the same host (`127.0.0.1`, not a mixture of localhost and IP) for all requests so cookies apply consistently. Let Postman retain the `vq_access` and `vq_refresh` cookies returned by the API. Browser requests also validate the Origin against `APP_ORIGINS`.

### Sign in: POST /auth/login

```json
{
  "email": "your-test-account@example.com",
  "password": "YOUR_PRIVATE_PASSWORD"
}
```

Expected: 200 with `{ "user": { "id": "...", "name": "...", "email": "...", "role": "..." } }`, plus HttpOnly cookies. Tokens are not returned in the JSON body. Use `GET /auth/me` to check the session.

If no owner exists, create it through the UI with the local setup code, or POST `/auth/register` with `name`, `email`, `password` (12?128 characters) and `setupCode`. Do not commit real passwords, keys, cookies or setup codes to this file or a shared collection. Later registrations do not need the setup code and depend on `ALLOW_REGISTRATION`.

## 2. Add a test document: POST /rag/add

```json
{
  "id": "manual-test-policy",
  "source": "manual-test-policy.txt",
  "version": "1",
  "text": "Employees may work remotely one day per week. Requests must be approved by their manager."
}
```

Expected: 201 with `{ "success": true, "id": "manual-test-policy" }` after embeddings and database commit succeed. A provider error is not a successful upload. Retrying identical content and metadata reuses existing embeddings.

For an actual file, use `POST /rag/uploads`, Body -> form-data, with one **File** field named `file`. Do not manually set multipart Content-Type: the client must supply its boundary. Supported: PDF, DOCX, TXT and Markdown; 10 MB, 500,000 extracted characters and 1,000 passages maximum. Scanned PDFs need OCR. HTTP **202** means accepted, not indexed. Poll `GET /rag/uploads` for the authenticated account's saved progress; the source appears in `GET /rag/docs` only when its status is `completed`. `POST /rag/uploads/:id/retry` resumes a failed job, subject to its retry budget. `DELETE /rag/uploads/:id` discards a pending job or dismisses a completed receipt; it does not delete an indexed document. Cross-account job operations return 404. No job list response contains document text, file bytes or embedding vectors.

The compatibility route `POST /rag/upload` still performs synchronous indexing and returns HTTP 201 with a content-derived document ID only after success. It retains the 100,000-character limit and a bounded request deadline. Use the background route for larger files or unreliable providers.

## 3. Inspect the library: GET /rag/docs

Returns only the signed-in account's documents. Records include `id`, `text`, `source`, optional metadata, `chunkCount`, `createdAt` and `hasOriginal`. Embedding vectors are not exposed by this endpoint.

`GET /rag/docs/{id}/file` downloads an original upload. A document added as JSON or imported from the old snapshot has no original file and returns 404 for this route.

## 4. Ask a question: POST /rag/query

```json
{
  "query": "How many days can employees work remotely?",
  "conversationId": "681c42e0-8ea0-4e9c-a55c-4ea0bf0e9a61",
  "messageId": "e7893c9b-1fea-4345-94ab-19a247e1037b"
}
```

These UUIDs are synthetic examples. Use a new `messageId` for a new question, and retain `conversationId` to group questions in the same saved conversation. Both fields are optional. For a recognized follow-up, up to three prior supported turns from this account and conversation can resolve references. Prior answers are untrusted context, never evidence; claims still need current retrieved passages. `contextUsed` indicates when that context was supplied.

A successful HTTP response has `draft`, `status`, `factCheck`, `citations`, `attempts`, `durationMs`, `correction`, `conversationId`, `messageId`, `sourceRevision` and `sourcesChanged`. A cached result may have `cached: true`.

`status` can be `supported`, `repaired` or `abstained`. Abstention is an expected outcome, with `reason` equal to `no_documents`, `insufficient_context`, `verification_failed` or `generation_failed`. A model check is not a factual accuracy guarantee. Exact answer wording is not deterministic and should not be asserted in live tests.

When generation fails after passages have been retrieved, HTTP 200 returns a structured fallback: `reason: "generation_failed"`, `status: "abstained"`, `verificationStatus: "VERIFICATION_FAILED"`, `factCheck.passed: false`, zero checked claims and the authorized citation excerpts/versions. The UI labels it **Source passages only**. This is saved in history but excluded from the answer cache. A retry uses a new message ID and makes a fresh attempt. Transport success does not mean generation or verification succeeded. Failures before usable retrieval can still return HTTP errors.

Replay the exact same body after completion: it should return the stored result without adding another message or making another model call. Reusing the message ID with a changed question returns 409. A pending or previously failed message also returns 409; an intentional retry after failure needs a new message ID.

## 5. Check saved history: GET /rag/conversations

Each page returns up to 20 conversations with ten recent messages each, including saved answers, citations and failures. If `hasMoreConversations` is true, pass the last item's `cursor` as `GET /rag/conversations?before={cursor}`. A conversation with `olderMessagesCursor` has older messages: request `GET /rag/conversations/{id}/messages?before={olderMessagesCursor}` for up to 30 more. That response has `messages` and another `olderMessagesCursor` (null at the end). Cursors are opaque; malformed inputs return 400 and another account's conversation returns 404. These endpoints preserve old records.

Reload the UI or sign out and back in to confirm persistence. The `sourcesChanged` warning becomes true when the library revision differs from the answer's recorded revision; it does not mean the answer was automatically revalidated. Browser requests include `X-Veriqon-Account` with the displayed account ID. A mismatch with the authenticated session returns 409 / `ACCOUNT_CHANGED`, preventing an old tab from silently using a different account's session. API clients can include this optional consistency header; it never grants access.

`GET /rag/messages/{messageId}` retrieves one owned saved answer with its conversation title and ID, even when it is outside the loaded history page. It returns `{ conversationId, title, message }` with `Cache-Control: private, no-store`. Another account's ID or a missing ID returns 404; no session returns 401. Conflict Center uses this endpoint to open older affected answers without loading the whole history.

## 6. Delete only the synthetic document: DELETE /rag/docs/manual-test-policy

Expected: 200 with `{ "success": true }`. This removes the document, search chunks and original bytes if present. Earlier chats retain their historical citation excerpts. Repeating deletion or requesting another account's ID returns 404. Never substitute a real user's document ID in a destructive test without intending to delete it.

## 7. Session lifecycle

- `POST /auth/refresh`, empty JSON body: rotates the refresh cookie and renews access. Retain the new cookies. An old refresh token cannot be replayed.
- `POST /auth/logout`, empty JSON body: revokes the session and clears cookies.
- `GET /auth/me` after logout: 401.

Access JWTs last 15 minutes; database sessions have a maximum seven-day lifetime. Production cookies require HTTPS.

## Recovery codes and evidence conflicts

New registrations return eight recovery codes once. Existing accounts can use `POST /auth/recovery-codes` with `{ "password": "your current password" }` to replace their codes; `GET /auth/recovery-codes` returns only the remaining count. Store codes privately. `POST /auth/recover` accepts `{ "email": "your account email", "code": "one unused code", "password": "your new password" }`. A successful reset consumes the code and revokes every session. Reusing it returns 401. Test with a disposable account, since regeneration invalidates previous codes.

`GET /rag/conflicts` requires authentication and returns unresolved evidence conflicts from the account's latest 200 saved answer assessments. It includes exact quoted passages, source versions and affected message IDs. An empty list means no conflicts were recorded in that window, not that the entire library is conflict-free. Cross-account conflicts must never appear.

RAG responses also include `verificationStatus`, `repairHistory`, `modelUsage`, `promptVersion`, claim counts and retrieval rounds. Only `REPAIRED_VERIFIED` denotes a revision that passed final verification and the substantive-change guard. Attempted or stylistic revisions must not receive that label. See [RAC method and measured limitations](docs/rac-method.md).

## Negative cases

| Request | Expected |
| --- | --- |
| Read documents/history without authentication | 401 |
| POST/DELETE without `X-Veriqon-Request: 1`, or with a disallowed Origin | 403 |
| Query body with another user's `ownerId` | 400, unknown field rejected |
| Private request with `X-Veriqon-Account` different from the authenticated user | 409 / ACCOUNT_CHANGED, no mutation |
| Malformed history cursor or unsupported history query parameters | 400 |
| Query with an invalid UUID or more than 4,000 characters | 400 |
| Download/delete another account's document ID | 404 |
| Invalid or oversized upload | 400 or 413, depending on validation stage |
| More than one active ingestion/query in the same account | 429 |
| Four other accounts already running expensive work | 429 |
| More than 20 expensive operations/account/minute | 429 |
| Unavailable, denied, truncated or empty generation response after retrieval | HTTP 200 with `generation_failed`, unverified source excerpts and no successful correction |
| Invalid verification output after its bounded contract retry | `VERIFICATION_FAILED`, never a fake supported answer |
| POST /rag/save or /rag/load | 404; SQLite now persists writes automatically |

Do not run overload or quota tests against a live paid provider. Deterministic isolation, idempotency, admission-control and failure tests are already included in `npm test`.


## Lifecycle metadata, review and version history

See [Lifecycle workflows](docs/LIFECYCLE_WORKFLOWS.md) for bounded history routes, revision-checked writes, shared admission limits and the combined browser/API acceptance command. Legacy version-array routes remain compatible; use `GET /rag/messages/:id/version-history?limit=20` for newest-first paginated answer versions.
