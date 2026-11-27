"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  ChevronRight,
  CircleHelp,
  GitCompareArrows,
  History,
  Menu,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  X,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  api,
  citationChunkLabel,
  type Citation,
  type DocumentRecord,
  type Health,
  type QueryResult,
} from "../lib/api";
import type { Account } from "../lib/session";
import { WorkspaceSidebar, type WorkspaceView } from "./workspace-sidebar";
import { AnswerVersionHistory } from "./knowledge-controls";
import { WorkspaceDialogs, type SourcePreview } from "./workspace-dialogs";
import { ThemeToggle } from "./theme-provider";
import { ConflictCenter } from "./conflict-center";
import { DocumentLibrary } from "./document-library";
import { ChatPanel, matchesConversation, type Conversation, type Message } from "./chat-panel";
import { Modal } from "./ui";
import { RepairDetails, VerificationBadge } from "./answer-details";
import {
  Analytics,
  Corrections,
  ConversationHistory,
  PageHeading,
} from "./research-views";

type View = WorkspaceView;
const navigation = [
  { id: "knowledge" as const, title: "Knowledge base", icon: BookOpen },
  { id: "chat" as const, title: "Chat workspace", icon: MessageSquare },
  { id: "history" as const, title: "Chat history", icon: History },
  {
    id: "conflicts" as const,
    title: "Conflict center",
    icon: GitCompareArrows,
  },
  { id: "corrections" as const, title: "Corrections", icon: History },
  { id: "analytics" as const, title: "Analytics", icon: Activity },
];
const freshConversation = (): Conversation => ({
  id: crypto.randomUUID(),
  title: "New conversation",
  messages: [],
});
const CONVERSATION_WINDOW = 40;
const MESSAGE_WINDOW = 60;
function protectedHistory(items: Conversation[], drafts: Record<string, string>, activeId = "") {
  return new Set(items.filter(c => c.id === activeId || drafts[c.id] || c.messages.some(m => !m.result && !m.error) || (!c.cursor && c.messages.some(m => m.error))).map(c => c.id));
}
function retainHistory(items: Conversation[], protectedIds: Set<string>, older = false) {
  const unique = [...new Map(items.map(c => [c.id, c])).values()];
  const pinned = unique.filter(c => protectedIds.has(c.id));
  const rest = unique.filter(c => !protectedIds.has(c.id));
  const room = Math.max(0, CONVERSATION_WINDOW - pinned.length);
  const keep = new Set([...pinned, ...(room === 0 ? [] : older ? rest.slice(-room) : rest.slice(0, room))].map(c => c.id));
  return unique.filter(c => keep.has(c.id));
}

export function Workspace({
  account,
  onLogout,
}: {
  account: Account;
  onLogout: () => Promise<void>;
}) {
  const [view, setView] = useState<View>("knowledge");
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("veriqon-sidebar") === "collapsed");
    } catch {}
  }, []);
  function toggleSidebar() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(
          "veriqon-sidebar",
          !value ? "collapsed" : "expanded",
        );
      } catch {}
      return !value;
    });
  }
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyCursor, setHistoryCursor] = useState<string | undefined>();
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [moreHistoryError, setMoreHistoryError] = useState("");
  const [loadingOlder, setLoadingOlder] = useState("");
  const [olderError, setOlderError] = useState<{ id: string; message: string } | null>(null);
  const paginationLock = useRef(false);
  const [historySearch, setHistorySearch] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [chatToDelete, setChatToDelete] = useState<Conversation | null>(null);
  const [chatDeleteError, setChatDeleteError] = useState("");
  const [activeId, setActiveId] = useState("");
  const [focusedMessage, setFocusedMessage] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [historyWindowed, setHistoryWindowed] = useState(false);
  const historyState = useRef({ conversations, drafts, activeId });
  historyState.current = { conversations, drafts, activeId };
  const refreshController = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const restoreView = () => {
      const route = window.location.hash.slice(1);
      const next = navigation.find(item => item.id === route)?.id;
      // The accessibility skip link moves focus without switching pages.
      if (route !== "main") {
        setView(next || "knowledge");
        setFocusedMessage("");
        setMenuOpen(false);
      }
    };
    restoreView();
    window.addEventListener("popstate", restoreView);
    window.addEventListener("hashchange", restoreView);
    return () => {
      window.removeEventListener("popstate", restoreView);
      window.removeEventListener("hashchange", restoreView);
    };
  }, []);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [savedAnswer, setSavedAnswer] = useState<{ title: string; message: Message } | null>(null);
  const requestLock = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const active = conversations.find((c) => c.id === activeId);
  const visibleConversations = conversations.filter(
    (c) =>
      c.messages.length > 0 &&
      matchesConversation(c, historySearch),
  );
  const connected = Boolean(health);

  const refresh = useCallback(async (quiet = false) => {
    if (quiet && refreshController.current) return;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    if (!quiet) setLoading(true);
    try {
      const [docs, status] = await Promise.all([api.documents(controller.signal), api.health(controller.signal)]);
      if (controller.signal.aborted) return;
      setDocuments(docs);
      setHealth(status);
      setError("");
    } catch (error) {
      if (controller.signal.aborted) return;
      setHealth(null);
      setError(
        error instanceof Error
          ? error.message
          : "Could not refresh the workspace.",
      );
    } finally {
      if (refreshController.current === controller) refreshController.current = null;
      if (!controller.signal.aborted) setLoading(false);
      controller.abort();
    }
  }, []);
  const loadHistory = useCallback(async () => {
    if (paginationLock.current || requestLock.current) return;
    paginationLock.current = true;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const saved = await api.conversations();
      setHistoryCursor(saved[0]?.hasMoreConversations ? saved[saved.length - 1]?.cursor : undefined);
      setMoreHistoryError("");
      const current = historyState.current;
      const protectedIds = protectedHistory(current.conversations, current.drafts);
      // Preserve unsent drafts and local failures; saved server rows supply the current paging cursor.
      const pinned = current.conversations.filter(c => protectedIds.has(c.id)).map(c => ({ ...c, cursor: saved.find(row => row.id === c.id)?.cursor || c.cursor }));
      const items = retainHistory([...saved.filter(c => !protectedIds.has(c.id)), ...pinned], protectedIds);
      if (!items.length) items.push(freshConversation());
      setConversations(items);
      setHistoryWindowed(false);
      setActiveId((current) =>
        items.some((c) => c.id === current) ? current : items[0].id,
      );
    } catch {
      setHistoryError(
        "Chat history could not be loaded. Retry to reopen your conversations.",
      );
    } finally {
      paginationLock.current = false;
      setHistoryLoading(false);
    }
  }, []);
  async function loadMoreHistory() {
    if (!historyCursor || paginationLock.current) return;
    paginationLock.current = true; setLoadingMoreHistory(true); setMoreHistoryError("");
    try {
      const pinned = protectedHistory(conversations, drafts, activeId);
      if (pinned.size >= CONVERSATION_WINDOW) throw new Error("Finish or clear an unsent draft before opening another history window.");
      const saved = await api.conversations(historyCursor);
      setConversations(items => retainHistory([...items, ...saved.filter(c => !items.some(existing => existing.id === c.id))], protectedHistory(items, historyState.current.drafts, historyState.current.activeId), true));
      if (conversations.length + saved.length > CONVERSATION_WINDOW) setHistoryWindowed(true);
      setHistoryCursor(saved[0]?.hasMoreConversations ? saved[saved.length - 1]?.cursor : undefined);
    } catch (error) { setMoreHistoryError(error instanceof Error ? error.message : "Older conversations could not be loaded. Please retry."); }
    finally { paginationLock.current = false; setLoadingMoreHistory(false); }
  }
  async function loadOlderMessages() {
    if (!active?.olderMessagesCursor || paginationLock.current || requestLock.current) return;
    const id = active.id;
    paginationLock.current = true; setLoadingOlder(id); setOlderError(null);
    try {
      const page = await api.olderMessages(id, active.olderMessagesCursor);
      setConversations(items => items.map(c => {
        if (c.id !== id) return c;
        const messages = [...page.messages.filter(m => !c.messages.some(existing => existing.id === m.id)), ...c.messages];
        return { ...c, olderMessagesCursor: page.olderMessagesCursor, messages: messages.slice(0, MESSAGE_WINDOW), newerMessagesOmitted: c.newerMessagesOmitted || messages.length > MESSAGE_WINDOW };
      }));
    } catch { setOlderError({ id, message: "Older messages could not be loaded. Please retry." }); }
    finally { paginationLock.current = false; setLoadingOlder(""); }
  }
  async function loadLatestMessages() {
    if (!active || paginationLock.current || requestLock.current) return;
    const id = active.id;
    paginationLock.current = true; setLoadingOlder(id); setOlderError(null);
    try {
      const page = await api.olderMessages(id);
      setConversations(items => items.map(c => c.id === id ? { ...c, ...page, newerMessagesOmitted: false } : c));
    } catch { setOlderError({ id, message: "Latest messages could not be loaded. Please retry; your draft is unchanged." }); }
    finally { paginationLock.current = false; setLoadingOlder(""); }
  }
  useEffect(() => {
    void refresh();
    void loadHistory();
    return () => { refreshController.current?.abort(); };
  }, [refresh, loadHistory]);
  useEffect(() => {
    const reconnect = () => {
      if (!document.hidden) void refresh(true);
    };
    const timer = setInterval(reconnect, 30000);
    window.addEventListener("online", reconnect);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", reconnect);
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!menuOpen) return;
    const first =
      sidebarRef.current?.querySelector<HTMLButtonElement>(".mobile-nav-close");
    first?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input",
        ) || [],
      ).filter((element) => element.offsetParent !== null);
      const firstControl = controls[0],
        lastControl = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        lastControl?.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.querySelector<HTMLButtonElement>(".mobile-menu")?.focus();
    };
  }, [menuOpen]);

  function navigate(next: View) {
    if (view !== next) window.history.pushState(null, "", `#${next}`);
    setFocusedMessage("");
    setView(next);
    setMenuOpen(false);
  }
  async function openAnswer(messageId: string) {
    const conversation = conversations.find((c) =>
      c.messages.some((m) => m.id === messageId),
    );
    if (conversation) {
      setActiveId(conversation.id);
      navigate("chat");
      setFocusedMessage(messageId);
    } else {
      try { setSavedAnswer(await api.savedAnswer(messageId)); }
      catch (error) { setNotice(error instanceof Error ? error.message : "Could not load that saved answer. Try opening it again."); }
    }
  }
  function newConversation() {
    setHistorySearch("");
    if (requestLock.current || paginationLock.current || historyLoading || historyError) return;
    const conversation = freshConversation();
    const pinned = protectedHistory(conversations, drafts, activeId);
    if (pinned.size >= CONVERSATION_WINDOW) { setNotice("Finish or clear an unsent draft before starting another conversation."); return; }
    setConversations((items) => retainHistory([conversation, ...items], new Set([...pinned, conversation.id])));
    if (conversations.length >= CONVERSATION_WINDOW) setHistoryWindowed(true);
    setActiveId(conversation.id);
    navigate("chat");
  }
  function confirmChatDeletion(chat: Conversation) {
    setChatDeleteError(""); setChatToDelete(chat);
  }
  async function removeChat() {
    if (!chatToDelete || busy || requestLock.current || paginationLock.current) return;
    const id = chatToDelete.id;
    requestLock.current = true; setBusy("delete-chat"); setChatDeleteError("");
    try {
      if (chatToDelete.messages.length) {
        try { await api.deleteConversation(id); }
        catch (e) { if ((e as { status?: number }).status !== 404) throw e; } // Already removed in another tab, or never saved after a rejected request.
      }
      const remaining = historyState.current.conversations.filter(c => c.id !== id);
      if (!remaining.length) remaining.push(freshConversation());
      setConversations(remaining);
      setDrafts(items => { const next = { ...items }; delete next[id]; return next; });
      if (historyState.current.activeId === id) { setActiveId(remaining[0].id); navigate("history"); }
      setChatToDelete(null); setNotice("Chat deleted. Your documents and source review decisions are unchanged.");
    } catch (e) { setChatDeleteError(e instanceof Error ? e.message : "Could not delete this chat. Please retry."); }
    finally { requestLock.current = false; setBusy(""); }
  }
  async function send(question: string) {
    if (requestLock.current || paginationLock.current || historyLoading || historyError || active?.newerMessagesOmitted) return;
    requestLock.current = true;
    setPending(true);
    const conversationId = activeId;
    if ((active?.messages.length || 0) >= MESSAGE_WINDOW) {
      try {
        const page = await api.olderMessages(conversationId);
        setConversations(items => items.map(c => c.id === conversationId ? { ...c, ...page, newerMessagesOmitted: false } : c));
      } catch {
        setDrafts(items => ({ ...items, [conversationId]: question }));
        setNotice("Could not refresh the latest messages. Your question was kept as a draft; please retry.");
        requestLock.current = false; setPending(false); return;
      }
    }
    const message = {
      id: crypto.randomUUID(),
      question,
      createdAt: new Date().toISOString(),
    };
    setConversations((items) =>
      items.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              title: c.messages.length ? c.title : question.slice(0, 42),
              messages: [...c.messages, message],
            }
          : c,
      ),
    );
    const complete = (update: { result?: QueryResult; error?: string }) =>
      setConversations((items) =>
        items.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === message.id ? { ...m, ...update } : m,
                ),
              }
            : c,
        ),
      );
    try {
      complete({
        result: await api.query(question, conversationId, message.id),
      });
    } catch (error) {
      complete({
        error: error instanceof Error ? error.message : "Request failed.",
      });
    } finally {
      requestLock.current = false;
      setPending(false);
    }
  }
  async function signOut() {
    if (busy) return;
    setBusy("logout");
    try {
      await onLogout();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not sign out. Try again.",
      );
    } finally {
      setBusy("");
    }
  }
  async function downloadOriginal() {
    if (!preview?.documentId || busy) return;
    setBusy("download");
    try {
      await api.download(preview.documentId, preview.title);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setBusy("");
    }
  }
  async function removeDocument() {
    if (!preview?.documentId || busy) return;
    setBusy("delete");
    try {
      await api.removeDocument(preview.documentId);
      setPreview(null);
      setConfirmDelete(false);
      await refresh();
      await loadHistory();
      setNotice(
        "Document removed from retrieval. Earlier chat citations remain as historical records.",
      );
    } catch (failure) {
      setNotice(
        failure instanceof Error
          ? failure.message
          : "Could not delete the document.",
      );
    } finally {
      setBusy("");
    }
  }
  function inspectDocument(doc: DocumentRecord) {
    setConfirmDelete(false);
    setPreview({
      title: doc.source || doc.id,
      text: doc.text,
      version: doc.version,
      kind: "document",
      chunkCount: doc.chunkCount,
      documentId: doc.id,
      hasOriginal: doc.hasOriginal,
      metadata: `${doc.chunkCount} chunks · ${doc.version ? `Version ${doc.version}` : "Version not specified"} · Effective date unknown`,
    });
  }
  function inspectCitation(citation: Citation) {
    setPreview({
      title: citation.source,
      text: citation.excerpt,
      relations: citation.relations,
      sourceMetadata: citation.metadata,
      version: citation.version,
      kind: "citation",
      metadata: `Retrieved evidence [${citation.index}] · ${citationChunkLabel(citation)}${citation.page ? ` · Page ${citation.page}` : ""} · ${citation.version ? `Version ${citation.version}` : "Version unknown"}`,
    });
  }

  return (
    <div className="app-background">
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
        {menuOpen && (
          <button
            className="mobile-backdrop"
            tabIndex={-1}
            aria-label="Dismiss navigation overlay"
            onClick={() => setMenuOpen(false)}
          />
        )}
        <WorkspaceSidebar
          account={account}
          menuOpen={menuOpen}
          sidebarRef={sidebarRef}
          collapsed={collapsed}
          view={view}
          navigation={navigation}
          navigate={navigate}
          setMenuOpen={setMenuOpen}
          setSettings={setSettings}
          documentCount={documents.length}
          pending={pending}
          historyLoading={historyLoading}
          historyError={historyError}
          historySearch={historySearch}
          setHistorySearch={setHistorySearch}
          loadHistory={loadHistory}
          newConversation={newConversation}
          visibleConversations={visibleConversations}
          activeId={activeId}
          setActiveId={setActiveId}
          busy={busy}
          signOut={signOut}
        />
        <div className="workspace-main" inert={menuOpen}>
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button collapse-sidebar"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={toggleSidebar}
              >
                {collapsed ? (
                  <PanelLeftOpen size={18} />
                ) : (
                  <PanelLeftClose size={18} />
                )}
              </button>
              <button
                className="icon-button mobile-menu"
                onClick={() => setMenuOpen(true)}
                aria-label="Open navigation"
              >
                <Menu size={20} />
              </button>
              <span className="breadcrumb-root">Workspace</span>
              <ChevronRight size={13} />
              <strong>{navigation.find((n) => n.id === view)?.title}</strong>
            </div>
            <div className="topbar-actions">
              <button
                className="button secondary open-assistant"
                aria-label={
                  view === "chat" ? "Show workspace" : "Show assistant"
                }
                onClick={() => navigate(view === "chat" ? "knowledge" : "chat")}
              >
                {view === "chat" ? (
                  <BookOpen size={15} />
                ) : (
                  <MessageSquare size={15} />
                )}
                <span>
                  {view === "chat" ? "Knowledge base" : "Ask a question"}
                </span>
              </button>
              <ThemeToggle />
              <span
                className={`connection-badge ${connected ? "" : "disconnected"}`}
              >
                <span className="status-dot" />
                {loading
                  ? "Connecting"
                  : connected
                    ? "Connected"
                    : "Connection lost"}
              </span>
              <button
                className="icon-button"
                aria-label="Refresh workspace"
                title="Refresh workspace"
                disabled={loading}
                onClick={() => void refresh()}
              >
                <RefreshCw size={16} className={loading ? "spin" : ""} />
              </button>
              <span className="topbar-divider" />
              <button
                className="icon-button"
                aria-label="Help"
                onClick={() => setHelp(true)}
              >
                <CircleHelp size={18} />
              </button>
            </div>
          </header>
          {health && !health.providerConfigured && (
            <div className="connection-error" role="alert">
              <AlertTriangle size={16} />
              <span>
                AI is not configured for this workspace. Contact the owner to
                enable document indexing and answers.
              </span>
            </div>
          )}
          {error && (
            <div className="connection-error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
              <button onClick={() => void refresh()}>Retry</button>
            </div>
          )}
          <main
            id="main"
            className={`main-content route-content ${view === "chat" ? "chat-route" : ""}`}
            inert={menuOpen}
          >
            {view === "knowledge" && (
              <DocumentLibrary
                documents={documents}
                loading={loading}
                connected={connected}
                durableUploads={health?.capabilities?.durableUploads === true}
                onRefresh={refresh}
                onPreview={inspectDocument}
              />
            )}
            {view === "chat" && (
              <ChatPanel
                query={drafts[activeId] || ""}
                onQueryChange={(value) =>
                  setDrafts((items) => { const next = { ...items }; if (value) next[activeId] = value; else delete next[activeId]; return next; })
                }
                focusMessageId={focusedMessage}
                key={activeId}
                title={active?.title || "New conversation"}
                messages={active?.messages || []}
                pending={pending}
                connected={
                  connected &&
                  Boolean(activeId) &&
                  !historyLoading &&
                  !loadingMoreHistory &&
                  !historyError &&
                  !loadingOlder
                }
                documentCount={documents.length}
                onSend={send}
                onNew={newConversation}
                onHistory={() => navigate("history")}
                onDelete={active && (active.messages.length > 0 || drafts[activeId]) ? () => confirmChatDeletion(active) : undefined}
                onCitation={inspectCitation}
                hasOlderMessages={Boolean(active?.olderMessagesCursor)}
                loadingOlderMessages={loadingOlder === activeId}
                olderMessagesError={olderError?.id === activeId ? olderError.message : ""}
                onLoadOlder={loadOlderMessages}
                newerMessagesOmitted={active?.newerMessagesOmitted}
                onLoadLatest={loadLatestMessages}
              />
            )}
            {view === "history" && (
              <ConversationHistory
                search={conversationSearch}
                onSearch={setConversationSearch}
                onDelete={confirmChatDeletion}
                deleteDisabled={pending || Boolean(busy) || historyLoading || loadingMoreHistory || Boolean(loadingOlder)}
                conversations={conversations}
                loading={historyLoading}
                error={historyError}
                onRetry={() => void loadHistory()}
                hasMore={Boolean(historyCursor)}
                loadingMore={loadingMoreHistory}
                moreError={moreHistoryError}
                onLoadMore={() => void loadMoreHistory()}
                windowed={historyWindowed}
                onOpen={(id) => {
                  setActiveId(id);
                  navigate("chat");
                }}
              />
            )}
            {view === "conflicts" && (
              <>
                <PageHeading
                  title="Conflict center"
                  eyebrow="EVIDENCE RECONCILIATION"
                  description="Compare source passages. Keep unresolved disagreements visible."
                />
                <ConflictCenter
                  onCitation={inspectCitation}
                  onOpen={openAnswer}
                />
              </>
            )}
            {view === "corrections" && (
              <Corrections
                onCitation={inspectCitation}
                onOpen={openAnswer}
              />
            )}
            {view === "analytics" && (
              <Analytics
                documents={documents}
                messages={conversations.flatMap((c) => c.messages)}
                loading={loading || historyLoading}
                connected={connected}
                error={historyError}
              />
            )}
            {view !== "chat" && (
              <footer className="content-footer">
                <span>
                  <ShieldCheck size={13} /> Private research workspace
                </span>
                <span>Veriqon / Evidence first</span>
              </footer>
            )}
          </main>
        </div>
      </div>
      <div className="outside-caption">
        <span>VERIQON</span>
        <span>A little more context. A lot more clarity.</span>
        <span>RESEARCH WORKSPACE / 01</span>
      </div>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      <Modal open={Boolean(chatToDelete)} onClose={() => { if (busy !== "delete-chat") setChatToDelete(null); }} title="Delete chat?" description={`Delete “${chatToDelete?.title || "this chat"}” and its questions, answers and answer versions? This cannot be undone. Uploaded documents and source review decisions are kept.`}>
        {chatDeleteError && <p role="alert" className="inline-note">{chatDeleteError}</p>}
        <div className="conflict-clear-actions"><button className="button secondary" disabled={busy === "delete-chat"} onClick={() => setChatToDelete(null)}>Cancel</button><button className="button secondary destructive" disabled={Boolean(busy)} onClick={() => void removeChat()}>{busy === "delete-chat" ? "Deleting…" : "Delete chat"}</button></div>
      </Modal>
      <WorkspaceDialogs sources={documents}
        preview={preview}
        setPreview={setPreview}
        busy={busy}
        pending={pending}
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        downloadOriginal={downloadOriginal}
        removeDocument={removeDocument}
        settings={settings}
        setSettings={setSettings}
        account={account}
        connected={connected}
        health={health}
        signOut={signOut}
        help={help}
        setHelp={setHelp}
      />
      <Modal open={Boolean(savedAnswer)} onClose={() => setSavedAnswer(null)} title="Saved answer" description={savedAnswer?.title || "Recorded answer details"} drawer>
        {savedAnswer && <>
          <h2>{savedAnswer.message.question}</h2>
          <p className="muted">{new Date(savedAnswer.message.createdAt).toLocaleString()}</p>
          {savedAnswer.message.result ? <>
            <VerificationBadge result={savedAnswer.message.result} />
            {savedAnswer.message.result.sourcesChanged && <p className="inline-note">The library has changed since this answer was recorded. These are the original saved passages.</p>}
            <p className="answer-text">{savedAnswer.message.result.draft}</p>
            {savedAnswer.message.result.citations.map(c => <button className="source-button" key={c.index} onClick={() => inspectCitation(c)}>[{c.index}] {c.source}</button>)}
            <RepairDetails result={savedAnswer.message.result} onCitation={inspectCitation} />
            <AnswerVersionHistory key={savedAnswer.message.id} messageId={savedAnswer.message.id} onCitation={inspectCitation} />
          </> : <p role="alert">{savedAnswer.message.error || "No completed answer was recorded."}</p>}
        </>}
      </Modal>
    </div>
  );
}
