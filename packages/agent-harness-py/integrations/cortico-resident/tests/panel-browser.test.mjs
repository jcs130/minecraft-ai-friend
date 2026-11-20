import assert from 'node:assert/strict';
import {randomUUID, randomBytes, createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import test from 'node:test';
import definition from '../world.mjs';

const browserTest = {skip: !process.env.PORTAL_BROWSER_EXECUTABLE};
for (const kind of ['maid','numen']) {
  test('account authorization, local existing + new ' + kind + ' choices, retry and scoped grant', browserTest, async t => {
    const portal = new URL('../../../../../paper/integrations/agent-portal/', import.meta.url);
    const {siteFixture, testPassword} = await import(new URL('tests/helpers.mjs', portal));
    const puppeteer = createRequire(new URL('package.json', portal))('puppeteer-core');
    const token = 'rwt_' + randomBytes(32).toString('base64url');
    const slot = {id:'new-role', bodyKind:kind, bodyId:randomUUID(), ownerGameId:randomUUID(),
      workerHash:createHash('sha256').update(token).digest('hex')};
    const role = {id:'existing-role', bodyKind:kind, bodyId:randomUUID(), ownerGameId:randomUUID(),
      characterId:randomUUID(), workerHash:'f'.repeat(64), name:kind==='numen'?'桐人':'小泉'};
    const f = await siteFixture(t, {residentTurns:[role], residentCreationSlots:[slot]});
    const store = f.portal.store, owner = store.db.prepare('SELECT id FROM owners').get();
    store.db.prepare('INSERT INTO ownerships(owner_id,agent_uuid,proof,created_at) VALUES(?,?,?,?)').run(owner.id,role.ownerGameId,'fixture',Date.now());
    const secrets = new Map();
    const world = definition.create({cfg:{portalOrigin:f.origin},botDir:'test-'+kind,
      storeSecret:(key,v)=>secrets.set(key,v),secret:key=>secrets.get(key)});
    await world.start({log:{warn(){}},pushEvent:async()=>{}});
    t.after(() => world.stop());
    const js = await readFile(new URL('../panel.mjs', import.meta.url));
    const server = createServer((req,res) => {
      if (req.url==='/panel.mjs') {res.writeHead(200, {'Content-Type':'application/javascript'}); res.end(js);}
      else {res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end('<meta charset="utf-8"><main></main><script type="module">import client from "./panel.mjs"; await client.panels.pair.mount({root:document.querySelector("main"),invoke:window.invokeHost});</script>');}
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
    const browser = await puppeteer.launch({executablePath:process.env.PORTAL_BROWSER_EXECUTABLE,headless:true,
      args:['--disable-gpu','--no-first-run','--no-default-browser-check']});
    t.after(() => browser.close());
    const page = await browser.newPage(), receipts = [];
    await page.exposeFunction('invokeHost',async(method,args=[]) => {
      const data = await world.console().invoke('pair',method,args);
      receipts.push(data);
      return data;
    });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForSelector('.official[href]');
    assert.equal(await page.$eval('.official', el => el.href),f.origin+'/resident-connect.html?flow=authorize');
    async function authorize() {
      const response = await f.admin.request('/resident-onboarding/code','POST');
      assert.equal(response.status,201);
      await page.click('.authorize summary');
      await page.type('.manual input',response.data.code);
      await page.click('.manual button');
      await page.waitForSelector('.choices:not([hidden])');
      assert.equal(await page.$eval('.manual input',e=>e.value),'');
      await page.select('[name=body]',kind);
    }
    await page.click('.browser-start');
    await page.waitForSelector('.browser-link[href]:not([hidden])');
    const login = await browser.newPage();
    await login.goto(await page.$eval('.browser-link',el=>el.href));
    await login.waitForSelector('#login:not([hidden])');
    await login.type('[name=username]','fixture-admin');
    await login.type('[name=password]',testPassword);
    await login.click('#login button');
    await login.waitForSelector('#browser-approve:not([hidden])');
    await login.type('#browser-code',await page.$eval('.browser-code',el=>el.textContent));
    await login.click('#browser-approve button');
    await login.waitForFunction(() => document.querySelector('#result').textContent.includes('授权已完成'));
    assert.equal(new URL(login.url()).hash,'');
    assert.doesNotMatch(await login.content(), /r(?:ba|ot|dt)_[a-zA-Z0-9_-]{43}/);
    await login.close();
    await page.waitForSelector('.choices:not([hidden])');
    await page.select('[name=body]',kind);
    assert.equal(secrets.size,0);
    assert.equal(await page.$eval('[name=resident] option',e=>e.textContent),role.name);
    await page.click('.connect button');
    await page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('已配对'));
    assert.match([...secrets.values()].map(s=>Buffer.from(s,'base64url').toString()).join(''), /"id":"existing-role"/);
    await authorize();
    await page.select('[name=flow]','create');
    await page.type('[name=name]','新伙伴'); await page.type('[name=persona]','喜欢探险');
    const original = world.accountRequest.bind(world), ids = [];
    world.accountRequest = async (op,data) => {
      const reply = await original(op,data);
      if (op==='create') {
        ids.push(data.requestId);
        if (ids.length===1) throw Error('连接中断，请重试。');
      }
      return reply;
    };
    await page.click('.create button');
    await page.waitForFunction(() => document.querySelector('.create button').textContent.includes('继续上次'));
    await page.click('.create button');
    await page.waitForFunction(() => document.querySelector('.availability').textContent.includes('正在准备身体'));
    assert.equal(ids.length,2); assert.equal(ids[0],ids[1]);
    const births = store.db.prepare('SELECT * FROM resident_births').all();
    assert.equal(births.length,1); assert.equal(births[0].persona,'喜欢探险');
    const r = await fetch(f.origin + '/api/v1/resident-turns/new-role/activation',{method:'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, body:JSON.stringify({...slot, readyCharacterId:births[0].character})});
    assert.equal(r.status,200);
    await page.waitForSelector('.connect button:enabled',{visible:true});
    await page.click('.connect button');
    await page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('已配对 新伙伴'));
    assert.equal(secrets.size,1);
    assert.doesNotMatch(JSON.stringify(receipts), /r(?:ba|ot|dt)_[A-Za-z0-9_-]{43}/);
    const saved = JSON.parse(Buffer.from([...secrets.values()][0],'base64url'));
    assert.equal(saved.resident.characterId,births[0].character);
    assert.equal(saved.resident.bodyId,slot.bodyId);
    assert.match(saved.token,/^rdt_/); assert.ok(!saved.onboardingToken);
  });
}
