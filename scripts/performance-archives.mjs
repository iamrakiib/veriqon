/** Explicit disposable PostgreSQL only; no .env, provider or application data. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem } from 'node:os';
import pg from 'pg';
const require=createRequire(import.meta.url);
const {DatabaseService}=require('../dist/src/database/database.service.js');
const {chunkText}=require('../dist/src/common/utils.js');
const endpoint=new URL(process.env.TEST_DATABASE_URL || 'invalid:');
if (!['127.0.0.1','localhost'].includes(endpoint.hostname) || endpoint.pathname!=='/veriqon_test') throw new Error('Set TEST_DATABASE_URL to the disposable local veriqon_test database.');
const container=process.env.PERF_DATABASE_CONTAINER;
if (container && !/^veriqon-m3a-[a-z-]+$/.test(container)) throw new Error('Only owned veriqon-m3a test containers may be sampled.');
const schema='perf_'+randomUUID().replaceAll('-','');
const admin=new pg.Pool({connectionString:endpoint.toString(),max:1});
let db;
let cgroupV2=true;
if(container) { try { execFileSync('docker',['exec',container,'test','-f','/sys/fs/cgroup/memory.current'],{stdio:'ignore',timeout:5000}); } catch { cgroupV2=false; } }
const memory=()=>container ? Object.fromEntries(['current','peak'].map(k=>{
  const path=cgroupV2?`/sys/fs/cgroup/memory.${k}`:`/sys/fs/cgroup/memory/memory.${k==='current'?'usage':'max_usage'}_in_bytes`;
  return [k,Number(execFileSync('docker',['exec',container,'cat',path],{encoding:'utf8',timeout:5000}).trim())];
})) : null;
try {
  await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
  await admin.query(`CREATE SCHEMA ${schema}`);
  endpoint.searchParams.set('options',`-c search_path=${schema},public`);
  Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:endpoint.toString()});delete process.env.REDIS_URL;
  db=new DatabaseService();await db.initialize();
  await db.run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)','bench','bench@example.test','Benchmark','unused','member',1);
  await db.run('INSERT INTO documents(owner_id,id,text,version,created_at) VALUES(?,?,?,?,?)','bench','policy','Current content.','current',1);
  const sizes=[];
  const snapshotFor=(i,accents=0)=>{
    const plain=('Policy evidence '+i+' ').repeat(40000).slice(0,499900);
    const text='é'.repeat(accents)+plain.slice(accents);
    return JSON.stringify({id:'policy',text,version:`v${i}`,metadataRevision:1,metadata:{effectiveFrom:`${2020+i}-01-01`,effectiveTo:`${2020+i}-12-31`,scope:'Engineering'},chunks:chunkText(text).map((content,chunk_index)=>({content,chunk_index}))});
  };
  const snapshots=Array.from({length:9},(_,i)=>snapshotFor(i));
  const firstBudget=8*1024*1024-snapshots.slice(1,7).reduce((n,s)=>n+Buffer.byteLength(s),0);
  let low=0,high=499900;
  while(low<high) {const mid=Math.ceil((low+high)/2);if(Buffer.byteLength(snapshotFor(0,mid))<=firstBudget)low=mid;else high=mid-1;}
  snapshots[0]=snapshotFor(0,low);
  for(let i=0;i<9;i++) {
    const snapshot=snapshots[i];
    sizes.push(Buffer.byteLength(snapshot));
    await db.run('INSERT INTO document_versions VALUES(?,?,?,?,?)','bench','policy',`snapshot-${i}`,snapshot,i);
  }
  snapshots.length=0;global.gc?.();
  assert.ok(sizes.slice(0,7).reduce((a,b)=>a+b,0)>=8*1024*1024-3,'Exercise the actual byte ceiling, not a small archive');
  const scope={from:'2020-01-01',to:'2027-01-01',kind:'range'};
  const broad={...scope,to:'2029-01-01'};
  const sampleCount=8,timings=[],rss=[],heap=[];
  let query,queryArgs, transferredBytes=0;
  const all=db.all.bind(db);
  db.all=async(sql,...args)=>{
    if(sql.startsWith('WITH ranked')) {query=sql;queryArgs=args;}
    const rows=await all(sql,...args);
    transferredBytes+=rows.reduce((n,r)=>n+(typeof r.snapshot==='string'?Buffer.byteLength(r.snapshot):0),0);
    return rows;
  };
  const databaseBefore=memory();
  await db.historicalDocuments('bench',scope);
  for(let i=0;i<sampleCount;i++) {
    global.gc?.();const start=performance.now();
    const documents=await db.historicalDocuments('bench',scope);
    timings.push(performance.now()-start);
    assert.equal(documents.length,7);assert.ok(documents.every(d=>d.snapshotId&&d.chunks.length>0));
    rss.push(process.memoryUsage().rss);heap.push(process.memoryUsage().heapUsed);
  }
  const beforeReject=transferredBytes;
  await assert.rejects(db.historicalDocuments('bench',broad),/archive.*budget/i);
  assert.equal(transferredBytes,beforeReject,'Rejected windows must not transfer snapshot payloads');
  // Capture the real descriptor-selection plan (the broader rejection query).
  const plans=await all('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+query,...queryArgs);
  const databaseAfter=memory();
  timings.sort((a,b)=>a-b);
  const report={measuredAt:new Date().toISOString(),node:process.version,hardware:{cpu:cpus()[0]?.model,memoryBytes:totalmem()},
    workload:{versions:9,charactersPerVersion:499900,acceptedVersions:7,acceptedSerializedBytes:sizes.slice(0,7).reduce((a,b)=>a+b,0),rejectedSerializedBytes:sizes.reduce((a,b)=>a+b,0),limitBytes:8*1024*1024,samples:sampleCount,warmups:1,concurrency:1,modelCalls:0},
    latencyMs:{p50:timings[3],p95:timings[7],samples:timings},memoryBytes:{nodePeakProcessRss:process.resourceUsage().maxRSS*1024,nodeMaxSampleRss:Math.max(...rss),nodeMaxSampleHeap:Math.max(...heap),databaseBefore,databaseAfter},
    rejectedPayloadBytes:transferredBytes-beforeReject,queryPlan:plans[0]['QUERY PLAN'],
    limitations:['Peak process RSS includes setup; it is not isolated query allocation.','Container cgroup memory includes database shared buffers, tmpfs data and file cache; not just query executor memory.','Eight serial samples do not establish multi-tenant capacity or leak freedom.']};
  // Local acceptance budget declared by this harness, not a hosting SLA.
  assert.ok(report.memoryBytes.nodePeakProcessRss<512*1024*1024,'Single-window benchmark Node RSS exceeds the 512 MiB local test budget');
  writeFileSync(process.argv[2]||'data/performance-archives.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({workload:report.workload,latencyMs:report.latencyMs,memoryBytes:report.memoryBytes,rejectedPayloadBytes:report.rejectedPayloadBytes},null,2));
} finally {
  if(db) await db.onModuleDestroy();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
}
