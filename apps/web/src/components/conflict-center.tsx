'use client';
import { useCallback, useEffect, useState } from 'react';
import { request, type Citation } from '../lib/api';
type Conflict = { id: string; question: string; claim: string; detectedAt: string; status: 'UNRESOLVED'; scope: { time: string | null; place: string | null }; reason: string; supporting: (Citation & { quote: string })[]; contradicting: (Citation & { quote: string })[] };
type Response = { coverage: 'saved_answer_assessments'; truncated: boolean; reviewedAnswers: number; records: Conflict[] };
export function ConflictCenter({ onCitation }: { onCitation: (citation: Citation) => void }) {
  const [data, setData] = useState<Response | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await request<Response>('conflicts')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load conflict records.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section className="conflict-records"><div className="card-title"><h2>Unresolved evidence</h2><button className="button secondary" disabled={loading} onClick={() => void load()}>Refresh conflicts</button></div><p className="muted">Conflicts found while checking saved answers. This is not a scan of your entire library. Source precedence is not inferred from upload order.</p>{loading && <p role="status">Loading conflict records…</p>}{error && <p role="alert">{error}</p>}{data && !error && <><p>{data.records.length} unresolved {data.records.length === 1 ? 'record' : 'records'} across {data.reviewedAnswers} recent answer assessments.{data.truncated && ' Older answers are outside this view.'}</p><label>Filter <select aria-label="Filter conflicts" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All unresolved</option><option value="temporal">With stated temporal scope</option><option value="unknown">Scope needs review</option></select></label>{!data.records.length && <p>No conflicts were recorded in these answer assessments. This does not establish that all sources agree.</p>}{data.records.filter(c => filter === 'all' || (filter === 'temporal' ? c.scope.time : !c.scope.time)).map(conflict => <article className="conflict-record" key={conflict.id}><span className="badge amber">Unresolved · human review needed</span><h3>{conflict.claim}</h3><p>Question: {conflict.question}</p><p className="muted">Model-assessed scope: {conflict.scope.time || 'time unknown'} · {conflict.scope.place || 'place unknown'}</p><div className="conflict-sides">{[{ name: 'Supporting passage', refs: conflict.supporting }, { name: 'Contradicting passage', refs: conflict.contradicting }].map(side => <div key={side.name}><strong>{side.name}</strong>{side.refs.map((source, i) => <section key={`${source.index}-${i}`}><blockquote>{source.quote}</blockquote><button className="text-button" onClick={() => onCitation(source)}>[{source.index}] {source.source}</button><p className="muted">Version: {source.version || 'not supplied'}</p></section>)}</div>)}</div><p>{conflict.reason}</p><small>Recorded {new Date(conflict.detectedAt).toLocaleString()}. The original evidence remains in the answer history.</small></article>)}</>}</section>;
}
