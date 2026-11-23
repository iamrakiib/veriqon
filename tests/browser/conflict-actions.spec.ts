import { test, expect, type Page } from '@playwright/test';

const source = {index:1,documentId:'policy',source:'approved-policy.md',version:'v1',chunkIndex:0,quote:'Three remote days.',excerpt:'Three remote days.'};
const conflict = {id:'c1',revision:2,question:'Remote days?',claim:'Remote work differs',detectedAt:'2026-11-01',status:'UNRESOLVED',scope:{time:'2026',place:'Engineering'},reason:'No precedence established.',supporting:[source],contradicting:[{...source,index:2,documentId:'other',source:'other-policy.md',quote:'One remote day.',excerpt:'One remote day.'}]};
async function setup(page:Page, mobile:boolean, theme='dark') {
  await page.addInitScript(theme=>localStorage.setItem('veriqon-theme',theme),theme);
  await page.route('**/api/auth/status',r=>r.fulfill({json:{needsSetup:false,registrationEnabled:true}}));
  await page.route('**/api/auth/me',r=>r.fulfill({json:{user:{id:'fixture',email:'test@example.test',name:'Test',role:'member'}}}));
  await page.route('**/api/rag/docs',r=>r.fulfill({json:[]}));
  await page.route('**/api/rag/conversations',r=>r.fulfill({json:[]}));
  await page.route('**/api/rag/health',r=>r.fulfill({json:{status:'ok',providerConfigured:true}}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  if(mobile)await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('button',{name:'Conflict center',exact:true}).click();
}

for (const theme of ['dark','light']) test(`source choices remain readable and selectable in ${theme} mode`,async({page},info)=>{
  await page.route('**/api/rag/conflicts',r=>r.fulfill({json:{records:[conflict],reviewedAnswers:1,truncated:false,coverage:'saved_answer_assessments'}}));
  await setup(page,info.project.name==='mobile',theme);
  await page.getByRole('button',{name:/Remote work differs/}).click();
  const select=page.getByLabel('Applicable source');
  await select.selectOption('policy');await expect(select).toHaveValue('policy');
  await expect(select.locator('option:checked')).toHaveText('approved-policy.md');
  const colors=await select.evaluate(el=>[el,el.querySelector('option:checked')!].map(node=>{const s=getComputedStyle(node);return {color:s.color,background:s.backgroundColor};}));
  const luminance=(rgb:string)=>{const channels=rgb.match(/\d+/g)!.slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];};
  for(const color of colors){
    expect(color.background).not.toBe('rgba(0, 0, 0, 0)');
    const a=luminance(color.color),b=luminance(color.background);
    expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThanOrEqual(4.5);
  }
  await select.focus();await page.keyboard.press('ArrowDown');await expect(select).toHaveValue('other');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`data/conflict-source-${theme}-${info.project.name}.png`});
});

test('history action confirms filtered scope, retains failed requests and survives refresh',async({page},info)=>{
  let records=[conflict,{...conflict,id:'c2',claim:'Vacation days differ',status:'RESOLVED'}],posts=0,fail=true;
  await page.route('**/api/rag/conflicts',r=>r.fulfill({json:{records,reviewedAnswers:2,truncated:false,coverage:'saved_answer_assessments'}}));
  await page.route('**/api/rag/conflicts/archive',r=>{
    posts++;expect(r.request().postDataJSON()).toEqual({records:[{id:'c1',expectedRevision:2}]});
    if(fail)return r.fulfill({status:409,json:{message:'A conflict decision changed. Refresh before clearing history.'}});
    records=records.filter(c=>c.id!=='c1');return r.fulfill({json:{cleared:1}});
  });
  await setup(page,info.project.name==='mobile');
  await page.getByLabel('Filter conflicts').selectOption('unresolved');
  const actions=page.getByLabel('Conflict actions',{exact:true});
  if(info.project.name==='mobile'){
    const filter=await page.getByLabel('Filter conflicts').boundingBox(), refresh=await page.getByRole('button',{name:'Refresh conflicts'}).boundingBox(), menu=await actions.boundingBox();
    const center=(box:NonNullable<typeof filter>)=>box.y+box.height/2;
    expect(Math.abs(center(filter!)-center(refresh!))).toBeLessThan(2);expect(Math.abs(center(refresh!)-center(menu!))).toBeLessThan(2);
  }
  await actions.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'Clear visible history'})).toBeVisible();
  await page.screenshot({path:`data/conflict-actions-menu-${info.project.name}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.keyboard.press('Escape');await expect(actions).toBeFocused();
  await actions.click();await page.getByRole('button',{name:'Clear visible history'}).click();
  await expect(page.getByRole('dialog')).toContainText('Remove 1 visible record');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(actions).toBeFocused();expect(posts).toBe(0);
  await actions.click();await page.getByRole('button',{name:'Clear visible history'}).click();
  await page.getByRole('button',{name:'Clear history',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Refresh before clearing');
  await expect(page.locator('.conflict-row')).toHaveCount(1);
  await page.screenshot({path:`data/conflict-clear-${info.project.name}.png`});
  fail=false;await page.getByRole('button',{name:'Clear history',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(actions).toBeFocused();
  await expect(page.getByRole('status').filter({hasText:'Saved answers and source decisions are retained'})).toBeVisible();
  await page.getByRole('button',{name:'Refresh conflicts'}).click();
  await expect(page.getByText('No matching conflicts')).toBeVisible();
  await page.getByLabel('Filter conflicts').selectOption('all');
  await expect(page.getByRole('button',{name:/Vacation days differ/})).toBeVisible();
  expect(posts).toBe(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
