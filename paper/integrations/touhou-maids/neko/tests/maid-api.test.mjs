import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createMaidApi } from '../maid-api.mjs';

const protocol = 'qiandengji-maid-body/v1';
const makeKey = () => 'mda_' + randomBytes(32).toString('base64url');
const makeGrant = (key, maidId, ownerId, remaining = 60_000) => ({
  keySha256: createHash('sha256').update(key).digest('hex'),
  ownerId, maidId, expiresAt: new Date(Date.now() + remaining).toISOString(),
});

test('scoped API preserves the native lease and durable receipt across revocation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'maid-api-'));
  const nativeTokenFile = join(dir, 'native.key');
  const grantsFile = join(dir, 'grants.json');
  const nativeToken = randomBytes(32).toString('base64url');
  const ownerId = randomUUID(), maidId = randomUUID(), controllerId = randomUUID();
  const key = makeKey(), alternateKey = makeKey(), expiredKey = makeKey();
  const grant = makeGrant(key, maidId, ownerId), alternate = makeGrant(alternateKey, maidId, ownerId);
  const expired = makeGrant(expiredKey, maidId, ownerId, -1000);
  const update = async grants => {
    const temporary = grantsFile + '.next';
    await writeFile(temporary, JSON.stringify({ schema: 1, grants }));
    await rename(temporary, grantsFile);
  };
  await writeFile(nativeTokenFile, nativeToken);
  await update([grant, alternate, expired]);
  t.after(async () => {
    await unlink(grantsFile);
    await unlink(nativeTokenFile);
    await rmdir(dir);
  });
  const received = [], receipts = new Map();
  const actions = ['list', 'context', 'receipt', 'walk', 'companion'];
  const tool = {
    name: 'mc_maids',
    inputSchema: {
      properties: { action: { enum: actions }, x: { type: 'number' } },
      oneOf: actions.map(action => ({
        properties: { action: { const: action } },
        propertyNames: { enum: action === 'walk' ? ['action', 'x'] : ['action'] },
      })),
    },
  };
  let held = null;
  const native = createServer(async (req, res) => {
    const respond = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks));
    received.push({ ...input, authenticated: req.headers.authorization === 'Bearer ' + nativeToken });
    const { operation } = input;
    if (operation === 'bind') {
      if (held) return respond(409, { error: 'CONTROL_BUSY' });
      held = { protocol, ownerId, maidId, controllerId: input.controllerId, generation: 'fixture:' + randomUUID() };
      return respond(200, { ...held, tools: [tool] });
    }
    if (!held || input.controllerId !== held.controllerId || input.generation !== held.generation) {
      return respond(409, { error: 'CONTROL_CHANGED' });
    }
    if (operation === 'release') {
      const envelope = held;
      held = null;
      return respond(200, { ...envelope, released: true });
    }
    if (input.arguments.action === 'walk') {
      receipts.set(input.requestId, { requestId: input.requestId, status: 'running', goalCompleted: false });
      req.socket.destroy(); // Native accepted the original request before the network failed.
      return;
    }
    const data = receipts.get(input.arguments.operationId);
    return respond(200, { ...held, result: { content: [{ type: 'text', text: JSON.stringify(data) }] } });
  });
  await new Promise(resolve => native.listen(0, '127.0.0.1', resolve));
  const nativePort = native.address().port;
  const api = await createMaidApi({
    schema: 1, port: nativePort === 31887 ? 31888 : 31887, nativePort, nativeTokenFile, grantsFile,
  });
  await new Promise(resolve => api.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await api.close();
    await new Promise(resolve => native.close(resolve));
  });
  const url = 'http://127.0.0.1:' + api.server.address().port + '/api/v1/maid-body';
  async function post(input, bearer = key) {
    const headers = { 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json() };
  }
  const identity = { operation: 'identity' }, bind = { operation: 'bind', controllerId };
  assert.equal((await post(identity, null)).status, 401);
  assert.equal((await post(identity, makeKey())).status, 401);
  assert.equal((await post(identity, expiredKey)).status, 401);
  assert.equal((await post({ ...bind, maidId: randomUUID() })).status, 403);
  assert.deepEqual(await post(identity), { status: 200, body: { protocol, ownerId, maidId } });
  assert.equal(received.length, 0);

  const first = await post(bind);
  assert.equal(first.status, 200);
  assert.equal(first.body.controllerId, controllerId);
  const schema = first.body.tools[0].inputSchema;
  assert.deepEqual(schema.properties.action.enum, actions.slice(0, -1));
  assert.equal(schema.oneOf.length, 4);
  assert.notEqual(received[0].controllerId, controllerId);
  const call = { operation: 'call', controllerId, generation: first.body.generation, name: 'mc_maids' };
  assert.equal((await post({ ...call, arguments: { action: 'walk', ownerId: randomUUID() } })).status, 403);
  assert.equal((await post({ ...call, arguments: { action: 'companion' } })).status, 400);
  assert.equal(received.length, 1);
  assert.equal((await post(bind, alternateKey)).status, 409);
  assert.equal((await post({ ...call, arguments: { action: 'context' } }, alternateKey)).status, 409);
  assert.notEqual(received[0].controllerId, received[1].controllerId);

  const walk = { ...call, requestId: 'original-walk', arguments: { action: 'walk', requestId: 'original-walk', x: 22 } };
  const uncertain = await post(walk);
  assert.equal(uncertain.status, 502);
  assert.equal(uncertain.body.retryAllowed, false);
  assert.equal(received.filter(input => input.requestId === 'original-walk').length, 1);
  assert.equal(received.at(-1).arguments.requestId, walk.requestId);
  assert(received.every(input => input.authenticated));

  await update([alternate]);
  assert.equal((await post(identity)).status, 401);
  const end = Date.now() + 4_000;
  while (held && Date.now() < end) await delay(50);
  assert.equal(held, null);
  assert.equal(received.at(-1).operation, 'release');
  const second = await post(bind, alternateKey);
  assert.equal(second.status, 200);
  assert.notEqual(second.body.generation, first.body.generation);
  const receipt = await post({
    ...call, generation: second.body.generation, arguments: { action: 'receipt', operationId: walk.requestId },
  }, alternateKey);
  assert.equal(receipt.status, 200);
  assert.deepEqual(JSON.parse(receipt.body.result.content[0].text), receipts.get(walk.requestId));
  assert.equal((await post({ operation: 'release', controllerId, generation: second.body.generation }, alternateKey)).status, 200);
});
