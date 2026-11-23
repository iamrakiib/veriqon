import type { Evidence, EvidenceQuote, Verification } from './verification';

export type ReviewDecision = {
  id:string; action:'PREFER_SOURCE'|'DIFFERENT_SCOPE'; claim:string;
  scope:{time:string|null;place:string|null}; preferredDocumentId?:string;
  sources:{documentId:string;version:string;quote:string;snapshotId?:string}[];
};
const normalized=(value:string|null)=>value?.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim() || '';
const sameScope=(a:ReviewDecision['scope'],b:ReviewDecision['scope'])=>normalized(a.time)===normalized(b.time)&&normalized(a.place)===normalized(b.place);

/** Input decisions come only from the authenticated database, never model output. */
export function applyReviewDecisions(check:Verification,docs:Evidence[],decisions:ReviewDecision[]):Verification {
  if (!check.schemaValid || !decisions.length) return check;
  const matched=(claim:string,scope:ReviewDecision['scope'],quotes:EvidenceQuote[])=>decisions.filter(d=>normalized(d.claim)===normalized(claim)&&sameScope(d.scope,scope)
    && d.sources.length===quotes.length && d.sources.every(s=>quotes.some(q=>{
      const source=docs[q.index-1];return source?.id===s.documentId&&source.version===s.version&&source.snapshotId===s.snapshotId&&q.quote===s.quote;
    })));
  const applied:{id:string;claim:string;action:ReviewDecision['action']}[]=[];
  // Exact proposition/quote matching is intentionally conservative. A decision
  // cannot promote a merely similar claim or change unrelated statements.
  const atomicClaims=check.atomicClaims?.map(claim=>{
    if (!['SUPPORTED','CONFLICTED','CONTRADICTED'].includes(claim.verdict)) return claim;
    const clean=(text:string)=>normalized(text.replace(/\[\d+\]/g,'')).replace(/[.!?]$/,'');
    const matches=decisions.filter(d=>d.action==='PREFER_SOURCE' && sameScope(d.scope,claim.scope)
      && d.sources.some(s=>clean(s.quote)===clean(claim.text))
      && d.sources.every(s=>docs.some(doc=>doc.id===s.documentId&&doc.version===s.version&&doc.snapshotId===s.snapshotId&&doc.text.includes(s.quote))));
    if (!matches.length || new Set(matches.map(d=>d.preferredDocumentId)).size!==1) return claim;
    const decision=matches[0], selected=decision.sources.filter(s=>s.documentId===decision.preferredDocumentId).map(s=>({index:docs.findIndex(doc=>doc.id===s.documentId&&doc.version===s.version&&doc.snapshotId===s.snapshotId&&doc.text.includes(s.quote))+1,quote:s.quote}));
    if (!selected.length) return claim;
    const supported=selected.some(q=>clean(q.quote)===clean(claim.text));
    // Only an exact assertion on the rejected side establishes the repair target.
    if (!supported && ![...claim.supporting,...claim.contradicting].some(q=>docs[q.index-1]?.id!==decision.preferredDocumentId&&clean(q.quote)===clean(claim.text))) return claim;
    applied.push({id:decision.id,claim:claim.text,action:decision.action});
    return {...claim,verdict:supported?'SUPPORTED' as const:'CONTRADICTED' as const,supporting:supported?selected:[],contradicting:supported?[]:selected,recommendedAction:supported?'PRESERVE' as const:'REPAIR' as const};
  });
  const sourceConflicts=(check.sourceConflicts || []).filter(c=>{
    const matches=matched(c.claim,c.scope,[...c.supporting,...c.contradicting]);
    // Competing human decisions remain unresolved; never select the newest silently.
    if (!matches.length || new Set(matches.map(d=>`${d.action}:${d.preferredDocumentId || ''}`)).size!==1) return true;
    const decision=matches[0];
    if (decision.action==='PREFER_SOURCE') {
      // Do not remove a conflict while an answer claim still relies on its losing quote.
      const losing=decision.sources.filter(s=>s.documentId!==decision.preferredDocumentId);
      if ((atomicClaims || []).some(claim=>claim.supporting.some(q=>losing.some(s=>docs[q.index-1]?.id===s.documentId&&q.quote===s.quote)))) return true;
    }
    applied.push({id:decision.id,claim:c.claim,action:decision.action});return false;
  });
  if (!applied.length) return check;
  const claims=check.claims.map((sentence,i)=>{
    const facts=atomicClaims?.filter(c=>c.sentenceId===i+1) || [];
    return facts.length?{...sentence,supported:facts.every(c=>c.verdict==='SUPPORTED'),evidenceIndexes:[...new Set(facts.flatMap(c=>c.supporting.map(q=>q.index)))]}:sentence;
  });
  const passed=!sourceConflicts.length&&Boolean(atomicClaims?.length)&&atomicClaims!.every(c=>c.verdict==='SUPPORTED');
  return {...check,claims,atomicClaims,sourceConflicts,passed,appliedDecisions:applied,verdict:passed?'Supported under recorded source review':check.verdict};
}
