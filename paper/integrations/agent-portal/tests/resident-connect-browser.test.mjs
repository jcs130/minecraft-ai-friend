import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {siteFixture, testPassword} from './helpers.mjs';

const browserTest = {skip: !process.env.PORTAL_BROWSER_EXECUTABLE};
const workerToken = 'rwt_' + randomBytes(32).toString('base64url');
const workerHash = createHash('sha256').update(workerToken).digest('hex');
const slot = {id:'new-maid', bodyKind:'maid', bodyId:randomUUID(), ownerGameId:randomUUID(), workerHash};
const kirito = {id:'kirito', name:'桐人', bodyKind:'numen', bodyId:randomUUID(),
  characterId:randomUUID(), ownerGameId:randomUUID(), workerHash:'b'.repeat(64)};

async function fixture(t, options = {}) {
  const f = await siteFixture(t, {residentTurns:[kirito], residentCreationSlots:[slot], ...options});
  const store = f.portal.store, owner = store.db.prepare('SELECT id FROM owners LIMIT 1').get();
  store.db.prepare('INSERT INTO ownerships(owner_id,agent_uuid,proof,created_at) VALUES(?,?,?,?)').run(owner.id,kirito.ownerGameId,'fixture',Date.now());
  const browser = await puppeteer.launch({executablePath:process.env.PORTAL_BROWSER_EXECUTABLE, headless:true,
    args:['--disable-gpu','--no-first-run','--no-default-browser-check']});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({width:360,height:800});
  return {...f,store,owner,browser,page};
}
async function login(page) {
  await page.waitForSelector('#login:not([hidden])');
  await page.type('[name=username]', 'fixture-admin');
  await page.type('[name=password]', testPassword);
  await page.click('#login button');
  await page.waitForSelector('#login[hidden]');
}
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const visible = (page,id) => page.waitForSelector('#' + id, {visible:true});
const enabled = (page,id) => page.waitForSelector('#' + id + ':enabled', {visible:true});

test('the shared desktop authorization screen discloses both modes and confirms only once', browserTest, async t => {
  const {page,origin} = await fixture(t);
  const api = origin + '/api/v1/resident-onboarding/';
  const post = (path,token) => fetch(api+path,{method:'POST',headers:{'Content-Type':'application/json',
    ...(token ? {Authorization:'Bearer '+token} : {})},body:'{}'}).then(res=>res.json());
  const pending = await post('browser-start');
  await page.goto(origin+'/resident-connect.html?flow=browser&play=1#'+pending.id);
  await login(page);
  await visible(page,'player-authorization');
  assert.match(await page.$eval('#player-authorization',element=>element.textContent),/Mineflayer/);
  const requests = [];
  page.on('request',request=>{if (request.url().endsWith('/browser-approve')) requests.push(request.url());});
  await page.type('#browser-code',pending.code);
  await page.click('#browser-approve button');
  await page.waitForSelector('#browser-approve[hidden]');
  assert.equal(requests.length,1);
  const grant = await post('browser-status',pending.secret);
  assert.equal(grant.state,'authorized');
  assert.ok(grant.playerAuthorizationExpiresAt>Date.now());
  assert.equal(await noOverflow(page),true);
});

test('official login stays in the authorization flow, copies a one-time account code and reveals no resident secret', browserTest, async t => {
  const {page,origin,browser} = await fixture(t);
  await browser.defaultBrowserContext().overridePermissions(origin,['clipboard-read','clipboard-sanitized-write']);
  await page.goto(origin + '/resident-connect.html?flow=authorize');
  await login(page);
  await page.click('#authorize-code');
  await visible(page,'delivery');
  const code = await page.$eval('#code', e => e.value);
  assert.match(code,/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/);
  await page.click('#copy');
  await page.waitForFunction(() => document.querySelector('#result').textContent.includes('已复制'));
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()),code);
  assert.equal(await page.$eval('#legacy',e => e.hidden),true);
  assert.equal(await page.$eval('#install',e => e.hidden),true);
  assert.equal(await noOverflow(page),true);
  assert.equal(page.url(),origin + '/resident-connect.html?flow=authorize');
  assert.doesNotMatch(await page.content(), /rot_[a-zA-Z0-9_-]{43}|rdt_[a-zA-Z0-9_-]{43}/);
  const pair = () => fetch(origin+'/api/v1/resident-onboarding/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
  assert.equal((await pair()).status,200);
  assert.equal((await pair()).status,403);
});

test('authorization links only to the enabled resident installers and their reviewed OSS objects', browserTest, async t => {
  const baseUrl = 'https://download.example.test/releases/';
  const {page,origin} = await fixture(t,{downloads:{baseUrl,enabledPackages:['resident-cortico-api6','resident-neko']}});
  await page.goto(origin + '/resident-connect.html?flow=authorize');
  await visible(page,'install');
  await Promise.all([page.waitForNavigation(), page.click('#install a')]);
  assert.equal(new URL(page.url()).hash,'#resident');
  await visible(page,'resident');
  const hrefs = await page.$$eval('#resident-downloads a[download]', nodes=>nodes.map(n=>n.href));
  assert.deepEqual(hrefs.map(s=>new URL(s).pathname).sort(),[
    '/downloads/cortico-world-qiandengji-resident-api6-0.3.0.tgz','/downloads/qiandengji-resident-0.3.1.neko-plugin']);
  for (const url of hrefs) {
    const r = await fetch(url,{method:'HEAD',redirect:'manual'});
    assert.equal(r.status,307);
    assert.equal(r.headers.get('location'),baseUrl + r.headers.get('x-checksum-sha256') + '/' + url.split('/').at(-1));
  }
});

test('public body guidance works without JavaScript and lists no residents before login', browserTest, async t => {
  const {page,origin} = await fixture(t);
  await page.setJavaScriptEnabled(false);
  await page.goto(origin+'/join');
  const panel = await page.$eval('#plugin-start',e=>e.innerText);
  assert.match(panel,/自主换身暂未开放/);
  const link = await page.$eval('#plugin-start a[href*="flow=connect"]',e=>e.href);
  await page.goto(link);
  assert.match(await page.$eval('#body-status',e=>e.innerText),/登录后.*当前账号的已有居民/);
  assert.equal(await page.$$eval('#role option',rows=>rows.length),0);
  assert.equal((await fetch(origin+'/api/v1/resident-turns')).status,401);
  assert.equal(await noOverflow(page),true);
});

test('production website creation selects a maid even when the link asks for Numen', browserTest, async t => {
  const {page,origin} = await fixture(t,{residentCreationMode:'maid-only'});
  await page.goto(origin+'/resident-connect.html?flow=create&bodyKind=numen');
  await visible(page,'body-status');
  assert.match(await page.$eval('#body-status',el=>el.textContent),/自主换身暂未开放/);
  await login(page);
  await visible(page,'create');
  assert.equal(await page.$eval('#kind-label',el=>el.hidden),true);
  assert.equal(await page.$eval('#kind',el=>el.value),'maid');
  await page.type('#name','雾灯');
  await page.type('#persona','在营地招待朋友。');
  await page.click('#create-button');
  await page.waitForFunction(() => document.getElementById('result').textContent.includes('创建请求已保存'));
  assert.equal(new URL(page.url()).searchParams.get('bodyKind'),'maid');
});

test('existing Numen is connected by code, downloaded separately and revoked', browserTest, async t => {
  const {page,origin,browser,store,owner} = await fixture(t);
  await page.goto(origin + '/resident-connect.html');
  await page.waitForSelector('#login:not([hidden])');
  await browser.setCookie({name:'qd_portal_session',value:store.createSession(owner.id,'test').token,url:origin});
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await visible(page,'manage-residents');
  await Promise.all([page.waitForNavigation(),page.click('#manage-residents')]);
  await enabled(page,'role-code');
  assert.equal(await page.$eval('#role option', e => e.textContent), '桐人');
  await page.click('#role-code');
  await visible(page,'delivery');
  assert.equal(await page.$eval('#kind-caption',e=>e.textContent),'按身体类型筛选居民');
  const filterWrites=[];
  const trackFilterWrites=request=>{if(request.method()==='POST')filterWrites.push(request.url());};
  page.on('request',trackFilterWrites);
  await page.select('#kind','maid');
  assert.equal(await page.$eval('#delivery',e => e.hidden),true);
  assert.match(await page.$eval('#availability',e=>e.textContent),/查看其他类型/);
  await page.select('#kind','numen');
  assert.equal(await page.$eval('#role option',e=>e.textContent),'桐人');
  assert.deepEqual(filterWrites,[]);
  page.off('request',trackFilterWrites);
  await page.select('#flow','create');
  assert.match(await page.$eval('#availability',e=>e.textContent),/暂无可分配.*身体名额/);
  await page.select('#flow','connect');
  await page.click('#advanced summary');
  const grant = page.waitForResponse(r => r.url().endsWith('/kirito/grant') && r.request().method() === 'POST');
  await page.click('#download');
  assert.equal((await (await grant).json()).resident.bodyId,kirito.bodyId);
  await enabled(page,'release'); await page.click('#release');
  await page.waitForFunction(() => document.querySelector('#result').textContent.includes('已撤销'));
  assert.equal(store.db.prepare('SELECT count(*) n FROM resident_grants').get().n,0);
  assert.equal(await noOverflow(page),true);
});

test('new maid creation survives loss of a committed response and reload, then waits for worker readiness', browserTest, async t => {
  const {page,origin,store} = await fixture(t);
  const ids = [];
  page.on('request', req => {
    if (req.method()==='POST' && req.url()===origin+'/api/v1/resident-turns') ids.push(JSON.parse(req.postData()).requestId);
  });
  await page.goto(origin+'/resident-connect.html?flow=create&bodyKind=maid');
  await login(page);
  await visible(page,'create');
  await page.type('#name','小泉'); await page.type('#persona','喜欢照拂花草。');
  await page.evaluate(() => {
    const send = window.fetch;
    window.fetch = async (...args) => {
      const res = await send(...args);
      if (args[0]==='/api/v1/resident-turns' && args[1]?.method==='POST') throw TypeError('response lost');
      return res;
    };
  });
  await page.click('#create-button');
  await page.waitForFunction(() => document.querySelector('#create-button').textContent.includes('继续上次'));
  await page.reload(); await visible(page,'create');
  assert.equal(await page.$eval('#name',e => e.value),'小泉');
  await page.click('#create-button');
  await page.waitForFunction(() => document.querySelector('#availability').textContent.includes('准备身体'));
  assert.equal(ids.length,2); assert.equal(ids[0],ids[1]);
  const births = store.db.prepare('SELECT * FROM resident_births').all();
  assert.equal(births.length,1);
  assert.equal(await page.$eval('#role-code',e => e.disabled),true);
  const activation = await fetch(origin + '/api/v1/resident-turns/new-maid/activation', {method:'POST',
    headers:{Authorization:'Bearer '+workerToken,'Content-Type':'application/json'}, body:JSON.stringify({...slot,readyCharacterId:births[0].character})});
  assert.equal(activation.status,200);
  await enabled(page,'role-code'); await page.click('#role-code');
  await visible(page,'delivery');
  assert.equal(await noOverflow(page),true);
});
