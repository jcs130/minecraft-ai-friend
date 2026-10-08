// Bounded, explicit QA body using mc-agent-neko's real initBot and WS server.
// No model, cheat command, inventory grant, world reset or automatic replay.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [nekoRoot, output, account = 'MawNekoQA1008', host = '192.168.3.163', port = '28977'] = process.argv.slice(2);
assert(nekoRoot && path.isAbsolute(nekoRoot) && output && path.isAbsolute(output));
assert(!fs.existsSync(output), 'Prior probe directories must not be replayed');
assert(/^[A-Za-z0-9_]{1,16}$/.test(account));
fs.mkdirSync(output, {recursive: true});
process.env.MAW_NEKO_ADAPTER_FILE = path.resolve(import.meta.dirname, '../world/src/neko-adapter/native-runtime.cjs');
process.env.MAW_NEKO_LEDGER_DIR = path.join(output, 'ledger');
process.env.NEKO_PLUGIN_WS_HOST = '127.0.0.1';
process.env.NEKO_PLUGIN_WS_PORT ||= '28988';
process.env.NEKO_AGENT_SCREENSHOT_INTERVAL_MS = '0';
process.env.DEBUG_CHAT = '0';
process.env.STATUS_NL = '0';
const load = relative => import(pathToFileURL(path.join(nekoRoot, relative)).href);
const { setSettings } = await load('src/agent/settings.js');
setSettings({minecraft_version: '1.21.1', host, port: Number(port), auth: 'offline',
    allow_insecure_coding: false, blocked_actions: ['!newAction'], chat_ingame: false, only_chat_with: [], speak: false});
const {initBot} = await load('src/utils/mcdata.js');
const {wsServer} = await load('src/websocket/ws_server.js');
const {ActionManager} = await load('src/agent/action_manager.js');
const commands = await load('src/agent/commands/index.js');
const bot = initBot(account);
const agent = {name: account, bot, blocked_actions: ['!newAction'], isIdle: () => !agent.actions.executing};
agent.actions = new ActionManager(agent);
const packets = [], errors = [], commandsRead = [];
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
let done = false, spawned = false, timer, poll;
bot.on('error', error => errors.push({kind: 'connection', message: error.message}));
bot.on('kicked', reason => errors.push({kind: 'kicked', message: String(reason)}));
bot._client.on('custom_payload', packet => {
    if (!packet.channel.startsWith('maw_agent:')) return;
    try {
        const body = JSON.parse(Buffer.from(packet.data).toString('utf8'));
        if (body.playerUuid) assert.equal(body.playerUuid.toLowerCase(), bot._client.uuid.toLowerCase());
        packets.push({channel: packet.channel, body});
    } catch (error) {errors.push({kind: 'private_packet', message: error.message});}
});
for (const adapter of Object.values(bot.mawNative.sdk)) adapter?.events?.on('protocolError', error => errors.push({kind: 'protocol', message: error.message}));
async function finish(reason) {
    if (done) return;
    done = true; clearTimeout(timer); clearInterval(poll);
    const report = {schemaVersion: 1, account, playerUuid: bot._client.uuid, spawned, reason, errors,
        packetCount: packets.length, commandReadCount: commandsRead.length, native: bot.mawNative.status(),
        modelCalls: 0, agentFrameworkStarted: false, bodySource: 'mc-agent-neko/src/utils/mcdata.js:initBot',
        endpoint: `${host}:${port}`, completedAt: new Date().toISOString()};
    save('packets.json', packets); save('body-report.json', report); save('command-reads.json', commandsRead);
    for (const socket of wsServer.clients) socket.close();
    wsServer.stop();
    bot.quit('Neko bridge verification complete');
    await new Promise(resolve => setTimeout(resolve, 600));
    bot.mawNative.close();
    console.log(JSON.stringify(report));
    process.exit(reason === 'requested_stop' && spawned && errors.length === 0 ? 0 : 1);
}
timer = setTimeout(() => void finish('bounded_probe_timeout'), 180000);
bot.on('end', () => {if (!done) void finish('unexpected_disconnect');});
bot.once('spawn', async () => {
    spawned = true;
    try {
        await new Promise(resolve => setTimeout(resolve, 1200));
        const receipt = JSON.parse(await commands.executeCommand(agent, '!modCall("curios.state", "{}")'));
        commandsRead.push(receipt);
        assert.equal(receipt.ok, true, JSON.stringify(receipt)); assert.equal(receipt.playerUuid, bot._client.uuid);
        wsServer.start();
        await new Promise((resolve, reject) => {wsServer.wss.once('listening', resolve); wsServer.wss.once('error', reject);});
        wsServer.setAgent(agent);
        save('ready.json', {pid: process.pid, playerUuid: bot._client.uuid, account,
            ws: `ws://127.0.0.1:${process.env.NEKO_PLUGIN_WS_PORT}`, native: bot.mawNative.status(),
            agentFrameworkStarted: false, modelCalls: 0});
        console.log(JSON.stringify({ready: true, account, playerUuid: bot._client.uuid}));
        poll = setInterval(() => {if (fs.existsSync(path.join(output, 'stop.requested'))) void finish('requested_stop');}, 200);
    } catch (error) {errors.push({kind: 'setup', message: error.stack}); await finish('setup_failed');}
});
