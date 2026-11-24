# Source scoping, upload pacing and chat navigation

10 November 2026. Local changes only; nothing published to GitHub, Render or Vercel.

## Root causes and changes

1. **Filename mismatch widened retrieval.** `note-b.txt` did not match `note b.txt`; the search fell back to the whole authorized library. Source resolution now accepts unambiguous space/hyphen/underscore aliases, prefers exact spelling, and requests clarification for missing or ambiguous filenames before any model call. Explicit selections apply to initial and targeted retrieval and partition the answer cache. Duplicate names require clarification; normalization never grants access to another account's documents.
2. **Two-file follow-ups lost their referents.** “These two policy files” was not recognized as contextual, and only successfully verified turns supplied references. The last three saved user questions now supply filename references even if an answer was conflicted. Failed or conflicted answer text is excluded from model context. Prior answers are never factual evidence. An unresolved or deleted filename stops inference instead of substituting an older unrelated file.
3. **One source could crowd out another.** Named comparisons now allocate dense candidates per document in PostgreSQL and prioritize one relevant passage per selected source before filling remaining context. Passage expansion reserves space for the other selected documents. If the complete selected set cannot fit or be retrieved, the pipeline abstains rather than generating a comparison from a subset.
4. **Embedding calls could burst across workers.** Request-start spacing and provider cooldowns are now coordinated in the database. No document text or API key is stored in the pacing state; its namespace hashes gateway, credential and model. Free-model spacing defaults to 3 seconds and is configurable. A 429 without reset metadata starts a 60-second cooldown rather than a speculative sub-second retry. Provider-supplied reset times take precedence. This controls requests, not token prices or provider availability.
5. **Long uploads could spend their retry budget on ordinary duration.** Workers yield between batches after 25 batches or two minutes, preserve vector checkpoints and return to the queue. Scheduling pauses consume no failure attempt. Successful checkpoint progress resets the consecutive failure streak; three unproductive automatic attempts still stop, and manual retry remains bounded at six. Real 429 failures cannot become endless free scheduling pauses through transport retry.
6. **History had no local return control and chat needed more vertical room.** A compact, accessible history control now sits in the existing chat header. Returning preserves the history search and draft. Following the user's clarification, the desktop width is restored to its original 800-pixel cap. Compact header spacing, a send button beside the expanding input and removal of repeated composer labels give the conversation more height. Mobile retains a 44-pixel back/send target, and the composer stays within the viewport. The footer no longer incorrectly labels a source-specific search as “All workspace documents.”

## Important behavior

- “According to note-b.txt…” searches the uniquely matching file. It does not import disagreements from unrelated sources into a source-specific answer.
- “Compare note.txt and note b.txt…” and a resolvable “these two policy files…” search that pair, including targeted evidence retrieval.
- “Across all documents” can explicitly broaden the search. A vague or missing two-file reference requests filenames.
- Genuine same-scope conflicts remain unresolved without recorded authority. These changes do not fabricate precedence or create a repair entry when no factual correction is supported.
- Existing saved answers are historical records. Their old citations and statuses are not rewritten by this change.
- Every actual repair still requires exact corrective evidence, preservation of supported content and final verification. Superficial rewrites and new unsupported claims remain rejected by regression tests.

## Verification

The deterministic provider fixtures are confined to tests. Production continues to use the configured provider.

| Check | Result |
| --- | --- |
| Backend unit/HTTP suite | 124 passed, 0 failed; 1 PostgreSQL-only skip |
| PostgreSQL/pgvector/Redis integration suite | 23 passed, 0 failed, including the PostgreSQL-only lease race |
| Final PostgreSQL candidate-allocation regression | 1 passed, 0 failed |
| Header navigation and broad chat area, desktop/mobile | 2 passed, with dark/light screenshots inspected |
| Full desktop/mobile browser regression suite | 84 passed, 0 failed, 2 intentional viewport skips |
| Additional source-clarification disclosure check, desktop/mobile | 2 passed, 0 failed |
| Subsequent height correction, original width, draft preservation, expanding input and short displays | 6 targeted desktop/mobile tests passed; frontend typecheck passed; dark/light screenshots inspected |
| Actual localhost API/security smoke checks | 25 passed; authenticated read burst 40/40, concurrency 5, p50 39 ms, p95 96 ms |
| Actual saved-history, conflict, correction and analytics UI inspection | Passed, no browser runtime errors; existing synthetic records only, no new model benchmark |
| TypeScript backend build, lint and frontend production build | Passed |

The read burst is not a throughput benchmark. The large-document test indexes over 275 synthetic passages through repeated worker turns, checks that each successful passage is embedded once and verifies a single committed document revision. It does not measure real-provider token savings, cost, factual accuracy or end-to-end latency on the user's PDF.

The first backend run exposed an outdated single-turn upload assertion and a broad inferred-comparison compatibility issue; both were corrected and rerun. The first browser run found two assertions still expecting the former context disclosure; the replacement disclosure explicitly says previous answers are not evidence. An API smoke probe ran before startup completed and was rerun after readiness. These initial failures are not counted as passing runs.

Logs are local ignored files under `data/scope-*.log`; screenshots are under `test-results/`. Tests used temporary databases and synthetic accounts. Test containers and their volumes were removed, and Docker was returned to its initially stopped state.

## Remaining limitations

Free-provider quotas and upstream outages remain external constraints. Pacing reduces bursts and unnecessary retries but cannot create capacity. No new live-model factuality benchmark or token-cost reduction is claimed here. Exact vector search, process-local answer caching, effective-date/supersession enforcement, manual conflict adjudication, whole-library scanning and continuous answer revalidation still need separate production work. Health flags remain `temporal: false` and `conflictLibraryScan: false`.

Named references are deterministic and conservative, not a general natural-language entity resolver. Queries with unclear references need filenames. The independent reliability, privacy, sustained-load and restore-drill release gates in [the ingestion review](ingestion-reliability.md#remaining-release-gates) still apply.
