import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomBytes } from 'node:crypto';
import { nativeEntityHandoffAdapters, nativeResidentHandoffClient } from '../src/native-entity-handoff.mjs';

const source = { kind: 'maid', bodyId: 'travel-maid', entityUuid: '11111111-1111-4111-8111-111111111111' };
const target = { kind: 'villager', bodyId: 'market-villager', entityUuid: '22222222-2222-4222-8222-222222222222' };
const context = { operationId: 'original-1', characterId: 'test-resident',
  ownerId: '00000000-0000-4000-8000-000000000001', generation: 5, source, target };
const sleep = { physicalState: 'parked', controllerState: 'fenced', recoveryAdmission: 'held_in_all_worlds', snapshotSha256: 'c'.repeat(64) };
const awake = { physicalState: 'active', controllerState: 'exclusive', originalIdentityVerified: true, snapshotRestored: true };
const backend = (modify = v => v) => ({
  inspect: r => modify({ ...r, available: true, ...sleep }),
  park: r => modify({ ...r, state: 'committed', durable: true, ...sleep }),
  resume: r => modify({ ...r, state: 'committed', durable: true, ...awake }),
});

test('missing or partial native provider is never offered to a model', () => {
  assert.deepEqual(nativeEntityHandoffAdapters(), {});
  assert.throws(() => nativeEntityHandoffAdapters({ maid: { release() {} } }));
  assert.throws(() => nativeEntityHandoffAdapters({ numen: backend() }));
});

test('native custody transport signs only the exact loopback original operation', async () => {
  const controlKey = randomBytes(32);
  assert.throws(() => nativeResidentHandoffClient({ endpoint:'https://native.invalid/', controlKey }));
  const endpoint = 'http://127.0.0.1:19088/v1/native-resident-handoff';
  let calls = 0;
  const native = nativeResidentHandoffClient({ endpoint, controlKey, async fetcher(url, options) {
    assert.equal(url.href, endpoint);
    assert.equal(options.redirect, 'error');
    const { payload, signature } = JSON.parse(options.body);
    assert.equal(signature, createHmac('sha256', controlKey).update(payload).digest('base64url'));
    const { expires, ...request } = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.ok(expires > Date.now() && expires <= Date.now() + 45_000);
    assert.equal(request.operationId, context.operationId);
    assert.equal(request.ownerId, context.ownerId);
    return Response.json({ ...request, ...sleep, available:true, ...(calls++ ? { operationId:'foreign-operation' } : {}) });
  } });
  const { villager } = nativeEntityHandoffAdapters({ villager:native });
  assert.equal(await villager.preflight(context), true);
  await assert.rejects(villager.preflight(context), /does not match/);
  assert.equal(calls, 2);
});

test('both directions bind original physical entity and successor generation', async () => {
  const calls = [];
  const record = row => { calls.push(row); return row; };
  const h = nativeEntityHandoffAdapters({ maid: backend(record), villager: backend(record) });
  for (const [a,b] of [[source,target],[target,source]]) {
    const c = { ...context, source:a, target:b };
    assert.equal(await h[b.kind].preflight(c),true);
    assert.deepEqual(await h[a.kind].release(c), { state:'released', bodyId:a.bodyId, entityUuid:a.entityUuid });
    assert.deepEqual(await h[b.kind].acquire({ ...c, generation:6 }), { state:'acquired', bodyId:b.bodyId, entityUuid:b.entityUuid });
  }
  assert.deepEqual(calls.map(r => [r.phase,r.generation]), [['inspect',5],['park',5],['resume',6],['inspect',5],['park',5],['resume',6]]);
  assert(!calls.some(r => Object.hasOwn(r,'source') || Object.hasOwn(r,'target')));
});

test('native recovery reads both original phases at their original generations', async () => {
  const reads = [];
  const provider = { ...backend(), result(query) {
    reads.push(query);
    const {originalPhase, ...original} = query;
    return {...original, phase:originalPhase, state:'committed', durable:true, ...(originalPhase === 'park' ? sleep : awake)};
  }};
  const h = nativeEntityHandoffAdapters({maid:provider,villager:provider});
  const cutover = {...context,generation:6};
  assert.deepEqual(await h.maid.result(cutover), {
    state:'released',bodyId:source.bodyId,entityUuid:source.entityUuid,operationId:context.operationId,generation:6,
  });
  assert.deepEqual(await h.villager.result(cutover), {
    state:'acquired',bodyId:target.bodyId,entityUuid:target.entityUuid,operationId:context.operationId,generation:6,
  });
  assert.deepEqual(reads.map(row=>[row.phase,row.originalPhase,row.generation,row.operationId]),
    [['result','park',5,context.operationId],['result','resume',6,context.operationId]]);
});

test('identity, owner, operation and generation must match before a callback can settle anything', async () => {
  for (const [key,value] of Object.entries({operationId:'other',characterId:'another',ownerId:source.entityUuid,
    kind:'other',bodyId:'other',entityUuid:context.ownerId,phase:'other',generation:99})) {
    const p=backend(receipt => ({ ...receipt, [key]:value }));
    const h=nativeEntityHandoffAdapters({ maid:p, villager:p });
    assert.equal(await h.villager.preflight(context),false,key);
    assert.equal((await h.maid.release(context)).state,'unknown',key);
    assert.equal((await h.villager.acquire(context)).state,'unknown',key);
  }
});

test('unloaded, AI disabled, or plain lease release each lack physical custody proof', async () => {
  for (const fields of [{ physicalState:'unloaded' }, { controllerState:'released' }, { recoveryAdmission:'marker_only' }, { snapshotSha256:'' }]) {
    const p=backend(row=>({...row,...fields}));const h=nativeEntityHandoffAdapters({maid:p,villager:p});
    assert.equal(await h.villager.preflight(context),false);
    assert.equal((await h.maid.release(context)).state,'unknown');
  }
  for (const fields of [{durable:false},{originalIdentityVerified:false},{snapshotRestored:false},{controllerState:'bound'}]) {
    const h=nativeEntityHandoffAdapters({villager:backend(r=>({...r,...fields}))});
    assert.equal((await h.villager.acquire(context)).state,'unknown');
  }
});

test('unchanged precondition refusal differs from uncertain physical effect', async () => {
  for (const effectsApplied of [false,true,undefined]) {
    const h=nativeEntityHandoffAdapters({maid:backend(r=>({...r,...awake,state:'blocked',effectsApplied}))});
    assert.equal((await h.maid.release(context)).state,effectsApplied===false?'blocked':'unknown');
  }
  for (const physicalState of ['unknown','unloaded','missing','parked']) {
    const h=nativeEntityHandoffAdapters({maid:backend(r=>({...r,...awake,state:'blocked',effectsApplied:false,physicalState}))});
    assert.equal((await h.maid.release(context)).state,'unknown');
  }
});

test('a transport loss is never retried and a malformed binding is never dispatched', async () => {
  let calls=0;
  const h=nativeEntityHandoffAdapters({maid:backend(()=>{calls++;throw Error('lost response');})});
  await assert.rejects(h.maid.release(context),/lost response/);
  for (const c of [{...context,generation:-1},{...context,source:target},
    {...context,source:{...source,playerUuid:source.entityUuid}},{...context,source:{...source,entityUuid:null}}]) {
    await assert.rejects(h.maid.release(c),/Invalid registered/);
  }
  assert.equal(calls,1);
});
