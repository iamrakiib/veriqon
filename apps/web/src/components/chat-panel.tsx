'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, BookOpen, CheckCheck, ChevronDown, Copy, Check, FileText, LoaderCircle, MessageSquare, Plus, ShieldCheck, Sparkles, AlertTriangle } from 'lucide-react';
import { citationChunkLabel, type Citation, type QueryResult } from '../lib/api';
import { BrandMark } from './ui';

export type Message = { id: string; question: string; result?: QueryResult; error?: string; createdAt: string };
export type Conversation = { id: string; title: string; messages: Message[] };

export function ChatPanel({ title, messages, pending, connected, documentCount, onSend, onNew, onCitation }: { title: string; messages: Message[]; pending: boolean; connected: boolean; documentCount: number; onSend: (question: string) => Promise<void>; onNew: () => void; onCitation: (citation: Citation) => void }) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('conversation');
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const followBottom = useRef(true);
  useEffect(() => { if (!pending) { setElapsed(0); return; } const started = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(timer); }, [pending]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(''), 2500); return () => clearTimeout(timer); }, [copied]);
  async function copyAnswer(message: Message) {
    try { await navigator.clipboard.writeText(message.result!.draft); setCopied(message.id); setCopyError(''); }
    catch { setCopyError('Copy is unavailable. Select the answer text and copy it manually.'); }
  }
  function switchTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 'conversation' : event.key === 'End' ? 'evidence' : tab === 'conversation' ? 'evidence' : 'conversation';
    setTab(next); document.getElementById(`${next}-tab`)?.focus();
  }
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (messages.length && scroll.current && followBottom.current) scroll.current.scrollTo({ top: scroll.current.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }, [messages, pending, tab]);
  const lastAnswer = [...messages].reverse().find(message => message.result)?.result;
  async function submit() {
    if (!query.trim() || pending || !connected) return;
    const question = query.trim(); followBottom.current = true; setQuery(''); setTab('conversation');
    await onSend(question);
    textarea.current?.focus();
  }

  return <aside className="chat-panel" aria-label="AI assistant">
    <div className="assistant-heading"><BrandMark small /><div><h2 title={title}>{title === 'New conversation' ? 'Knowledge assistant' : title}</h2><span className="assistant-status"><span className={`status-dot ${connected ? '' : 'offline'}`} />{connected ? 'Connected to RAG' : 'API offline'}</span></div><button className="icon-button" aria-label="New conversation" title="New conversation" onClick={onNew} disabled={pending}><Plus size={18} /></button></div>
    <div className="chat-tabs" onKeyDown={switchTab} role="tablist" aria-label="Assistant views"><button role="tab" tabIndex={tab === 'conversation' ? 0 : -1} id="conversation-tab" aria-controls="conversation-panel" aria-selected={tab === 'conversation'} onClick={() => setTab('conversation')}><MessageSquare size={14} /> Conversation</button><button role="tab" tabIndex={tab === 'evidence' ? 0 : -1} id="evidence-tab" aria-controls="evidence-panel" aria-selected={tab === 'evidence'} onClick={() => setTab('evidence')}><BookOpen size={14} /> Evidence{lastAnswer && <span>{lastAnswer.citations.length}</span>}</button></div>
    <div className="chat-scroll" onScroll={event => { const area = event.currentTarget; followBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80; }} ref={scroll} role="tabpanel" id={`${tab}-panel`} aria-labelledby={`${tab}-tab`}>
      {tab === 'evidence' ? <div className="evidence-view"><span className="eyebrow">LATEST ANSWER</span><h3>Follow the evidence.</h3><p className="muted">Retrieved passages are context. Inspect the assessment to see which claims they support.</p>{lastAnswer?.citations.length ? lastAnswer.citations.map(citation => <button className="evidence-card" key={citation.index} onClick={() => onCitation(citation)}><span><FileText size={15} /><strong>[{citation.index}] {citation.source}</strong><ArrowUpRight size={14} /></span><p>{citation.excerpt}</p><small>{citationChunkLabel(citation)} · {citation.version ? `Version ${citation.version}` : 'Version unknown'}</small></button>) : <div className="small-empty"><BookOpen size={24} /><p>Sources will appear after an answer retrieves evidence.</p></div>}</div> : <>
        {!messages.length && <div className="chat-welcome"><div className="welcome-orbit"><Sparkles size={27} strokeWidth={1.4} /><span /></div><span className="eyebrow">LESS GUESSWORK. MORE GROUNDING.</span><h2>Your knowledge.<br />A clearer answer.</h2><p>Ask a question, explore your sources, and see how an answer holds up to the evidence.</p><div className="suggestions">{['Summarize the key ideas in my documents', 'What evidence supports the main claims?', 'Where do my sources disagree?'].map((suggestion, i) => <button key={suggestion} onClick={() => { setQuery(suggestion); textarea.current?.focus(); }}><span>{i === 0 ? <FileText size={15} /> : i === 1 ? <ShieldCheck size={15} /> : <MessageSquare size={15} />}{suggestion}</span><ArrowUpRight size={14} /></button>)}</div><div className="welcome-foot"><span className="tiny-dot" /> {documentCount ? `${documentCount} sources in your knowledge base` : 'Add a source to get started'}</div></div>}
        {messages.map(message => <div className="message-pair" key={message.id}><div className="user-message">{message.question}</div><div className="message-meta user-meta">You · {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          {message.result && <div className="assistant-message"><div className="answer-author"><BrandMark small /><strong>Veriqon</strong><button className="icon-button copy-answer" aria-label={copied === message.id ? 'Answer copied' : 'Copy answer'} onClick={() => void copyAnswer(message)}>{copied === message.id ? <Check size={14} /> : <Copy size={14} />}</button></div><div className="answer-text">{message.result.draft}</div><div className={`answer-verdict ${message.result.status === 'abstained' ? 'warning' : ''}`}>{message.result.status === 'abstained' ? <AlertTriangle size={14} /> : <CheckCheck size={14} />}{message.result.status === 'abstained' ? message.result.reason === 'no_documents' ? 'Upload a source first' : message.result.reason === 'verification_failed' ? 'Could not verify answer' : 'Not enough retrieved evidence' : message.result.status === 'repaired' ? 'Repaired & model checked' : 'Model checked'}</div>
            {message.result.citations.length > 0 && <div className="citation-list">{message.result.citations.map(citation => <button key={citation.index} onClick={() => onCitation(citation)}><FileText size={12} /><span>[{citation.index}] {citation.source}</span><ArrowUpRight size={12} /></button>)}</div>}
            <div className="answer-notices">{message.result.sourcesChanged && <p className="source-change"><HistoryNotice /> Your library changed since this answer was generated. Ask again to check current sources.</p>}</div><div className="answer-timing">{message.result.cached ? 'Saved answer / Same sources' : `${(message.result.durationMs / 1000).toFixed(1)}s / ${message.result.attempts} ${message.result.attempts === 1 ? 'attempt' : 'attempts'}`}</div><details className="verification-detail"><summary>Verification details <ChevronDown size={13} /></summary><p>{message.result.factCheck.verdict}</p><p className="pre-wrap">{message.result.factCheck.evidence}</p><small>This is a model assessment, not an independent factual guarantee.</small></details>
            {message.result.correction && <details className="verification-detail"><summary>View answer repair <ChevronDown size={13} /></summary><p>{message.result.correction.reason}</p><strong>Original draft</strong><p>{message.result.correction.original}</p></details>}
          </div>}
          {message.error && <div className="chat-error" role="alert"><AlertTriangle size={16} /><div><strong>Couldn’t complete this answer</strong><p>{message.error}</p><button className="text-button" disabled={pending || !connected} onClick={() => { setQuery(message.question); textarea.current?.focus(); }}>Edit and retry</button></div></div>}
          {!message.result && !message.error && <div className="thinking" role="status"><LoaderCircle size={16} className="spin" /> Retrieving and checking evidence{elapsed > 0 ? ` / ${elapsed}s` : '...'}{elapsed >= 25 && <small>Still working. Generation and verification can take longer on busy providers.</small>}</div>}
        </div>)}
      </>}
    </div>
    <div className="composer-area"><span className="sr-only" role="status">{copied ? 'Answer copied to clipboard.' : pending ? 'Generating and verifying your answer.' : messages.length ? 'Response available.' : 'Ready for a question.'}</span>{copyError && <p className="copy-error" role="alert">{copyError}</p>}<div className="context-line"><span><BookOpen size={12} /> All workspace documents</span><span>Saved to your account</span></div><form className="composer" onSubmit={event => { event.preventDefault(); void submit(); }}><textarea ref={textarea} aria-label="Ask your knowledge base" placeholder="Ask your knowledge base…" maxLength={4000} rows={2} value={query} disabled={pending} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} /><div className="composer-bottom"><span><Sparkles size={12} /> Evidence-first answers</span><button className="send-button" type="submit" aria-label="Send question" disabled={!query.trim() || pending || !connected}>{pending ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={18} />}</button></div></form><p className="composer-note">Each question searches your sources independently.</p></div>
  </aside>;
}

function HistoryNotice() { return <AlertTriangle size={14} />; }
