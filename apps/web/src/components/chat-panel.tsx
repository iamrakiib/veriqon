"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  Copy,
  Check,
  FileText,
  LoaderCircle,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import {
  citationWithAssessment,
  citationChunkLabel,
  type Citation,
  type QueryResult,
} from "../lib/api";
import { AnswerVersionHistory } from "./knowledge-controls";
import { BrandMark } from "./ui";
import { RepairDetails, VerificationBadge } from "./answer-details";

export type Message = {
  id: string;
  question: string;
  result?: QueryResult;
  error?: string;
  createdAt: string;
};
export type Conversation = { id: string; title: string; messages: Message[]; cursor?: string; hasMoreConversations?: boolean; olderMessagesCursor?: string | null; newerMessagesOmitted?: boolean };

export function ChatPanel({
  query,
  onQueryChange: setQuery,
  focusMessageId,
  title,
  messages,
  pending,
  connected,
  documentCount,
  onSend,
  onNew,
  onHistory,
  onCitation,
  hasOlderMessages,
  loadingOlderMessages,
  olderMessagesError,
  onLoadOlder,
  newerMessagesOmitted,
  onLoadLatest,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  focusMessageId?: string;
  title: string;
  messages: Message[];
  pending: boolean;
  connected: boolean;
  documentCount: number;
  onSend: (question: string) => Promise<void>;
  onNew: () => void;
  onHistory: () => void;
  onCitation: (citation: Citation) => void;
  hasOlderMessages?: boolean;
  loadingOlderMessages?: boolean;
  olderMessagesError?: string;
  onLoadOlder?: () => Promise<void>;
  newerMessagesOmitted?: boolean;
  onLoadLatest?: () => Promise<void>;
}) {
  const [tab, setTab] = useState("conversation");
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const followBottom = useRef(true);
  useEffect(() => {
    if (!pending) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [pending]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copyAnswer(message: Message) {
    try {
      await navigator.clipboard.writeText(message.result!.draft);
      setCopied(message.id);
      setCopyError("");
    } catch {
      setCopyError(
        "Copy is unavailable. Select the answer text and copy it manually.",
      );
    }
  }
  function switchTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "conversation"
        : event.key === "End"
          ? "evidence"
          : tab === "conversation"
            ? "evidence"
            : "conversation";
    setTab(next);
    document.getElementById(`${next}-tab`)?.focus();
  }
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = textarea.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [query]);
  useEffect(() => {
    if (messages.length && scroll.current && followBottom.current)
      scroll.current.scrollTo({
        top: scroll.current.scrollHeight,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }, [messages, pending, tab]);
  useEffect(() => {
    if (focusMessageId) {
      followBottom.current = false;
      setTab("conversation");
      requestAnimationFrame(() =>
        document
          .getElementById(`message-${focusMessageId}`)
          ?.scrollIntoView({ block: "start", behavior: "instant" }),
      );
    }
  }, [focusMessageId]);
  const lastAnswer = [...messages]
    .reverse()
    .find((message) => message.result)?.result;
  async function submit() {
    if (!query.trim() || pending || !connected || newerMessagesOmitted) return;
    const question = query.trim();
    followBottom.current = true;
    setQuery("");
    setTab("conversation");
    await onSend(question);
    textarea.current?.focus();
  }

  return (
    <aside className="chat-panel" aria-label="AI assistant">
      <div className="assistant-heading">
        <button className="chat-history-button" onClick={onHistory} aria-label="Back to chat history" title="Back to chat history">
          <ArrowLeft size={16} aria-hidden="true" /><span>History</span>
        </button>
        <BrandMark small />
        <div>
          <h1 title={title}>
            {title === "New conversation" ? "Knowledge assistant" : title}
          </h1>
          <span className="assistant-status">
            <span className={`status-dot ${connected ? "" : "offline"}`} />
            {connected
              ? "Private sources · evidence checked"
              : "Waiting for workspace connection"}
          </span>
        </div>
        <button
          className="icon-button"
          aria-label="New conversation"
          title="New conversation"
          onClick={onNew}
          disabled={pending}
        >
          <Plus size={18} />
        </button>
      </div>
      <div
        className="chat-tabs"
        onKeyDown={switchTab}
        role="tablist"
        aria-label="Assistant views"
      >
        <button
          role="tab"
          tabIndex={tab === "conversation" ? 0 : -1}
          id="conversation-tab"
          aria-controls="conversation-panel"
          aria-selected={tab === "conversation"}
          onClick={() => setTab("conversation")}
        >
          <MessageSquare size={14} /> Conversation
        </button>
        <button
          role="tab"
          tabIndex={tab === "evidence" ? 0 : -1}
          id="evidence-tab"
          aria-controls="evidence-panel"
          aria-selected={tab === "evidence"}
          onClick={() => setTab("evidence")}
        >
          <BookOpen size={14} /> Evidence
          {lastAnswer && <span>{lastAnswer.citations.length}</span>}
        </button>
      </div>
      <div
        className="chat-scroll"
        onScroll={(event) => {
          const area = event.currentTarget;
          followBottom.current =
            area.scrollHeight - area.scrollTop - area.clientHeight < 80;
        }}
        ref={scroll}
        role="tabpanel"
        id={`${tab}-panel`}
        aria-labelledby={`${tab}-tab`}
      >
        {tab === "evidence" ? (
          <div className="evidence-view">
            <span className="eyebrow">LATEST ANSWER</span>
            <h3>Follow the evidence.</h3>
            <p className="muted">
              [1], [2] and [3] label retrieved passages, not separate files.
              Several passages can come from one document. Open a passage to
              inspect its exact text.
            </p>
            {lastAnswer?.citations.length ? (
              lastAnswer.citations.map((citation) => (
                <button
                  className="evidence-card"
                  key={citation.index}
                  onClick={() =>
                    onCitation(citationWithAssessment(citation, lastAnswer))
                  }
                >
                  <span>
                    <FileText size={15} />
                    <strong>
                      [{citation.index}] {citation.source}
                    </strong>
                    <ArrowUpRight size={14} />
                  </span>
                  <p>{citation.excerpt}</p>
                  <small>
                    {citationChunkLabel(citation)} ·{" "}
                    {citation.version
                      ? `Version ${citation.version}`
                      : "Version unknown"}
                  </small>
                </button>
              ))
            ) : (
              <div className="small-empty">
                <BookOpen size={24} />
                <p>Sources will appear after an answer retrieves evidence.</p>
              </div>
            )}
          </div>
        ) : (
          <>
            {newerMessagesOmitted && <p className="scope-note">Showing an older window of up to 60 messages. Return to the latest messages before sending. <button className="text-button" disabled={loadingOlderMessages || pending} onClick={() => { followBottom.current = true; void onLoadLatest?.(); }}>Latest messages</button></p>}
            {hasOlderMessages && <button className="button secondary" disabled={loadingOlderMessages || pending} onClick={() => { followBottom.current = false; void onLoadOlder?.(); }}>{loadingOlderMessages ? "Loading older messages…" : "Load older messages"}</button>}
            {olderMessagesError && <p role="alert" className="inline-note">{olderMessagesError}</p>}
            {!messages.length && (
              <div className="chat-welcome">
                <div className="welcome-orbit">
                  <Sparkles size={27} strokeWidth={1.4} />
                  <span />
                </div>
                <span className="eyebrow">YOUR RESEARCH, GROUNDED</span>
                <h2>
                  What would you like
                  <br />
                  to understand?
                </h2>
                <p>
                  Ask a question, explore your sources, and see how an answer
                  holds up to the evidence.
                </p>
                <div className="suggestions">
                  {[
                    "Summarize the key ideas in my documents",
                    "What evidence supports the main claims?",
                    "Where do my sources disagree?",
                  ].map((suggestion, i) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setQuery(suggestion);
                        textarea.current?.focus();
                      }}
                    >
                      <span>
                        {i === 0 ? (
                          <FileText size={15} />
                        ) : i === 1 ? (
                          <ShieldCheck size={15} />
                        ) : (
                          <MessageSquare size={15} />
                        )}
                        {suggestion}
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
                <div className="welcome-foot">
                  <span className="tiny-dot" />{" "}
                  {documentCount
                    ? `${documentCount} ${documentCount === 1 ? "source" : "sources"} in your knowledge base`
                    : "Add a source to get started"}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <div
                className="message-pair"
                id={`message-${message.id}`}
                key={message.id}
              >
                <div className="user-message">{message.question}</div>
                <div className="message-meta user-meta">
                  You ·{" "}
                  {new Date(message.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                {message.result && (
                  <div className="assistant-message">
                    <div className="answer-author">
                      <BrandMark small />
                      <strong>Veriqon</strong>
                      <button
                        className="icon-button copy-answer"
                        aria-label={
                          copied === message.id
                            ? "Answer copied"
                            : "Copy answer"
                        }
                        onClick={() => void copyAnswer(message)}
                      >
                        {copied === message.id ? (
                          <Check size={14} />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                    <div className="answer-text">
                      {message.result.draft
                        .split(/(\[\d+\])/g)
                        .map((part, i) => {
                          const match = part.match(/^\[(\d+)\]$/);
                          const citation =
                            match &&
                            message.result!.citations.find(
                              (c) => c.index === Number(match[1]),
                            );
                          return citation ? (
                            <button
                              className="inline-citation"
                              key={i}
                              aria-label={`Open passage ${citation.index} from ${citation.source}`}
                              onClick={() =>
                                onCitation(
                                  citationWithAssessment(
                                    citation,
                                    message.result,
                                  ),
                                )
                              }
                            >
                              {part}
                            </button>
                          ) : (
                            part
                          );
                        })}
                    </div>
                    <div className="answer-verdict">
                      <VerificationBadge result={message.result} />
                    </div>
                    {message.result.verificationStatus === "VERIFICATION_FAILED" && (
                      <div className="answer-notices">
                        <p>{message.result.reason === "generation_failed" ? "The AI provider could not complete this answer. Retrieved passages are available for you to inspect; they have not been verified as an answer." : "Answer checking did not complete. This does not mean your source lacks the answer."}</p>
                        <button
                          type="button"
                          className="text-button"
                          disabled={pending || !connected}
                          onClick={() => {
                            setQuery(message.question);
                            textarea.current?.focus();
                          }}
                        >
                          Retry this question
                        </button>
                      </div>
                    )}
                    {message.result.citations.length > 0 && (
                      <>
                        <p className="citation-explanation">
                          {citationSummary(message.result.citations)}
                        </p>
                        <details className="evidence-disclosure" open={message.result.reason === "generation_failed" ? true : undefined}>
                          <summary>
                            Retrieved passages <ChevronDown size={13} />
                          </summary>
                          <div className="citation-list">
                            {message.result.citations.map((citation) => (
                              <button
                                key={citation.index}
                                aria-label={`[${citation.index}] ${citation.source}`}
                                title={`Passage ${citation.index}: ${citationChunkLabel(citation)}`}
                                onClick={() =>
                                  onCitation(
                                    citationWithAssessment(
                                      citation,
                                      message.result,
                                    ),
                                  )
                                }
                              >
                                <FileText size={12} />
                                <span>
                                  [{citation.index}] {citation.source}
                                  <small>{citationChunkLabel(citation)}</small>
                                </span>
                                <ArrowUpRight size={12} />
                              </button>
                            ))}
                          </div>
                        </details>
                      </>
                    )}
                    <div className="answer-notices">
                      {message.result.retrievalMode === "lexical_fallback" && <p className="muted">Keyword search was used because semantic search was unavailable. Some relevant passages may have been missed.</p>}
                      {message.result.sourcesChanged && (
                        <p className="source-change">
                          <HistoryNotice /> Your library changed since this
                          answer was generated. Ask again to check current
                          sources.
                        </p>
                      )}
                    </div>
                    <div className="answer-timing">
                      {message.result.answerOrigin ? "Read from your saved records / No AI calls" : message.result.cached
                        ? message.result.cache?.kind === "semantic"
                          ? "Reused for an equivalent question / Same source versions"
                          : "Saved answer / Same sources"
                        : `${(message.result.durationMs / 1000).toFixed(1)}s / ${message.result.attempts} ${message.result.attempts === 1 ? "attempt" : "attempts"}`}
                    </div>
                    {message.result.contextUsed && <p className="muted">Used recent questions to resolve source references. Previous answers are not source evidence.</p>}
                    {message.result.cached && message.result.cache?.kind === "semantic" && (
                      <p className="muted">Originally checked for: {message.result.cache.matchedQuestion}</p>
                    )}
                    <details className="verification-detail">
                      <summary>
                        Verification details <ChevronDown size={13} />
                      </summary>
                      <p>{message.result.factCheck.verdict}</p>
                      <p className="pre-wrap">
                        {message.result.factCheck.evidence}
                      </p>
                      <small>
                        {message.result.reason === "source_selection_required" ? "Source names were checked against your accessible library. No AI answer was generated." : message.result.answerOrigin ? "This response reports stored account records, not document-content verification." : "This is a model assessment, not an independent factual guarantee."}
                      </small>
                    </details>
                    <AnswerVersionHistory key={message.id} messageId={message.id} onCitation={onCitation} />
                    {(message.result.repairHistory?.length ||
                      message.result.correction) && (
                      <details className="verification-detail">
                        <summary>
                          View answer repair <ChevronDown size={13} />
                        </summary>
                        <RepairDetails
                          result={message.result}
                          onCitation={onCitation}
                        />
                      </details>
                    )}
                  </div>
                )}
                {message.error && (
                  <div className="chat-error" role="alert">
                    <AlertTriangle size={16} />
                    <div>
                      <strong>Couldn’t complete this answer</strong>
                      <p>{message.error}</p>
                      <button
                        className="text-button"
                        disabled={pending || !connected}
                        onClick={() => {
                          setQuery(message.question);
                          textarea.current?.focus();
                        }}
                      >
                        Edit and retry
                      </button>
                    </div>
                  </div>
                )}
                {!message.result && !message.error && (
                  <div className="thinking" role="status">
                    <LoaderCircle size={16} className="spin" /> Retrieving and
                    checking evidence{elapsed > 0 ? ` / ${elapsed}s` : "..."}
                    <small>
                      Answers appear after checking is complete; responses are
                      not streamed.
                    </small>
                    {elapsed >= 25 && (
                      <small>
                        Still working. Generation and verification can take
                        longer on busy providers.
                      </small>
                    )}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
      <div className="composer-area">
        <span className="sr-only" role="status">
          {copied
            ? "Answer copied to clipboard."
            : pending
              ? "Generating and verifying your answer."
              : messages.length
                ? "Response available."
                : "Ready for a question."}
        </span>
        {copyError && (
          <p className="copy-error" role="alert">
            {copyError}
          </p>
        )}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <textarea
            ref={textarea}
            aria-label="Ask your knowledge base"
            placeholder="Ask your knowledge base…"
            maxLength={4000}
            rows={1}
            value={query}
            disabled={pending}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="composer-bottom">
            <button
              className="send-button"
              type="submit"
              aria-label="Send question"
              disabled={!query.trim() || pending || !connected || newerMessagesOmitted}
            >
              {pending ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <ArrowUp size={18} />
              )}
            </button>
          </div>
        </form>
        <p className="composer-note">
          Name files to focus your search.
        </p>
      </div>
    </aside>
  );
}

function HistoryNotice() {
  return <AlertTriangle size={14} />;
}

function citationSummary(citations: Citation[]) {
  const count = new Set(citations.map((c) => c.documentId)).size;
  return `${citations.length} ${citations.length === 1 ? "passage" : "passages"} from ${count} ${count === 1 ? "document" : "documents"}. Numbers identify passages.`;
}
