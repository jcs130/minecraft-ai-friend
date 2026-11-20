import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import test from 'node:test';
import definition from '../world.mjs';

async function gateway(t, bodyKind) {
  const role = {id: 'resident', name: '桐人', bodyKind}, key = 'rdt_' + 'x'.repeat(43);
  const state = {reply: null, requests: 0, polls: 0};
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks));
    const finish = (status, result) => {
      res.writeHead(status, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(result));
    };
    if (req.url === '/api/v1/resident-turns/pair') {
      if (data.code !== 'ABCD-EFGH-2345') return finish(403, {});
      return finish(200, {endpoint: state.origin + '/api/v1/resident-turns/resident', token: key, resident: role});
    }
    if (req.headers.authorization !== 'Bearer ' + key) return finish(401, {});
    const op = req.url.split('/').pop();
    if (op === 'poll') { state.polls++; return finish(200, {turn: state.turn ?? null}); }
    if (op === 'begin') { state.requests++; return finish(200, {state: 'requested', requestId: 'fresh'}); }
    if (op === 'reply') { state.reply = data; state.turn = null; return finish(200, {accepted: true}); }
    finish(404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  state.origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  state.offer = scene => { state.turn = {id: 'turn-id', kind: 'plan', until: Date.now() + 30_000, resident: role, scene}; };
  return state;
}

for (const kind of ['maid', 'numen']) {
  test(kind + ' pairs from its World panel and scopes text, voice, actions and a fresh turn to that grant', async t => {
    const server = await gateway(t, kind);
    const secrets = new Map();
    const context = {cfg: {portalOrigin: server.origin}, botDir: 'test-' + kind,
                     storeSecret: (k, v) => secrets.set(k, v), secret: k => secrets.get(k)};
    let world = definition.create(context);
    const invoke = (...args) => world.console().invoke('pair', ...args);
    assert.equal((await invoke('status', [])).origin, server.origin);
    await assert.rejects(invoke('pair', ['ABCD-BADC-5678']));
    assert.equal(secrets.size, 0);
    assert.deepEqual(await invoke('pair', ['ABCD-EFGH-2345']), {name: '桐人', bodyKind: kind});
    assert.equal(secrets.size, 1);
    world = definition.create(context);  // A new instance attaches using the bot's private secret.
    const {promise: event, resolve} = Promise.withResolvers();
    const section = {version: 1, messages: [
      {id: 'owner-voice', medium: 'voice', scope: 'private', speakerName: '伙伴', text: '你听到了吗？'},
      {id: 'visitor-text', medium: 'text', scope: 'nearby', text: '你好'},
    ], outputs: [{mode: 'speech', scope: 'private', sourceEventId: 'owner-voice'},
                 {mode: 'text', scope: 'nearby', sourceEventId: 'visitor-text'}]};
    const bodyTools = [{tool: 'body:observe', parameters: {type: 'object'}}];
    server.offer({bodyTools, communication: section});
    await world.start({log: {warn() {}}, pushEvent: (e, opts) => { resolve({e, opts}); }});
    try {
      const tools = Object.fromEntries(world.tools().map(tool => [tool.name, tool.handler]));
      const {e, opts} = await event;
      assert.equal(e.type, 'resident.turn');
      assert.equal(opts.trigger, 'flush');
      assert.equal(JSON.parse(e.text.split('\n').at(-1)).scene.communication.messages[0].text, '你听到了吗？');
      const id = 'turn-id', view = JSON.parse(await tools.qd_resident_context({id}));
      assert.deepEqual(view.bodyTools, bodyTools);
      assert.deepEqual(view.communication, section);
      await assert.rejects(tools.qd_resident_act({id, tool: 'body:other'}));
      await assert.rejects(tools.qd_resident_communicate({id, mode:'speech', text:'你好'}));
      await assert.rejects(tools.qd_resident_communicate({id, mode:'text', sourceEventId:'owner-voice', text:'你好'}));
      await assert.rejects(tools.qd_resident_communicate({id:'other-turn', mode:'speech', sourceEventId:'owner-voice', text:'你好'}));
      assert.equal(server.reply, null);
      const mode = kind === 'maid' ? 'speech' : 'text';
      const sourceEventId = mode === 'speech' ? 'owner-voice' : 'visitor-text';
      await tools.qd_resident_communicate({id, mode, sourceEventId, text:'我听到了。'});
      assert.deepEqual(server.reply, {id, answer:{communication:{mode, sourceEventId, text:'我听到了。'}}});
      await assert.rejects(tools.qd_resident_context({id}));
      assert.deepEqual(JSON.parse(await tools.qd_resident_begin({})), {state:'requested',requestId:'fresh'});
      assert.equal(server.requests, 1);
      assert.doesNotMatch(JSON.stringify(await invoke('status', [])), /rdt_|ABCD|token/);
    } finally { await world.stop(); }
  });
}

test('full native action args are carried on the original turn and ambiguous output is refused', async t => {
  const server = await gateway(t, 'numen');
  const session = {endpoint: server.origin + '/api/v1/resident-turns/resident', token:'rdt_'+'x'.repeat(43)};
  const world = definition.create({cfg: {portalOrigin:server.origin}, botDir:'demo', secret: () => Buffer.from(JSON.stringify(session)).toString('base64url')});
  const {promise: event, resolve} = Promise.withResolvers();
  server.offer({bodyTools:[{tool:'body:move'}],communication:{version:1,messages:[],outputs:[
    {mode:'native',scope:'private'},{mode:'native',scope:'nearby'},
  ]}});
  await world.start({log: {warn() {}}, pushEvent: resolve});
  try {
    await event;
    const tools = Object.fromEntries(world.tools().map(tool => [tool.name, tool.handler]));
    await assert.rejects(tools.qd_resident_communicate({id:'turn-id',mode:'native',text:'听到了'}));
    const args = {x:8, y:64, z:-12};
    await tools.qd_resident_act({id:'turn-id',tool:'body:move',args});
    assert.deepEqual(server.reply.answer, {steps:[{tool:'body:move',args}]});
  } finally { await world.stop(); }
});
