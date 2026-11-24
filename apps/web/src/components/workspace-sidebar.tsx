"use client";
import type { RefObject } from "react";
import {
  X,
  Plus,
  RefreshCw,
  Search,
  MessageSquare,
  Settings2,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import type { Account } from "../lib/session";
import type { Conversation } from "./chat-panel";
import { BrandMark } from "./ui";
export type WorkspaceView =
  | "knowledge"
  | "chat"
  | "history"
  | "conflicts"
  | "corrections"
  | "analytics";
type Props = {
  account: Account;
  menuOpen: boolean;
  sidebarRef: RefObject<HTMLElement | null>;
  collapsed: boolean;
  view: WorkspaceView;
  navigation: { id: WorkspaceView; title: string; icon: LucideIcon }[];
  navigate: (view: WorkspaceView) => void;
  setMenuOpen: (value: boolean) => void;
  setSettings: (value: boolean) => void;
  documentCount: number;
  pending: boolean;
  historyLoading: boolean;
  historyError: string;
  historySearch: string;
  setHistorySearch: (value: string) => void;
  loadHistory: () => Promise<void>;
  newConversation: () => void;
  visibleConversations: Conversation[];
  activeId: string;
  setActiveId: (value: string) => void;
  busy: string;
  signOut: () => Promise<void>;
};
export function WorkspaceSidebar({
  account,
  menuOpen,
  sidebarRef,
  collapsed,
  view,
  navigation,
  navigate,
  setMenuOpen,
  setSettings,
  documentCount,
  pending,
  historyLoading,
  historyError,
  historySearch,
  setHistorySearch,
  loadHistory,
  newConversation,
  visibleConversations,
  activeId,
  setActiveId,
  busy,
  signOut,
}: Props) {
  return (
    <aside
      ref={sidebarRef}
      role={menuOpen ? "dialog" : undefined}
      aria-modal={menuOpen || undefined}
      className={`sidebar ${menuOpen ? "is-open" : ""}`}
      aria-label="Workspace navigation"
    >
      <button
        className="icon-button mobile-nav-close"
        aria-label="Close navigation"
        onClick={() => setMenuOpen(false)}
      >
        <X size={19} />
      </button>
      <div className="window-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <a
        className="brand"
        href="#"
        onClick={(event) => {
          event.preventDefault();
          navigate("knowledge");
        }}
      >
        <BrandMark />
        <span>Veriqon</span>
      </a>
      <button
        className="button secondary sidebar-new"
        onClick={newConversation}
        disabled={pending || historyLoading || Boolean(historyError)}
        aria-label="New chat"
      >
        <Plus size={16} />
        <span>New chat</span>
      </button>
      <div className="workspace-switch" aria-label="Private personal workspace">
        <span className="workspace-avatar">VQ</span>
        <span>
          <strong>My workspace</strong>
          <small>Private knowledge library</small>
        </span>
      </div>
      <div className="nav-group">
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-label={item.title}
              title={collapsed ? item.title : undefined}
              data-view={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={17} strokeWidth={1.6} />
              <span>{item.title}</span>
              {item.id === "knowledge" && (
                <span className="nav-count">{documentCount}</span>
              )}
            </button>
          ))}
        </nav>
      </div>
      <div className="nav-group conversations">
        <div className="nav-label-row">
          <span className="nav-label">CHAT HISTORY</span>
          <button
            className="icon-button"
            aria-label="Refresh chat history"
            disabled={pending || historyLoading}
            onClick={() => void loadHistory()}
          >
            <RefreshCw size={13} className={historyLoading ? "spin" : ""} />
          </button>
          <button
            className="icon-button"
            aria-label="Create conversation"
            onClick={newConversation}
            disabled={pending || historyLoading || Boolean(historyError)}
          >
            <Plus size={14} />
          </button>
        </div>
        <label className="history-search">
          <Search size={13} />
          <input
            aria-label="Search chat history"
            placeholder="Find a conversation"
            value={historySearch}
            onChange={(event) => setHistorySearch(event.target.value)}
          />
          {historySearch && (
            <button
              className="icon-button"
              aria-label="Clear chat search"
              onClick={() => setHistorySearch("")}
            >
              <X size={12} />
            </button>
          )}
        </label>
        {historyLoading ? (
          <p className="nav-empty">Loading saved chats...</p>
        ) : historyError ? (
          <div className="nav-empty" role="alert">
            {historyError}
            <button className="text-button" onClick={() => void loadHistory()}>
              Retry chat history
            </button>
          </div>
        ) : visibleConversations.length ? (
          visibleConversations.map((c) => (
            <button
              className={`conversation-link ${c.id === activeId && view === "chat" ? "selected" : ""}`}
              key={c.id}
              onClick={() => {
                setActiveId(c.id);
                navigate("chat");
              }}
            >
              <MessageSquare size={14} />
              <span>{c.title}</span>
            </button>
          ))
        ) : (
          <p className="nav-empty">
            {historySearch ? (
              "No matching recent conversations."
            ) : (
              <>
                Your saved conversations
                <br />
                will appear here.
              </>
            )}
          </p>
        )}
        <button
          className="new-conversation"
          onClick={newConversation}
          disabled={pending || historyLoading || Boolean(historyError)}
        >
          <Plus size={14} /> New conversation
        </button>
      </div>
      <div className="sidebar-bottom">
        <button
          className="nav-item"
          aria-label="Workspace settings"
          onClick={() => setSettings(true)}
        >
          <Settings2 size={17} />
          <span>Workspace settings</span>
        </button>
        <div className="profile">
          <button
            className="profile-settings"
            aria-label="Open account settings"
            title="Open account settings"
            onClick={() => setSettings(true)}
          >
            <div className="profile-avatar">
              {account.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="profile-details">
              <strong title={account.name}>{account.name}</strong>
              <small>
                {account.role === "owner"
                  ? "Workspace owner"
                  : "Personal account"}
              </small>
            </div>
          </button>
          <button
            className="icon-button"
            aria-label="Sign out"
            title="Sign out"
            disabled={Boolean(busy)}
            onClick={() => void signOut()}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
