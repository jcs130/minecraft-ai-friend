import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { BodyHandoffCoordinator, BodyHandoffStore } from '../src/body-handoff.mjs';
import { combinedBodyHandoffAdapters } from '../src/native-entity-handoff.mjs';

const characterId = 'combined-test';
const authority = { ownerId: randomUUID() };
const playerUuid = randomUUID();
const bodies = {
  mineflayer: { kind: 'mineflayer', bodyId: 'desktop', playerUuid },
  numen: { kind: 'numen', bodyId: 'server-player', playerUuid },
  maid: { kind: 'maid', bodyId: 'maid-a', entityUuid: randomUUID() },
  villager: { kind: 'villager', bodyId: 'villager-a', entityUuid: randomUUID() },
};
const exclusive = { physicalState: 'active', controllerState: 'exclusive' };
const parked = {
  physicalState: 'parked', controllerState: 'fenced',
  recoveryAdmission: 'held_in_all_worlds', snapshotSha256: 'a'.repeat(64),
};
const complete = { ...exclusive, originalIdentityVerified: true, snapshotRestored: true };
const committed = { state: 'committed', durable: true };

function setup(t, kind, change = {}) {
  const store = new BodyHandoffStore(':memory:');
  const calls = [];
  const ledger = new Map();
  const key = request => `${request.operationId}/${request.phase}/${request.kind}/${request.generation}`;
  const operate = (request, evidence) => {
    calls.push([request.phase, request.kind, request.generation]);
    const receipt = { ...request, ...evidence };
    if (receipt.durable) ledger.set(key(request), receipt);
    return change.wire?.(receipt) ?? receipt;
  };
  const native = {
    inspect: request => operate(request, { ...parked, available: true }),
    fence: request => operate(request, { ...committed, controllerState: 'fenced' }),
    park: request => operate(request, { ...committed, ...parked }),
    cancel: request => operate(request, { ...committed, ...exclusive }),
    admit: request => operate(request, { ...committed, controllerState: 'reserved' }),
    resume: request => operate(request, { ...committed, ...complete }),
    result: request => ledger.get(key({ ...request, phase: request.originalPhase })),
  };
  const driver = kind => ({
    preflight: () => true,
    release: () => {
      calls.push(['save-and-detach', kind]);
      return { ...bodies[kind], state: change.release ?? 'released' };
    },
    acquire: () => {
      calls.push(['join-and-witness', kind]);
      return { ...bodies[kind], state: change.acquire ?? 'acquired' };
    },
    complete: () => calls.push(['unpause', kind]),
  });
  const base = { mineflayer: driver('mineflayer'), numen: driver('numen') };
  const registration = {
    characterId, ...authority, active: bodies[kind], autonomous: true,
    targets: Object.values(bodies).filter(body => body.kind !== kind),
    combinedCustody: true,
  };
  store.register(registration);
  const coordinator = new BodyHandoffCoordinator({
    store, adapters: base, combinedAdapters: combinedBodyHandoffAdapters(native, base),
  });
  t.after(() => store.close());
  return { store, registration, coordinator, calls, base };
}

for (const source of Object.keys(bodies)) {
  for (const target of Object.keys(bodies).filter(kind => kind !== source)) {
    test(`enrolled ${source} → ${target} requires game and driver confirmation in order`, async t => {
      const { coordinator, calls } = setup(t, source);
      const request = { characterId, requestId: 'move-1', targetKind: target, expectedGeneration: 1 };
      assert.deepEqual(coordinator.current(characterId, authority).targetKinds,
        Object.keys(bodies).filter(kind => kind !== source).sort());
      const receipt = await coordinator.switchBody(request, authority);
      assert.equal(receipt.status, 'completed');
      assert.equal(receipt.activeKind, target);
      assert.equal(receipt.generation, 2);
      const expected = [['inspect', target, 1]];
      if (bodies[source].playerUuid) expected.push(['fence', source, 1], ['save-and-detach', source]);
      expected.push(['park', source, 1]);
      if (bodies[target].playerUuid) expected.push(['admit', target, 2], ['join-and-witness', target]);
      expected.push(['resume', target, 2]);
      if (bodies[target].playerUuid) expected.push(['unpause', target]);
      assert.deepEqual(calls, expected);
      assert.deepEqual(await coordinator.switchBody(request, authority), receipt);
      assert.deepEqual(calls, expected);
    });
  }
}

test('protected registrations cannot silently fall back to the old player-only route', async t => {
  const { store, registration, base } = setup(t, 'mineflayer');
  const restarted = new BodyHandoffCoordinator({ store, adapters: base });
  assert.deepEqual(restarted.current(characterId, authority).targetKinds, []);
  assert.throws(() => store.register({ ...registration, combinedCustody: false }), /binding changed/);
  await assert.rejects(restarted.switchBody({
    characterId, targetKind: 'numen', requestId: 'fallback', expectedGeneration: 1,
  }, authority), { code: 'BODY_HANDOFF_TARGET_UNAVAILABLE' });
});

test('a known old-body refusal cancels the game fence before restoring source control', async t => {
  const { coordinator, calls } = setup(t, 'mineflayer', { release: 'blocked' });
  const receipt = await coordinator.switchBody({
    characterId, targetKind: 'villager', requestId: 'busy-receipt', expectedGeneration: 1,
  }, authority);
  assert.equal(receipt.status, 'blocked');
  assert.equal(receipt.activeKind, 'mineflayer');
  assert.equal(receipt.generation, 1);
  assert.deepEqual(calls, [
    ['inspect', 'villager', 1], ['fence', 'mineflayer', 1],
    ['save-and-detach', 'mineflayer'], ['cancel', 'mineflayer', 1],
  ]);
});

test('an unknown driver save cannot claim or revive any body automatically', async t => {
  const { coordinator, calls } = setup(t, 'numen', { release: 'unknown' });
  const request = { characterId, targetKind: 'maid', requestId: 'unknown-save', expectedGeneration: 1 };
  const receipt = await coordinator.switchBody(request, authority);
  assert.equal(receipt.status, 'recovery_required');
  assert.equal(receipt.activeKind, null);
  assert.deepEqual(await coordinator.reconcile(request, authority), receipt);
  assert.deepEqual(await coordinator.switchBody(request, authority), receipt);
  assert.deepEqual(calls, [['inspect', 'maid', 1], ['fence', 'numen', 1], ['save-and-detach', 'numen']]);
});

test('the original game records resolve lost acquire response and unpause only the successor', async t => {
  const { coordinator, calls } = setup(t, 'villager', {
    wire(receipt) {
      if (receipt.phase === 'resume') throw Error('Reply dropped after commit');
      return receipt;
    },
  });
  const request = { characterId, targetKind: 'mineflayer', requestId: 'lost-claim', expectedGeneration: 1 };
  const held = await coordinator.switchBody(request, authority);
  assert.equal(held.status, 'recovery_required');
  assert.equal(calls.some(([phase]) => phase === 'unpause'), false);
  const settled = await Promise.all([
    coordinator.reconcile(request, authority), coordinator.reconcile(request, authority),
  ]);
  assert.deepEqual(settled[0], settled[1]);
  assert.equal(settled[0].status, 'completed');
  assert.equal(settled[0].activeKind, 'mineflayer');
  assert.equal(calls.filter(([phase]) => phase === 'unpause').length, 1);
  assert.equal(calls.filter(([phase]) => phase === 'join-and-witness').length, 1);
});
