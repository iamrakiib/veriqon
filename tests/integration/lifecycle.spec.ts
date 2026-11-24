import { test, expect } from '@playwright/test';
const password='Browser test password 123!';
const oldFact='Engineering permits three remote days.';
const newFact='Engineering permits one remote day.';
const benefit='Benefits include twenty vacation days.';
const headers={'X-Veriqon-Request':'1'};
test('real lifecycle: register, queued upload, conflict review, automatic correction, history and account isolation',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Full name').fill('Lifecycle owner');await page.getByLabel('Email address',{exact:true}).fill('owner@browser.test');await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByLabel('One-time setup code').fill('browser-fixture-setup-only');
  const registered=page.waitForResponse(r=>r.url().endsWith('/api/auth/register')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  const registration=await (await registered).json();expect(registration.recoveryCodes).toHaveLength(8);
  await page.getByRole('dialog').getByRole('checkbox').check();await page.getByRole('dialog').getByRole('button',{name:'Done',exact:true}).click();
  await page.getByLabel('Upload documents').setInputFiles({name:'policy-old.txt',mimeType:'text/plain',buffer:Buffer.from(oldFact+' '+benefit)});
  await expect(page.getByRole('button',{name:/policy-old.txt.*Version/})).toBeVisible({timeout:30000});
  const docs=await page.request.get('/api/rag/docs').then(r=>r.json());const old=docs.find((d:{source:string})=>d.source==='policy-old.txt');
  await page.getByRole('button',{name:/policy-old.txt.*Version/}).click();await page.getByRole('button',{name:'Source dates and authority'}).click();
  await page.getByLabel('Effective from',{exact:true}).fill('2024-01-01');await page.getByLabel('Reason for this metadata change').fill('Confirmed original policy effective date.');
  await page.getByRole('button',{name:'Save source metadata'}).click();await expect(page.getByRole('status').filter({hasText:'Metadata saved'})).toBeVisible();
  const competing=await page.request.put('/api/rag/docs/'+old.id+'/metadata',{headers,data:{metadata:{effectiveFrom:'2023-01-01'},expectedRevision:1,reason:'Concurrent confirmed date from another tab'}});expect(competing.status()).toBe(200);
  await page.getByLabel('Reason for this metadata change').fill('Attempt to save an outdated editor revision.');await page.getByRole('button',{name:'Save source metadata'}).click();
  await expect(page.getByRole('alert')).toContainText('changed');await expect(page.getByRole('status').filter({hasText:'Metadata saved'})).toHaveCount(0);
  await page.getByRole('button',{name:'Reload metadata'}).click();await expect(page.getByLabel('Effective from',{exact:true})).toHaveValue('2023-01-01');
  await page.getByRole('button',{name:'View document versions'}).click();await expect(page.getByRole('button',{name:'Read archived version'}).first()).toBeVisible();
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:'Show assistant',exact:true}).click();
  const answerResponse=page.waitForResponse(r=>r.url().endsWith('/api/rag/query')&&r.request().method()==='POST');
  await page.getByLabel('Ask your knowledge base').fill('What is the current Engineering remote-work allowance and vacation benefit?');await page.getByRole('button',{name:'Send question'}).click();
  const answer=await (await answerResponse).json();expect(answer.verificationStatus).toBe('VERIFIED_UNCHANGED');expect(answer.draft).toContain(oldFact);
  await page.getByRole('button',{name:/Open passage 1/}).first().click();await expect(page.getByRole('dialog')).toContainText(oldFact);await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:'Back to chat history'}).click();await expect(page.getByRole('heading',{name:'Chat history'})).toBeVisible();
  await page.getByRole('main').getByRole('button',{name:/What is the current Engineering/}).click();await expect(page.getByLabel('Ask your knowledge base')).toBeVisible();
  await page.getByRole('button',{name:'Show workspace',exact:true}).click();
  await page.getByLabel('Upload documents').setInputFiles({name:'policy-new.txt',mimeType:'text/plain',buffer:Buffer.from(newFact+' '+benefit)});
  await expect(page.getByRole('button',{name:/policy-new.txt.*Version/})).toBeVisible({timeout:30000});
  // No revalidation button or direct tick call: the actual background scheduler reacts to ingestion.
  await expect.poll(async()=>{const r=await page.request.get(`/api/rag/messages/${answer.messageId}/version-history`);const p=await r.json();return p.items?.[0]?.result.verificationStatus;},{timeout:60000}).toBe('UNRESOLVED_CONFLICT');
  await page.getByRole('button',{name:'Conflict center',exact:true}).click();await page.getByRole('button',{name:new RegExp('Engineering permits three remote days')}).first().click();
  const latestDocs=await page.request.get('/api/rag/docs').then(r=>r.json());const revised=latestDocs.find((d:{source:string})=>d.source==='policy-new.txt');
  await page.getByLabel('Applicable source').selectOption(revised.id);await page.getByLabel('Review explanation').fill('Approved policy owner confirms the one-day rule.');
  await page.getByRole('button',{name:'Save review decision'}).click();await expect(page.getByText('Review decision recorded',{exact:true})).toBeVisible();
  await expect.poll(async()=>{const p=await page.request.get(`/api/rag/messages/${answer.messageId}/version-history`).then(r=>r.json());return p.items?.[0]?.result.verificationStatus;},{timeout:60000}).toBe('REPAIRED_VERIFIED');
  await page.reload();await page.getByRole('button',{name:/Corrections/}).click();await page.getByRole('button',{name:'Refresh background revalidation'}).click();
  await page.getByRole('button',{name:'View answer versions'}).first().click();
  await expect(page.getByText(new RegExp('Engineering permits one remote day')).first()).toBeVisible();await expect(page.getByText('Original answer',{exact:true})).toBeVisible();
  const versions=await page.request.get(`/api/rag/messages/${answer.messageId}/version-history`).then(r=>r.json());
  expect(versions.items[0].result.draft).toContain(benefit);expect(versions.items.at(-1).result.draft).toBe(answer.draft);expect(versions.items[0].result.citations.every((c:{version?:string})=>!!c.version)).toBe(true);
  await page.getByRole('button',{name:'Chat workspace',exact:true}).click();
  const rejectedResponse=page.waitForResponse(r=>r.url().endsWith('/api/rag/query')&&r.request().method()==='POST');
  await page.getByLabel('Ask your knowledge base').fill('What is the current Engineering allowance and benefit? unsafe repair');await page.getByRole('button',{name:'Send question'}).click();
  const rejected=await(await rejectedResponse).json();expect(rejected.verificationStatus).not.toBe('REPAIRED_VERIFIED');expect(rejected.repairHistory.some((h:{accepted:boolean})=>!h.accepted)).toBe(true);expect(rejected.draft).not.toContain('pays travel expenses');
  expect(rejected.repairHistory.some((h:{after?:{atomicClaims?:{text:string;verdict:string}[]}})=>h.after?.atomicClaims?.some(c=>c.text.includes('travel expenses')&&c.verdict==='INSUFFICIENT_EVIDENCE'))).toBe(true);
  await page.getByRole('button',{name:'Corrections',exact:true}).click();await page.getByLabel('Filter corrections').selectOption('withheld');await expect(page.getByText('Repair withheld',{exact:true})).toBeVisible();
  const conflict=await page.request.get('/api/rag/conflicts').then(r=>r.json());const conflictId=conflict.records[0].id;
  const archive=await page.request.get(`/api/rag/docs/${old.id}/version-history`).then(r=>r.json());
  const other=await browser.newContext({baseURL:'http://127.0.0.1:3015'});
  try{
    const signup=await other.request.post('/api/auth/register',{headers,data:{email:'other@browser.test',name:'Other',password}});expect(signup.status()).toBe(201);
    for(const path of [`docs/${old.id}/metadata`,`docs/${old.id}/version-history`,`docs/${old.id}/versions/${archive.items[0].versionId}`,`messages/${answer.messageId}/version-history`,`messages/${answer.messageId}/revalidation-history`,`conflicts/${conflictId}/decision-history`])expect((await other.request.get('/api/rag/'+path)).status(),path).toBe(404);
    expect((await other.request.put(`/api/rag/docs/${old.id}/metadata`,{headers,data:{metadata:{},expectedRevision:1,reason:'Unauthorized account must not alter source'}})).status()).toBe(404);
    expect((await other.request.post(`/api/rag/messages/${answer.messageId}/revalidate`,{headers,data:{}})).status()).toBe(404);
    expect((await other.request.post(`/api/rag/conflicts/${conflictId}/decision`,{headers,data:{action:'KEEP_UNRESOLVED',expectedRevision:1,explanation:'Unauthorized account must not alter decision'}})).status()).toBe(404);
    expect((await other.request.get('/api/rag/revalidations').then(r=>r.json())).jobs).toHaveLength(0);
  }finally{await other.close();}
  expect(errors).toEqual([]);
  await page.screenshot({path:'data/m4-real-stack-corrections.png'});
  // Real recovery invalidates the current session, then the same persisted history remains after login.
  const recovery=await browser.newContext({baseURL:'http://127.0.0.1:3015'});try{
    const recoverPage=await recovery.newPage();await recoverPage.goto('/');await recoverPage.getByRole('button',{name:'Forgot password?'}).click();
    await recoverPage.getByLabel('Recovery email').fill('owner@browser.test');await recoverPage.getByLabel('Recovery code').fill(registration.recoveryCodes[0]);await recoverPage.getByLabel('New password',{exact:true}).fill(password+'new');await recoverPage.getByLabel('Confirm new password').fill(password+'new');
    await recoverPage.getByRole('button',{name:'Reset password',exact:true}).click();await expect(recoverPage.getByRole('status')).toContainText('Password changed');
  }finally{await recovery.close();}
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await page.reload();await page.getByLabel('Email address',{exact:true}).fill('owner@browser.test');await page.getByLabel('Password',{exact:true}).fill(password+'new');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.locator('.app-shell')).toBeVisible();expect((await page.request.get(`/api/rag/messages/${answer.messageId}/version-history`).then(r=>r.json())).items).toHaveLength(versions.items.length);
});
