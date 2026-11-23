"use client";
import {
  ArrowDownToLine,
  LoaderCircle,
  Trash2,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import type { Account } from "../lib/session";
import { SourceMetadataEditor } from "./knowledge-controls";
import type { SourceMetadata, Citation, Health } from "../lib/api";
import { Modal } from "./ui";
import { ThemeSettings } from "./theme-provider";
import { RecoverySettings } from "./recovery";
export type SourcePreview = {
  sourceMetadata?: SourceMetadata;
  title: string;
  text: string;
  metadata: string;
  relations?: Citation["relations"];
  version?: string;
  kind?: "document" | "citation";
  chunkCount?: number;
  documentId?: string;
  hasOriginal?: boolean;
};
type Props = {
  sources: {id:string;source?:string}[];
  preview: SourcePreview | null;
  setPreview: (value: SourcePreview | null) => void;
  busy: string;
  pending: boolean;
  confirmDelete: boolean;
  setConfirmDelete: (value: boolean) => void;
  downloadOriginal: () => Promise<void>;
  removeDocument: () => Promise<void>;
  settings: boolean;
  setSettings: (value: boolean) => void;
  account: Account;
  connected: boolean;
  health: Health | null;
  signOut: () => Promise<void>;
  help: boolean;
  setHelp: (value: boolean) => void;
};
export function WorkspaceDialogs({
  sources,
  preview,
  setPreview,
  busy,
  pending,
  confirmDelete,
  setConfirmDelete,
  downloadOriginal,
  removeDocument,
  settings,
  setSettings,
  account,
  connected,
  health,
  signOut,
  help,
  setHelp,
}: Props) {
  return (
    <>
      {" "}
      <Modal
        drawer
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.title || "Source preview"}
        description={preview?.metadata || "Source details"}
      >
        <dl className="source-metadata">
          <div>
            <dt>View</dt>
            <dd>
              {preview?.kind === "citation"
                ? "Evidence captured with this answer"
                : "Current indexed document"}
            </dd>
          </div>
          <div>
            <dt>Source version</dt>
            <dd>
              <code>{preview?.version || "Not supplied"}</code>
            </dd>
          </div>
          <div>
            <dt>Publication date</dt>
            <dd>{preview?.sourceMetadata?.publishedAt || "Not provided in this snapshot"}</dd>
          </div>
          <div>
            <dt>Effective period</dt>
            <dd>{preview?.sourceMetadata?.effectiveFrom || "Unknown"} to {preview?.sourceMetadata?.effectiveTo || "Unknown"}</dd>
          </div>
          {preview?.kind === "document" && (
            <>
              <div>
                <dt>Indexing state</dt>
                <dd>Indexed · {preview.chunkCount} passages</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>Not provided</dd>
              </div>
              <div>
                <dt>Version history / supersession</dt>
                <dd>Inspect recorded versions below</dd>
              </div>
            </>
          )}
        </dl>
        {preview?.kind === "citation" && (
          <section className="evidence-relationships">
            <h3>Relationship to this answer</h3>
            {preview.relations?.length ? (
              preview.relations.map((r, i) => (
                <div key={i}>
                  <span
                    className={`badge ${r.relationship === "supporting" ? "green" : "red"}`}
                  >
                    {r.relationship === "supporting"
                      ? "Assessed as supporting"
                      : "Assessed as contradicting"}
                  </span>
                  <p>{r.claim}</p>
                </div>
              ))
            ) : (
              <p className="muted">
                Retrieved context. No claim-level relationship was recorded for
                this passage.
              </p>
            )}
          </section>
        )}
        {preview?.kind === "document" && preview.documentId && <SourceMetadataEditor key={preview.documentId} documentId={preview.documentId} sources={sources} />}
        <h3 className="drawer-section-title">
          {preview?.kind === "citation"
            ? "Exact retrieved passage"
            : "Extracted content"}
        </h3>
        <div className="document-preview">{preview?.text}</div>
        {preview?.hasOriginal && (
          <div className="preview-actions">
            <button
              className="button secondary"
              disabled={Boolean(busy)}
              onClick={() => void downloadOriginal()}
            >
              {busy === "download" ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <ArrowDownToLine size={15} />
              )}{" "}
              Download original
            </button>
          </div>
        )}
        {preview?.documentId && (
          <div className="delete-document">
            {confirmDelete ? (
              <>
                <p>
                  Remove this document and its original file from your library?
                  Saved answers keep their cited passages, but future questions
                  will not use this document.
                </p>
                <div>
                  <button
                    className="button secondary"
                    onClick={() => setConfirmDelete(false)}
                    disabled={Boolean(busy)}
                  >
                    Keep document
                  </button>
                  <button
                    className="button danger"
                    disabled={Boolean(busy) || pending}
                    onClick={() => void removeDocument()}
                  >
                    {busy === "delete" ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Trash2 size={15} />
                    )}{" "}
                    Confirm delete
                  </button>
                </div>
              </>
            ) : (
              <button
                className="text-button"
                disabled={Boolean(busy) || pending}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} /> Delete document
              </button>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={settings}
        onClose={() => setSettings(false)}
        title="Workspace settings"
        description="Appearance, account, and storage for your workspace."
      >
        <ThemeSettings />
        <div className="account-summary">
          <div className="profile-avatar">
            {account.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <strong>{account.name}</strong>
            <span>{account.email}</span>
          </div>
          <span className="badge neutral">{account.role}</span>
        </div>
        <RecoverySettings />
        <dl className="settings-list">
          <div>
            <dt>API connection</dt>
            <dd>{connected ? "Connected" : "Offline"}</dd>
          </div>
          <div>
            <dt>Document storage</dt>
            <dd>
              {health?.storage === "postgresql"
                ? "PostgreSQL"
                : health?.storage === "sqlite"
                  ? "SQLite (local)"
                  : "Unavailable"}{" "}
              / Saved automatically
            </dd>
          </div>
          <div>
            <dt>Access control</dt>
            <dd>Private library / JWT sessions</dd>
          </div>
          <div>
            <dt>Original uploads</dt>
            <dd>Stored with your documents</dd>
          </div>
          <div>
            <dt>Historical date filtering</dt>
            <dd>Uses recorded source dates where provided</dd>
          </div>
        </dl>
        <p className="muted">
          Your indexed documents survive restarts. Chat history and answer
          repairs are saved to your account and remain after reload or sign-out.
          Older imported documents retain their extracted text; re-upload to
          save the original file.
        </p>
        <div className="settings-actions">
          <button
            className="button secondary"
            disabled={Boolean(busy)}
            onClick={() => void signOut()}
          >
            {busy === "logout" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <LogOut size={15} />
            )}{" "}
            Sign out of this session
          </button>
        </div>
      </Modal>
      <Modal
        open={help}
        onClose={() => setHelp(false)}
        title="A workspace built around evidence"
        description="From your documents to answers you can inspect."
      >
        <ol className="help-steps">
          <li>
            <strong>Add knowledge.</strong> Upload PDF, DOCX, or UTF-8
            TXT/Markdown documents. Your documents are indexed so the assistant
            can find relevant passages. Scanned images require external OCR before upload.
          </li>
          <li>
            <strong>Ask a question.</strong> The model retrieves relevant
            chunks, drafts an answer, and checks each statement against those
            passages.
          </li>
          <li>
            <strong>Inspect the result.</strong> Open source citations, review
            the model assessment, and compare any repaired answer.
          </li>
          <li>
            <strong>Keep your knowledge.</strong> Your files and indexed text
            are saved to your private library automatically.
          </li>
        </ol>
        <p className="muted">Conflict Center covers assessed answers, not a full-library scan. Account recovery uses saved recovery codes; email reset links are not configured.</p>
        <div className="inline-note">
          <ShieldCheck size={18} /> Answers reflect the sources available when
          you ask. Background revalidation can record new assessments after source changes; inspect its status in Corrections. Original answers remain unchanged.
        </div>
      </Modal>
    </>
  );
}
