import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { siteFixture } from './helpers.mjs';
import { agentSkill, skillAt } from '../src/agent-skill.mjs';

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
  ]) {
    const url = `/downloads/qiandengji-agent-${version}.zip`;
    assert.equal(skillAt(url)?.version, version);
    const response = await fetch(f.origin + url), bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  }
});
