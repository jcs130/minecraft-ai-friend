import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { startMineflayerDevice } from '../device/mineflayer-device.mjs';
import { BodyHandoffCoordinator, BodyHandoffStore } from '../src/body-handoff.mjs';
import { createDeviceHandoffBroker } from '../src/device-handoff.mjs';
import { mineflayerHandoffAdapter } from '../src/player-body-handoff.mjs';

async function fixture(t) {
  const characterId = 'device-fixture';
  const playerUuid = randomUUID();
  const owner = { ownerId: randomUUID() };
  const mineflayer = { kind: 'mineflayer', playerUuid, bodyId: playerUuid };
  const numen = { ...mineflayer, kind: 'numen' };
  const store = new BodyHandoffStore(':memory:');
  store.register({ characterId, ...owner, active: mineflayer, targets: [numen], autonomous: true });
  const broker = createDeviceHandoffBroker({ timeoutMs: 1200 });
  let active = 'mineflayer', witnessed = false, lost = null;
  const calls = [];
  const adapter = mineflayerHandoffAdapter({ clientFor: broker.clientFor, witness: {
    arm() { witnessed = false; return { nonce: 'a'.repeat(64) }; },
    read() { return { uuid: playerUuid, kind: active, online: active === 'mineflayer', saved: active === 'none', witnessed }; },
  }, witnessTimeoutMs: 500 });
  const handoff = new BodyHandoffCoordinator({ store, adapters: {
    mineflayer: adapter,
    numen: {
      release({ source }) { assert.equal(active, 'numen'); calls.push('numen-release'); active = 'none'; return { ...source, state: 'released' }; },
      acquire({ target }) { assert.equal(active, 'none'); calls.push('numen-acquire'); active = 'numen'; return { ...target, state: 'acquired' }; },
    },
  } });
  broker.attach(handoff);
  const identity = { characterId, playerUuid, bodyId: playerUuid, ...owner };
  assert.throws(() => broker.enroll({ ...identity, playerUuid: randomUUID() }), { code: 'DEVICE_SCOPE_MISMATCH' });
  const enrollment = broker.enroll(identity);
  assert.throws(() => broker.enroll(identity), { code: 'DEVICE_ALREADY_ENROLLED' });
  const server = createServer((req, res) => {
    const end = res.end.bind(res);
    res.end = data => {
      if (lost?.(JSON.parse(data))) {
        lost = null;
        res.destroy();
        return res;
      }
      return end(data);
    };
    return broker.handle(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + server.address().port + enrollment.endpoint;
  const post = async (body, token = enrollment.token) => {
    const response = await fetch(endpoint, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ characterId, ...body }) });
    return { status: response.status, ...await response.json() };
  };
  const devices = [];
  t.after(async () => {
    for (const device of devices) await device.close();
    broker.revoke(characterId);
    await handoff.close();
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
    store.close();
  });
  function startDevice(createRuntime) {
    return startMineflayerDevice({ endpoint, characterId, token: enrollment.token,
      pollMs: 10, onStop: () => calls.push('stopped'), createRuntime }).then(device => {
      devices.push(device);
      return device;
    });
  }
  return { identity, post, startDevice, handoff, calls, owner, playerUuid, characterId, broker,
    active: () => active, change: next => { active = next; }, markWitness: () => { witnessed = true; },
    drop: predicate => { lost = predicate; } };
}

test('same device proof and original transaction across an HTTP reconnect, then rejoin at next generation', async t => {
  const f = await fixture(t);
  const { playerUuid, characterId, calls } = f;
  let latest, blocked = true;
  function lookup(port, requestId) { return port.request({ op: 'lookup', characterId, requestId }); }
  await f.startDevice(port => {
    latest = port;
    return {
      async prepareTargetBodyHandoff(next, requestId) {
        const receipt = await lookup(next, requestId);
        assert.equal(receipt.phase, 'releasing');
        assert.equal(next.playerUuid, playerUuid);
        assert.equal(next.generation, receipt.generation + 1);
        latest = next;
        return true;
      },
      async witnessBodyHandoff({ generation, requestId, nonce }) {
        const receipt = await lookup(latest, requestId);
        assert.equal(generation, receipt.generation);
        assert.equal(nonce, 'a'.repeat(64));
        calls.push('mineflayer-witness');
        f.markWitness();
      },
      async releaseForBodyHandoff() {
        calls.push('mineflayer-release');
        if (blocked) return { state: 'blocked' };
        f.change('none');
        f.drop(row => row.value?.accepted === true);
        return { state: 'disconnected' };
      },
      async connectForBodyHandoff(requestId) {
        const receipt = await lookup(latest, requestId);
        assert.equal(receipt.phase, 'acquiring');
        assert.equal(f.active(), 'none');
        f.change('mineflayer');
        calls.push('mineflayer-connect');
        return { state: 'connected', playerUuid };
      },
      async refreshBodyHandoff(requestId) { await lookup(latest, requestId); },
      async disconnect() {},
    };
  });
  const instanceId = randomUUID();
  assert.equal((await f.post({ op: 'hello', instanceId }, 'rdt_not_a_device')).status, 401);
  assert.equal((await f.post({ op: 'hello', instanceId, characterId: 'different' })).error, 'DEVICE_SCOPE_MISMATCH');
  assert.equal((await f.post({ op: 'hello', instanceId })).error, 'DEVICE_INSTANCE_CONFLICT');

  async function submit(requestId) {
    const original = { characterId, requestId, expectedGeneration: latest.generation, targetKind: 'numen' };
    await latest.request({ op: 'controllerSwitch', ...original });
    await f.handoff.close();
    return lookup(latest, requestId);
  }
  assert.equal((await submit('old-blocked')).reason, 'SOURCE_NOT_READY');
  assert.equal(f.active(), 'mineflayer');
  blocked = false;
  assert.equal((await submit('new-finished')).status, 'completed');
  assert.equal((await submit('new-finished')).status, 'completed');
  assert.equal(f.active(), 'numen');
  assert.equal(calls.filter(row => row === 'mineflayer-release').length, 2);

  const back = await f.handoff.switchBody({ characterId, requestId: 'back',
    expectedGeneration: 2, targetKind: 'mineflayer' }, f.owner);
  assert.equal(back.status, 'completed');
  assert.equal(latest.generation, 3);
  assert.equal(f.active(), 'mineflayer');
  assert.deepEqual(calls, ['mineflayer-witness', 'mineflayer-release', 'mineflayer-witness',
    'mineflayer-release', 'numen-acquire', 'numen-release', 'mineflayer-connect', 'mineflayer-witness']);
});

test('lost delivery of an issued effect is held and never served again', async t => {
  const f = await fixture(t);
  const instanceId = randomUUID();
  await f.post({ op: 'hello', instanceId });
  const request = { characterId: f.characterId, requestId: 'lost-witness',
    expectedGeneration: 1, targetKind: 'numen' };
  f.drop(row => row.value?.command?.action === 'witness');
  const switching = f.handoff.switchBody(request, f.owner);
  await delay(20);
  await assert.rejects(f.post({ op: 'next', instanceId }));
  assert.deepEqual((await f.post({ op: 'next', instanceId })).value, { command: null });
  const unknown = await switching;
  assert.equal(unknown.status, 'recovery_required');
  assert.equal(unknown.reason, 'SOURCE_RELEASE_UNCONFIRMED');
  assert.deepEqual(f.handoff.lookup(request, f.owner), unknown);
  assert.equal(f.active(), 'mineflayer');
  assert.deepEqual((await f.post({ op: 'next', instanceId })).value, { command: null });
  f.broker.revoke(f.characterId);
  assert.equal((await f.post({ op: 'current', instanceId })).status, 401);
});
