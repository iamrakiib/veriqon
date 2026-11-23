# Local verification failure investigation

Two saved questions about the TKG paper failed with `Atomic decomposition was incomplete or malformed` before evidence checking ran. Answer generation succeeded in both. Their recorded total durations were 12.9 and 28.4 seconds. These are observed local failures, not estimates of average performance.

A live reproduction identified overly brittle decomposition requirements: omitted introductory wording rejected the whole plan, and a standalone claim repeating a numerical subject from its own original sentence failed an exact span/text quantity-equality check. The latter now allows original-sentence numerical context while still requiring every span quantity and rejecting invented quantities. Missing assertion coverage still fails validation; it receives one bounded contract retry rather than being silently accepted.

A second live reproduction reached verification, but a valid PDF quote was rejected because the source contained `Experi-\nments` and the verifier returned `Experiments`. A typography-only matcher now maps the quote back to the exact original source slice. It permits whitespace, Unicode typography and PDF line-wrap normalization, not approximate wording or altered values. Replaying that captured assessment passed all 22 claim records after this fix. That replay establishes a parser regression fix, not independently evaluated factual accuracy or a newly measured end-to-end latency improvement.

The verifier now returns stable claim IDs instead of recopying all fact text and spans. The server retains the original claim mapping and requires a complete set of strict assessments. Invalid responses receive one bounded contract retry. Timeouts, provider failures and schema failures are distinguished from insufficient evidence, and the chat provides an edit-and-retry action.

Explicitly named document queries are scoped to matching filenames within the authenticated account. A TKG paper reproduction retrieved only `Tkg_new.pdf` instead of mixing in the account's resume. Vague requests and comparisons retain broader retrieval. This is source selection, not source-authority inference.

All 69 backend tests passed in the combined verification/cache implementation, including the new parser, quote, cache, repair and authorization regressions. Provider latency, genuinely unsupported claims, and model mistakes remain possible. The earlier live run still timed out after a rejected quote; no claim is made that every paper query is now successful. Further independent answer-quality evaluation is needed.
