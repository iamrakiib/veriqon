# Veriqon local UI redesign

Implemented against the supplied UI/UX plan on 2026-10-30. This work is local only: no GitHub push, hosting configuration change, or deployment. The existing NestJS API, authentication, retrieval, verification, database schema, and provider integration remain in place.

## Audit and changes

The previous workspace combined a document library and a narrow persistent assistant. It provided working authentication, uploads, conversations, recovery codes, and conflict records, but did not give history, correction review, and analytics their own readable views. A legacy correction field could also look like a successful repair without an explicit final verification outcome.

The application now has a collapsible desktop sidebar and a focus-managed mobile navigation panel, with dedicated views for the knowledge base, chat, history, conflicts, corrections, and analytics. Settings preserves the existing account and recovery controls. The Veriqon name and three colored window dots are retained.

The visual system uses neutral light/dark surfaces, a restrained blue accent, semantic status colors, locally hosted Geist fonts, consistent spacing, visible keyboard focus, and reduced-motion support. Chat owns its scroll region; the expanding composer stays inside the viewport. Unsent drafts survive navigation between views during the session.

### Evidence and correction review

- Citation numbers identify retrieved passages, not unique files. Several numbered citations can therefore reference different passages from one document.
- A right-hand source drawer shows the exact excerpt, recorded document version, and recorded claim relationships. Unavailable date and authority metadata is explicitly identified.
- Final verification labels require the backend's explicit verification status and a passing final assessment. Legacy corrections are not upgraded to verified repairs.
- Correction review displays recorded original/proposed claims, changed text, evidence, and final outcomes. The text highlighting is a word-level presentation aid, not a factual-verification algorithm.
- The Conflict Center uses real saved conflict assessments, supports filtering and side-by-side source review, and opens the affected answer. An empty view does not assert that all documents agree.

### Observability

Analytics derives observations from up to 100 loaded conversations and the current private document list. It labels the coverage limit, time range, cached-request exclusion from mean latency, partial token totals, and model-assessed verification counts. Activity dates are sorted chronologically. Verification counts are not factual-accuracy estimates. Outcome categories can overlap, for example an abstention with an unresolved conflict.

Costs, historical document-version archives, pending revalidation jobs, manual conflict resolution, authority decisions, and missing publication/effective dates are not invented. Their UI states explain the unavailable backend capability. This frontend work does not implement those backend features or improve the underlying RAC algorithm.

## Component responsibilities

| File | Responsibility |
| --- | --- |
| `apps/web/src/components/workspace.tsx` | Application state, API coordination, navigation, selected source, draft preservation |
| `apps/web/src/components/workspace-sidebar.tsx` | Typed sidebar and conversation navigation presentation |
| `apps/web/src/components/workspace-dialogs.tsx` | Source drawer, account settings, help presentation |
| `apps/web/src/components/chat-panel.tsx` | Chat, composer, passage links, final answer presentation |
| `apps/web/src/components/answer-details.tsx` | Verification labels, recorded claim repairs, evidence relationships |
| `apps/web/src/components/research-views.tsx` | History, corrections, and observed analytics |
| `apps/web/src/components/conflict-center.tsx` | Saved conflict comparison and affected-answer navigation |
| `apps/web/src/components/document-library.tsx` | Library search/filter/sort, upload queue, source selection |
| `apps/web/src/components/ui.tsx` | Shared controls and modal focus restoration |
| `apps/web/src/lib/api.ts` | Typed frontend API contracts; existing endpoints retained |
| `apps/web/src/app/theme.css` | Shared semantic theme tokens |
| `apps/web/src/app/research.css` | Responsive application presentation, layered over existing account styles |

No runtime dependency was added. Local font assets include their OFL license.

## Validation

Browser regression tests use controlled API fixtures to test presentation and client behavior; production components do not contain fixture data. Coverage includes light/dark navigation, desktop/tablet/mobile sizing, long answers, large libraries, upload queue states, authentication and recovery, cross-tab renewal serialization, citation focus restoration, exact source versions, repair labels, partial analytics, and draft preservation.

A separate real localhost integration check created a disposable account, acknowledged its recovery codes, uploaded and indexed a synthetic TXT document, inspected its extracted content, downloaded the original, confirmed deletion, read the private conflict endpoint, and signed out. All six checks passed with no browser page errors. Its disposable account was removed afterward. This check did not query an external chat model or establish factual reliability.

Validation artifacts are kept under ignored `data/` and `test-results/` directories.

| Check | Actual result |
| --- | --- |
| `npm run web:build` | Passed; optimized frontend compiled, type checked, and prerendered |
| `npm run web:check` | Passed (`tsc --noEmit`) |
| `npm run lint` | Passed |
| `npm run test:browser` | 58 passed, 2 intentionally skipped, 0 failed (2.3 minutes). The skipped mobile-project cases are multi-viewport/tablet checks executed by the desktop project. |
| Real localhost integration | 6 checks passed; no browser page errors; disposable data cleaned up |
| Visual review | Desktop knowledge base and chat, analytics, mobile chat and corrections, expanded conflict comparison, and tablet layout screenshots inspected; light and dark coverage |
| Local server check after build | Frontend, API readiness, and proxied authentication status each returned HTTP 200 |

During iteration, an actual dialog-focus regression was fixed, and a session-renewal test's UI wait was adjusted for slow local startup while preserving its single-concurrent-refresh assertion. The table records the final complete browser run, not a sum of selected passing retries. The final run is in `data/ui-browser-final2.log`.

## Remaining limits

- Answers are delivered after completion; no simulated streaming or fake verification stages are shown.
- Draft persistence covers in-session view changes, not a full browser reload.
- Conflict coverage is the backend's latest 200 saved assessments, not an exhaustive contradiction scan of the entire corpus.
- Opening an affected answer depends on that answer being present in loaded history; the UI explains when it is outside the available window.
- Browser and integration checks validate the UI and API wiring, not independent claim accuracy, retrieval quality, or calibrated confidence.
- Local visual inspection and automated layout checks are not a complete accessibility certification or a substitute for user research.

Run locally with `npm run start:dev` and `npm run web:dev`; open <http://127.0.0.1:3001>. No deployment is part of this change.
