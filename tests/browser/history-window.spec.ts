import { test, expect, type Page } from '@playwright/test';

const result={draft:'Supported fixture.',status:'supported',verificationStatus:'VERIFIED_UNCHANGED',factCheck:{passed:true,verdict:'Supported',evidence:'Fixture',claims:[]},citations:[],durationMs:1,attempts:1,correction:null};
const message=(n:number)=>({id:`m${n}`,question:`Saved question ${n}`,result,createdAt:'2026-01-01T00:00:00Z'});
async function identity(page:Page){
  await page.route('**/api/auth/status',r=>r.fulfill({json:{needsSetup:false,registrationEnabled:true}}));
  await page.route('**/api/auth/me',r=>r.fulfill({json:{user:{id:'fixture',email:'test@example.test',name:'Test',role:'member'}}}));
  await page.route('**/api/rag/docs',r=>r.fulfill({json:[]}));
  await page.route('**/api/rag/health',r=>r.fulfill({json:{status:'ok',providerConfigured:true}}));
}
test('chat history windows stay bounded without losing drafts or access to newer records',async({page})=>{
  await identity(page);
  await page.route('**/api/rag/conversations*',r=>{
    const start=Number(new URL(r.request().url()).searchParams.get('before')||0);
    return r.fulfill({json:Array.from({length:20},(_,offset)=>{const n=start+offset;return {id:`c${n}`,title:`Research ${n}`,cursor:String(n+1),hasMoreConversations:start<40,olderMessagesCursor:n===0?'1':null,messages:n===0?Array.from({length:10},(_,i)=>message(i+90)):[message(n)]};})});
  });
  await page.route('**/api/rag/conversations/c0/messages*',r=>{
    const before=Number(new URL(r.request().url()).searchParams.get('before')||0);
    return r.fulfill({json:{messages:Array.from({length:30},(_,i)=>message((before?90-before*30:70)+i)),olderMessagesCursor:String(before+1)}});
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Show assistant',exact:true}).click();
  await page.getByLabel('Ask your knowledge base').fill('Keep my unfinished question');
  await page.getByRole('button',{name:'Back to chat history'}).click();
  await page.getByRole('button',{name:'Load older conversations'}).click();
  await page.getByRole('button',{name:'Load older conversations'}).click();
  await expect(page.locator('.history-row')).toHaveCount(40);
  await expect(page.getByRole('main').getByRole('button',{name:/Research 59 /})).toBeVisible();
  await page.getByRole('button',{name:'Newest conversations'}).click();
  await page.getByRole('main').getByRole('button',{name:/Research 0 /}).click();
  await expect(page.getByLabel('Ask your knowledge base')).toHaveValue('Keep my unfinished question');
  await page.getByRole('button',{name:'Load older messages'}).click();
  await page.getByRole('button',{name:'Load older messages'}).click();
  await expect(page.locator('.message-pair')).toHaveCount(60);
  await expect(page.getByText('Saved question 30',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Send question'})).toBeDisabled();
  await page.getByRole('button',{name:'Latest messages'}).click();
  await expect(page.locator('.message-pair')).toHaveCount(30);
  await expect(page.getByText('Saved question 99',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Ask your knowledge base')).toHaveValue('Keep my unfinished question');
  await expect(page.getByRole('button',{name:'Send question'})).toBeEnabled();
});

test('a full chat window refreshes before sending and retains the draft if refresh fails',async({page})=>{
  await identity(page);
  await page.route('**/api/rag/conversations',r=>r.fulfill({json:[{id:'c0',title:'Long conversation',cursor:'saved',messages:Array.from({length:60},(_,i)=>message(i))}]}));
  let fail=true, queries=0;
  await page.route('**/api/rag/conversations/c0/messages',r=>r.fulfill(fail?{status:503,json:{message:'Unavailable'}}:{json:{messages:Array.from({length:30},(_,i)=>message(i+30)),olderMessagesCursor:'older'}}));
  await page.route('**/api/rag/query',r=>{queries++;return r.fulfill({json:result});});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Show assistant',exact:true}).click();
  await page.getByLabel('Ask your knowledge base').fill('A question that must not disappear');
  await page.getByRole('button',{name:'Send question'}).click();
  await expect(page.getByRole('status').filter({hasText:'Your question was kept as a draft'})).toBeVisible();
  await expect(page.getByLabel('Ask your knowledge base')).toHaveValue('A question that must not disappear');
  expect(queries).toBe(0);
  fail=false;
  await page.getByRole('button',{name:'Send question'}).click();
  await expect(page.locator('.message-pair')).toHaveCount(31);
  await expect(page.locator('.user-message').filter({hasText:'A question that must not disappear'})).toBeVisible();
  expect(queries).toBe(1);
});

test('history eviction preserves a different conversation whose answer is still generating',async({page})=>{
  await identity(page);
  await page.route('**/api/rag/conversations*',r=>{
    const start=Number(new URL(r.request().url()).searchParams.get('before')||0);
    return r.fulfill({json:Array.from({length:20},(_,i)=>({id:`c${start+i}`,title:`Research ${start+i}`,cursor:String(start+i+1),hasMoreConversations:start<40,messages:[message(start+i)]}))});
  });
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  let submitted=false;
  await page.route('**/api/rag/query',async r=>{submitted=true;await gate;await r.fulfill({json:result});});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Show assistant',exact:true}).click();
  await page.getByLabel('Ask your knowledge base').fill('Pending answer must remain reachable');
  await page.getByRole('button',{name:'Send question'}).click();
  await expect.poll(()=>submitted).toBe(true);
  await page.getByRole('button',{name:'Back to chat history'}).click();
  await page.getByRole('main').getByRole('button',{name:/Research 1 /}).click();
  await page.getByRole('button',{name:'Back to chat history'}).click();
  await page.getByRole('button',{name:'Load older conversations'}).click();
  await page.getByRole('button',{name:'Load older conversations'}).click();
  try{await expect(page.getByRole('main').getByRole('button',{name:/Research 0 /})).toBeVisible();}finally{release();}
  await page.getByRole('main').getByRole('button',{name:/Research 0 /}).click();
  await expect(page.locator('.message-pair').filter({hasText:'Pending answer must remain reachable'})).toContainText('Supported fixture.');
});
