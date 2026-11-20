import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { siteFixture } from './helpers.mjs';

const SITEMAP_PATHS = ['/', '/join', '/downloads.html', '/aincrad.html', '/agent-api.html', '/map.html', '/music.html', '/android.html'];

async function get(origin, path) {
  const response = await fetch(origin + path);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { response, status: response.status, type: response.headers.get('content-type'), csp: response.headers.get('content-security-policy'), text: buffer.toString('utf8') };
}

test('robots.txt, sitemap.xml and llms.txt are served as UTF-8 text or XML', async t => {
  const f = await siteFixture(t);
  const robots = await get(f.origin, '/robots.txt');
  assert.equal(robots.status, 200);
  assert.equal(robots.type, 'text/plain; charset=utf-8');
  assert.match(robots.text, /^User-agent: \*\nAllow: \//);
  for (const bot of ['GPTBot', 'ChatGPT-User', 'ClaudeBot', 'Google-Extended', 'PerplexityBot', 'CCBot']) {
    assert.match(robots.text, new RegExp(`User-agent: ${bot}\\nAllow: /`));
  }
  assert.match(robots.text, /\nSitemap: https:\/\/mc\.kangqiang\.site\/sitemap\.xml\n?$/);

  const sitemap = await get(f.origin, '/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.equal(sitemap.type, 'application/xml; charset=utf-8');
  assert.doesNotMatch(sitemap.text, /#/);
  const locs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(locs, SITEMAP_PATHS.map(path => 'https://mc.kangqiang.site' + (path === '/' ? '/' : path)));

  const llms = await get(f.origin, '/llms.txt');
  assert.equal(llms.status, 200);
  assert.equal(llms.type, 'text/plain; charset=utf-8');
  assert.match(llms.text, /micro\.kangqiang\.site:25702/);
  assert.match(llms.text, /不要把 IP 写死/);
  assert.match(llms.text, /公共 DNS/);
  assert.match(llms.text, /\/api\/v1\/site/);
  assert.match(llms.text, /\/api\/v1\/server/);
});

test('sitemap paths exist and homepage exposes fallback metadata with a matching CSP hash', async t => {
  const f = await siteFixture(t);
  for (const path of SITEMAP_PATHS) {
    const page = await get(f.origin, path);
    assert.equal(page.status, 200, path);
  }

  const home = await get(f.origin, '/');
  assert.equal(home.type, 'text/html; charset=utf-8');
  assert.match(home.text, /rel="canonical" href="https:\/\/mc\.kangqiang\.site\/"/);
  assert.match(home.text, /property="og:image" content="https:\/\/mc\.kangqiang\.site\/season-art\/aincrad-dusk-20261030-960\.webp"/);
  assert.match(home.text, /name="twitter:card" content="summary_large_image"/);
  assert.match(home.text, /<noscript>[\s\S]*<h1>千灯纪：重返艾恩葛朗特<\/h1>[\s\S]*micro\.kangqiang\.site:25702[\s\S]*Java 1\.21\.1[\s\S]*href="\/join"[\s\S]*href="\/aincrad\.html"[\s\S]*href="\/downloads\.html"[\s\S]*href="\/api\/v1\/site"[\s\S]*href="\/api\/v1\/server"[\s\S]*<\/noscript>/);
  assert.equal((home.text.match(/id="main"/g) || []).length, 1, 'static homepage should have one #main, inside noscript');

  const jsonLd = home.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLd, 'JSON-LD script is present');
  const data = JSON.parse(jsonLd[1]);
  assert.equal(data['@type'], 'VideoGame');
  assert.equal(data.name, '千灯纪：重返艾恩葛朗特');
  assert.equal(data.url, 'https://mc.kangqiang.site/');
  assert.equal(data.gamePlatform, 'Minecraft Java Edition');
  assert.equal(data.additionalProperty?.value, 'micro.kangqiang.site:25702');

  const hash = createHash('sha256').update(jsonLd[1], 'utf8').digest('base64');
  assert.ok(home.csp.includes(`script-src 'self' 'sha256-${hash}'`), home.csp);
  assert.doesNotMatch(home.csp, /unsafe-inline/);

  const image = await get(f.origin, '/season-art/aincrad-dusk-20261030-960.webp');
  assert.equal(image.status, 200);
  assert.equal(image.type, 'image/webp');
});
