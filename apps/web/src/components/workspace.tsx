'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Database, FileText, GitCompareArrows, History, LoaderCircle, Menu, MessageSquare, Plus, RefreshCw, Search, Trash2, LogOut, Settings2, ShieldCheck, X, AlertTriangle } from 'lucide-react';
import { api, citationChunkLabel, type Citation, type DocumentRecord, type Health, type QueryResult } from '../lib/api';
import type { Account } from '../lib/session';
import { BrandMark, EmptyState, Modal } from './ui';
import { ThemeSettings, ThemeToggle } from './theme-provider';
import { DocumentLibrary } from './document-library';
import { ChatPanel, type Conversation } from './chat-panel';

type View = 'knowledge' | 'chat' | 'conflicts' | 'corrections' | 'analytics';
const navigation = [
  { id: 'knowledge' as const, title: 'Knowledge base', icon: BookOpen },
  { id: 'chat' as const, title: 'Chat workspace', icon: MessageSquare },
  { id: 'conflicts' as const, title: 'Conflict center', icon: GitCompareArrows },
  { id: 'corrections' as const, title: 'Answer repairs', icon: History },
  { id: 'analytics' as const, title: 'Reliability', icon: Activity }
];
const freshConversation = (): Conversation => ({ id: crypto.randomUUID(), title: 'New conversation', messages: [] });

export function Workspace({ account, onLogout }: { account: Account; onLogout: () => Promise<void> }) {
  const [view, setView] = useState<View>('knowledge');
  const [mobilePane, setMobilePane] = useState<'workspace' | 'assistant'>('workspace');
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [preview, setPreview] = useState<{ title: string; text: string; metadata: string; documentId?: string; hasOriginal?: boolean } | null>(null);
  const requestLock = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const active = conversations.find(c => c.id === activeId);
  const answers = conversations.flatMap(c => c.messages).filter(m => m.result);
  const visibleConversations = conversations.filter(c => c.messages.length > 0 && c.title.toLowerCase().includes(historySearch.toLowerCase()));
  const attemptedRepairs = answers.filter(m => m.result?.attempts === 2);
  const repairs = answers.filter(m => m.result?.correction);
  const connected = Boolean(health);
  const chunkCount = documents.reduce((sum, doc) => sum + doc.chunkCount, 0);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [docs, status] = await Promise.all([api.documents(), api.health()]);
      setDocuments(docs); setHealth(status); setError('');
    } catch (error) {
      setHealth(null); setError(error instanceof Error ? error.message : 'Could not refresh the workspace.');
    } finally { setLoading(false); }
  }, []);
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true); setHistoryError('');
    try {
      const saved = await api.conversations();
      const items = saved.length ? saved : [freshConversation()];
      setConversations(items); setActiveId(current => items.some(c => c.id === current) ? current : items[0].id);
    } catch { setHistoryError('Chat history could not be loaded. Retry to reopen your conversations.'); }
    finally { setHistoryLoading(false); }
  }, []);
  useEffect(() => { void refresh(); void loadHistory(); }, [refresh, loadHistory]);
  useEffect(() => {
    const reconnect = () => { void refresh(true); };
    const timer = setInterval(reconnect, 30000);
    window.addEventListener('online', reconnect);
    return () => { clearInterval(timer); window.removeEventListener('online', reconnect); };
  }, [refresh]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 7000); return () => clearTimeout(timer); }, [notice]);

  useEffect(() => {
    if (!menuOpen) return;
    const first = sidebarRef.current?.querySelector<HTMLButtonElement>('.mobile-nav-close');
    first?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input') || []).filter(element => element.offsetParent !== null);
      const firstControl = controls[0], lastControl = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === firstControl) { event.preventDefault(); lastControl?.focus(); }
      else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); firstControl?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus(); };
  }, [menuOpen]);

  function navigate(next: View) { setView(next); setMobilePane(next === 'chat' ? 'assistant' : 'workspace'); setMenuOpen(false); }
  function newConversation() {
    setHistorySearch('');
    if (requestLock.current || historyLoading || historyError) return;
    const conversation = freshConversation(); setConversations(items => [conversation, ...items]); setActiveId(conversation.id); navigate('chat');
  }
  async function send(question: string) {
    if (requestLock.current || historyLoading || historyError) return;
    requestLock.current = true; setPending(true);
    const conversationId = activeId;
    const message = { id: crypto.randomUUID(), question, createdAt: new Date().toISOString() };
    setConversations(items => items.map(c => c.id === conversationId ? { ...c, title: c.messages.length ? c.title : question.slice(0, 42), messages: [...c.messages, message] } : c));
    const complete = (update: { result?: QueryResult; error?: string }) => setConversations(items => items.map(c => c.id === conversationId ? { ...c, messages: c.messages.map(m => m.id === message.id ? { ...m, ...update } : m) } : c));
    try { complete({ result: await api.query(question, conversationId, message.id) }); }
    catch (error) { complete({ error: error instanceof Error ? error.message : 'Request failed.' }); }
    finally { requestLock.current = false; setPending(false); }
  }
  async function signOut() {
    if (busy) return; setBusy('logout');
    try { await onLogout(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not sign out. Try again.'); }
    finally { setBusy(''); }
  }
  async function downloadOriginal() {
    if (!preview?.documentId || busy) return; setBusy('download');
    try { await api.download(preview.documentId, preview.title); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Download failed.'); }
    finally { setBusy(''); }
  }
  async function removeDocument() {
    if (!preview?.documentId || busy) return; setBusy('delete');
    try {
      await api.removeDocument(preview.documentId); setPreview(null); setConfirmDelete(false);
      await refresh(); await loadHistory(); setNotice('Document removed from retrieval. Earlier chat citations remain as historical records.');
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : 'Could not delete the document.'); }
    finally { setBusy(''); }
  }
  function inspectDocument(doc: DocumentRecord) { setConfirmDelete(false); setPreview({ title: doc.source || doc.id, text: doc.text, documentId: doc.id, hasOriginal: doc.hasOriginal, metadata: `${doc.chunkCount} chunks · ${doc.version ? `Version ${doc.version}` : 'Version not specified'} · Effective date unknown` }); }
  function inspectCitation(citation: Citation) { setPreview({ title: citation.source, text: citation.excerpt, metadata: `Retrieved evidence [${citation.index}] · ${citationChunkLabel(citation)}${citation.page ? ` · Page ${citation.page}` : ''} · ${citation.version ? `Version ${citation.version}` : 'Version unknown'}` }); }

  return <div className="app-background"><a className="skip-link" href="#main">Skip to workspace</a><div className="app-shell">
    {menuOpen && <button className="mobile-backdrop" tabIndex={-1} aria-label="Dismiss navigation overlay" onClick={() => setMenuOpen(false)} />}
    <aside ref={sidebarRef} role={menuOpen ? 'dialog' : undefined} aria-modal={menuOpen || undefined} className={`sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Workspace navigation"><button className="icon-button mobile-nav-close" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X size={19} /></button><div className="window-dots" aria-hidden="true"><span /><span /><span /></div><a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('knowledge'); }}><BrandMark /><span>Veriqon</span></a>
      <button className="workspace-switch" onClick={() => setSettings(true)}><span className="workspace-avatar">VQ</span><span><strong>My workspace</strong><small>Private knowledge library</small></span><ChevronDown size={14} /></button>
      <div className="nav-group"><span className="nav-label">WORKSPACE</span><nav>{navigation.map(item => <button key={item.id} data-view={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={17} strokeWidth={1.6} /><span>{item.title}</span>{item.id === 'conflicts' && <small className="planned-label">Planned</small>}{item.id === 'knowledge' && <span className="nav-count">{documents.length}</span>}{item.id === 'corrections' && attemptedRepairs.length > 0 && <span className="nav-count">{attemptedRepairs.length}</span>}</button>)}</nav></div>
      <div className="nav-group conversations"><div className="nav-label-row"><span className="nav-label">CHAT HISTORY</span><button className="icon-button" aria-label="Refresh chat history" disabled={pending || historyLoading} onClick={() => void loadHistory()}><RefreshCw size={13} className={historyLoading ? 'spin' : ''} /></button><button className="icon-button" aria-label="Create conversation" onClick={newConversation} disabled={pending || historyLoading || Boolean(historyError)}><Plus size={14} /></button></div><label className="history-search"><Search size={13} /><input aria-label="Search chat history" placeholder="Find a conversation" value={historySearch} onChange={event => setHistorySearch(event.target.value)} />{historySearch && <button className="icon-button" aria-label="Clear chat search" onClick={() => setHistorySearch('')}><X size={12} /></button>}</label>{historyLoading ? <p className="nav-empty">Loading saved chats...</p> : historyError ? <div className="nav-empty" role="alert">{historyError}<button className="text-button" onClick={() => void loadHistory()}>Retry chat history</button></div> : visibleConversations.length ? visibleConversations.map(c => <button className={`conversation-link ${c.id === activeId && view === 'chat' ? 'selected' : ''}`} key={c.id} onClick={() => { setActiveId(c.id); navigate('chat'); }}><MessageSquare size={14} /><span>{c.title}</span></button>) : <p className="nav-empty">{historySearch ? 'No matching recent conversations.' : <>Your saved conversations<br />will appear here.</>}</p>}<button className="new-conversation" onClick={newConversation} disabled={pending || historyLoading || Boolean(historyError)}><Plus size={14} /> New conversation</button></div>
      <div className="sidebar-bottom"><div className="foundation-card"><span><ShieldCheck size={16} /> Built on evidence</span><p>Retrieve. Verify. Repair.<br />Keep the sources in sight.</p><button onClick={() => setHelp(true)}>How it works <ArrowUpRight size={13} /></button></div><button className="nav-item" onClick={() => setSettings(true)}><Settings2 size={17} /> Workspace settings</button><div className="profile"><div className="profile-avatar">{account.name.slice(0, 2).toUpperCase()}</div><div className="profile-details"><strong title={account.name}>{account.name}</strong><small>{account.role === 'owner' ? 'Workspace owner' : 'Personal account'}</small></div><button className="icon-button" aria-label="Sign out" title="Sign out" disabled={Boolean(busy)} onClick={() => void signOut()}><LogOut size={16} /></button></div></div>
    </aside>
    <div className="workspace-main" inert={menuOpen}><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><span className="breadcrumb-root">Workspace</span><ChevronRight size={13} /><strong>{navigation.find(n => n.id === view)?.title}</strong></div><div className="topbar-actions"><ThemeToggle /><span className={`connection-badge ${connected ? '' : 'disconnected'}`}><span className="status-dot" />{loading ? 'Connecting' : connected ? 'Connected' : 'Connection lost'}</span><button className="icon-button" aria-label="Refresh workspace" title="Refresh workspace" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button><span className="topbar-divider" /><button className="icon-button" aria-label="Help" onClick={() => setHelp(true)}><CircleHelp size={18} /></button></div></header>
      {health && !health.providerConfigured && <div className="connection-error" role="alert"><AlertTriangle size={16} /><span>AI is not configured for this workspace. Contact the owner to enable document indexing and answers.</span></div>}
      {error && <div className="connection-error" role="alert"><AlertTriangle size={16} /><span>{error}</span><button onClick={() => void refresh()}>Retry</button></div>}
      <div className="mobile-pane-switch" role="group" aria-label="Workspace panels"><button aria-label="Show workspace" aria-pressed={mobilePane === 'workspace'} onClick={() => setMobilePane('workspace')}><BookOpen size={15} /> Workspace</button><button aria-label="Show assistant" aria-pressed={mobilePane === 'assistant'} onClick={() => setMobilePane('assistant')}><MessageSquare size={15} /> Assistant</button></div>
      <div className={`workspace-columns ${view === 'chat' ? 'chat-focused' : ''}`} data-mobile-pane={mobilePane}><main id="main" className="main-content">
        {view === 'knowledge' && <DocumentLibrary documents={documents} loading={loading} connected={connected} onRefresh={refresh} onPreview={inspectDocument} />}
        {view === 'chat' && <><div className="section-heading"><div><span className="eyebrow">A CONVERSATION WITH CONTEXT</span><h1>Ask. Inspect.<br />Understand<span className="title-dot">.</span></h1><p>Your sources, with a second look at every answer.</p></div></div><div className="context-card"><div className="card-title"><Database size={19} /><h2>Connected knowledge</h2><span className="count">{documents.length}</span></div><p>Each question searches your private indexed documents.</p>{documents.slice(0, 5).map(doc => <button className="context-document" key={doc.id} onClick={() => inspectDocument(doc)}><FileText size={16} /><span>{doc.source || doc.id}</span><ArrowUpRight size={14} /></button>)}{!documents.length && <button className="button secondary" onClick={() => navigate('knowledge')}><Plus size={15} /> Add your first source</button>}</div><div className="workflow"><span className="eyebrow">BEHIND EVERY ANSWER</span>{[{ n: '01', title: 'Find relevant evidence', text: 'Retrieve document chunks with semantic search.' }, { n: '02', title: 'Check each statement', text: 'Assess whether the retrieved evidence supports the draft.' }, { n: '03', title: 'Repair or abstain', text: 'Retry unsupported answers once, then withhold answers that still fail.' }].map(step => <div key={step.n}><span>{step.n}</span><section><h3>{step.title}</h3><p>{step.text}</p></section></div>)}</div><p className="session-disclosure">Your conversations are saved to your account. Reopen them from Chat history; the latest 100 conversations are shown. Each question is independent; previous messages are not sent as context.</p></>}
        {view === 'conflicts' && <><PageHeading eyebrow="MAKE DISAGREEMENT VISIBLE" title="Conflict center" description="A dedicated place for evidence that needs a closer look." /><div className="feature-status"><span className="badge amber">Not connected</span><h2>Conflicting evidence deserves context.</h2><p>Automated conflict records are not available in the current API. No conflict scan has been performed.</p><div className="comparison-preview"><div><FileText size={21} /><strong>Source A</strong><span>Claim · scope · effective dates</span></div><GitCompareArrows size={22} /><div><FileText size={21} /><strong>Source B</strong><span>Claim · scope · effective dates</span></div></div><p className="muted">The next backend phase needs immutable document versions, authority metadata, and scope-aware comparison before this view can support reliable resolutions.</p><button className="button secondary" onClick={() => navigate('knowledge')}>Inspect source documents <ArrowUpRight size={15} /></button></div></>}
        {view === 'corrections' && <><PageHeading eyebrow="TRANSPARENT BY DESIGN" title="Answer repairs" description="See saved repairs from your recent conversations." /><div className="inline-note"><History size={16} /> Immediate repairs only. Repairs are saved with conversations. Continuous revalidation is not implemented.</div>{attemptedRepairs.length ? attemptedRepairs.map(message => message.result?.correction ? <article className="repair-card" key={message.id}><div className="repair-heading"><span className="badge green"><Check size={12} /> Repaired</span><time>{new Date(message.createdAt).toLocaleString()}</time></div><h2>{message.question}</h2><label>ORIGINAL DRAFT</label><p className="original-draft">{message.result!.correction!.original}</p><label>REVISED ANSWER</label><p>{message.result!.correction!.revised}</p><div className="repair-reason"><ShieldCheck size={16} /><p>{message.result!.correction!.reason}</p></div></article> : <article className="repair-card" key={message.id}><div className="repair-heading"><span className="badge amber">Repair withheld</span><time>{new Date(message.createdAt).toLocaleString()}</time></div><h2>{message.question}</h2><p>The revised answer did not pass verification. No unsupported answer was accepted.</p><details className="verification-detail"><summary>Why verification failed</summary><p className="pre-wrap">{message.result?.factCheck.evidence}</p></details></article>) : <EmptyState icon={<History size={30} strokeWidth={1.4} />} title="Every repair leaves a trace" description="Repair attempts appear here after an answer fails its first assessment. You can see successful revisions and attempts that were withheld." />}</>}
        {view === 'analytics' && <><PageHeading eyebrow="OBSERVE, THEN IMPROVE" title="Reliability overview" description="Workspace counts and results from the loaded chat history." /><div className="metrics-grid"><Metric icon={<FileText size={18} />} title="Indexed documents" value={connected ? documents.length : '—'} caption="Current API store" /><Metric icon={<Database size={18} />} title="Searchable chunks" value={connected ? chunkCount : '—'} caption="Current API store" /><Metric icon={<MessageSquare size={18} />} title="Completed answers" value={answers.length} caption="Loaded chat history" /><Metric icon={<History size={18} />} title="Repaired answers" value={repairs.length} caption="Passed after one repair" /></div><div className="reliability-card"><h2>Answer outcomes <span className="badge neutral">Saved chat data</span></h2>{[{ label: 'Supported on first pass', count: answers.filter(m => m.result?.status === 'supported').length, color: 'green' }, { label: 'Repaired and checked', count: repairs.length, color: 'teal' }, { label: 'Abstained', count: answers.filter(m => m.result?.status === 'abstained').length, color: 'amber' }].map(row => <div className="outcome" key={row.label}><div><span className={`legend-dot ${row.color}`} />{row.label}<strong>{row.count}</strong></div><div className="bar-track"><span className={row.color} style={{ width: `${answers.length ? row.count / answers.length * 100 : 0}%` }} /></div></div>)}<p className="muted">Model assessments are not measured factual accuracy. Independent evaluation is still required.</p></div><div className="reliability-card"><h2>Measurement coverage</h2><dl className="coverage"><div><dt>Average answer latency</dt><dd>{answers.length ? `${(answers.reduce((sum, m) => sum + (m.result?.durationMs || 0), 0) / answers.length / 1000).toFixed(1)} s` : 'No observations'}</dd></div><div><dt>API cost & token usage</dt><dd>Not instrumented</dd></div><div><dt>Temporal accuracy & STER benchmarks</dt><dd>Not evaluated</dd></div><div><dt>Background revalidation</dt><dd>Not implemented</dd></div></dl></div></>}
        <footer className="content-footer"><span><ShieldCheck size={13} /> Veriqon RAG</span><span>Evidence over assumptions</span></footer>
      </main><ChatPanel key={activeId} title={active?.title || 'New conversation'} messages={active?.messages || []} pending={pending} connected={connected && Boolean(activeId) && !historyLoading && !historyError} documentCount={documents.length} onSend={send} onNew={newConversation} onCitation={inspectCitation} /></div>
    </div>
  </div><div className="outside-caption"><span>VERIQON</span><span>A little more context. A lot more clarity.</span><span>RESEARCH WORKSPACE / 01</span></div>
    {notice && <div className="toast" role="status"><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={15} /></button></div>}
    <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.title || 'Source preview'} description={preview?.metadata || 'Source details'}><div className="document-preview">{preview?.text}</div>{preview?.hasOriginal && <div className="preview-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={() => void downloadOriginal()}>{busy === 'download' ? <LoaderCircle className="spin" size={15} /> : <ArrowDownToLine size={15} />} Download original</button></div>}{preview?.documentId && <div className="delete-document">{confirmDelete ? <><p>Remove this document and its original file from your library? Saved answers keep their cited passages, but future questions will not use this document.</p><div><button className="button secondary" onClick={() => setConfirmDelete(false)} disabled={Boolean(busy)}>Keep document</button><button className="button danger" disabled={Boolean(busy) || pending} onClick={() => void removeDocument()}>{busy === 'delete' ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />} Confirm delete</button></div></> : <button className="text-button" disabled={Boolean(busy) || pending} onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete document</button>}</div>}</Modal>
    <Modal open={settings} onClose={() => setSettings(false)} title="Workspace settings" description="Appearance, account, and storage for your workspace."><ThemeSettings /><div className="account-summary"><div className="profile-avatar">{account.name.slice(0, 2).toUpperCase()}</div><div><strong>{account.name}</strong><span>{account.email}</span></div><span className="badge neutral">{account.role}</span></div><dl className="settings-list"><div><dt>API connection</dt><dd>{connected ? 'Connected' : 'Offline'}</dd></div><div><dt>Document storage</dt><dd>{health?.storage === 'postgresql' ? 'PostgreSQL' : health?.storage === 'sqlite' ? 'SQLite (local)' : 'Unavailable'} / Saved automatically</dd></div><div><dt>Access control</dt><dd>Private library / JWT sessions</dd></div><div><dt>Original uploads</dt><dd>Stored with your documents</dd></div><div><dt>Historical date filtering</dt><dd>Not available yet</dd></div></dl><p className="muted">Your indexed documents survive restarts. Chat history and answer repairs are saved to your account and remain after reload or sign-out. Older imported documents retain their extracted text; re-upload to save the original file.</p><div className="settings-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={() => void signOut()}>{busy === 'logout' ? <LoaderCircle className="spin" size={15} /> : <LogOut size={15} />} Sign out of this session</button></div></Modal>
    <Modal open={help} onClose={() => setHelp(false)} title="A workspace built around evidence" description="From your documents to answers you can inspect."><ol className="help-steps"><li><strong>Add knowledge.</strong> Upload PDF, DOCX, or UTF-8 TXT/Markdown documents. Your documents are indexed so the assistant can find relevant passages.</li><li><strong>Ask a question.</strong> The model retrieves relevant chunks, drafts an answer, and checks each statement against those passages.</li><li><strong>Inspect the result.</strong> Open source citations, review the model assessment, and compare any repaired answer.</li><li><strong>Keep your knowledge.</strong> Your files and indexed text are saved to your private library automatically.</li></ol><div className="inline-note"><ShieldCheck size={18} /> Answers reflect the sources available when you ask. They are not automatically updated when your documents change.</div></Modal>
  </div>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}<span className="title-dot">.</span></h1><p>{description}</p></div></div>; }
function Metric({ icon, title, value, caption }: { icon: React.ReactNode; title: string; value: string | number; caption: string }) { return <div className="metric"><span>{icon}{title}</span><strong>{value}</strong><small>{caption}</small></div>; }
