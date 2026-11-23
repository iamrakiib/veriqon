import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { chunkText } from '../common/utils';
import { DatabaseService } from '../database/database.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { RevalidationService } from '../rag/revalidation.service';
import { RagService } from '../rag/rag.service';
import { temporalScope, validateMetadata } from '../rag/temporal';
import type { EvidenceConflict } from '../rag/conflicts';
import { parseClaimVerification, parseSourceConflicts, type Verification } from '../rag/verification';
import { applyReviewDecisions, type ReviewDecision } from '../rag/source-decisions';

async function fixture() {
  const previous = { ...process.env }, schema = 'test_' + randomUUID().replace(/-/g, '');
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: ':memory:', OPENROUTER_API_KEY: 'fixture-only', EMBEDDING_MODEL: 'fixture-embedding', REVALIDATION_PER_HOUR: '100' });
  delete process.env.DATABASE_URL; delete process.env.REDIS_URL;
  const admin = process.env.TEST_DATABASE_URL ? new Pool({ connectionString: process.env.TEST_DATABASE_URL }) : undefined;
  if (admin) {
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector'); await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema},public`); process.env.DATABASE_URL = url.toString();
  }
  const db = new DatabaseService(); await db.initialize();
  for (const id of ['a','b']) await db.run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', id, `${id}@example.test`, id, 'unused', 'member', Date.now());
  const store = new VectorStoreService(db); store.getEmbedding = async () => [1, 0];
  async function doc(id: string, text: string, owner = 'a') {
    const version = 'sha256:' + createHash('sha256').update(text).digest('hex');
    await db.writeDocument(owner, { id, text, embeddingModel: store.embeddingConfig.identity, chunks: [{ chunkId: id + '#0', index: 0, source: id + '.txt', version, content: text, embedding: [1,0] }] });
    return version;
  }
  return { db, store, doc, close: async () => { await db.onModuleDestroy(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } process.env = previous; } };
}

test('metadata rejects invalid dates, cross-owner sources, lost updates and supersession cycles', async () => {
  const f = await fixture();
  try {
    await f.doc('old', 'Three remote days.'); await f.doc('new', 'One remote day.'); await f.doc('private', 'Private source.', 'b');
    assert.throws(() => validateMetadata({ effectiveFrom: '2026-02-30' }));
    await assert.rejects(f.db.updateMetadata('a','private',{},0,'Authorized test explanation'));
    await f.db.updateMetadata('a','old',{ effectiveFrom: '2024-01-01', scope:'Engineering' },0,'Approved historical source metadata');
    await assert.rejects(f.db.updateMetadata('a','old',{},0,'Stale editor update must fail'));
    await f.db.updateMetadata('a','new',{ effectiveFrom:'2025-01-01',scope:'Engineering',supersedes:'old' },0,'Approved replacement policy source');
    await assert.rejects(f.db.updateMetadata('a','old',{ effectiveFrom:'2024-01-01',scope:'Engineering',supersedes:'new' },1,'A circular relationship must fail'));
    assert.equal((await f.db.knowledgeEvents('a','old')).length, 1);
    assert.equal((await f.db.knowledgeEvents('b','old')).length, 0);
    assert.ok((await f.db.documentVersions('a','old')).length >= 2);
  } finally { await f.close(); }
});

test('same-ID replacements retain retrievable historical text and isolate version windows', async () => {
  const f = await fixture();
  try {
    const old = await f.doc('policy', 'In 2024 Engineering permits three remote days.');
    await f.db.updateMetadata('a','policy',{ effectiveFrom:'2024-01-01',effectiveTo:'2024-12-31',scope:'Engineering' },0,'Confirmed original effective period');
    const current = await f.doc('policy','In 2026 Engineering permits one remote day.');
    const meta = await f.db.metadata('a','policy');
    await f.db.updateMetadata('a','policy',{effectiveFrom:'2026-01-01',scope:'Engineering'},meta.revision,'Confirmed replacement effective period');
    const historical = await f.store.search('Engineering remote days in 2024?',5,undefined,'a');
    assert.equal(historical.length,1); assert.equal(historical[0].version,old);
    assert.match(historical[0].text,/three remote days/); assert.doesNotMatch(historical[0].text,/one remote day/);
    const now = await f.store.search('Engineering remote days currently?',5,undefined,'a');
    assert.equal(now.length,1); assert.equal(now[0].version,current);
    const both = await f.store.search('Compare Engineering remote days in 2024 and 2026?',5,undefined,'a');
    assert.deepEqual(new Set(both.map(d=>d.version)),new Set([old,current]));
    assert.equal(both.length,2,'Distinct versions must not share covered chunk indexes or merged windows');
    assert.deepEqual(await f.store.search('Engineering remote days in 2024?',5,undefined,'b'),[]);
  } finally { await f.close(); }
});

test('replacement content cannot inherit the previous version effective dates', async () => {
  const f=await fixture();
  try {
    await f.doc('policy','Old policy.');
    await f.db.updateMetadata('a','policy',{effectiveFrom:'2024-01-01',effectiveTo:'2024-12-31'},0,'Confirmed original period metadata');
    await f.doc('policy','Replacement policy without established dates.');
    const meta=await f.db.metadata('a','policy');
    assert.deepEqual(meta.metadata,{}); assert.equal(meta.revision,2,'Do not reset the concurrency fence');
    await assert.rejects(f.db.updateMetadata('a','policy',{},1,'Stale editor for original content'));
  } finally { await f.close(); }
});

test('archived supersession applies to historical and selected-source queries without widening evidence scope', async () => {
  const f=await fixture();
  try {
    await f.doc('old','Engineering remote work permits three days.');
    await f.db.updateMetadata('a','old',{effectiveFrom:'2023-01-01',scope:'Engineering'},0,'Established original policy period');
    const historical=await f.doc('replacement','Engineering remote work permits one day.');
    await f.db.updateMetadata('a','replacement',{effectiveFrom:'2024-01-01',effectiveTo:'2024-12-31',scope:'Engineering',supersedes:'old'},0,'Explicit approved historical supersession');
    await f.doc('replacement','Engineering remote work permits two days in 2026.');
    await f.db.updateMetadata('a','replacement',{effectiveFrom:'2026-01-01',scope:'Engineering'},2,'Established current replacement period');
    const past=await f.store.search('Engineering remote policy in 2024?',5,undefined,'a');
    assert.deepEqual(past.map(d=>d.version),[historical]);
    assert.deepEqual(await f.store.search('Engineering remote policy in 2024?',5,undefined,'a',['old']),[], 'An outside-focus archived superseder suppresses an obsolete source without adding outside-focus text');
    assert.deepEqual((await f.store.search('Engineering remote policy in 2023?',5,undefined,'a')).map(d=>d.id),['old']);
    const comparison=await f.store.search('Compare Engineering remote policy in 2023 and 2024?',5,undefined,'a');
    assert.deepEqual(new Set(comparison.map(d=>d.id)),new Set(['old','replacement']),'Partial-period supersession must not erase the earlier policy');
    await f.doc('old','Sales remote policy permits four days in 2026.');
    await f.db.updateMetadata('a','old',{effectiveFrom:'2026-01-01',scope:'Sales'},2,'Current source describes a different department');
    const archivedBoth=await f.store.search('Engineering remote policy in 2024?',5,undefined,'a');
    assert.deepEqual(archivedBoth.map(d=>d.version),[historical],'Compare historical scopes, not the target document current scope');
    assert.deepEqual(await f.store.search('Engineering remote policy in 2024?',5,undefined,'b'),[]);
  } finally { await f.close(); }
});

test('archived source selection uses the latest metadata revision, not a withdrawn precedence rule', async () => {
  const f=await fixture();
  try {
    await f.doc('old','Engineering remote policy allows three days.');
    await f.db.updateMetadata('a','old',{effectiveFrom:'2023-01-01',scope:'Engineering'},0,'Original Engineering effective date');
    const version=await f.doc('new','Engineering remote policy allows one day.');
    await f.db.updateMetadata('a','new',{effectiveFrom:'2024-01-01',scope:'Engineering',supersedes:'old'},0,'Initially approved source precedence');
    await f.db.updateMetadata('a','new',{effectiveFrom:'2024-01-01',effectiveTo:'2024-12-31',scope:'Engineering'},1,'Review withdrew the unsupported supersession');
    await f.doc('new','Engineering remote policy allows two days in 2026.');
    await f.db.updateMetadata('a','new',{effectiveFrom:'2026-01-01',scope:'Engineering'},3,'Established replacement effective period');
    const evidence=await f.store.search('Engineering remote policy in 2024?',5,undefined,'a');
    assert.deepEqual(new Set(evidence.map(d=>d.id)),new Set(['old','new']));
    const archived=evidence.find(d=>d.version===version)!;
    assert.equal(archived.metadata?.supersedes,undefined);
    assert.equal(archived.metadata?.effectiveTo,'2024-12-31');
    const snapshot=await f.db.documentVersion('a','new',archived.snapshotId!);
    assert.equal(snapshot.metadataRevision,2);
  } finally { await f.close(); }
});

test('archive descriptor and payload count limits fail explicitly and respect selected sources', async()=>{
  const f=await fixture();
  try {
    await f.doc('overflow','Current policy.');await f.doc('selected','Selected current policy.');
    const add=async(from:number,to:number)=>f.db.transaction(async()=>{
      for(let i=from;i<to;i++) {
        const text=`Historical policy ${i}.`;
        const snapshot={id:'overflow',text,version:`v${i}`,metadata:{effectiveFrom:'2024-01-01'},metadataRevision:1,chunks:[{chunk_index:0,content:text}]};
        await f.db.run('INSERT INTO document_versions VALUES(?,?,?,?,?)','a','overflow',`version-${i}`,JSON.stringify(snapshot),i);
      }
    });
    await add(0,101);
    await assert.rejects(f.db.historicalDocuments('a',temporalScope('Policy in 2024')),/Too many applicable archived versions/);
    await add(101,1001);
    await assert.rejects(f.db.historicalSources('a',temporalScope('Policy in 2024')),/Too many applicable archived relationships/);
    assert.deepEqual(await f.db.historicalDocuments('a',temporalScope('Policy in 2024'),['selected']),[]);
    assert.deepEqual(await f.db.historicalSources('b',temporalScope('Policy in 2024')),[]);
  } finally { await f.close(); }
});

test('a historical content version label cannot be reused for different text', async () => {
  const f=await fixture();
  const write=(text:string,version:string)=>f.db.writeDocument('a',{id:'policy',text,chunks:[{chunkId:'policy#0',index:0,content:text,version,embedding:[1,0]}]});
  try {
    await write('Original policy.','release-1');
    await write('Revised policy.','release-2');
    await assert.rejects(write('Different content using the original label.','release-1'),/content version/i);
    assert.equal((await f.db.get('SELECT text FROM documents WHERE owner_id=? AND id=?','a','policy'))?.text,'Revised policy.');
  } finally { await f.close(); }
});

test('historical retrieval rejects an oversized archive window before loading snapshot payloads', async () => {
  const f=await fixture();
  try {
    await f.doc('large-history','Current policy.');
    await f.db.transaction(async()=>{
      for(let i=0;i<9;i++) {
        const text='ARCHIVE_PAYLOAD '+ 'a'.repeat(490000)+i;
        const snapshot={id:'large-history',text,version:`v${i}`,metadata:{effectiveFrom:'2024-01-01',effectiveTo:'2024-12-31'},metadataRevision:i,chunks:chunkText(text).map((content,chunk_index)=>({chunk_index,content}))};
        await f.db.run('INSERT INTO document_versions VALUES(?,?,?,?,?)','a','large-history',`snapshot-${i}`,JSON.stringify(snapshot),i);
      }
    });
    const all=f.db.all.bind(f.db);let loadedPayload=false;
    f.db.all=async(...args)=>{const rows=await all(...args); if(rows.some(r=>typeof r.snapshot==='string'&&r.snapshot.includes('ARCHIVE_PAYLOAD'))) loadedPayload=true;return rows;};
    await assert.rejects(f.db.historicalDocuments('a',temporalScope('Policy in 2024')),/archive.*budget/i);
    assert.equal(loadedPayload,false,'Reject from byte metadata before materializing archive text in Node');
  } finally { await f.close(); }
});

test('conflict review reads only referenced sources and hashes legacy versions on demand', async () => {
  const f = await fixture();
  try {
    const av = await f.doc('a-policy', 'Remote work is permitted three days per week.');
    const bv = await f.doc('b-policy', 'Remote work is permitted one day per week.');
    await f.doc('unrelated', 'PRIVATE_UNRELATED_TEXT '.repeat(1000));
    // Existing legacy rows without a stored content hash remain supported.
    await f.db.run('UPDATE documents SET version=NULL WHERE owner_id=? AND id=?', 'a', 'a-policy');
    const sources = [{documentId:'a-policy',source:'a-policy.txt',version:av,quote:'Remote work is permitted three days per week.',index:1,excerpt:'three days',chunkIndex:0},
      {documentId:'b-policy',source:'b-policy.txt',version:bv,quote:'Remote work is permitted one day per week.',index:2,excerpt:'one day',chunkIndex:0}];
    await f.db.persistConflict('a', {id:'bounded-review',messageId:'m',conversationId:'c',question:'Remote days?',detectedAt:new Date().toISOString(),claim:'Remote days',status:'UNRESOLVED',scope:{time:null,place:null},temporalValidity:'UNKNOWN',reason:'Same scope disagreement',supporting:[sources[0]],contradicting:[sources[1]]});
    const all = f.db.all.bind(f.db); const transferred: string[] = [];
    f.db.all = async (...args) => { const rows = await all(...args); transferred.push(JSON.stringify(rows)); return rows; };
    const result = await f.db.conflictRecords('a');
    assert.equal(result.records[0].stale, false);
    assert.ok(!transferred.some(row => row.includes('PRIVATE_UNRELATED_TEXT')), 'Unreferenced document text must not cross the SQL boundary');
  } finally { await f.close(); }
});

test('version and event pages are bounded, stable across timestamp ties, and owner scoped', async () => {
  const f = await fixture();
  try {
    await f.doc('policy', 'Original policy text.');
    for (let i=0;i<6;i++) await f.db.updateMetadata('a','policy',{scope:`Department ${i}`},i,'Approved explicit department metadata');
    await f.db.run('UPDATE document_versions SET recorded_at=42 WHERE owner_id=?','a');
    await f.db.run('UPDATE knowledge_events SET created_at=42 WHERE owner_id=?','a');
    const versions:string[]=[],events:string[]=[];
    for (let cursor:string|undefined;;) {
      const page=await f.db.documentVersionPage('a','policy',2,cursor);
      assert.ok(page.items.length<=2); assert.ok(!JSON.stringify(page).includes('Original policy text'));
      versions.push(...page.items.map(v=>v.versionId));
      if (!page.nextCursor) break; cursor=page.nextCursor;
    }
    for (let cursor:string|undefined;;) {
      const page=await f.db.knowledgeEventPage('a','policy',2,cursor);
      events.push(...page.items.map(e=>e.id));
      assert.ok(page.items.every(e=>e.actorId==='a'&&e.reason.length>10));
      if (!page.nextCursor) break; cursor=page.nextCursor;
    }
    assert.equal(versions.length,7); assert.equal(new Set(versions).size,7);
    assert.equal(events.length,6); assert.equal(new Set(events).size,6);
    assert.equal((await f.db.documentVersion('a','policy',versions[0])).text,'Original policy text.');
    await assert.rejects(f.db.documentVersionPage('b','policy'));
    await assert.rejects(f.db.documentVersion('b','policy',versions[0]));
    assert.deepEqual((await f.db.knowledgeEventPage('b','policy')).items,[]);
    await assert.rejects(f.db.documentVersionPage('a','policy',51));
    await assert.rejects(f.db.documentVersionPage('a','policy',2,'invalid'));
    await f.db.run('DELETE FROM documents WHERE owner_id=? AND id=?','a','policy');
    await assert.rejects(f.db.documentVersion('a','policy',versions[0]));
    assert.deepEqual(await f.db.historicalDocuments('a',temporalScope('Policy in 2024')),[]);
  } finally { await f.close(); }
});

test('named candidate retrieval never loads unselected document payloads', async () => {
  const f=await fixture();
  try {
    await f.doc('selected','Engineering remote work policy.');
    await f.doc('other','UNSELECTED_PAYLOAD '.repeat(1000));
    await f.doc('private','OTHER_ACCOUNT_PAYLOAD','b');
    const all=f.db.all.bind(f.db), transferred:string[]=[];
    f.db.all=async(...args)=>{const rows=await all(...args);transferred.push(JSON.stringify(rows));return rows;};
    const records=await f.db.candidateDocuments('a',[1,0],f.store.embeddingConfig.identity,5,'remote policy',['selected']);
    assert.deepEqual(records.map(r=>r.id),['selected']);
    assert.ok(!transferred.some(r=>r.includes('UNSELECTED_PAYLOAD')||r.includes('OTHER_ACCOUNT_PAYLOAD')));
  } finally { await f.close(); }
});

test('review decisions cannot resolve different propositions, scope, source versions or paraphrased evidence', () => {
  const a='Remote work is permitted three days per week.', b='Remote work is permitted one day per week.';
  const docs=[{id:'a',version:'v1',text:a,chunkIndex:0},{id:'b',version:'v2',text:b,chunkIndex:0}];
  const scope={time:null,place:'Engineering'};
  const check=parseClaimVerification(JSON.stringify({sentences:[{id:1,kind:'FACTUAL',claims:[{text:a,span:a,verdict:'SUPPORTED',supporting:[{index:1,quote:a}],contradicting:[],missingInformation:[],temporalValidity:'UNKNOWN',scope}]}]}),a,docs);
  const decision:ReviewDecision={id:'d',action:'PREFER_SOURCE',claim:'Remote work days',scope,preferredDocumentId:'b',sources:[{documentId:'a',version:'v1',quote:a},{documentId:'b',version:'v2',quote:b}]};
  const corrected=applyReviewDecisions(check,docs,[decision]);
  assert.equal(corrected.atomicClaims![0].verdict,'CONTRADICTED');
  assert.deepEqual(corrected.atomicClaims![0].contradicting,[{index:2,quote:b}]);
  assert.equal(corrected.passed,false,'A decision alone cannot verify the losing assertion');
  for (const changed of [ {...decision,scope:{time:null,place:'Sales'}},
    {...decision,sources:[{...decision.sources[0],version:'new'},decision.sources[1]]},
    {...decision,sources:[{...decision.sources[0],quote:'Vacation days are twenty.'},decision.sources[1]]} ]) {
    assert.equal(applyReviewDecisions(check,docs,[changed]),check);
  }
  assert.equal(applyReviewDecisions(check,docs,[decision,{...decision,id:'other',preferredDocumentId:'a'}]),check);
  const comparison={...check,atomicClaims:[],passed:false,sourceConflicts:[{id:'c',claim:'Vacation allowance',supporting:[{index:1,quote:a}],contradicting:[{index:2,quote:b}],scope,reason:'disagreement',scopeRelation:'SAME' as const,periodRelation:'OVERLAPPING' as const}]};
  assert.equal(applyReviewDecisions(comparison,docs,[decision]),comparison);
});

test('reviewed precedence resolves only matching source quotes and retains unrelated supported evidence', async () => {
  const f=await fixture();
  try {
    const a='Remote work is permitted three days per week. Benefits include twenty vacation days.';
    const b='Remote work is permitted one day per week.';
    const av=await f.doc('a-policy',a),bv=await f.doc('b-policy',b);
    const sources=[{documentId:'a-policy',version:av,quote:'Remote work is permitted three days per week.',index:1,excerpt:a,source:'a-policy.txt',chunkIndex:0},
      {documentId:'b-policy',version:bv,quote:b,index:2,excerpt:b,source:'b-policy.txt',chunkIndex:0}];
    const conflict: EvidenceConflict={id:'reviewed',messageId:'m',conversationId:'c',question:'Remote days?',detectedAt:new Date().toISOString(),claim:'Remote work days',status:'UNRESOLVED',scope:{time:null,place:'Engineering'},temporalValidity:'UNKNOWN',reason:'Same scope disagreement',supporting:[sources[0]],contradicting:[sources[1]]};
    await f.db.persistConflict('a',conflict);
    await f.db.decideConflict('a',conflict.id,{action:'PREFER_SOURCE',preferredDocumentId:'b-policy',explanation:'Owner approved the quoted remote policy.',expectedRevision:1});
    const evidence=sources.map(s=>({id:s.documentId,version:s.version,source:s.source,text:s.excerpt,chunkIndex:0,chunkEndIndex:0,score:1,retrievalMode:'hybrid' as const}));
    const original=b+' Benefits include twenty vacation days.';
    const check: Verification=parseClaimVerification(JSON.stringify({sentences:[b,'Benefits include twenty vacation days.'].map((text,i)=>({id:i+1,kind:'FACTUAL',claims:[{text,span:text,verdict:'SUPPORTED',supporting:[{index:i===0?2:1,quote:text}],contradicting:[],missingInformation:[],temporalValidity:'UNKNOWN',scope:conflict.scope}]}))}),original,evidence);
    check.sourceConflicts=[{id:'comparison',claim:conflict.claim,supporting:[{index:1,quote:sources[0].quote}],contradicting:[{index:2,quote:b}],scope:conflict.scope,reason:'Sources disagree',scopeRelation:'SAME',periodRelation:'OVERLAPPING'}]; check.passed=false;
    const rag=new RagService(f.store); f.store.search=async()=>evidence;
    const review=f.store.reviewDecisions.bind(f.store);let decisionReads=0;
    f.store.reviewDecisions=async(...args)=>{decisionReads++;return review(...args);};
    rag.generateAnswer=async()=>original; rag.factCheck=async()=>structuredClone(check);
    const result=await rag.queryPipeline('How many remote days and vacation days?', 'a');
    assert.equal(result.verificationStatus,'VERIFIED_UNCHANGED'); assert.equal(result.draft,original);
    assert.equal(result.citations.length,2,'A claim decision must not hide other evidence in the losing document');
    const cached=await rag.queryPipeline('How many remote days and vacation days?', 'a');
    assert.equal(cached.cache.kind,'exact');assert.equal(decisionReads,1,'Revision-valid cache hits do not reread decisions');

    const wrong=sources[0].quote+' Benefits include twenty vacation days.';
    const repair=new RagService(f.store);let generated=0;
    repair.generateAnswer=async()=>++generated===1?wrong:original;
    const checked:string[]=[];
    repair.factCheck=async(text)=>{
      checked.push(text);const first=text.startsWith(b)?b:sources[0].quote;
      const verdict=parseClaimVerification(JSON.stringify({sentences:[first,'Benefits include twenty vacation days.'].map((fact,i)=>({id:i+1,kind:'FACTUAL',claims:[{text:fact,span:fact,verdict:'SUPPORTED',supporting:[{index:i===0&&first===b?2:1,quote:fact}],contradicting:[],missingInformation:[],temporalValidity:'UNKNOWN',scope:conflict.scope}]}))}),text,evidence);
      verdict.sourceConflicts=structuredClone(check.sourceConflicts);verdict.passed=false;return verdict;
    };
    const corrected=await repair.queryPipeline('What is the approved remote work and vacation policy?', 'a');
    assert.equal(corrected.verificationStatus,'REPAIRED_VERIFIED');
    assert.match(corrected.draft,/one day per week/);assert.match(corrected.draft,/twenty vacation days/);
    assert.equal(corrected.correction?.original,wrong);
    assert.ok(checked.includes(wrong)&&checked.some(text=>text.startsWith(b)),'Both original and revised assertions are verified');
  } finally { await f.close(); }
});

test('temporal retrieval uses explicit effective dates and supersession, never upload order', async () => {
  const f = await fixture();
  try {
    await f.doc('old','In 2024 Engineering permits three remote days.'); await f.doc('new','In 2025 Engineering permits one remote day.');
    await f.db.updateMetadata('a','old',{ effectiveFrom:'2024-01-01',scope:'Engineering' },0,'Approved historical policy dates');
    await f.db.updateMetadata('a','new',{ effectiveFrom:'2025-01-01',scope:'Engineering',supersedes:'old' },0,'Approved policy supersession');
    assert.deepEqual((await f.store.search('How many remote days in 2024?',5,undefined,'a')).map(d => d.id), ['old']);
    assert.deepEqual((await f.store.search('How many remote days currently?',5,undefined,'a')).map(d => d.id), ['new']);
    assert.deepEqual((await f.store.search('According to old.txt, how many remote days?',5,undefined,'a')).map(d => d.id), ['old']);
    assert.deepEqual(await f.store.search('How many remote days?',5,undefined,'b'), []);
    assert.equal(temporalScope('What is dataset 2024?').kind,'current');
    assert.equal(temporalScope('Which policy?', '2024-07-01').kind,'date');
  } finally { await f.close(); }
});

test('conflict decisions are owner-scoped, concurrent-safe, auditable and invalidated by metadata changes', async () => {
  const f = await fixture();
  try {
    const av = await f.doc('a-policy','Remote work is permitted three days per week.'), bv = await f.doc('b-policy','Remote work is permitted one day per week.');
    const citation = (id: string, version: string, quote: string, index: number) => ({ documentId: id, version, quote, index, excerpt: quote, source: id + '.txt', chunkIndex: 0 });
    const conflict: EvidenceConflict = { id:'conflict', messageId:'answer',conversationId:'conversation', question:'How many days?',detectedAt:new Date().toISOString(),claim:'Remote work days',status:'UNRESOLVED',scope:{time:null,place:'Engineering'},temporalValidity:'UNKNOWN',reason:'Overlapping source disagreement',
      supporting:[citation('a-policy',av,'Remote work is permitted three days per week.',1)],contradicting:[citation('b-policy',bv,'Remote work is permitted one day per week.',2)] };
    await f.db.persistConflict('a',conflict);
    const decision = { action:'PREFER_SOURCE' as const, preferredDocumentId:'b-policy', explanation:'The library owner approved this source.', expectedRevision:1 };
    await assert.rejects(f.db.decideConflict('b','conflict',decision));
    const competing=await Promise.allSettled([f.db.decideConflict('a','conflict',decision),f.db.decideConflict('a','conflict',decision)]);
    assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(competing.filter(r=>r.status==='rejected').length,1);
    await assert.rejects(f.db.decideConflict('a','conflict',decision));
    assert.equal((await f.db.reviewDecisions('a')).length,1);
    assert.equal((await f.db.knowledgeEvents('a','conflict')).length,1);
    await f.db.transaction(async()=>{
      for(let i=0;i<201;i++) await f.db.run('INSERT INTO evidence_conflicts(owner_id,id,payload,created_at,updated_at) VALUES(?,?,?,?,?)','a',`newer-${i}`,JSON.stringify({...conflict,id:`newer-${i}`}),Date.now()+1000,Date.now()+1000);
    });
    assert.equal((await f.db.reviewDecisions('a')).length,1,'An active decision must not disappear behind newer unresolved display records');
    const refs=[{documentId:'a-policy',version:av},{documentId:'b-policy',version:bv}];
    assert.equal((await f.db.reviewDecisions('a',refs)).length,1);
    assert.deepEqual(await f.db.reviewDecisions('a',refs.slice(0,1)),[],'All decision sources must be present');
    assert.deepEqual(await f.db.reviewDecisions('a',[refs[0],{...refs[1],version:'different-version'}]),[]);
    assert.deepEqual(await f.db.reviewDecisions('b',refs),[]);
    await f.db.run("UPDATE evidence_conflicts SET status='RESOLVED' WHERE owner_id=? AND id<>?",'a','conflict');
    await assert.rejects(f.db.reviewDecisions('a',refs),/More than 200/,'Never silently omit matching conflicting decisions');
    await f.db.run("UPDATE evidence_conflicts SET status='UNRESOLVED' WHERE owner_id=? AND id<>?",'a','conflict');
    await f.db.updateMetadata('a','b-policy',{scope:'Sales'},0,'Corrected the policy department');
    assert.equal((await f.db.reviewDecisions('a')).length,0);
    assert.equal((await f.db.conflictRecords('a')).records[0].status,'UNRESOLVED');
  } finally { await f.close(); }
});

test('clearing conflict history is atomic, owner-scoped, revision-fenced and preserves active decisions', async () => {
  const f = await fixture();
  try {
    const av = await f.doc('policy-a','Three days.'), bv = await f.doc('policy-b','One day.');
    const conflict: EvidenceConflict = { id:'reviewed', messageId:'answer',conversationId:'conversation',question:'Days?',detectedAt:new Date().toISOString(),claim:'Remote days',status:'UNRESOLVED',scope:{time:null,place:'Engineering'},temporalValidity:'UNKNOWN',reason:'Conflicting policy values',
      supporting:[{index:1,documentId:'policy-a',source:'policy-a.md',version:av,chunkIndex:0,quote:'Three days.',excerpt:'Three days.'}],
      contradicting:[{index:2,documentId:'policy-b',source:'policy-b.md',version:bv,chunkIndex:0,quote:'One day.',excerpt:'One day.'}] };
    await f.db.persistConflict('a',conflict);
    await f.db.persistConflict('b',{...conflict,id:'private'});
    await f.db.decideConflict('a',conflict.id,{action:'PREFER_SOURCE',preferredDocumentId:'policy-b',explanation:'Owner confirmed the approved policy.',expectedRevision:1});
    const revision = (await f.db.get('SELECT document_revision FROM users WHERE id=?','a'))!.document_revision;
    await assert.rejects(f.db.archiveConflicts('b',[{id:'reviewed',expectedRevision:2}]),/not found/);
    await assert.rejects(f.db.archiveConflicts('a',[{id:'reviewed',expectedRevision:1}]),/changed/);
    await assert.rejects(f.db.archiveConflicts('a',[{id:'reviewed',expectedRevision:2},{id:'private',expectedRevision:1}]),/not found/);
    assert.equal((await f.db.conflictRecords('a')).records.length,1,'A failed batch must not clear its earlier valid entries');
    await assert.rejects(f.db.archiveConflicts('a',[]));
    await assert.rejects(f.db.archiveConflicts('a',[{id:'reviewed',expectedRevision:2},{id:'reviewed',expectedRevision:2}]));
    await f.db.archiveConflicts('a',[{id:'reviewed',expectedRevision:2}]);
    await f.db.archiveConflicts('a',[{id:'reviewed',expectedRevision:2}]);
    assert.equal((await f.db.conflictRecords('a',[conflict])).records.length,0,'Saved answer extraction must not resurrect cleared history');
    assert.equal((await f.db.reviewDecisions('a')).length,1,'Clearing display history must not revoke a source decision');
    assert.equal((await f.db.get('SELECT document_revision FROM users WHERE id=?','a'))!.document_revision,revision,'Display-only clearing must not invalidate answers or enqueue revalidation');
    assert.equal((await f.db.knowledgeEvents('a','reviewed')).filter(e=>e.action==='CONFLICT_ARCHIVED').length,1,'Retries are idempotent');
    assert.equal((await f.db.knowledgeEvents('a','reviewed')).filter(e=>e.action==='CONFLICT_DECISION').length,1);
    assert.equal((await f.db.conflictRecords('b')).records.length,1);
    const legacy = {...conflict,id:'legacy'};
    await f.db.archiveConflicts('a',[{id:'legacy',expectedRevision:0}],[legacy]);
    await f.db.archiveConflicts('a',[{id:'legacy',expectedRevision:0}],[legacy]);
    assert.equal((await f.db.conflictRecords('a',[legacy,conflict])).records.length,0);
    assert.equal((await f.db.knowledgeEvents('a','legacy')).length,1);
    await f.db.persistConflict('a',{...conflict,id:'new-evidence'});
    assert.deepEqual((await f.db.conflictRecords('a')).records.map(c=>c.id),['new-evidence']);
  } finally { await f.close(); }
});

test('explicit disjoint dates and departments override a model comparison without inventing precedence', () => {
  const docs=[{id:'a',version:'1',text:'Remote work is three days.',chunkIndex:0,metadata:{scope:'Engineering',effectiveFrom:'2024-01-01',effectiveTo:'2024-12-31'}},
    {id:'b',version:'2',text:'Remote work is one day.',chunkIndex:0,metadata:{scope:'Engineering',effectiveFrom:'2026-01-01'}}];
  const raw=[{claim:'Remote days',supporting:[{index:1,quote:docs[0].text}],contradicting:[{index:2,quote:docs[1].text}],scope:{time:null,place:'Engineering'},scopeRelation:'SAME',periodRelation:'OVERLAPPING',precedence:'EXPLICIT',reason:'Model assertion'}];
  assert.deepEqual(parseSourceConflicts(raw,docs),[]);
  docs[1].metadata.effectiveFrom='2024-01-01';
  assert.equal(parseSourceConflicts(raw,docs).length,1,'Model preference cannot resolve overlapping evidence');
  docs[1].metadata.scope='Sales';
  assert.deepEqual(parseSourceConflicts(raw,docs),[]);
});

const answer = (draft: string, revision: number) => ({ draft, status:'supported',verificationStatus:'VERIFIED_UNCHANGED',factCheck:{passed:true,claims:[]},citations:[],sourceRevision:revision,repairHistory:[],requestContext:{},modelUsage:[] });
test('new competing evidence queues revalidation and appends a version without changing the original answer', async () => {
  const f = await fixture();
  try {
    await f.doc('first','Remote work permits three days.');
    const id = await f.db.beginMessage('a','conversation','What is the current policy?');
    const original = answer('Three days. [1]',await f.db.revision('a')); await f.db.finishMessage('a',id,original);
    await f.doc('competing','Remote work permits one day.');
    let calls = 0;
    const rag = { queryPipeline: async (_q: string,_o: string,_c: unknown, options: any) => { calls++; assert.equal(options.originalDraft,'Three days.'); assert.equal(options.bypassCache,true); return answer('One day.',await f.db.revision('a')); } } as unknown as RagService;
    const worker = new RevalidationService(f.db,rag);
    for (let i=0;i<4;i++) await worker.tick();
    assert.equal(calls,1); assert.equal((await f.db.answerVersions('a',id)).length,2);
    assert.equal(JSON.parse(String((await f.db.get('SELECT result FROM messages WHERE owner_id=? AND id=?','a',id))!.result)).draft,original.draft);
    assert.equal((await worker.list('a')).jobs[0].status,'completed');
    await assert.rejects(worker.request('b',id)); await assert.rejects(f.db.answerVersions('b',id));
    await worker.tick(); assert.equal(calls,1);
  } finally { await f.close(); }
});

test('failed revalidation is bounded and retains the original answer', async () => {
  const f = await fixture();
  try {
    const id=await f.db.beginMessage('a','conversation','How many days?'); await f.db.finishMessage('a',id,answer('Three days.',0));
    const rag={ queryPipeline: async () => ({...answer('',0),reason:'verification_failed'}) } as unknown as RagService;
    const worker=new RevalidationService(f.db,rag); await worker.request('a',id);
    for(let i=0;i<4;i++) { await f.db.run('UPDATE revalidation_jobs SET next_at=0'); await worker.tick(); }
    const job=(await worker.list('a')).jobs[0]; assert.equal(job.status,'failed'); assert.equal(job.attempts,3);
    assert.equal((await f.db.answerVersions('a',id)).length,1);
  } finally { await f.close(); }
});
