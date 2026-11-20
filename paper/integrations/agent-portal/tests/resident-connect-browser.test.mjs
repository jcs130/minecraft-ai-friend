import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {siteFixture} from './helpers.mjs';

test('website owner selects a Numen, downloads its grant, and revokes it in the same browser', {
  skip: !process.env.PORTAL_BROWSER_EXECUTABLE,
}, async t => {
  const role = {id:'kirito', name:'桐人', bodyKind:'numen', bodyId:randomUUID(),
                characterId:randomUUID(), ownerGameId:randomUUID(), workerHash:'b'.repeat(64)};
  const f = await siteFixture(t, {residentTurns:[role]});
  const store = f.portal.store, owner = store.db.prepare('SELECT id FROM owners LIMIT 1').get();
  store.db.prepare('INSERT INTO ownerships(owner_id,agent_uuid,proof,created_at) VALUES(?,?,?,?)').run(owner.id,role.ownerGameId,'fixture',Date.now());
  const browser = await puppeteer.launch({executablePath:process.env.PORTAL_BROWSER_EXECUTABLE, headless:true,
                                          args:['--disable-gpu','--no-first-run','--no-default-browser-check']});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({width:390,height:844});
  await page.goto(f.origin + '/resident-connect.html');
  await page.waitForSelector('#login:not([hidden])');
  await browser.setCookie({name:'qd_portal_session',value:store.createSession(owner.id,'test').token,url:f.origin});
  await page.reload();
  await page.waitForSelector('form:not([hidden])');
  assert.equal(await page.$eval('option', e => e.textContent), '桐人 · Numen');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const grant = page.waitForResponse(r => r.url().endsWith('/kirito/grant') && r.request().method() === 'POST');
  await page.click('button[type=submit]');
  const reply = await grant;
  assert.equal(reply.status(), 201);
  assert.equal((await reply.json()).resident.bodyId, role.bodyId);
  await page.waitForSelector('#release:enabled');
  await page.click('#release');
  await page.waitForFunction(() => document.querySelector('#result').textContent.includes('已撤销'));
  assert.equal(store.db.prepare('SELECT count(*) n FROM resident_grants').get().n, 0);
});
