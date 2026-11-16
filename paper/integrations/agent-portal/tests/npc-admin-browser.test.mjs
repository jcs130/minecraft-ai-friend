import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {siteFixture,testPassword} from './helpers.mjs';
import {NpcAdmin} from '../src/npc-admin.mjs';
let executablePath;
for(const file of [process.env.PORTAL_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].filter(Boolean))try{await fs.access(file);executablePath=file;break;}catch{}
test('administrator edits NPC profile in actual mobile/desktop browser without layout overflow or accidental replay',{skip:!executablePath},async t=>{
  let browser;t.after(async()=>browser?.close());
  const f=await siteFixture(t),service=new NpcAdmin(f.portal.store);
  service.poll({catalogue:{schemaVersion:1,observedAt:new Date().toISOString(),residents:[{id:'10000000-0000-0000-0000-000000000011',revision:0,loaded:true,profession:'ranger',currentBrain:'qwen',
    profile:{name:'桐人',persona:'敏捷剑士，喜欢与伙伴一起探索，记住自己的旅途。',brain:'qwen',voice:'none',appearance:'original',autonomous:true,mapVisible:true},brains:[{id:'qwen',model:'qwen3.8-flash'}],voices:['none'],models:[{id:'original',label:'角色原外观'}]}]},results:[]});
  browser=await puppeteer.launch({executablePath,headless:true,args:['--no-first-run','--no-default-browser-check'],userDataDir:path.join(f.root,'npc-browser')});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(f.origin+'/npc-admin.html');
  await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('仅管理员'));
  assert.equal(await page.$('article.resident'),null);
  const status=await page.evaluate(async password=>{
    const session=await (await fetch('/api/v1/session')).json();const result=await fetch('/api/v1/sessions',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({username:'fixture-admin',password})});return result.status;
  },testPassword);assert.equal(status,200);
  await page.reload();await page.waitForSelector('article.resident');
  for(const width of [390,844,1366]){
    await page.setViewport({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'width '+width);
    assert.equal(await page.$eval('input[name=name]',e=>e.value),'桐人');
  }
  await page.$eval('input[name=name]',e=>{e.value='桐人 · 黑衣剑士';});
  await page.click('button[type=submit]');await page.waitForFunction(()=>document.querySelector('.form-result').textContent==='已提交');
  assert.equal(service.state().jobs.length,1);assert.equal(service.state().jobs[0].status,'queued');
  assert.equal(await page.$eval('button[type=submit]',e=>e.disabled),true);
  assert.deepEqual(errors,[]);
  if(process.env.NPC_ADMIN_SCREENSHOT){await page.setViewport({width:390,height:1000});await page.screenshot({path:process.env.NPC_ADMIN_SCREENSHOT,fullPage:true});}
});
