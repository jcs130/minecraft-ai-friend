import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import world from '../../../../packages/agent-harness-py/integrations/cortico-resident/world.mjs';
import {siteFixture} from './helpers.mjs';
import {ResidentTurns} from '../src/resident-turns.mjs';

const worker = () => 'rwt_' + randomBytes(32).toString('base64url');
function binding(id, bodyKind, key) {
  return {id, name: id, bodyKind, bodyId: randomUUID(), characterId: randomUUID(), ownerGameId: randomUUID(),
          workerHash: createHash('sha256').update(key).digest('hex')};
}

test('active grants renew across days and portal restart, while inactive grants expire', async t => {
  const key = worker(), role = binding('active', 'maid', key);
  const f = await siteFixture(t, {residentTurns: [role]});
  const store = f.portal.store, owner = store.db.prepare('SELECT id FROM owners LIMIT 1').get();
  store.db.prepare('INSERT INTO ownerships(owner_id,agent_uuid,proof,created_at) VALUES(?,?,?,?)').run(owner.id,role.ownerGameId,'fixture',Date.now());
  const {data} = await f.admin.request('/resident-turns/active/grant', 'POST', {});
  let now = Date.now();
  const reconnect = () => new ResidentTurns(f.config, store, {now: () => now});
  let relay = reconnect();
  const poll = () => relay.machine({method:'POST', headers:{authorization:'Bearer '+data.token}}, {},
                                   '/api/v1/resident-turns/active/poll', async () => ({}), () => {});
  for (let i=0; i<4; i++) {
    now += 10 * 3600_000;
    assert.equal(await poll(), true);
    relay = reconnect();
  }
  now += 13 * 3600_000;
  await assert.rejects(poll(), e => e.status === 401);
});
async function post(url, op, key, body = {}) {
  const r = await fetch(url + '/' + op, {method: 'POST', headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
                                         body: JSON.stringify(body)});
  return {status: r.status, data: await r.json()};
}
function plan(role) {
  return {kind: 'plan', instructions: 'Use the current scene.',
          scene: {goal: '巡查营地', recentBodyResults: []}, bodyId: role.bodyId, characterId: role.characterId,
          bodyKind: role.bodyKind, ownerGameId: role.ownerGameId};
}
for (const kind of ['maid', 'numen']) {
  test(kind + ' owner grant, resident turn, Cortico wake, accepted decision and disconnected fallback', async t => {
    const key = worker(), role = binding('resident', kind, key), other = binding('another', 'numen', worker());
    const f = await siteFixture(t, {residentTurns: [role, other]});
    const api = '/resident-turns', grant = api + '/resident/grant', base = f.origin + '/api/v1' + api + '/resident';
    const owner = f.portal.store.db.prepare('SELECT id FROM owners LIMIT 1').get();
    assert.equal((await f.admin.request(grant, 'POST', {})).status, 404);
    f.portal.store.db.prepare('INSERT INTO ownerships(owner_id,agent_uuid,proof,created_at) VALUES(?,?,?,?)')
      .run(owner.id, role.ownerGameId, 'fixture', Date.now());
    assert.deepEqual((await f.admin.request(api)).data.residents.map(r => r.bodyId), [role.bodyId]);
    assert.equal((await f.admin.request(grant, 'POST', {}, {'X-CSRF-Token': 'bad'})).status, 403);
    assert.equal((await f.admin.request(api + '/another/grant', 'POST', {})).status, 404);
    const {data: session, status} = await f.admin.request(grant, 'POST', {});
    assert.equal(status, 201);
    assert.equal((await post(base, 'offer', key, plan(role))).data.state, 'local');
    assert.equal((await post(base, 'offer', key, plan(other))).status, 400);
    assert.equal((await post(base, 'offer', key, {...plan(role), ownerGameId: other.ownerGameId})).status, 400);
    assert.equal((await post(base, 'poll', key)).status, 401);
    assert.equal((await post(base.replace('/resident-turns/resident', '/resident-turns/another'), 'poll', session.token)).status, 401);
    const file = path.join(f.root, 'session.json');
    await writeFile(file, JSON.stringify(session));
    const extension = world.create({cfg: {sessionFile: file}});
    let delivered;
    const answer = {steps: [], agenda: [{afterMinutes: 0, forMinutes: 10, goal: '巡查营地', evidence: '营地周边已检查'}]};
    await extension.start({log: {warn() {}}, async pushEvent(event) {
      delivered = JSON.parse(event.text.split('\n').at(-1));
      assert.equal(delivered.resident.bodyKind, kind);
      await extension.tools()[0].handler({id: delivered.id, answer}, {});
    }});
    try {
      await post(base, 'poll', session.token);
      assert.deepEqual((await post(base, 'offer', key, plan(role))).data, {state: 'answered', id: delivered.id, answer});
      assert.equal((await post(base, 'reply', session.token, {id: delivered.id, answer})).status, 409);
    } finally { await extension.stop(); }
    const pending = post(base, 'offer', key, plan(role));
    let old;
    for (let i = 0; i < 25 && !old; i++) { old = (await post(base, 'poll', session.token)).data.turn; if (!old) await delay(10); }
    assert.ok(old);
    assert.equal((await f.admin.request(grant, 'DELETE')).status, 200);
    assert.equal((await pending).data.state, 'local');
    assert.equal((await post(base, 'reply', session.token, {id: old.id, answer})).status, 401);
    assert.equal((await post(base, 'offer', key, plan(role))).data.state, 'local');
    const next = (await f.admin.request(grant, 'POST', {})).data;
    f.portal.store.db.prepare('DELETE FROM ownerships WHERE owner_id=?').run(owner.id);
    assert.equal((await post(base, 'poll', next.token)).status, 401);
  });
}
