import { ShieldCheck, AlertTriangle, CircleHelp } from "lucide-react";
import type { Citation, QueryResult } from "../lib/api";

export function VerificationBadge({ result }: { result: QueryResult }) {
  const status = result.verificationStatus;
  const verified = result.factCheck.passed && result.status !== "abstained";
  const label =
    result.reason === "source_selection_required" ? "Choose sources" : result.reason === "generation_failed" ? "Source passages only" : result.answerOrigin ? "Checked records" : verified && status === "REPAIRED_VERIFIED"
      ? "Repaired & verified"
      : verified && status === "VERIFIED_UNCHANGED"
        ? "Verified"
        : status === "UNRESOLVED_CONFLICT"
          ? "Unresolved conflict"
          : status === "PARTIALLY_VERIFIED"
            ? "Partially verified"
            : status === "INSUFFICIENT_EVIDENCE" ||
                result.reason === "insufficient_context" ||
                result.reason === "no_documents"
              ? "Insufficient evidence"
              : status === "VERIFICATION_FAILED" ||
                  result.reason === "verification_failed"
                ? "Verification failed"
                : "Earlier assessment · not revalidated";
  const tone =
    label === "Checked records" || label === "Verified" || label === "Repaired & verified"
      ? "green"
      : label === "Unresolved conflict" || label === "Verification failed"
        ? "red"
        : "amber";
  const Icon =
    tone === "green"
      ? ShieldCheck
      : tone === "red"
        ? AlertTriangle
        : CircleHelp;
  return (
    <span
      className={`badge ${tone}`}
      title={result.reason === "source_selection_required" ? "Identify the requested sources before retrieval or verification can begin." : result.answerOrigin ? "Read directly from your account's stored records; no model was used." : "Verification is an evidence-grounded model assessment, not an independent accuracy guarantee."}
    >
      <Icon size={13} />
      {label}
    </span>
  );
}

/** Highlight the changed interval; exact claim edits take priority over whole-answer comparisons. */
export function TextChange({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const a = before.split(/(\s+)/),
    b = after.split(/(\s+)/);
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const render = (words: string[], old: boolean) => (
    <>
      {words.slice(0, start).join("")}
      {old ? (
        <del>{words.slice(start, words.length - end).join("")}</del>
      ) : (
        <ins>{words.slice(start, words.length - end).join("")}</ins>
      )}
      {end > 0 && words.slice(-end).join("")}
    </>
  );
  return (
    <div className="change-grid">
      <section>
        <h3>Original</h3>
        <p>{render(a, true)}</p>
      </section>
      <section>
        <h3>Revision</h3>
        <p>{render(b, false)}</p>
      </section>
    </div>
  );
}

export function RepairDetails({
  result,
  onCitation,
}: {
  result: QueryResult;
  onCitation: (citation: Citation) => void;
}) {
  const events = result.repairHistory?.length
    ? result.repairHistory
    : result.correction
      ? [
          {
            original: result.correction.original,
            revised: result.correction.revised,
            accepted:
              result.verificationStatus === "REPAIRED_VERIFIED" &&
              result.factCheck.passed &&
              result.status === "repaired",
            reason: result.correction.reason,
          },
        ]
      : [];
  return (
    <div className="repair-events">
      {events.length ? (
        events.map((event, i) => (
          <section key={i} className="repair-event">
            <div className="repair-event-heading">
              <span className={`badge ${event.accepted ? "green" : "amber"}`}>
                {event.accepted
                  ? "Verified factual correction"
                  : "Attempt not accepted"}
              </span>
              <span className="muted">Attempt {i + 1}</span>
            </div>
            <p>{event.reason}</p>
            {event.edits?.length ? (
              event.edits.map((edit) => (
                <div key={edit.claimId}>
                  <TextChange before={edit.original} after={edit.replacement} />
                  <div className="repair-quotes">
                    {edit.evidence.map((e, n) => {
                      const citation = result.citations.find(
                        (c) => c.index === e.index,
                      );
                      return (
                        <div key={n}>
                          <blockquote>{e.quote}</blockquote>
                          {citation && (
                            <button
                              className="text-button"
                              onClick={() => onCitation(citation)}
                            >
                              [{e.index}] {citation.source}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : event.revised ? (
              <TextChange before={event.original} after={event.revised} />
            ) : (
              <p className="muted">No revised answer was recorded.</p>
            )}
            <p className="muted">
              Final verification:{" "}
              {event.after?.verdict ||
                (event.accepted
                  ? result.factCheck.verdict
                  : "Not successfully completed")}
              .{" "}
              {event.accepted
                ? ""
                : "This proposal was not published as a verified answer."}
            </p>
          </section>
        ))
      ) : (
        <p className="muted">
          No detailed correction record is available for this earlier answer.
        </p>
      )}
    </div>
  );
}
