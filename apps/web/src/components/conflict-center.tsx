"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Search,
  ChevronDown,
  GitCompareArrows,
  RefreshCw,
  ArrowUpRight,
  Ellipsis,
  Archive,
} from "lucide-react";
import { request, type Citation } from "../lib/api";
import { AuditHistory, ConflictReview } from "./knowledge-controls";
import { EmptyState, Modal } from "./ui";
type Conflict = {
  id: string;
  messageId?: string;
  question: string;
  claim: string;
  detectedAt: string;
  status: "UNRESOLVED" | "RESOLVED" | "DISMISSED";
  revision?: number;
  stale?: boolean;
  resolution?: {action:string;explanation:string;actorId:string;at:number};
  scope: { time: string | null; place: string | null };
  reason: string;
  supporting: (Citation & { quote: string })[];
  contradicting: (Citation & { quote: string })[];
};
type Response = {
  coverage: "saved_answer_assessments";
  truncated: boolean;
  reviewedAnswers: number;
  records: Conflict[];
};
export function ConflictCenter({
  onCitation,
  onOpen,
}: {
  onCitation: (citation: Citation) => void;
  onOpen?: (messageId: string) => void;
}) {
  const [data, setData] = useState<Response | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState("");
  const [clearing, setClearing] = useState(false), [clearError, setClearError] = useState(""), [notice, setNotice] = useState("");
  const [toClear, setToClear] = useState<Conflict[] | null>(null);
  async function clearHistory() {
    if (!toClear || clearing) return;
    setClearing(true); setClearError("");
    try {
      await request("conflicts/archive", { method: "POST", body: JSON.stringify({ records: toClear.map(c => ({ id: c.id, expectedRevision: c.revision || 0 })) }) });
      const ids = new Set(toClear.map(c => c.id));
      setData(current => current ? { ...current, records: current.records.filter(c => !ids.has(c.id)) } : current);
      setSelected(""); setToClear(null); setNotice("Conflict history cleared. Saved answers and source decisions are retained.");
    } catch (e) { setClearError(e instanceof Error ? e.message : "Could not clear conflict history. Nothing has been removed."); }
    finally { setClearing(false); }
  }
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await request<Response>("conflicts"));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load conflict records.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const rows =
    data?.records.filter(
      (c) =>
        (filter === "all" ||
          (filter === "unresolved" ? c.status === "UNRESOLVED" :
            filter === "resolved" ? c.status !== "UNRESOLVED" :
              filter === "stale" ? c.stale :
                filter === "temporal" ? c.scope.time : !c.scope.time)) &&
        `${c.id} ${c.claim} ${c.question} ${[...c.supporting, ...c.contradicting].map((s) => s.source).join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) || [];
  return (
    <section className="conflict-records">
      <div className="view-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search conflicts"
            placeholder="Search claims, sources or IDs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="filter-select">
          <select
            aria-label="Filter conflicts"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All records</option>
            <option value="unresolved">Unresolved</option>
            <option value="resolved">Resolved / dismissed</option>
            <option value="stale">Stale decisions</option>
            <option value="temporal">With stated temporal scope</option>
            <option value="unknown">Scope needs review</option>
          </select>
        </label>
        <button
          className="button secondary conflict-refresh"
          aria-label="Refresh conflicts"
          title="Refresh conflicts"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
          <span>Refresh conflicts</span>
        </button>
        <details className="conflict-actions" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.open = false; }} onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
          <summary className="icon-button" aria-label="Conflict actions" title="Conflict actions"><Ellipsis size={18} /></summary>
          <div className="conflict-actions-popover">
            <button disabled={loading || !!error || !rows.length || clearing} onClick={e => { const menu = e.currentTarget.closest("details")!; menu.open = false; menu.querySelector("summary")?.focus(); setClearError(""); setToClear(rows.slice(0, 200)); }}><Archive size={16} />Clear visible history</button>
          </div>
        </details>
      </div>
      {notice && <p role="status" className="scope-note">{notice}</p>}
      <Modal open={toClear !== null} onClose={() => { if (!clearing) setToClear(null); }} title="Clear conflict history?" description={`Remove ${toClear?.length || 0} visible ${(toClear?.length || 0) === 1 ? "record" : "records"} from this history. Source documents, saved answers and review decisions are retained. New conflicts will still appear.`}>
        <p className="scope-note">This clears the selected history view; it does not resolve disagreements or revoke source preferences.</p>
        {clearError && <p role="alert" className="inline-note">{clearError}</p>}
        <div className="conflict-clear-actions"><button className="button secondary" disabled={clearing} onClick={() => setToClear(null)}>Cancel</button><button className="button secondary destructive" disabled={clearing} onClick={() => void clearHistory()}>{clearing ? "Clearing..." : "Clear history"}</button></div>
      </Modal>
      <p className="scope-note">
        Conflicts found while checking saved answers. This is not a scan of your
        entire library. Source precedence is not inferred from upload order.
      </p>
      {loading ? (
        <div
          className="loading-rows"
          role="status"
          aria-label="Loading conflict records"
        >
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : error ? (
        <div className="inline-note" role="alert">
          {error}
        </div>
      ) : (
        data && (
          <>
            <p className="muted">
              {data.records.filter(c=>c.status==="UNRESOLVED").length} unresolved{" "}
              {data.records.filter(c=>c.status==="UNRESOLVED").length === 1 ? "record" : "records"} across{" "}
              {data.reviewedAnswers} recent answer assessments.
              {data.truncated && " Older answers are outside this view."}
            </p>
            {rows.length ? (
              <div className="conflict-table">
                <div className="conflict-table-head" aria-hidden="true">
                  <span>CLAIM / SOURCES</span>
                  <span>SCOPE</span>
                  <span>STATUS</span>
                  <span>DETECTED</span>
                </div>
                {rows.map((c) => (
                  <article className="conflict-record" key={c.id}>
                    <button
                      className="conflict-row"
                      aria-expanded={selected === c.id}
                      aria-controls={`conflict-${c.id}`}
                      onClick={() => setSelected(selected === c.id ? "" : c.id)}
                    >
                      <span>
                        <strong>{c.claim}</strong>
                        <small>
                          {[
                            ...new Set(
                              [...c.supporting, ...c.contradicting].map(
                                (s) => s.source,
                              ),
                            ),
                          ].join(" / ")}
                        </small>
                      </span>
                      <span className="scope-cell">
                        {c.scope.time || "Needs review"}
                      </span>
                      <span className={`badge ${c.status==="UNRESOLVED"?"red":"green"}`}>{c.status === "UNRESOLVED" ? "Unresolved" : c.status === "RESOLVED" ? "Resolved by review" : "Dismissed by review"}</span>
                      <time>
                        {new Date(c.detectedAt).toLocaleDateString()}{" "}
                        <ChevronDown size={13} />
                      </time>
                    </button>
                    {selected === c.id && (
                      <div className="conflict-detail" id={`conflict-${c.id}`}>
                        <div className="repair-heading">
                          <span className={`badge ${c.status === "UNRESOLVED" ? "red" : "green"}`}>
                            {c.stale ? "Stale decision · evidence changed" : c.status === "UNRESOLVED" ? "Unresolved · human review needed" : "Review decision recorded"}
                          </span>
                          <code title={c.id}>{c.id.slice(0, 12)}</code>
                        </div>
                        {c.question && <p>Question: {c.question}</p>}
                        <div className="conflict-sides">
                          {[
                            { name: "Supporting passage", refs: c.supporting },
                            {
                              name: "Contradicting passage",
                              refs: c.contradicting,
                            },
                          ].map((side) => (
                            <section key={side.name}>
                              <h3>{side.name}</h3>
                              {side.refs.map((s, i) => (
                                <div key={i}>
                                  <blockquote>{s.quote}</blockquote>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      onCitation({
                                        ...s,
                                        relations: [
                                          {
                                            claim: c.claim,
                                            relationship:
                                              side.name === "Supporting passage"
                                                ? "supporting"
                                                : "contradicting",
                                          },
                                        ],
                                      })
                                    }
                                  >
                                    [{s.index}] {s.source}{" "}
                                    <ArrowUpRight size={13} />
                                  </button>
                                  <dl className="source-metadata">
                                    <div>
                                      <dt>Version</dt>
                                      <dd>
                                        <code>
                                          {s.version || "Not supplied"}
                                        </code>
                                      </dd>
                                    </div>
                                    <div>
                                      <dt>Publication / effective dates</dt>
                                      <dd>Published: {s.metadata?.publishedAt || "Unknown"}; effective: {s.metadata?.effectiveFrom || "Unknown"} to {s.metadata?.effectiveTo || "Unknown"}. Evidence snapshot.</dd>
                                    </div>
                                  </dl>
                                </div>
                              ))}
                            </section>
                          ))}
                        </div>
                        <dl className="source-metadata">
                          <div>
                            <dt>Classification</dt>
                            <dd>Conflicting evidence · subtype not recorded</dd>
                          </div>
                          <div>
                            <dt>Model-assessed scope</dt>
                            <dd>
                              {c.scope.time || "Time unknown"} /{" "}
                              {c.scope.place || "Place unknown"}
                            </dd>
                          </div>
                          <div>
                            <dt>Effective date overlap</dt>
                            <dd>Not established</dd>
                          </div>
                          <div>
                            <dt>Source authority</dt>
                            <dd>{c.resolution && !c.stale ? "Claim-specific owner review; not general source authority" : "No applicable precedence rule recorded"}</dd>
                          </div>
                          <div>
                            <dt>Resolution decision</dt>
                            <dd>{c.resolution ? `${c.resolution.action}: ${c.resolution.explanation}` : "Unresolved"}</dd>
                          </div>
                        </dl>
                        <p className="conflict-reason">{c.reason}</p>
                        {!c.messageId && <p className="scope-note">The original chat was deleted. Source evidence and review decisions are retained.</p>}
                        {c.messageId && onOpen && (
                          <button
                            className="text-button"
                            onClick={() => onOpen(c.messageId!)}
                          >
                            Open affected answer <ArrowUpRight size={14} />
                          </button>
                        )}
                        {c.stale ? <><p role="status">The sources or metadata changed. Recheck the affected answer before making another decision.</p><AuditHistory key={c.id} path={`conflicts/${encodeURIComponent(c.id)}/decision-history`} label="Decision history" /></> : <ConflictReview key={`${c.id}:${c.revision || 0}`} id={c.id} revision={c.revision || 0} sources={[...c.supporting,...c.contradicting]} onSaved={()=>void load()} />}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<GitCompareArrows size={26} />}
                title={
                  data.records.length
                    ? "No matching conflicts"
                    : "No recorded conflicts"
                }
                description={
                  data.records.length
                    ? "Try another search or scope filter."
                    : "No conflicts were recorded in these answer assessments. This does not establish that all sources agree."
                }
              />
            )}
          </>
        )
      )}
    </section>
  );
}
