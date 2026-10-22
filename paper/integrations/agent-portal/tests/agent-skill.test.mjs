import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { siteFixture } from './helpers.mjs';
import { agentSkill } from '../src/agent-skill.mjs';

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
