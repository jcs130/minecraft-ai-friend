import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { BodyHandoffCoordinator, BodyHandoffStore } from '../src/body-handoff.mjs';
import { bodyHandoffTool } from '../src/body-handoff-tool.mjs';
import { hostingServer } from '../src/http.mjs';
import { mineflayerHandoffAdapter } from '../src/player-body-handoff.mjs';

const playerUuid = randomUUID();
const characterId = 'fixture-character';
const authority = { ownerId: randomUUID() };
const controller = { characterId, bodyId: playerUuid, kind: 'mineflayer', generation: 1 };
const mineflayer = { kind: 'mineflayer', bodyId: playerUuid, playerUuid };
const numen = { ...mineflayer, kind: 'numen' };
const request = { characterId, requestId: 'fixture-switch', targetKind: 'numen', expectedGeneration: 1 };
const proof = (body, state) => ({ bodyId: body.bodyId, playerUuid: body.playerUuid, state });

function fixture(t, overrides = {}) {
  const store = new BodyHandoffStore(':memory:');
  store.register({ characterId, ...authority, active: mineflayer, targets: [numen], autonomous: true });
  const calls = [];
  const handoff = new BodyHandoffCoordinator({ store, adapters: {
    mineflayer: { release: async context => {
      calls.push('release');
      return overrides.release ? await overrides.release(context) : proof(context.source, 'released');
    } },
    numen: { preflight: overrides.preflight, acquire: async context => {
      calls.push('acquire');
      return overrides.acquire ? await overrides.acquire(context) : proof(context.target, 'acquired');
    } },
  } });
  t.after(async () => { await handoff.close(); store.close(); });
  return { handoff, store, calls };
}

test('source admission freezes before release, duplicate shares one transfer and successor owns new epoch', async t => {
  const { promise, resolve } = Promise.withResolvers();
  const { handoff, calls } = fixture(t, { release: () => promise });
  const running = handoff.switchBody(request, authority);
  assert.equal(handoff.lookup(request, authority).phase, 'releasing');
  assert.equal((await handoff.switchBody(request, authority)).status, 'switching');
  await assert.rejects(handoff.switchBody({ ...request, requestId: 'other' }, authority), { code: 'BODY_HANDOFF_BUSY' });
  assert.throws(() => handoff.assertControl(controller, authority), { code: 'BODY_HANDOFF_CONTROL_CHANGED' });
  resolve(proof(mineflayer, 'released'));
  const done = await running;
  assert.equal(done.status, 'completed');
  assert.equal(done.generation, 2);
  assert.equal(done.activeKind, 'numen');
  assert.deepEqual(calls, ['release', 'acquire']);
  assert.deepEqual(await handoff.switchBody(request, authority), done);
  assert.throws(() => handoff.assertControl(controller, authority), { code: 'BODY_HANDOFF_CONTROL_CHANGED' });
  handoff.assertControl({ ...controller, kind: 'numen', generation: 2 }, authority);
});

test('preflight preserves old control, wrong native proof fences both sides, duplicate never retries', async t => {
  const absent = fixture(t, { preflight: () => false });
  assert.equal((await absent.handoff.switchBody(request, authority)).reason, 'TARGET_NOT_READY');
  absent.handoff.assertControl(controller, authority);
  assert.deepEqual(absent.calls, []);
  const unknown = fixture(t, { release: () => ({ ...proof(mineflayer, 'released'), playerUuid: randomUUID() }) });
  const result = await unknown.handoff.switchBody(request, authority);
  assert.equal(result.status, 'recovery_required');
  assert.equal(result.activeKind, null);
  assert.deepEqual(await unknown.handoff.switchBody(request, authority), result);
  assert.deepEqual(unknown.calls, ['release']);
});

test('a configured incompatible target cannot make the current physical body give up control', async t => {
  const store = new BodyHandoffStore(':memory:');
  t.after(() => store.close());
  const maid = { kind:'maid', bodyId:'native-maid', entityUuid:randomUUID() };
  store.register({ characterId, ...authority, active:mineflayer, targets:[numen,maid] });
  let writes = 0;
  const handoff = new BodyHandoffCoordinator({ store, adapters:{
    mineflayer:{ release() {writes++;} }, numen:{ acquire() {writes++;} }, maid:{ acquire() {writes++;} },
  }});
  assert.deepEqual(handoff.current(characterId,authority).targetKinds,['numen']);
  await assert.rejects(handoff.switchBody({...request,targetKind:'maid'},authority),{code:'BODY_HANDOFF_TARGET_UNAVAILABLE'});
  handoff.assertControl(controller,authority);
  assert.equal(writes,0);
});

test('startup records the interrupted stage and never replays it', t => {
  const { handoff, store, calls } = fixture(t);
  const { context } = handoff.reserve(request, authority.ownerId);
  store.transition(context, 'released');
  store.markInterrupted();
  assert.equal(handoff.lookup(request, authority).status, 'recovery_required');
  assert.equal(handoff.lookup(request, authority).phase, 'acquiring');
  assert.equal(handoff.lookup(request, authority).generation, 2);
  assert.deepEqual(calls, []);
});

test('recovery accepts only original native proofs from both ends', async t => {
  const { handoff, calls } = fixture(t, { acquire: () => { throw new Error('lost acquire reply'); } });
  const held = await handoff.switchBody(request, authority);
  const prove = (body, state, operationId = request.requestId) => ({
    ...proof(body, state), operationId, generation: held.generation,
  });
  handoff.adapters.mineflayer.result = () => prove(mineflayer, 'released');
  handoff.adapters.numen.result = () => prove(numen, 'acquired', 'someone-elses-original');
  assert.deepEqual(await handoff.reconcile(request, authority), held);
  handoff.adapters.numen.result = () => prove(numen, 'acquired');
  const done = await handoff.reconcile(request, authority);
  assert.equal(done.status, 'completed');
  assert.equal(done.phase, 'reconciled');
  assert.equal(done.generation, held.generation);
  assert.deepEqual(calls, ['release', 'acquire']);
});

test('agent tool can end its turn and queue one immutable authorized request', async t => {
  const { handoff, calls } = fixture(t);
  let driverReady = true;
  const tool = bodyHandoffTool({ handoff, controller, authority, assertDriver: () => {
    if (!driverReady) throw new Error('stale driver');
  } });
  const input = { action: 'switch', targetKind: 'numen' };
  const accepted = await tool.handler(input, { callId: 'native-first' });
  assert.equal(accepted.endsTurn, true);
  assert.equal(accepted.data.status, 'switching');
  assert.deepEqual((await tool.handler(input, { callId: 'native-first' })).data, accepted.data);
  await handoff.close();
  driverReady = false;
  const result = await tool.handler({ action: 'lookup', requestId: accepted.data.requestId }, {});
  assert.equal(result.data.status, 'completed');
  assert.deepEqual(calls, ['release', 'acquire']);
  await assert.rejects(tool.handler(input, { callId: 'late' }), /stale driver/);
});

test('a controller port cannot substitute a role or keep autonomous permission after revocation', async t => {
  const { handoff, store, calls } = fixture(t);
  const send = handoff.controllerPort(controller, authority);
  assert.equal((await send({ op: 'current', characterId })).activeKind, 'mineflayer');
  await assert.rejects(send({ op: 'controllerSwitch', ...request, characterId: 'other-role' }),
    { code: 'BODY_HANDOFF_CONTROL_CHANGED' });
  await assert.rejects(send({ op: 'controllerSwitch', ...request, expectedGeneration: 2 }),
    { code: 'BODY_HANDOFF_CONTROL_CHANGED' });
  store.register({ characterId, ...authority, active: mineflayer, targets: [numen] });
  await assert.rejects(send({ op: 'controllerSwitch', ...request }), { code: 'BODY_HANDOFF_AUTONOMY_DISABLED' });
  assert.deepEqual(calls, []);
});

test('character body API stays on existing loopback authority and rechecks owner', async t => {
  const { handoff } = fixture(t);
  const key = randomBytes(32);
  const api = hostingServer({ hosting: {}, bodyHandoff: handoff, serviceKey: key, grantKey: randomBytes(32) });
  const address = await api.listen();
  t.after(() => new Promise(resolve => api.server.close(resolve)));
  const post = (data, headers) => fetch(`http://127.0.0.1:${address.port}/v1/character-bodies`, {
    method: 'POST', body: JSON.stringify(data), headers: {
      'content-type': 'application/json', authorization: `Bearer ${key.toString('base64url')}`, ...headers,
    },
  });
  assert.equal((await post({ op: 'current', characterId, ...authority }, { cookie: 'website=value' })).status, 403);
  assert.equal((await post({ op: 'current', characterId, ownerId: randomUUID() })).status, 404);
  assert.equal((await post({ op: 'current', characterId, ...authority }, { authorization: 'Bearer wrong' })).status, 401);
  const selected = await post({ op: 'switch', ...request, ...authority });
  assert.equal(selected.status, 202);
  assert.equal((await selected.json()).requestId, request.requestId);
  await handoff.close();
  const completion = await post({ op: 'lookup', ...request, ...authority });
  assert.equal((await completion.json()).status, 'completed');
});

test('the original player waits for one connection witness and a matching saved receipt', async () => {
  const order = [];
  let read = 0;
  const adapter = mineflayerHandoffAdapter({
    clientFor: (_id, exactUuid, { generation }) => ({
      async witnessBodyHandoff(value) {
        assert.equal(value.generation, generation);
        assert.equal(exactUuid, playerUuid);
        order.push('sent');
      },
      async releaseForBodyHandoff(value) {
        assert.equal(value.requestId, request.requestId);
        order.push('disconnect');
        return { state: 'disconnected' };
      },
    }),
    witness: {
      async arm(_body, cursor) {
        assert.equal(cursor.expect, 'saved');
        order.push('armed');
        return { nonce: 'fixture-only' };
      },
      async read(_body, cursor) {
        assert.equal(cursor.requestId, request.requestId);
        order.push('read');
        read++;
        return { uuid: playerUuid, online: read < 3, witnessed: read >= 2, saved: read >= 4 };
      },
    },
  });
  const result = await adapter.release({
    operationId: request.requestId, characterId, generation: 1, source: mineflayer, target: numen,
  });
  assert.equal(result.state, 'released');
  assert.deepEqual(order, ['armed', 'sent', 'read', 'read', 'disconnect', 'read', 'read']);
});
