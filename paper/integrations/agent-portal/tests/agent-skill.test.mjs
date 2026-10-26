import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { siteFixture } from './helpers.mjs';
import { agentSkill, skillAt } from '../src/agent-skill.mjs';
import { loadConfig } from '../src/config.mjs';

test('public Agent skill download matches the pinned release and never embeds a private credential in the link', async t => {
  const f = await siteFixture(t);
  const meta = (await f.client().request('/site')).data.agentSkill;
  assert.equal(meta.sha256, agentSkill.sha256); assert.ok(!meta.url.includes('?'));
  const response = await fetch(f.origin + meta.url), bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.equal(bytes.length, agentSkill.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), agentSkill.sha256);
  const head = await fetch(f.origin + meta.url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(agentSkill.bytes)); assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await fetch(f.origin + '/downloads/.env')).status, 404);
});

test('earlier reviewed Skill links keep their bytes when the current bundle changes', async t => {
  const f = await siteFixture(t);
  for (const [version, digest] of [
    ['1.0.0', '3d1676e86f31396071866c64ce87d9e6820e1530b755c4221f04c22a15f94669'],
    ['1.1.0', '6a1be95fa174e37c330a756ffdbc32f0924254099390d1fc99a236c451d8fe7d'],
    ['1.2.0', 'a0618f8c2d75a71d42ca532973a43f7d837e91ee47707a7ce9de2d9167cf858b'],
    ['1.2.1', '1c3c57962babb47fd2ca2100b12e1d941949e85e6774b63b5cbd1a874e435c66'],
  ]) {
    const url = `/downloads/qiandengji-agent-${version}.zip`;
    assert.equal(skillAt(url)?.version, version);
    const response = await fetch(f.origin + url), bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  }
});

test('reviewed Skill links redirect directly to the configured OSS prefix without forwarding cookies or query strings', async t => {
  const baseUrl = 'https://downloads.example.test/qiandengji/skills/';
  const f = await siteFixture(t, { downloads: { baseUrl } });
  for (const version of ['1.0.0', '1.1.0', '1.2.0', '1.2.1', agentSkill.version]) {
    const route = `/downloads/qiandengji-agent-${version}.zip`, release = skillAt(route);
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(f.origin + route + '?token=must-not-forward&url=https://evil.example', {
        method, redirect: 'manual', headers: { Cookie: 'unrelated=must-not-forward' },
      });
      assert.equal(response.status, 307);
      assert.equal(response.headers.get('location'), baseUrl + release.sha256 + '/' + release.filename);
      assert.equal(response.headers.get('x-checksum-sha256'), release.sha256);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await response.arrayBuffer()).byteLength, 0);
    }
  }
  assert.equal((await fetch(f.origin + '/downloads/config.local.json', { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(f.origin + '/downloads/qiandengji-agent-9.9.9.zip', { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(f.origin + '/downloads/.env', { redirect: 'manual' })).status, 404);
});

test('permanent Skill download resolves exactly the current reviewed bytes',async t=>{
 const f=await siteFixture(t),reply=await fetch(f.origin+'/downloads/agent-skill'),bytes=Buffer.from(await reply.arrayBuffer());
 assert.equal(reply.status,200);assert.equal(createHash('sha256').update(bytes).digest('hex'),agentSkill.sha256);
 const mirror=await siteFixture(t,{downloads:{baseUrl:'https://downloads.example.test/qiandengji/'}});
 const head=await fetch(mirror.origin+'/downloads/agent-skill?token=private',{method:'HEAD',redirect:'manual'});
 assert.equal(head.status,307);assert.equal(head.headers.get('location'),'https://downloads.example.test/qiandengji/'+agentSkill.sha256+'/'+agentSkill.filename);
});

test('download mirror defaults to local delivery and rejects credentials, plaintext or arbitrary query parameters in configuration', () => {
  assert.equal(loadConfig({ skipLocalConfig: true }).downloads.baseUrl, '');
  for (const baseUrl of ['http://downloads.example.test/', 'https://user:secret@downloads.example.test/',
    'https://downloads.example.test/?Signature=secret', 'https://downloads.example.test/#fragment',
    'https://downloads.example.test/%2e%2e/private', 'file:///private/', null]) {
    assert.throws(() => loadConfig({ skipLocalConfig: true, downloads: { baseUrl } }));
  }
});
