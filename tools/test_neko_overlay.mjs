// Exercises the installed upstream parser and command registry, without a model.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2]);
const load = relative => import(pathToFileURL(path.join(root, relative)).href);
const commands = await load('src/agent/commands/index.js');
const { ActionManager } = await load('src/agent/action_manager.js');
const { wsServer } = await load('src/websocket/ws_server.js');
let calls = [];
const agent = {blocked_actions: [], bot: {mawNative: {bindAgent() {}, bodyBlocked: () => false,
    async request(message) {calls.push(message); return {ok: true, id: message.id, args: message.args};}}}};
for (const name of ['modList', 'modExplain', 'modCall', 'modStatus', 'modResult']) assert.equal(commands.commandExists(name), true);
assert.equal(commands.isAction('!modCall'), true);
const snbt = '{id:"ars_nouveau:novice_spell_book",components:{"minecraft:custom_name":\'{"text":"法术书 (我的)"}\'}}';
const args = {expectedHeldSnbt: snbt, spellId: 'ars_nouveau:slot_0'};
const expression = `!modCall("spell.cast", ${JSON.stringify(JSON.stringify(args))})`;
const parsed = commands.parseCommandMessage(expression);
assert.equal(parsed.commandName, '!modCall'); assert.deepEqual(JSON.parse(parsed.args[1]), args);
const result = JSON.parse(await commands.executeCommand(agent, expression));
assert.deepEqual(result.args, args); assert.equal(calls.length, 1);
assert.match(calls[0].callId, /^[0-9a-f-]{36}$/);
const multiple = `看这里 !modList() 然后 ${expression} 结束`;
assert.equal(commands.parseCommandStrings(multiple).length, 2);
assert.equal(commands.truncCommandMessageMulti(multiple).endsWith(expression), true);
assert.equal(commands.truncCommandMessage(`${expression} 注释`), expression);
assert.equal(commands.parseCommandMessage('!goToCoordinates(-4, 65, 12, 1)').args[0], -4);
const bad = JSON.parse(await commands.executeCommand(agent, '!modCall("spell.cast", "invalid")'));
assert.equal(bad.code, 'native_arguments_json_invalid'); assert.equal(calls.length, 1);
assert.match(commands.getCommandDocs(agent), /modExplain/);
agent.bot.mawNative.bodyBlocked = () => true;
const manager = new ActionManager(agent);
await assert.rejects(manager.runAction('action:test', () => { throw Error('must not run'); }), /native_body_reserved_or_unknown/);
const own = [], other = [];
agent.bot._client = {uuid: '11111111-1111-4111-8111-111111111111'};
agent.bot.mawNative.request = async () => ({ok: true, operationCount: 48});
wsServer.agent = agent;
wsServer.broadcast = message => other.push(message);
const socket = {readyState: 1, send: message => own.push(JSON.parse(message))};
wsServer.handleMessage({type: 'native_mod', schemaVersion: 1, requestId: 'check', action: 'list'}, socket);
await new Promise(resolve => setImmediate(resolve));
// Disabled adapter is a private, explicit rejection, never game chat or broadcast.
assert.equal(own[0].code, 'native_adapter_not_enabled'); assert.equal(other.length, 0);
console.log(JSON.stringify({ok: true, registeredCommands: 5, nativeJsonEscaping: true,
    parserAndMultiCommand: true, bodyGuard: true, privateSocketRoute: true, modelCalls: 0}));
// Upstream imports install housekeeping timers even without Agent.start().
// This is a bounded offline test, with no Minecraft/WebSocket connection.
process.exit(0);
