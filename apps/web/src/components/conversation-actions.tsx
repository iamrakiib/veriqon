"use client";
import { Ellipsis, Trash2 } from "lucide-react";

export function ConversationActions({ label = "Chat actions", disabled, onDelete }: { label?: string; disabled?: boolean; onDelete: () => void }) {
  return <details className="conversation-actions" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.open = false; }} onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
    <summary className="icon-button" aria-label={label} title={label}><Ellipsis size={18} /></summary>
    <div className="conversation-actions-popover">
      <button disabled={disabled} onClick={e => { const menu = e.currentTarget.closest("details")!; menu.open = false; menu.querySelector("summary")?.focus(); onDelete(); }}><Trash2 size={15} />Delete chat</button>
    </div>
  </details>;
}
