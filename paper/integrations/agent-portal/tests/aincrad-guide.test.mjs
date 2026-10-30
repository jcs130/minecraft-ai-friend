import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { siteFixture } from './helpers.mjs';

test('Aincrad release is readable without login or JavaScript and serves responsive concept artwork', async t => {
  const f = await siteFixture(t);
  const response = await fetch(f.origin + '/aincrad.html');
  assert.equal(response.status, 200);
  const dom = new JSDOM(await response.text()); t.after(() => dom.window.close());
  const document = dom.window.document;
  assert.equal(document.querySelectorAll('script,form').length, 0);
  assert.match(document.querySelector('h1').textContent, /重返艾恩葛朗特.*破晓攻略/);
  assert.match(document.body.textContent, /Vortex六职业/);
  assert.match(document.body.textContent, /后续楼层逐步建设/);
  assert.match(document.body.textContent, /耗8魔力/);
  assert.match(document.body.textContent, /开页耗2魔力/);
  assert.match(document.body.textContent, /聊天不能替代任务验收和发奖/);
  for(const id of ['knight','mage','ranger','cleric','beastmaster','engineer'])assert.match(document.body.textContent,new RegExp(id));
  assert.match(document.body.textContent,/奖励待核对/);
  assert.match(document.body.textContent,/必须穿齐头盔、胸甲、护腿、靴子/);
  assert.match(document.body.textContent,/不强制带剑/);
  assert.equal(document.querySelectorAll('a[href^="/#"]').length >= 4, true);
  for (const element of document.querySelectorAll('link[rel="stylesheet"],img')) {
    const url = element.getAttribute('href') || element.getAttribute('src');
    const asset = await fetch(f.origin + url);
    assert.equal(asset.status, 200, url); await asset.arrayBuffer();
  }
  const hero = document.querySelector('.season-art');
  assert.match(hero.alt, /概念图.*并非地图实景/);
  assert.equal(hero.getAttribute('fetchpriority'), 'high');
  for (const variant of hero.getAttribute('srcset').split(',')) {
    const [url] = variant.trim().split(/\s+/);
    const art = await fetch(f.origin + url);
    assert.equal(art.status, 200, url);
    assert.match(art.headers.get('content-type'), /image\/webp/);
    const bytes = Buffer.from(await art.arrayBuffer());
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(bytes.length < 350000, 'Each responsive image must remain small enough for the homepage');
  }
  const css = await fetch(f.origin + '/aincrad.css', { method:'HEAD' });
  assert.equal(css.status, 200); assert.equal((await css.arrayBuffer()).byteLength, 0);
});

test('the public guide distinguishes current rescue, ended runs and ordinary tower starts', async t => {
  const f = await siteFixture(t);
  const document = new JSDOM(await (await fetch(f.origin + '/aincrad.html')).text());
  t.after(() => document.window.close());
  const text = document.window.document.body.textContent;
  assert.match(document.window.document.querySelector('#latest').textContent, /已在正式服生效/);
  assert.match(text, /AF 0\.4\.47\.34-vortex/);
  assert.match(text, /常规限时30分钟/);
  assert.match(text, /普通断线期间继续计时/);
  assert.match(text, /第3次结束/);
  assert.match(text, /救援和旧存档点失效/);
  assert.match(text, /存活者留在原地，不会自动传送/);
  assert.match(text, /每次新开从第1层开始，历史通关不跳层/);
  assert.match(text, /开场免费/);
  assert.match(text, /arena stash putslot/);
  assert.match(text, /profession info/);
  assert.match(text, /tasks abandon/);
  assert.match(text, /同世界48格/);
});
