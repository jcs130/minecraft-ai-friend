import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {siteFixture,testPassword} from './helpers.mjs';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
let executablePath;
for(const candidate of [process.env.PORTAL_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean)){try{await fs.access(candidate);executablePath=candidate;break;}catch{}}
test('role owner can open the website avatar dialog and publish an uploaded picture',{skip:!executablePath},async t=>{
 const f=await siteFixture(t);
 const browser=await puppeteer.launch({executablePath,headless:true,args:process.platform==='linux'&&process.env.GITHUB_ACTIONS==='true'?['--no-sandbox']:[]});
 t.after(()=>browser.close());const page=await browser.newPage();await page.setViewport({width:390,height:844});
 await page.goto(f.origin+'/#agents',{waitUntil:'domcontentloaded'});
 await page.evaluate(async password=>{const session=await(await fetch('/api/v1/session')).json();const r=await fetch('/api/v1/sessions',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({username:'fixture-admin',password})});if(!r.ok)throw Error('Fixture login failed');},testPassword);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-action="player-avatar"]');
 await page.click('[data-action="player-avatar"]');await page.waitForSelector('#player-avatar-form');
 await (await page.$('#player-avatar-form input[type=file]')).uploadFile(fileURLToPath(new URL('../public/assets/scenes/lantern-village-960.webp',import.meta.url)));
 await page.click('#player-avatar-form input[name=publicConsent]');await page.click('#player-avatar-form button[type=submit]');
 await page.waitForFunction(()=>!document.querySelector('#modal').open);
 const response=await fetch(f.origin+'/api/v1/avatars/'+f.agent.name);assert.equal(response.headers.get('content-type'),'image/webp');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
});
