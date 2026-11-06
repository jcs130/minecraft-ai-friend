import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {siteFixture} from './helpers.mjs';
let executablePath;for(const candidate of [process.env.PORTAL_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].filter(Boolean)){try{await fs.access(candidate);executablePath=candidate;break;}catch{}}
test('hosting settings and conversation fit portrait, landscape and desktop with actual browser layout',{skip:!executablePath},async t=>{
  let browser;t.after(async()=>browser?.close());const f=await siteFixture(t);
  browser=await puppeteer.launch({executablePath,headless:true,args:['--disable-gpu','--no-first-run','--no-default-browser-check'],userDataDir:path.join(f.root,'hosting-browser')});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',request=>{if(request.isNavigationRequest())void request.respond({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/hosting.css"><script src="/hosting.js" defer></script></head><body><main style="max-width:1100px;margin:auto;padding:12px"><h1>千灯纪</h1></main></body></html>'});else void request.continue();});
  const artifacts=path.resolve('.local/hosted-ui');await fs.mkdir(artifacts,{recursive:true});
  for(const [width,height]of [[390,844],[844,390],[1440,900]])for(const view of ['agents','live']){
    await page.setViewport({width,height});await page.goto(f.origin+'/hosting-layout-test',{waitUntil:'networkidle0'});
    await page.evaluate(view=>{
      const catalogue={providers:[{id:'test',label:'测试供应商',models:[{id:'test-model',label:'测试模型'}]}],harnesses:[{id:'numen',label:'Numen 原生循环',mode:'numen',providers:['test'],available:false,reason:'独立密钥接线待验收。'},{id:'hub',label:'Harness Hub + MC 核心',mode:'harness',providers:['test'],available:false}]};
      window.QdHosting.mount({root:document.querySelector('main'),state:{view,site:{hosting:{enabled:true}},session:{owner:{id:'test'}},authorized:[{id:'test-role',isOwn:true,name:'测试角色'}],selectedChannel:'test-channel',channels:[{id:'test-channel',managed:true,playerName:'测试角色'}]},api:async()=>view==='agents'?{catalogue,profile:{revision:0,keyConfigured:false}}:{messages:[{id:'message-test',text:'你好，准备去哪个副本探险？',state:'delivered'}],replies:[{id:'reply-test',body:'准备去公会接委托，先整理装备。'}]}});
    },view);
    await page.waitForSelector('.hosted-panel');
    if(view==='agents')await page.waitForFunction(()=>document.querySelector('.hosted-panel select')?.options.length>0);
    else await page.waitForSelector('.hosted-chat-row');
    assert.equal(await page.$eval('html',el=>el.scrollWidth<=innerWidth),true,`${view} ${width} overflow`);
    assert.equal(await page.$$eval('.hosted-panel button',buttons=>buttons.every(b=>b.getBoundingClientRect().height>=40)),true);
    await page.screenshot({path:path.join(artifacts,`${view}-${width}.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);
});
