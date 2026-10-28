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

For an actual file, use `POST /rag/upload`, Body -> form-data, with one **File** field named `file`. Do not manually set multipart Content-Type: the client must supply its boundary. Supported: PDF, DOCX, TXT and Markdown; 10 MB and 100,000 extracted characters maximum. Scanned PDFs need OCR. This route returns a content-derived document ID and retains the original file.

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

These UUIDs are synthetic examples. Use a new `messageId` for a new question, and retain `conversationId` to group questions in the same saved conversation. Both fields are optional. Earlier turns are not automatically included in model context.

A successful HTTP response has `draft`, `status`, `factCheck`, `citations`, `attempts`, `durationMs`, `correction`, `conversationId`, `messageId`, `sourceRevision` and `sourcesChanged`. A cached result may have `cached: true`.

`status` can be `supported`, `repaired` or `abstained`. Abstention is an expected outcome, with `reason` equal to `no_documents`, `insufficient_context` or `verification_failed`. A model check is not a factual accuracy guarantee. Exact answer wording is not deterministic and should not be asserted in live tests.

Replay the exact same body after completion: it should return the stored result without adding another message or making another model call. Reusing the message ID with a changed question returns 409. A pending or previously failed message also returns 409; an intentional retry after failure needs a new message ID.

## 5. Check saved history: GET /rag/conversations

The latest 100 conversations include saved questions, answers, citations and failures. Reload the UI or sign out and back in to confirm they remain. The `sourcesChanged` warning becomes true when the library revision differs from the answer's recorded revision; it does not mean the answer was automatically revalidated.

## 6. Delete only the synthetic document: DELETE /rag/docs/manual-test-policy

Expected: 200 with `{ "success": true }`. This removes the document, search chunks and original bytes if present. Earlier chats retain their historical citation excerpts. Repeating deletion or requesting another account's ID returns 404. Never substitute a real user's document ID in a destructive test without intending to delete it.

## 7. Session lifecycle

- `POST /auth/refresh`, empty JSON body: rotates the refresh cookie and renews access. Retain the new cookies. An old refresh token cannot be replayed.
- `POST /auth/logout`, empty JSON body: revokes the session and clears cookies.
- `GET /auth/me` after logout: 401.

Access JWTs last 15 minutes; database sessions have a maximum seven-day lifetime. Production cookies require HTTPS.

## Negative cases

| Request | Expected |
| --- | --- |
| Read documents/history without authentication | 401 |
| POST/DELETE without `X-Veriqon-Request: 1`, or with a disallowed Origin | 403 |
| Query body with another user's `ownerId` | 400, unknown field rejected |
| Query with an invalid UUID or more than 4,000 characters | 400 |
| Download/delete another account's document ID | 404 |
| Invalid or oversized upload | 400 or 413, depending on validation stage |
| More than one active ingestion/query in the same account | 429 |
| Four other accounts already running expensive work | 429 |
| More than 20 expensive operations/account/minute | 429 |
| Unavailable, denied, truncated or empty provider response | Explicit error, never a fake supported answer |
| POST /rag/save or /rag/load | 404; SQLite now persists writes automatically |

Do not run overload or quota tests against a live paid provider. Deterministic isolation, idempotency, admission-control and failure tests are already included in `npm test`.
