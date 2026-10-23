import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { siteFixture } from './helpers.mjs';
import { newSecret } from '../src/store.mjs';
import { runAgentAccess, parseInviteLink } from '../public/agent-register.mjs';
import { projectRoot } from '../src/config.mjs';
import { agentSkill } from '../src/agent-skill.mjs';

async function invite(f) { const response = await f.admin.request('/agent-invites', 'POST', { label: 'Private owner label', username: 'ag_JoinLink' }); assert.equal(response.status, 201); return response.data; }
async function inspect(f, token) { const response = await fetch(f.origin + '/api/v1/agent-access/invitation', { headers: { Authorization: 'Bearer ' + token } }); return { status: response.status, data: await response.json() }; }
test('copyable onboarding link, prompt, Skill and readiness share the exact invitation and canonical origin', async t => {
  const f = await siteFixture(t), value = await invite(f), parsed = new URL(value.onboarding.link);
  assert.equal(parsed.origin, f.origin); assert.equal(parsed.pathname, '/join'); assert.equal(parsed.search, ''); assert.equal(new URLSearchParams(parsed.hash.slice(1)).get('invite'), value.token);
  assert.match(value.onboarding.prompt, /自己的 Agent 框架/); assert.match(value.onboarding.prompt, /游戏建号桥当前尚未上线/); assert.match(value.onboarding.prompt, /scripts\/import-account.mjs/); assert.match(value.onboarding.prompt, /\/mycli status/);
  assert.ok(!value.onboarding.prompt.includes('clientSecret=')); assert.equal(value.onboarding.skill.version, agentSkill.version);
  const data = (await inspect(f, value.token)).data; assert.equal(data.state, 'available'); assert.equal(data.username, 'ag_JoinLink'); assert.equal(data.onboarding.prompt, value.onboarding.prompt);
  for (const forbidden of ['Private owner label', 'owner_id', 'playerUuid', 'clientId', 'clientSecret', 'passwordHash']) assert.ok(!JSON.stringify(data).includes(forbidden), forbidden);
  assert.equal((await f.admin.request('/agent-invites')).data.invites[0].state, 'available'); assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n, 0);
});
test('invitation inspection is read-only for used, expired, revoked and invalid invitations', async t => {
  const f = await siteFixture(t), value = await invite(f);
  const response = await fetch(f.origin + '/api/v1/agent-access/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + value.token }, body: JSON.stringify({ requestId: randomUUID(), username: 'ag_JoinLink', clientSecret: newSecret() }) }); assert.equal(response.status, 201);
  assert.equal((await inspect(f, value.token)).data.state, 'used'); await f.admin.request('/agent-invites/' + value.id, 'DELETE'); assert.equal((await inspect(f, value.token)).data.state, 'revoked');
  const expired = await invite(f); f.portal.store.db.prepare('UPDATE agent_invites SET expires_at=? WHERE id=?').run(Date.now() - 1000, expired.id); assert.equal((await inspect(f, expired.token)).data.state, 'expired');
  assert.equal((await inspect(f, 'qdi_' + newSecret())).status, 401);
  const unrelated = await fetch(f.origin + '/api/v1/agent-access/invitation', { headers: { Origin: 'https://untrusted.invalid', Authorization: 'Bearer ' + value.token } }); assert.equal(unrelated.status, 403);
});
test('public join page and Skill remain useful to a fetch-only Agent and never contain an owner invitation', async t => {
  const f = await siteFixture(t), value = await invite(f), page = await fetch(value.onboarding.link);
  const html = await page.text(); assert.equal(page.status, 200); assert.equal(page.headers.get('referrer-policy'), 'no-referrer'); assert.ok(!html.includes(value.token)); assert.match(html, /不执行 JavaScript/); assert.match(html, /references\/invite.md/);
  assert.equal((await fetch(f.origin + '/join', { method: 'HEAD' })).status, 200);
  const discovery = (await f.admin.request('/agent-access')).data; assert.equal(discovery.joinPage, '/join'); assert.equal(discovery.skill.version, agentSkill.version);
  const old = await fetch(f.origin + '/downloads/qiandengji-agent-1.0.0.zip'); assert.equal(old.status, 200); assert.equal(old.headers.get('content-length'), '2705570');
});
test('full link helper validates origin and private files, exchanges once and preserves its identity on retry', async t => {
  const f = await siteFixture(t), value = await invite(f), linkFile = path.join(f.root, 'link.txt'), file = path.join(f.root, 'identity.json');
  await fs.writeFile(linkFile, value.onboarding.link, { mode: 0o600 }); const output = [];
  const args = ['register', '--username', 'ag_JoinLink', '--invite-url-file', linkFile, '--identity-file', file];
  assert.equal(await runAgentAccess(args, line => output.push(line)), 0); const identity = JSON.parse(await fs.readFile(file));
  assert.equal(await runAgentAccess(args, line => output.push(line)), 0); assert.equal(JSON.parse(output.at(-1)).duplicate, true); assert.equal(JSON.parse(await fs.readFile(file)).gamePassword, identity.gamePassword);
  assert.ok(!output.join().includes(identity.gamePassword)); assert.ok(!output.join().includes(value.token));
  assert.equal(await runAgentAccess(['status', '--identity-file', file], line => output.push(line)), 0); assert.equal(JSON.parse(output.at(-1)).gameAccountCreated, false);
  for (const link of ['https://attacker:password@example.com/join#invite=' + value.token, f.origin + '/join?invite=' + value.token, f.origin + '/other#invite=' + value.token, f.origin + '/join#invite=' + value.token + '&invite=' + value.token]) assert.throws(() => parseInviteLink(link));
  await assert.rejects(runAgentAccess([...args, '--portal', 'https://other.invalid'], () => {}), /INVITE_PORTAL_MISMATCH/);
});
test('join page reads the fragment only in memory and copies a complete, current invitation prompt', async t => {
  const f = await siteFixture(t), value = await invite(f), html = await fs.readFile(path.join(projectRoot, 'public/join.html'), 'utf8');
  const dom = new JSDOM(html, { url: value.onboarding.link, runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const urls = [], copied = []; dom.window.AbortSignal = AbortSignal;
  dom.window.fetch = (url, options) => { urls.push(url); return fetch(f.origin + url, options); };
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async text => copied.push(text) } });
  await dom.window.eval('(async()=>{' + await fs.readFile(path.join(projectRoot, 'public/join.js'), 'utf8') + '\n})()');
  assert.equal(dom.window.document.querySelector('#join-name').textContent, 'ag_JoinLink'); assert.equal(dom.window.document.querySelector('#join-invite').hidden, false);
  dom.window.document.querySelector('#join-copy').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(copied[0], value.onboarding.prompt); assert.ok(urls.every(url => !url.includes(value.token))); assert.equal(dom.window.localStorage.length, 0);
  assert.equal(dom.window.document.querySelector('#join-download').href, f.origin + agentSkill.url);
});
