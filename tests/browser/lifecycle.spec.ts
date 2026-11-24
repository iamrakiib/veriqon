import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const source={id:'policy',source:'policy.md',text:'One day.',chunkCount:1,version:'v2'};
const result={draft:'One day. [1]',status:'supported',verificationStatus:'VERIFIED_UNCHANGED',factCheck:{passed:true,verdict:'Supported',evidence:'One day.',claims:[]},citations:[{index:1,documentId:'policy',source:'policy.md',version:'v2',chunkIndex:0,excerpt:'One day.'}],durationMs:100,attempts:1,correction:null};
async function setup(page:Page){
  await page.route('**/api/auth/status',r=>r.fulfill({json:{needsSetup:false,registrationEnabled:true}}));
  await page.route('**/api/auth/me',r=>r.fulfill({json:{user:{id:'fixture',email:'test@example.test',name:'Test',role:'member'}}}));
  await page.route('**/api/rag/docs',r=>r.fulfill({json:[source]}));
  await page.route('**/api/rag/health',r=>r.fulfill({json:{status:'ok',providerConfigured:true}}));
  await page.route('**/api/rag/conversations',r=>r.fulfill({json:[]}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.app-shell')).toBeVisible();
}
test('long lifecycle histories keep a bounded window and preserve the latest assessment label',async({page},info)=>{
  test.setTimeout(120000);
  await setup(page);
  const items=Array.from({length:120},(_,i)=>({sequence:119-i,result:{...result,draft:`Recorded assessment ${119-i}. ${'Evidence text. '.repeat(80)}`},createdAt:120-i,reason:'Recorded source update'}));
  const payloadBytes:number[]=[];
  await page.route('**/api/rag/query',r=>r.fulfill({json:result}));
  await page.route('**/api/rag/messages/*/version-history*',r=>{
    const start=Number(new URL(r.request().url()).searchParams.get('cursor')||0);
    const body=JSON.stringify({items:items.slice(start,start+20),nextCursor:start+20<items.length?String(start+20):null});
    payloadBytes.push(Buffer.byteLength(body));return r.fulfill({contentType:'application/json',body});
  });
  await page.route('**/api/rag/messages/*/revalidation-history*',r=>{
    const start=Number(new URL(r.request().url()).searchParams.get('cursor')||0);
    return r.fulfill({json:{items:items.slice(start,start+20).map(v=>({id:String(v.sequence),action:'REVIEW',reason:`Audit event ${v.sequence}`,createdAt:v.createdAt})),nextCursor:start+20<items.length?String(start+20):null}});
  });
  await page.getByRole('button',{name:'Show assistant',exact:true}).click();
  await page.getByLabel('Ask your knowledge base').fill('How many days?');await page.getByRole('button',{name:'Send question'}).click();
  await page.getByRole('button',{name:'View answer versions'}).click();
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'Load older answer versions'}).click();
  await writeFile(`data/m4-history-${process.env.M4_BENCHMARK_PHASE||'candidate'}-${info.project.name}.json`,JSON.stringify({fixture:'120 synthetic assessments',legacyArrayBytes:Buffer.byteLength(JSON.stringify(items)),pageBytes:payloadBytes,retainedRecords:await page.locator('.correction-record').count()},null,2));
  await expect(page.locator('.correction-record')).toHaveCount(100);
  await expect(page.getByText(/Latest recorded assessment: version 119/)).toBeVisible();
  await expect(page.getByText('Revalidation 99 - latest recorded',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Newest answer versions'}).click();
  await expect(page.locator('.correction-record')).toHaveCount(20);
  await page.getByRole('button',{name:'Revalidation audit history'}).click();
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'Load older audit events'}).click();
  await expect(page.getByText('Audit event 119',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Audit event 0',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Revalidation audit history'}).click();
  await expect(page.getByText('Audit event 119',{exact:true})).toBeVisible();
});

test('repeated history navigation releases inactive answer panels',async({page},info)=>{
  test.skip(info.project.name!=='desktop','Chromium heap observation runs once per candidate.');
  test.setTimeout(120000);
  await setup(page);
  await page.route('**/api/rag/query',r=>r.fulfill({json:result}));
  const items=Array.from({length:20},(_,i)=>({sequence:19-i,result:{...result,draft:`Assessment ${i}. ${'Evidence text. '.repeat(80)}`},createdAt:20-i,reason:'Recorded update'}));
  await page.route('**/api/rag/messages/*/version-history*',r=>r.fulfill({json:{items,nextCursor:null}}));
  await page.getByRole('button',{name:'Show assistant',exact:true}).click();
  await page.getByLabel('Ask your knowledge base').fill('How many days?');await page.getByRole('button',{name:'Send question'}).click();
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  const samples:{cycle:number;heapBytes:number;nodes:number}[]=[];
  for(let cycle=1;cycle<=16;cycle++){
    await page.getByRole('button',{name:'View answer versions'}).click();
    await expect(page.locator('.correction-record')).toHaveCount(20);
    await page.getByRole('button',{name:'Back to chat history'}).click();
    await page.getByRole('main').getByRole('button',{name:/How many days/}).click();
    await expect(page.locator('.correction-record')).toHaveCount(0);
    if(cycle%4===0){await cdp.send('HeapProfiler.collectGarbage');const metrics=await cdp.send('Performance.getMetrics');samples.push({cycle,heapBytes:metrics.metrics.find(m=>m.name==='JSHeapUsedSize')!.value,nodes:metrics.metrics.find(m=>m.name==='Nodes')!.value});}
  }
  await writeFile(`data/m4-navigation-${process.env.M4_BENCHMARK_PHASE||'candidate'}.json`,JSON.stringify({fixture:'16 navigation cycles, 20 synthetic answer versions opened each cycle; Chromium dev server, forced GC',samples},null,2));
});

test('closing the library cancels its in-flight upload poll',async({page})=>{
  await setup(page);
  await page.route('**/api/rag/health',r=>r.fulfill({json:{status:'ok',providerConfigured:true,capabilities:{durableUploads:true}}}));
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  let calls=0;
  await page.route('**/api/rag/uploads',async r=>{calls++;await gate;await r.fulfill({json:[]}).catch(()=>{});});
  let aborted=false;
  page.on('requestfailed',r=>{if(r.url().endsWith('/api/rag/uploads'))aborted=true;});
  await page.getByRole('button',{name:'Refresh workspace'}).click();
  await expect.poll(()=>calls).toBe(1);
  await page.getByRole('button',{name:'Show assistant',exact:true}).click();
  try{await expect.poll(()=>aborted,{timeout:3000}).toBe(true);}finally{release();}
});

test('document version windows retain access to old and newest snapshots',async({page})=>{
  await setup(page);
  await page.route('**/api/rag/docs/policy/version-history*',r=>{
    const start=Number(new URL(r.request().url()).searchParams.get('cursor')||0);
    return r.fulfill({json:{items:Array.from({length:20},(_,i)=>({versionId:`snapshot-${119-start-i}`,recordedAt:120-start-i,metadata:{}})),nextCursor:start<100?String(start+20):null}});
  });
  await page.getByRole('button',{name:/policy.md.*Version/}).click();
  await page.getByRole('button',{name:'View document versions'}).click();
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'Load older document versions'}).click();
  await expect(page.getByRole('button',{name:'Read archived version'})).toHaveCount(100);
  await expect(page.getByText('snapshot-0',{exact:true})).toBeVisible();
  await expect(page.getByText('snapshot-119',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'View document versions'}).click();
  await expect(page.getByRole('button',{name:'Read archived version'})).toHaveCount(20);
  await expect(page.getByText('snapshot-119',{exact:true})).toBeVisible();
});

test('source metadata and bounded version history are reachable with stale-save recovery',async({page},info)=>{
  await setup(page);
  await page.route('**/api/rag/docs/policy/metadata',r=>r.fulfill(r.request().method()==='PUT'?{status:409,json:{message:'Source metadata changed. Reload before saving.'}}:{json:{metadata:{effectiveFrom:'2026-01-01'},revision:2}}));
  await page.route('**/api/rag/docs/policy/version-history*',r=>r.fulfill({json:{items:[{versionId:'v1',version:'old',recordedAt:1,metadata:{}}],nextCursor:null}}));
  await page.route('**/api/rag/docs/policy/versions/v1',r=>r.fulfill({json:{versionId:'v1',text:'Archived three days.',metadata:{}}}));
  await page.getByRole('button',{name:/policy.md.*Version/}).click();
  await page.getByRole('button',{name:'Source dates and authority'}).click();
  await expect(page.getByLabel('Effective from',{exact:true})).toHaveValue('2026-01-01');
  await page.getByLabel('Reason for this metadata change').fill('Dates verified from approved policy.');
  await page.getByRole('button',{name:'Save source metadata'}).click();
  await expect(page.getByRole('alert')).toContainText('Reload before saving');
  await expect(page.getByText('Metadata saved.',{exact:false})).toHaveCount(0);
  await page.getByRole('button',{name:'View document versions'}).click();
  await page.getByRole('button',{name:'Read archived version'}).click();
  await expect(page.getByText('Archived three days.')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`data/m4-source-${info.project.name}.png`});
});
test('chat exposes latest and original versions and does not claim a completed job was queued',async({page})=>{
  await setup(page);
  await page.route('**/api/rag/query',r=>r.fulfill({json:result}));
  await page.route('**/api/rag/messages/*/version-history*',r=>r.fulfill({json:r.request().url().includes('cursor=older')?{items:[{sequence:0,result,createdAt:1,reason:'Original'}],nextCursor:null}:{items:[{sequence:1,result:{...result,draft:'Updated answer.'},createdAt:2,reason:'Source updated'}],nextCursor:'older'}}));
  await page.route('**/api/rag/messages/*/revalidate',r=>r.fulfill({json:{queued:false,status:'completed',nextAt:1,jobId:'j'}}));
  await page.route('**/api/rag/messages/*/revalidation-history*',r=>r.fulfill({json:{items:[{id:'e',action:'ANSWER_REVALIDATED_UNCHANGED',reason:'Evidence unchanged',createdAt:3}],nextCursor:null}}));
  if(await page.getByRole('button',{name:'Show assistant',exact:true}).isVisible())await page.getByRole('button',{name:'Show assistant',exact:true}).click();
  await page.getByLabel('Ask your knowledge base').fill('How many days?');await page.getByRole('button',{name:'Send question'}).click();
  await page.getByRole('button',{name:'View answer versions'}).click();
  await expect(page.getByText('Updated answer.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Load older answer versions'}).click();
  await expect(page.getByText('Original answer',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Recheck current evidence'}).click();
  await expect(page.getByRole('status').filter({hasText:'No new job queued'})).toBeVisible();
  await page.getByRole('button',{name:'Revalidation audit history'}).click();
  await expect(page.getByText('Evidence unchanged',{exact:true})).toBeVisible();
});
test('corrections exposes the actual background job and retry time',async({page},info)=>{
  await setup(page);
  await page.route('**/api/rag/revalidations',r=>r.fulfill({json:{enabled:true,hourlyBudget:10,jobs:[{id:'j',messageId:'m',question:'Policy update',status:'retry_wait',nextAt:2000000000000,error:'Provider cooldown'}]}}));
  if(info.project.name==='mobile')await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('button',{name:/Corrections/}).click();
  await page.getByRole('button',{name:'Refresh background revalidation'}).click();
  await expect(page.getByText('Policy update',{exact:true})).toBeVisible();
  await expect(page.getByText(/Next eligible retry:/)).toBeVisible();
});

test('conflict review records a decision and retains paginated history and stale warnings',async({page},info)=>{
  await setup(page);
  let resolved=false,stale=false,posts=0;
  const conflict={id:'conflict',revision:2,question:'How many days?',claim:'Remote work differs',detectedAt:'2026-01-01',scope:{time:'2026',place:'Engineering'},reason:'No precedence',supporting:[{...result.citations[0],quote:'One day.',metadata:{effectiveFrom:'2026-01-01'}}],contradicting:[{...result.citations[0],index:2,documentId:'other',source:'other.md',quote:'Three days.',excerpt:'Three days.'}]};
  await page.route('**/api/rag/conflicts',r=>r.fulfill({json:{coverage:'saved_answer_assessments',reviewedAnswers:1,records:[{...conflict,revision:resolved?3:2,status:stale?'UNRESOLVED':resolved?'RESOLVED':'UNRESOLVED',stale,resolution:resolved?{action:'PREFER_SOURCE',explanation:'Approved by the policy owner.',actorId:'fixture',at:1}:null}]}}));
  await page.route('**/api/rag/conflicts/conflict/decision',r=>{posts++;expect(r.request().postDataJSON()).toMatchObject({expectedRevision:2,preferredDocumentId:'policy',explanation:'Approved by the policy owner.'});resolved=true;return r.fulfill({json:{status:'RESOLVED',revision:3}});});
  await page.route('**/api/rag/conflicts/conflict/decision-history*',r=>r.fulfill({json:r.request().url().includes('cursor=older')?{items:[{id:'old',action:'CONFLICT_DECISION',reason:'Earlier review',createdAt:1}],nextCursor:null}:{items:[{id:'new',action:'CONFLICT_DECISION',reason:'Approved by the policy owner.',createdAt:2}],nextCursor:'older'}}));
  if(info.project.name==='mobile')await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('button',{name:'Conflict center',exact:true}).click();
  await page.getByRole('button',{name:/Remote work differs/}).click();
  await page.getByLabel('Applicable source').selectOption('policy');
  await page.getByLabel('Review explanation').fill('Approved by the policy owner.');
  await page.getByRole('button',{name:'Save review decision'}).click();
  await expect(page.getByText('Review decision recorded',{exact:true})).toBeVisible();expect(posts).toBe(1);
  await page.getByLabel('Filter conflicts').selectOption('resolved');
  await expect(page.getByRole('button',{name:/Remote work differs/})).toBeVisible();
  await page.getByRole('button',{name:'Decision history',exact:true}).click();
  await page.getByRole('button',{name:'Load older audit events'}).click();
  await expect(page.getByText('Earlier review',{exact:true})).toBeVisible();
  stale=true;await page.getByLabel('Filter conflicts').selectOption('stale');await page.getByRole('button',{name:'Refresh conflicts'}).click();
  await expect(page.getByText('Stale decision · evidence changed',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save review decision'})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
