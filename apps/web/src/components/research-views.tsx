"use client";
import { useCallback, useEffect, useState } from "react";
import { History, Search, ArrowUpRight, MessageSquare, RefreshCw, Ellipsis, Archive } from "lucide-react";
import type { Citation, DocumentRecord } from "../lib/api";
import { RevalidationPanel } from "./knowledge-controls";
import { request } from "../lib/api";
import type { Conversation, Message } from "./chat-panel";
import { matchesConversation } from "./chat-panel";
import { ConversationActions } from "./conversation-actions";
import { EmptyState, Modal } from "./ui";
import { RepairDetails, VerificationBadge } from "./answer-details";

export function PageHeading({
  title,
  description,
  eyebrow = "WORKSPACE",
}: {
  title: string;
  description: string;
  eyebrow?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
export function ConversationHistory({
  search,
  onSearch,
  conversations,
  loading,
  error,
  onRetry,
  onOpen,
  onDelete,
  deleteDisabled,
  hasMore,
  loadingMore,
  moreError,
  onLoadMore,
  windowed,
}: {
  search: string;
  onSearch: (value: string) => void;
  conversations: Conversation[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onDelete?: (chat: Conversation) => void;
  deleteDisabled?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  moreError?: string;
  onLoadMore?: () => void;
  windowed?: boolean;
}) {
  const rows = conversations.filter(
    (c) =>
      c.messages.length &&
      matchesConversation(c, search),
  );
  return (
    <>
      <PageHeading
        title="Chat history"
        description="Pick up your research. Each question uses a fresh retrieval of your sources."
      />
      <label className="search-field">
        <Search size={16} />
        <input
          aria-label="Search conversations"
          placeholder="Search titles and questions"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>
      {loading ? (
        <div className="loading-rows" aria-label="Loading conversations">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : error ? (
        <div className="inline-note" role="alert">
          {error}
          <button className="text-button" onClick={onRetry}>
            Retry chat history
          </button>
        </div>
      ) : rows.length ? (
        <div className="history-list">
          {rows.map((c) => (
            <div className="history-entry" key={c.id}>
            <button
              className="history-row"
              onClick={() => onOpen(c.id)}
            >
              <MessageSquare size={18} />
              <span>
                <strong>{c.title}</strong>
                <small>
                  {c.messages.length}{c.olderMessagesCursor ? "+" : ""} loaded questions ·{" "}
                  {new Date(
                    c.messages[c.messages.length - 1].createdAt,
                  ).toLocaleString()}
                </small>
              </span>
              <ArrowUpRight size={16} />
            </button>
            {onDelete && <ConversationActions label={`Chat actions for ${c.title}`} disabled={deleteDisabled} onDelete={() => onDelete(c)} />}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<MessageSquare size={24} />}
          title={
            search
              ? "No matching conversations"
              : "Start your first conversation"
          }
          description="Your saved questions, answers and evidence will appear here."
        />
      )}
      <p className="scope-note">
        Search covers loaded conversations and messages. Open a conversation to load older messages.
        {windowed && " Up to 40 conversations are kept in this window; drafts remain available."}
      </p>
      {moreError && <p role="alert" className="inline-note">{moreError}</p>}
      {windowed && <button className="button secondary" disabled={loadingMore || loading} onClick={onRetry}>Newest conversations</button>}
      {hasMore && <button className="button secondary" disabled={loadingMore || loading} onClick={onLoadMore}>{loadingMore ? "Loading older conversations…" : "Load older conversations"}</button>}
    </>
  );
}
export function Corrections({
  onCitation,
  onOpen,
}: {
  onCitation: (c: Citation) => void;
  onOpen: (id: string) => void;
}) {
  type Record = Message & { assessmentId: string };
  type Response = { records: Record[]; reviewedAnswers: number; truncated: boolean };
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [clearing, setClearing] = useState(false), [clearError, setClearError] = useState("");
  const [toClear, setToClear] = useState<Record[] | null>(null), [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await request<Response>("corrections")); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load corrections."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function clearHistory() {
    if (!toClear || clearing) return;
    setClearing(true); setClearError("");
    try {
      await request("corrections/archive", { method: "POST", body: JSON.stringify({ records: toClear.map(({ id, assessmentId }) => ({ id, assessmentId })) }) });
      const ids = new Set(toClear.map(r => r.id));
      setData(current => current ? { ...current, records: current.records.filter(r => !ids.has(r.id)) } : current);
      setToClear(null); setNotice("Correction history cleared. Saved answers, versions and background jobs are retained.");
    } catch (e) { setClearError(e instanceof Error ? e.message : "Could not clear correction history. Nothing has been removed."); }
    finally { setClearing(false); }
  }
  const [filter, setFilter] = useState("all");
  const attempts = data?.records || [];
  const accepted = (m: Message) =>
    m.result?.verificationStatus === "REPAIRED_VERIFIED" &&
    m.result.factCheck.passed &&
    m.result.status === "repaired";
  const rows = attempts.filter(
    (m) =>
      filter === "all" || (filter === "verified" ? accepted(m) : !accepted(m)),
  );
  return (
    <>
      <PageHeading
        title="Corrections"
        eyebrow="ANSWER AUDIT TRAIL"
        description="See what changed, why it changed, and whether the revision passed verification."
      />
      <div className="view-toolbar correction-toolbar">
        <span className="muted">{attempts.length} {attempts.length === 1 ? "answer" : "answers"} with repair attempts</span>
        <label className="filter-select">
          <select
            aria-label="Filter corrections"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All attempts</option>
            <option value="verified">Verified repairs</option>
            <option value="withheld">Withheld / earlier assessments</option>
          </select>
        </label>
        <button className="button secondary conflict-refresh" aria-label="Refresh corrections" title="Refresh corrections" disabled={loading || clearing} onClick={() => void load()}><RefreshCw size={14} /><span>Refresh corrections</span></button>
        <details className="conflict-actions" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.open = false; }} onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
          <summary className="icon-button" aria-label="Correction actions" title="Correction actions"><Ellipsis size={18} /></summary>
          <div className="conflict-actions-popover">
            <button disabled={loading || !!error || !rows.length || clearing} onClick={e => { const menu = e.currentTarget.closest("details")!; menu.open = false; menu.querySelector("summary")?.focus(); setClearError(""); setToClear(rows); }}><Archive size={16} />Clear visible history</button>
          </div>
        </details>
      </div>
      {notice && <p role="status" className="scope-note">{notice}</p>}
      <Modal open={toClear !== null} onClose={() => { if (!clearing) setToClear(null); }} title="Clear correction history?" description={`Remove ${toClear?.length || 0} visible repair ${(toClear?.length || 0) === 1 ? "record" : "records"} from this history. Saved answers, immutable versions and background jobs are retained. New assessments will still appear.`}>
        {clearError && <p role="alert" className="inline-note">{clearError}</p>}
        <div className="conflict-clear-actions"><button className="button secondary" disabled={clearing} onClick={() => setToClear(null)}>Cancel</button><button className="button secondary destructive" disabled={clearing} onClick={() => void clearHistory()}>{clearing ? "Clearing..." : "Clear history"}</button></div>
      </Modal>
      <p className="scope-note">
        Repair attempts across {data?.reviewedAnswers ?? 0} recent answer assessments.{data?.truncated && " Older answers are outside this view."} Background assessments and their immutable versions are listed separately below.
      </p>
      <RevalidationPanel onCitation={onCitation} />
      {loading ? (
        <div className="skeleton" aria-label="Loading corrections" />
      ) : error ? (
        <p role="alert">{error}</p>
      ) : rows.length ? (
        rows.map((m) => (
          <article className="correction-record" key={m.id}>
            <div className="repair-heading">
              {accepted(m) ? (
                <VerificationBadge result={m.result!} />
              ) : (
                <span className="badge amber">
                  {m.result?.correction && !m.result.verificationStatus
                    ? "Earlier repair · not revalidated"
                    : "Repair withheld"}
                </span>
              )}
              <time>{new Date(m.createdAt).toLocaleString()}</time>
            </div>
            <h2>{m.question}</h2>
            <RepairDetails result={m.result!} onCitation={onCitation} />
            {!accepted(m) && (
              <details className="verification-detail">
                <summary>Why verification failed</summary>
                <p>{m.result!.factCheck.evidence}</p>
              </details>
            )}
            <button className="text-button" onClick={() => onOpen(m.id)}>
              Open affected answer <ArrowUpRight size={14} />
            </button>
          </article>
        ))
      ) : (
        <EmptyState
          icon={<History size={26} />}
          title={
            filter === "all"
              ? "Every repair leaves a trace"
              : "No matching repairs"
          }
          description="Verified corrections and withheld attempts appear here with the evidence used to assess them."
        />
      )}
    </>
  );
}
export function Analytics({
  documents,
  messages,
  loading,
  connected,
  error,
}: {
  documents: DocumentRecord[];
  messages: Message[];
  loading: boolean;
  connected: boolean;
  error: string;
}) {
  const [range, setRange] = useState("all");
  const selected = messages.filter(
    (m) =>
      range === "all" ||
      Date.parse(m.createdAt) >= Date.now() - Number(range) * 86400000,
  );
  const answers = selected.filter((m) => m.result),
    results = answers.map((m) => m.result!);
  const verified = results.filter(
    (r) =>
      !r.answerOrigin && r.factCheck.passed &&
      ["VERIFIED_UNCHANGED", "REPAIRED_VERIFIED"].includes(
        r.verificationStatus || "",
      ) &&
      r.status !== "abstained",
  );
  const repairs = verified.filter(
    (r) => !r.cached && r.verificationStatus === "REPAIRED_VERIFIED",
  );
  const calls = results.flatMap((r) => r.modelUsage || []);
  const tokens = calls.reduce(
    (sum, c) => sum + (c.promptTokens ?? 0) + (c.completionTokens ?? 0),
    0,
  );
  const incomplete =
    results.some((r) => !r.cached && !r.answerOrigin && !r.modelUsage?.length) ||
    calls.some((c) => c.promptTokens === null || c.completionTokens === null) ||
    selected.some((m) => m.error);
  const timed = results.filter(
    (r) => !r.cached && Number.isFinite(r.durationMs),
  );
  const days = new Map<number, number>();
  answers.forEach((m) => {
    const date = new Date(m.createdAt);
    const day = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).getTime();
    days.set(day, (days.get(day) || 0) + 1);
  });
  const metrics = [
    {
      label: "Indexed documents",
      value: connected ? documents.length : "—",
      note: "Current private library",
    },
    {
      label: "Completed answers",
      value: answers.length,
      note: "Includes abstentions",
    },
    {
      label: "Verified answers",
      value: verified.length,
      note: "Model assessed, not accuracy",
    },
    {
      label: "Verified repairs",
      value: repairs.length,
      note: "Passed final verification",
    },
    {
      label: "Average response",
      value: timed.length
        ? `${(timed.reduce((n, r) => n + r.durationMs, 0) / timed.length / 1000).toFixed(1)} s`
        : "—",
      note: "Noncached completed requests",
    },
    {
      label: "Reported tokens",
      value: calls.length || results.length && !incomplete ? tokens.toLocaleString() : "—",
      note: incomplete
        ? "Partial total; some usage missing"
        : "Reported input + output tokens",
    },
  ];
  return (
    <>
      <PageHeading
        title="Analytics"
        eyebrow="OBSERVE, THEN IMPROVE"
        description="Usage and answer outcomes from your loaded conversation history."
      />
      <div className="view-toolbar">
        <p className="muted">{selected.length} loaded questions · local time</p>
        <label className="filter-select">
          <select
            aria-label="Analytics time range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="all">All loaded history</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert">{error} Metrics are unavailable until history loads.</p>
      ) : loading ? (
        <div className="skeleton" aria-label="Loading analytics" />
      ) : (
        <>
          <div className="metrics-grid">
            {metrics.map((m) => (
              <div className="metric" key={m.label}>
                <span>{m.label}</span>
                <strong>{m.value}</strong>
                <small>{m.note}</small>
              </div>
            ))}
          </div>
          <div className="analytics-grid">
            <section className="report-section">
              <h2>Answer activity</h2>
              <p className="muted">
                Up to 14 recorded dates, ordered by day. Counts include
                abstentions.
              </p>
              {days.size ? (
                <div
                  className="activity-chart"
                  aria-label="Completed answers by date"
                >
                  {[...days.entries()]
                    .sort(([a], [b]) => a - b)
                    .slice(-14)
                    .map(([day, n]) => (
                      <div className="activity-row" key={day}>
                        <time>{new Date(day).toLocaleDateString()}</time>
                        <div>
                          <span
                            style={{
                              width: `${(n / Math.max(...days.values())) * 100}%`,
                            }}
                          />
                        </div>
                        <strong>{n}</strong>
                      </div>
                    ))}
                </div>
              ) : (
                <EmptyState
                  icon={<MessageSquare size={22} />}
                  title="No observations yet"
                  description="Ask a question to start recording answer outcomes."
                />
              )}
            </section>
            <section className="report-section">
              <h2>Outcome breakdown</h2>
              <dl className="coverage">
                <div>
                  <dt>Verified unchanged</dt>
                  <dd>{verified.filter(r => !r.cached && r.verificationStatus === "VERIFIED_UNCHANGED").length}</dd>
                </div>
                <div>
                  <dt>Repaired and verified</dt>
                  <dd>{repairs.length}</dd>
                </div>
                <div>
                  <dt>Reused verified answers</dt>
                  <dd>{verified.filter(r => r.cached).length}</dd>
                </div>
                <div>
                  <dt>Checked workspace records</dt>
                  <dd>{results.filter(r => r.answerOrigin).length}</dd>
                </div>
                <div>
                  <dt>Abstained / partly verified</dt>
                  <dd>
                    {results.filter((r) => r.status === "abstained" && !["VERIFICATION_FAILED", "UNRESOLVED_CONFLICT"].includes(r.verificationStatus || "")).length}
                  </dd>
                </div>
                <div>
                  <dt>Answers with unresolved conflicts</dt>
                  <dd>
                    {
                      results.filter(
                        (r) => r.verificationStatus === "UNRESOLVED_CONFLICT",
                      ).length
                    }
                  </dd>
                </div>
                <div>
                  <dt>Generation / verification failures</dt>
                  <dd>{results.filter(r => r.verificationStatus === "VERIFICATION_FAILED").length}</dd>
                </div>
                <div>
                  <dt>Request failures</dt>
                  <dd>{selected.filter((m) => m.error).length}</dd>
                </div>
                <div>
                  <dt>Earlier / unclassified assessments</dt>
                  <dd>
                    {
                      results.filter(
                        (r) =>
                          !r.answerOrigin && r.status !== "abstained" && !verified.includes(r),
                      ).length
                    }
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </>
      )}
      <section className="report-section">
        <h2>Measurement coverage</h2>
        <dl className="coverage">
          <div>
            <dt>Current documents with version identifiers</dt>
            <dd>
              {connected
                ? documents.filter((d) => d.version).length
                : "Unavailable"}{" "}
              · not a version archive
            </dd>
          </div>
          <div>
            <dt>API expenditure</dt>
            <dd>Unavailable · costs are not recorded</dd>
          </div>
          <div>
            <dt>Pending revalidation jobs</dt>
            <dd>View Corrections for background job status</dd>
          </div>
          <div>
            <dt>Factual accuracy</dt>
            <dd>Requires independent evaluation</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
