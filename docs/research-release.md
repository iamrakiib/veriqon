# Local research-release verification

Checked on 11 November 2026. This prepares a downloadable research project; nothing was pushed or deployed. It does not certify a bug-free service or general factual accuracy.

## What this release adds

- MIT licensing for original code and synthetic fixtures, with separate third-party font notices.
- A self-contained seven-case corpus and offline demonstration that invokes the actual production correction orchestration. No private baseline checkout is required.
- Live evaluation against the same fixed drafts and evidence, plus an independent-review template and scorer. The baseline is an uncorrected draft, not an older Veriqon release.
- Local setup and configuration checks that generate private secrets without overwriting existing settings or printing them.
- Source export with file hashes, checks for known local secrets and common credential signatures, and inspection of reachable local Git history.
- Portable Chromium browser tests, an isolated test-port option, and Docker forwarding of documented embedding pacing and repair settings.
- An explicit [capability matrix](capabilities.md) and [provider guide](provider-setup.md). Durable ingestion is implemented; continuous answer revalidation is not.

## Fresh-source check

Sources were exported to a temporary directory outside the working repository, with no inherited `node_modules`, `.env`, data or build output. Dependencies were installed using `npm ci` on Node 22.19.0. Tests did not reuse the developer's running API or frontend.

| Check | Actual outcome |
| --- | --- |
| Fresh dependency installation | Passed; 414 packages installed, zero known vulnerabilities reported by npm at installation time |
| Local setup and doctor | Passed; independent secrets generated; missing live-provider configuration reported explicitly |
| Backend regression suite | 132 passed, zero failed, one PostgreSQL-only test skipped in the SQLite run |
| PostgreSQL/pgvector/Redis integration suite | 31 passed, zero failed or skipped, including the final retry/shutdown regressions |
| Offline correction demonstration | Seven scenarios passed |
| Release audit and review-tool tests | Four passed |
| Lint | Passed in the source workspace |
| Production frontend build and TypeScript check | Passed in the fresh source copy |
| Portable Chromium browser suite | 86 passed, zero failed, two intentional viewport-specific skips; isolated frontend on port 3101 |
| Fresh SQLite HTTP smoke | Ten checks passed: owner setup, registration/recovery codes, session access, anonymous rejection, library/history/conflict access, logout revocation and login |
| Docker configuration and images | Configuration validated; API and standalone frontend images built from the fresh copy |
| Fresh Docker startup and HTTP smoke | PostgreSQL, Redis, API and web healthy; ten account/session checks passed through the frontend proxy; homepage and readiness returned HTTP 200 |

The HTTP smoke used generated disposable accounts; no real user account or documents were changed. A first SQLite request made before the new API finished starting returned connection refused; the checks passed once startup completed. This was test synchronization, not an authenticated API failure. Docker startup waited for health checks. Live AI calls were evaluated separately against synthetic passages; the clean Docker setup intentionally had no provider key. No application implementation changed after these checks; final additions were documentation, measured traces, Git byte-preservation rules and full-history CI checkout. Next.js regenerated its environment declaration during build/dev checks.

## Live correction measurement

The [complete synthetic traces](../research/results/live-2026-11-11.json) preserve inputs, outputs, source/version references, assessments, accepted/rejected revisions, model usage and timings. The corpus is [fixtures.json](../research/fixtures.json); its SHA-256 is recorded in the report. No private uploaded documents were used.

| Measurement, limited to this corpus | Fixed uncorrected drafts | RAC-inspired correction |
| --- | ---: | ---: |
| Correct returned numeric facts | 6/11 | 10/10 |
| Unsupported returned numeric facts | 5/11 | 0/10 |
| Expected numeric coverage | 6/10 | 10/10 |
| Completed correction cases | Not applicable | 4/4 |
| Unnecessary successful repairs | Not applicable | 0/3 |
| Execution/provider failures | Not timed/executed | 0/7 |
| Mean correction-stage latency | Not measured | 9.55 seconds |
| Reported prompt + completion tokens | Not measured | 18,733 |

The live model returned by the gateway was `nvidia/nemotron-3-ultra-550b-a55b:free`. This is an observation about this run, not a promise of ongoing availability or a recommendation to send confidential documents to that provider. Model configuration was not switched for this test. API cost was not independently measured.

The model corrected five datasets to two and preserved four architectures. It retained the already-correct draft, retrieved the supplied results passage on the missing-support case, withheld an unsupported accuracy value, and corrected the 2024 policy using the supplied historical passage. This does not implement authoritative date filtering.

The last two cases repeat the incorrect-number input in live mode: adverse replacement text is injected only by the offline fixture provider. The live model made genuine corrections in those cases. Thus four successful repairs include three repetitions of the same underlying numeric correction; they are not four independent factual domains. The offline tests separately demonstrate rejection of a superficial rewrite and an unsupported qualifier introduced by a repair.

The grader recognizes only the fixture's numerical vocabulary. It does not establish arbitrary semantic entailment, extraction completeness, citation entailment, calibrated confidence or general claim accuracy. Ground truth was authored before the model run but has **not been independently human-reviewed**. Generation and embedding are excluded, retrieval is controlled, the sample is small and sequential, and no statistical superiority over another model or published RAC result is claimed.

## Remaining release boundaries

Use this as a research prototype with explicit operating requirements. It is not a production SLA:

- Provider quota and latency remain external dependencies. Saved upload checkpoints and source-excerpt fallback mitigate failure; they do not create capacity.
- Exact vector search, process-local semantic caching and limited load testing do not establish large-library or multi-instance scalability.
- Conflict Center is inspection of saved answer assessments. Library-wide scanning, administrator resolution history, authoritative temporal retrieval and continuous revalidation remain incomplete.
- Email ownership verification, delivered recovery emails and MFA are not implemented; recovery codes are supported.
- A broader independently annotated corpus, real-document retrieval recall, independent citation judgments, soak/load tests and operational restore drills remain needed for stronger reliability claims.
- Source audit checks known private values and selected patterns; it is not a guarantee that every possible secret or sensitive image is absent. Remote hosting logs and unavailable Git objects are outside this local check.

Historical documents under `docs/` retain earlier failures and measurements. A passing current regression does not erase those records. See [research instructions](../research/README.md) to reproduce the current workflow and [capabilities](capabilities.md) for the current implementation boundary.
