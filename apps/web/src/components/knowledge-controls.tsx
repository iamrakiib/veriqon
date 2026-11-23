"use client";
import { useState } from "react";
import { request, type SourceMetadata, type QueryResult, type Citation } from "../lib/api";
import { VerificationBadge } from "./answer-details";

// Retain a rolling window, while keyset cursors still allow access to the entire history.
const HISTORY_WINDOW = 100;

export function SourceMetadataEditor({ documentId, sources }: { documentId: string; sources: { id: string; source?: string }[] }) {
  const [open,setOpen]=useState(false),[value,setValue]=useState<SourceMetadata>({}),[revision,setRevision]=useState(0),[reason,setReason]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [versions,setVersions]=useState<{versionId:string;recordedAt:number;version?:string;metadata:SourceMetadata}[]|null>(null);
  const [cursor,setCursor]=useState<string|null>(null),[archive,setArchive]=useState<{text:string;metadata:SourceMetadata}|null>(null);
  async function load() {
    setBusy(true);setError("");
    try { const data=await request<{metadata:SourceMetadata;revision:number}>(`docs/${encodeURIComponent(documentId)}/metadata`);setValue(data.metadata);setRevision(data.revision);setOpen(true); }
    catch(e){setError(e instanceof Error?e.message:"Could not load source metadata.");}finally{setBusy(false);}
  }
  async function save(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError("");setNotice("");
    try { const data=await request<{metadata:SourceMetadata;revision:number}>(`docs/${encodeURIComponent(documentId)}/metadata`,{method:"PUT",body:JSON.stringify({metadata:Object.fromEntries(Object.entries(value).filter(([,v])=>v?.trim())),expectedRevision:revision,reason})});setRevision(data.revision);setValue(data.metadata);setReason("");setVersions(null);setArchive(null);setNotice("Metadata saved. Check background revalidation for affected answers; completion is not immediate."); }
    catch(e){setError(e instanceof Error?e.message:"Could not save source metadata.");}finally{setBusy(false);}
  }
  async function history(next?:string){setBusy(true);setError("");try{const page=await request<{items:NonNullable<typeof versions>;nextCursor:string|null}>(`docs/${encodeURIComponent(documentId)}/version-history?limit=20${next?`&cursor=${encodeURIComponent(next)}`:""}`);if(!Array.isArray(page.items))throw new Error("Invalid version history response.");setVersions(rows=>next?[...(rows||[]),...page.items].slice(-HISTORY_WINDOW):page.items);setCursor(page.nextCursor);}catch(e){setError(e instanceof Error?e.message:"Could not load versions.");}finally{setBusy(false);}}
  async function readVersion(id:string){setBusy(true);setError("");setArchive(null);try{setArchive(await request<{text:string;metadata:SourceMetadata}>(`docs/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(id)}`));}catch(e){setError(e instanceof Error?e.message:"Could not load archived text.");}finally{setBusy(false);}}
  return <section className="knowledge-controls">
    <div className="preview-actions"><button className="button secondary" disabled={busy} onClick={()=>open?setOpen(false):void load()}>{open?"Close metadata":"Source dates and authority"}</button><button className="text-button" disabled={busy} onClick={()=>void history()}>View document versions</button></div>
    {error&&<p role="alert" className="inline-note">{error}<button className="text-button" onClick={()=>void load()}>Reload metadata</button></p>}
    {notice&&<p role="status">{notice}</p>}
    {open&&<form className="knowledge-form" onSubmit={save}>
      <p className="scope-note full-field">Record dates stated by an authorized source. Upload time and document titles never establish authority. Effective end dates are inclusive.</p>
      {([['publishedAt','Publication date'],['effectiveFrom','Effective from'],['effectiveTo','Effective through']] as const).map(([key,label])=><label key={key}>{label}<input type="date" value={value[key]||""} onChange={e=>setValue({...value,[key]:e.target.value})}/></label>)}
      <label>Department / jurisdiction<input maxLength={160} value={value.scope||""} onChange={e=>setValue({...value,scope:e.target.value})} placeholder="For example, Engineering / Bangladesh"/></label>
      <label>Recorded source authority<input maxLength={160} value={value.authority||""} onChange={e=>setValue({...value,authority:e.target.value})} placeholder="For example, approved HR policy"/></label>
      <label>Explicitly supersedes<select value={value.supersedes||""} onChange={e=>setValue({...value,supersedes:e.target.value})}><option value="">No relationship established</option>{sources.filter(s=>s.id!==documentId).map(s=><option key={s.id} value={s.id}>{s.source||s.id}</option>)}</select></label>
      <label className="full-field">Reason for this metadata change<textarea required minLength={10} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <button className="button primary" disabled={busy||reason.trim().length<10}>{busy?"Saving…":"Save source metadata"}</button>
    </form>}
    {versions&&<div><h3>Recorded document versions</h3><p className="scope-note">Showing up to 100 versions at a time; View document versions returns to the newest. Historical snapshots are distinct from current metadata. Removing a document also removes its document snapshots.</p>{versions.length?versions.map(v=><article key={v.versionId}><p>{new Date(v.recordedAt).toLocaleString()} · {v.metadata.effectiveFrom||"Start unknown"} – {v.metadata.effectiveTo||"End unknown"}</p><code>{v.version||v.versionId}</code><button className="text-button" disabled={busy} onClick={()=>void readVersion(v.versionId)}>Read archived version</button></article>):<p>No document versions recorded.</p>}{cursor&&<button className="text-button" disabled={busy} onClick={()=>void history(cursor)}>Load older document versions</button>}{archive&&<section aria-label="Archived document"><p>Historical effective period: {archive.metadata.effectiveFrom||"Unknown"} – {archive.metadata.effectiveTo||"Unknown"}</p><pre className="document-preview">{archive.text}</pre></section>}</div>}
  </section>;
}

export function ConflictReview({ id,revision,sources,onSaved }: { id:string;revision:number;sources:Citation[];onSaved:()=>void }) {
  const [action,setAction]=useState("PREFER_SOURCE"),[source,setSource]=useState(""),[explanation,setExplanation]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");

  async function save(event:React.FormEvent){event.preventDefault();setBusy(true);setError("");try{await request(`conflicts/${encodeURIComponent(id)}/decision`,{method:"POST",body:JSON.stringify({action,explanation,expectedRevision:revision,...(action==="PREFER_SOURCE"?{preferredDocumentId:source}:{})})});onSaved();}catch(e){setError(e instanceof Error?e.message:"Could not save the decision.");}finally{setBusy(false);}}
  return <div className="knowledge-controls"><h3>Record a review decision</h3><p className="scope-note">This decision applies to the quoted proposition and source versions. It does not establish authority for every statement in either document.</p>
    <form className="knowledge-form" onSubmit={save}><label>Decision<select value={action} onChange={e=>setAction(e.target.value)}><option value="PREFER_SOURCE">Prefer a source for this claim</option><option value="DIFFERENT_SCOPE">Dismiss: different scope</option><option value="KEEP_UNRESOLVED">Keep unresolved / reopen</option></select></label>
      {action==="PREFER_SOURCE"&&<label>Applicable source<select required value={source} onChange={e=>setSource(e.target.value)}><option value="">Select the source</option>{[...new Map(sources.map(s=>[s.documentId,s])).values()].map(s=><option key={s.documentId} value={s.documentId}>{s.source}</option>)}</select></label>}
      <label className="full-field">Review explanation<textarea required minLength={10} maxLength={1000} value={explanation} onChange={e=>setExplanation(e.target.value)}/></label>
      <button className="button primary" disabled={busy||explanation.trim().length<10||(action==="PREFER_SOURCE"&&!source)}>{busy?"Saving…":"Save review decision"}</button>
    </form>{error&&<p role="alert" className="inline-note">{error}</p>}<AuditHistory path={`conflicts/${encodeURIComponent(id)}/decision-history`} label="Decision history"/>
  </div>;
}

export function AnswerVersionHistory({messageId,onCitation}:{messageId:string;onCitation?:(c:Citation)=>void}){
  const [versions,setVersions]=useState<{sequence:number;result:QueryResult;reason:string;createdAt:number}[]|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const [cursor,setCursor]=useState<string|null>(null),[latestSequence,setLatestSequence]=useState(0);
  async function load(next?:string){setBusy(true);setNotice("");try{const page=await request<{items:NonNullable<typeof versions>;nextCursor:string|null}>(`messages/${encodeURIComponent(messageId)}/version-history?limit=20${next?`&cursor=${encodeURIComponent(next)}`:""}`);if(!Array.isArray(page.items))throw new Error("Invalid answer history response.");if(!next)setLatestSequence(Math.max(...page.items.map(v=>v.sequence),0));setVersions(rows=>next?[...(rows||[]),...page.items].slice(-HISTORY_WINDOW):page.items);setCursor(page.nextCursor);}catch(e){setNotice(e instanceof Error?e.message:"Could not load answer versions.");}finally{setBusy(false);}}
  async function recheck(){setBusy(true);setNotice("");try{const job=await request<{queued:boolean;status:string;nextAt:number}>(`messages/${encodeURIComponent(messageId)}/revalidate`,{method:"POST",body:"{}"});setNotice(`${job.queued?"Revalidation scheduled":"No new job queued"}. Status: ${job.status.replaceAll("_"," ")}.${job.queued?` Next eligible run: ${new Date(job.nextAt).toLocaleString()}. Check background revalidation for progress.`:""}`);}catch(e){setNotice(e instanceof Error?e.message:"Could not request revalidation.");}finally{setBusy(false);}}
  return <div className="knowledge-controls"><div className="preview-actions"><button className="text-button" disabled={busy} onClick={()=>versions?setVersions(null):void load()}>{versions?"Hide answer versions":"View answer versions"}</button><button className="text-button" disabled={busy} onClick={()=>void recheck()}>Recheck current evidence</button></div>{notice&&<p role="status">{notice}</p>}{versions&&<p className="scope-note">Showing up to 100 versions at a time. Original answers are immutable. Latest recorded assessment: version {latestSequence}. An assessment may still contain unresolved claims.</p>}{versions&&[...versions].sort((a,b)=>b.sequence-a.sequence).map(v=><article className="correction-record" key={v.sequence}><div className="repair-heading"><strong>{v.sequence===0?"Original answer":`Revalidation ${v.sequence}${v.sequence===latestSequence?" - latest recorded":""}`}</strong><VerificationBadge result={v.result}/></div><p>{v.result.draft}</p><small>{new Date(v.createdAt).toLocaleString()} · {v.reason}</small>{onCitation&&v.result.citations.map(c=><button className="text-button" key={c.index} onClick={()=>onCitation(c)}>[{c.index}] {c.source}</button>)}</article>)}{versions&&<button className="text-button" disabled={busy} onClick={()=>void load()}>Newest answer versions</button>}{versions&&cursor&&<button className="text-button" disabled={busy} onClick={()=>void load(cursor)}>Load older answer versions</button>}<AuditHistory path={`messages/${encodeURIComponent(messageId)}/revalidation-history`} label="Revalidation audit history"/></div>;
}

export function RevalidationPanel({onCitation}:{onCitation:(c:Citation)=>void}){
  const [data,setData]=useState<{enabled:boolean;hourlyBudget:number;jobs:{id:string;messageId:string;question:string;status:string;error?:string;nextAt:number}[]}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function load(){setBusy(true);setError("");try{const next=await request<NonNullable<typeof data>>("revalidations");if(!Array.isArray(next.jobs))throw new Error("Could not read the revalidation queue.");setData(next);}catch(e){setError(e instanceof Error?e.message:"Could not read the queue.");}finally{setBusy(false);}}
  return <section className="knowledge-controls"><button className="button secondary" disabled={busy} onClick={()=>void load()}>{busy?"Loading…":"Refresh background revalidation"}</button>{error&&<p role="alert">{error}</p>}{data&&<><p className="scope-note">{data.enabled?`Automatic revalidation is enabled, limited to ${data.hourlyBudget} attempts per hour across this installation.`:"Automatic revalidation is paused by the server configuration."} Original answers remain unchanged. Latest 100 jobs.</p>{data.jobs.length?data.jobs.map(j=><article className="correction-record" key={j.id}><strong>{j.question}</strong><p>Status: {j.status.replaceAll("_"," ")}</p>{j.error&&<p>{j.error}</p>}{j.status==="retry_wait"&&<p>Next eligible retry: {new Date(j.nextAt).toLocaleString()}</p>}<AnswerVersionHistory messageId={j.messageId} onCitation={onCitation}/></article>):<p>No revalidation jobs have been recorded.</p>}</>}</section>;
}

export function AuditHistory({path,label}:{path:string;label:string}) {
  const [events,setEvents]=useState<{id:string;action:string;reason:string;createdAt:number;actorId?:string}[]|null>(null);
  const [cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function load(next?:string){setBusy(true);setError("");try{const page=await request<{items:NonNullable<typeof events>;nextCursor:string|null}>(path+"?limit=20"+(next?"&cursor="+encodeURIComponent(next):""));if(!Array.isArray(page.items))throw new Error("Invalid audit history response.");setEvents(rows=>next?[...(rows||[]),...page.items].slice(-HISTORY_WINDOW):page.items);setCursor(page.nextCursor);}catch(e){setError(e instanceof Error?e.message:"Could not load history.");}finally{setBusy(false);}}
  return <section><button className="text-button" disabled={busy} onClick={()=>void load()}>{label}</button>{error&&<p role="alert">{error}</p>}{events&&<p className="scope-note">Showing up to 100 events. Select {label.toLowerCase()} again to return to the newest.</p>}{events&&<ol>{events.length?events.map(e=><li key={e.id}><strong>{e.action.replaceAll("_"," ")}</strong><p>{e.reason}</p><small>{new Date(e.createdAt).toLocaleString()}{e.actorId?" - Account: "+e.actorId:""}</small></li>):<li>No audit events recorded.</li>}</ol>}{cursor&&<button className="text-button" disabled={busy} onClick={()=>void load(cursor)}>Load older audit events</button>}</section>;
}
