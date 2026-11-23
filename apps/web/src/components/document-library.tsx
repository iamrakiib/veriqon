"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  FolderOpen,
  ListFilter,
  LoaderCircle,
  Plus,
  Search,
  UploadCloud,
  X,
  AlertCircle,
} from "lucide-react";
import { api, type DocumentRecord, type IngestionJob } from "../lib/api";
import { EmptyState } from "./ui";

type Upload = {
  id: string;
  name: string;
  status: "queued" | "indexing" | "failed" | "indexed";
  error?: string;
};

export function DocumentLibrary({
  documents,
  loading,
  connected,
  durableUploads = false,
  onRefresh,
  onPreview,
}: {
  documents: DocumentRecord[];
  loading: boolean;
  connected: boolean;
  durableUploads?: boolean;
  onRefresh: () => Promise<void>;
  onPreview: (doc: DocumentRecord) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sort, setSort] = useState(false);
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [jobError, setJobError] = useState("");
  const [jobAction, setJobAction] = useState<string>();
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const completed = useRef(new Set<string>());
  const activeUploads = jobs.some(job => ["queued", "processing", "retry_wait"].includes(job.status));
  useEffect(() => {
    if (!connected || !durableUploads) return;
    let disposed = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const items = await api.uploads(controller.signal);
        if (disposed) return;
        setJobs(items);
        setJobError("");
        const newlyCompleted = items.filter(item => item.status === "completed" && !completed.current.has(item.id));
        completed.current = new Set(items.filter(item => item.status === "completed").map(item => item.id));
        if (newlyCompleted.length) await refreshRef.current();
      } catch (error) {
        if (!disposed) setJobError(error instanceof Error ? error.message : "Could not check upload progress.");
      } finally {
        if (!disposed) timer = setTimeout(() => { void poll(); }, activeUploads && !document.hidden ? 4000 : 30000);
      }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [connected, durableUploads, activeUploads]);

  async function changeJob(job: IngestionJob, action: "retry" | "discard") {
    if (jobAction) return;
    setJobAction(job.id);
    try {
      if (action === "retry") {
        const updated = await api.retryUpload(job.id);
        setJobs(items => items.map(item => item.id === updated.id ? updated : item));
      } else {
        await api.discardUpload(job.id);
        setJobs(items => items.filter(item => item.id !== job.id));
        // Publication may have won the race with discard; refresh the actual library.
        await refreshRef.current();
      }
      setJobError("");
    } catch (error) { setJobError(error instanceof Error ? error.message : "Could not update this upload."); }
    finally { setJobAction(undefined); }
  }
  const visible = documents
    .filter(
      (doc) =>
        `${doc.source || doc.id} ${doc.text}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === "all" ||
          (doc.source || "").toLowerCase().endsWith(`.${filter}`)),
    )
    .sort((a, b) =>
      sort
        ? (b.source || b.id).localeCompare(a.source || a.id)
        : (a.source || a.id).localeCompare(b.source || b.id),
    );

  async function ingest(files: FileList | File[]) {
    if (locked.current || !connected) return;
    locked.current = true;
    setUploading(true);
    const batch = Array.from(files).map((file) => ({
      file,
      id: crypto.randomUUID(),
    }));
    setUploads(
      batch.map(({ file, id }) => ({ id, name: file.name, status: "queued" })),
    );
    try {
      for (const [index, { file, id }] of batch.entries()) {
        try {
          if (index >= 10)
            throw new Error(
              "Only 10 files can be uploaded per batch. Upload this file in the next batch.",
            );
          if (!/\.(pdf|docx|txt|md)$/i.test(file.name))
            throw new Error(
              "Supported formats: PDF, DOCX, TXT and Markdown. Convert legacy .doc files to .docx.",
            );
          if (file.size > 10 * 1024 * 1024)
            throw new Error("This file exceeds the 10 MB upload limit.");
          if (file.name.length > 255)
            throw new Error("Use a filename shorter than 256 characters.");
          if (!file.size)
            throw new Error(
              "This file is empty. Choose a document with readable text.",
            );
          setUploads((items) =>
            items.map((item) =>
              item.id === id ? { ...item, status: "indexing" } : item,
            ),
          );
          if (durableUploads) {
            const job = await api.queueUpload(file);
            setJobs(items => [job, ...items.filter(item => item.id !== job.id)]);
            setUploads(items => items.filter(item => item.id !== id));
            continue;
          }
          await api.upload(file);
          setUploads((items) =>
            items.map((item) =>
              item.id === id ? { ...item, status: "indexed" } : item,
            ),
          );
        } catch (error) {
          setUploads((items) =>
            items.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: "failed",
                    error:
                      error instanceof Error ? error.message : "Upload failed.",
                  }
                : item,
            ),
          );
        }
      }
      await onRefresh();
    } finally {
      locked.current = false;
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">KNOWLEDGE LIBRARY</span>
          <h1>Knowledge base</h1>
          <p>Manage the sources behind your research.</p>
        </div>
        <button
          className="button primary"
          onClick={() => input.current?.click()}
          disabled={!connected || uploading}
        >
          <Plus size={16} /> Add documents
        </button>
      </div>
      <div className="library-summary" aria-label="Library summary">
        <div>
          <span className="summary-dot blue" />
          <span>Documents</span>
          <strong>{loading ? "-" : documents.length}</strong>
        </div>
        <div>
          <span className="summary-dot green" />
          <span>Passages</span>
          <strong>
            {loading
              ? "-"
              : documents.reduce((sum, doc) => sum + doc.chunkCount, 0)}
          </strong>
        </div>
        <div>
          <span className="summary-dot violet" />
          <span>Access</span>
          <strong>Private</strong>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
        multiple
        hidden
        disabled={!connected || uploading}
        aria-label="Upload documents"
        onChange={(event) => {
          if (event.target.files) void ingest(event.target.files);
        }}
      />
      <button
        className={`dropzone ${documents.length ? "has-documents" : ""} ${dragging ? "dragging" : ""}`}
        disabled={!connected || uploading}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void ingest(event.dataTransfer.files);
        }}
      >
        <span className="upload-icon">
          {uploading ? (
            <LoaderCircle className="spin" size={24} />
          ) : (
            <UploadCloud size={25} strokeWidth={1.5} />
          )}
        </span>
        <strong>
          {uploading
            ? "Indexing your knowledge…"
            : "Bring your knowledge together"}
        </strong>
        <span>
          <span className="accent">Click to upload</span> or drag and drop
        </span>
        <small>
          PDF, DOCX, TXT or Markdown · up to 10 MB each · 10 files per batch
        </small>
        <small>
          Up to {durableUploads ? "500,000" : "100,000"} extracted characters per document. Scanned PDFs need
          OCR.
        </small>
      </button>
      {jobError && <p className="connection-error" role="alert">{jobError}</p>}
      {jobs.length > 0 && <div className="upload-results" aria-label="Saved upload progress" aria-live="polite">
        <small className="subtle">Progress is saved across reloads. Failed uploads are kept for seven days. Up to three unfinished uploads at a time.</small>
        {jobs.map(job => <div key={job.id} className={`upload-result ${job.status === "completed" ? "indexed" : job.status === "processing" ? "indexing" : job.status}`}>
          {job.status === "completed" ? <Check size={14} /> : job.status === "failed" ? <AlertCircle size={14} /> : job.status === "processing" ? <LoaderCircle size={14} className="spin" /> : <Clock3 size={14} />}
          <span><strong>{job.source}</strong><small>
            {job.status === "completed" ? "Ready for questions" : job.status === "queued" ? "Saved — waiting to index" :
              job.status === "processing" ? `Indexing ${job.completedChunks} of ${job.totalChunks} passages` :
              job.status === "retry_wait" ? `Progress saved (${job.completedChunks}/${job.totalChunks}). Retrying after ${new Date(job.nextAt).toLocaleTimeString()}. ${job.error || ""}` :
              `Progress saved (${job.completedChunks}/${job.totalChunks}). ${job.error || "Indexing failed."}`}
          </small></span>
          {job.status === "failed" && job.attempts < 6 && <button className="button" aria-label={`Retry ${job.source}`} disabled={Boolean(jobAction)} onClick={() => void changeJob(job, "retry")}>Retry</button>}
          <button className="icon-button" disabled={Boolean(jobAction)} aria-label={`${job.status === "completed" ? "Dismiss" : "Discard upload"} ${job.source}`} onClick={() => void changeJob(job, "discard")}><X size={14} /></button>
        </div>)}
      </div>}
      {uploads.length > 0 && (
        <div className="upload-results" aria-live="polite">
          {uploads.map((item) => (
            <div key={item.id} className={`upload-result ${item.status}`}>
              {item.status === "queued" ? (
                <Clock3 size={14} />
              ) : item.status === "indexing" ? (
                <LoaderCircle size={14} className="spin" />
              ) : item.status === "indexed" ? (
                <Check size={14} />
              ) : (
                <AlertCircle size={14} />
              )}
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.error ||
                    (item.status === "queued"
                      ? "Waiting in queue"
                      : item.status === "indexing"
                        ? "Reading and indexing…"
                        : "Ready for questions")}
                </small>
              </span>
              {(item.status === "indexed" || item.status === "failed") && (
                <button
                  className="icon-button"
                  aria-label={`Dismiss ${item.name}`}
                  onClick={() =>
                    setUploads((items) => items.filter((i) => i.id !== item.id))
                  }
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="library-section">
        <div className="library-heading">
          <h2>
            All documents <span className="count">{documents.length}</span>
          </h2>
          <span className="subtle">Workspace library</span>
        </div>
        <div className="library-tools">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search documents"
              placeholder="Search your knowledge…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <X size={14} />
              </button>
            )}
          </label>
          <label className="filter-select">
            <ListFilter size={15} />
            <select
              aria-label="Filter file type"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">All types</option>
              <option value="txt">Text</option>
              <option value="md">Markdown</option>
              <option value="pdf">PDF</option>
              <option value="docx">Word</option>
            </select>
          </label>
        </div>
        <div className="document-table">
          <div className="table-head">
            <button onClick={() => setSort(!sort)}>
              NAME <ChevronDown size={12} className={sort ? "rotate" : ""} />
            </button>
            <span>STATUS</span>
            <span>CHUNKS</span>
            <span />
          </div>
          {loading ? (
            <div className="loading-rows" aria-label="Loading documents">
              {[1, 2, 3].map((i) => (
                <div className="skeleton" key={i} />
              ))}
            </div>
          ) : visible.length ? (
            visible.map((doc) => (
              <button
                className="document-row"
                key={doc.id}
                onClick={() => onPreview(doc)}
              >
                <span className="document-name">
                  <span
                    className={`file-icon ${(doc.source || "").toLowerCase().endsWith(".md") ? "markdown" : ""}`}
                  >
                    <FileText size={18} />
                  </span>
                  <span>
                    <strong>{doc.source || doc.id}</strong>
                    <small title={doc.version}>
                      {(doc.source || "").split(".").pop()?.toUpperCase() ||
                        "TEXT"}{" "}
                      ·{" "}
                      {doc.version
                        ? `Version ${doc.version}`
                        : "Version not supplied"}
                    </small>
                  </span>
                </span>
                <span className="badge green">
                  <span className="status-dot" /> Indexed
                </span>
                <span className="chunk-count">{doc.chunkCount}</span>
                <ArrowUpRight size={15} className="row-arrow" />
              </button>
            ))
          ) : (
            <EmptyState
              icon={<FolderOpen size={27} strokeWidth={1.4} />}
              title={
                search || filter !== "all"
                  ? "No matching documents"
                  : "Make room for what you know"
              }
              description={
                search || filter !== "all"
                  ? "Try another search or file type."
                  : "Upload your first document. Your assistant will use it to find evidence and build grounded answers."
              }
            />
          )}
        </div>
        <div className="table-footer">
          <span>
            {visible.length} {visible.length === 1 ? "document" : "documents"}
          </span>
          <span>
            <span className="tiny-dot" />{" "}
            {connected ? "Library connected" : "Waiting for connection"}
          </span>
        </div>
      </div>
      <p className="scope-note">
        Open a document to inspect its version, source details and extracted
        content.
      </p>
      <div className="knowledge-note">
        <span className="note-symbol">↗</span>
        <div>
          <strong>Good answers start with good evidence.</strong>
          <p>
            Keep sources focused and relevant. You can inspect the retrieved
            passages alongside every answer.
          </p>
        </div>
      </div>
    </>
  );
}
