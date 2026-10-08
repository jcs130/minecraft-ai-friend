// Copy to mc-agent-neko/src/integrations/maw_native.js with the checked installer.
// Opt-in only: importing an unconfigured Neko must not connect to My Agent World.
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.MAW_NEKO_ADAPTER_FILE);
const adapter = enabled ? require(process.env.MAW_NEKO_ADAPTER_FILE) : null;

export function attachNative(bot, account) {
    if (!adapter) return null;
    bot.setMaxListeners(Math.max(50, bot.getMaxListeners()));
    bot._client.setMaxListeners(Math.max(50, bot._client.getMaxListeners()));
    try { return adapter.attachNekoNative(bot, { ledgerDir: process.env.MAW_NEKO_LEDGER_DIR, account }); }
    catch (error) { bot._client.end('native adapter initialization failed'); throw error; }
}

export function handleNativeMessage(agent, socket, message) {
    if (message?.type !== 'native_mod') return Promise.resolve(false);
    if (adapter) return adapter.handleNativeMessage(agent, socket, message);
    if (socket?.readyState === 1) socket.send(JSON.stringify({type: 'native_mod_result', schemaVersion: 1,
        requestId: message.requestId, action: message.action, id: message.id ?? null, callId: message.callId ?? null,
        ok: false, code: 'native_adapter_not_enabled', outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false}));
    return Promise.resolve(true);
}

export function assertNativeBodyAvailable(agent) {
    if (agent?.bot?.mawNative?.bodyBlocked()) throw Object.assign(new Error('native_body_reserved_or_unknown'), {code: 'native_body_reserved_or_unknown'});
}

async function perform(agent, action, id, argsJson) {
    const runtime = agent?.bot?.mawNative;
    if (!runtime) return JSON.stringify({ok: false, code: 'native_adapter_not_enabled'});
    runtime.bindAgent(agent);
    let args;
    try { args = argsJson === undefined ? {} : JSON.parse(argsJson); }
    catch { return JSON.stringify({ok: false, code: 'native_arguments_json_invalid'}); }
    const result = await runtime.request({action, id, args, callId: crypto.randomUUID()});
    return JSON.stringify(result);
}

export const nativeQueries = [
    {name: '!modList', description: 'List native mod operations on YOUR connection (MineColonies, Ars, Create, maid, Curios, Domum). Then use modExplain. Proxy item/block IDs are not native identity.',
        perform: agent => perform(agent, 'list')},
    {name: '!modExplain', description: 'Get the exact JSON schema and preconditions of an installed native operation. Coordinates are absolute. Read full native SNBT/CAS before mutations; never guess components.',
        params: {id: {type: 'string', description: 'Installed operation ID, e.g. colony.status, spell.list, create.settings'}},
        perform: (agent, id) => perform(agent, 'explain', id)},
    {name: '!modStatus', description: 'Read native connection identity and unresolved writes. Unknown is NOT failure and must NOT be retried by reconnecting.',
        perform: agent => perform(agent, 'status')},
    {name: '!modResult', description: 'Read the durable receipt for a previous mutation callId without executing it again.',
        params: {callId: {type: 'string', description: 'Exact callId from a previous modCall receipt'}},
        perform: async (agent, callId) => JSON.stringify(await agent.bot.mawNative?.request({action: 'result', callId}) ?? {ok: false, code: 'native_adapter_not_enabled'})}
];
export const nativeActions = [
    {name: '!modCall', description: 'Call one native mod operation. argsJson is a JSON STRING: !modCall("colony.status", "{}"), or !modCall("native.recipes", "{\\"outputId\\":\\"minecraft:stick\\",\\"limit\\":1}"). Read-only calls do not reserve the body. Writes require an idle body; unknown writes stop further item/mod actions and are never retried. A cast confirmation is not proof of hitting a target.',
        params: {id: {type: 'string', description: 'ID obtained from modList/modExplain'},
            argsJson: {type: 'string', description: 'JSON-encoded argument object matching modExplain; escape inner quotes with backslashes'}},
        perform: (agent, id, argsJson) => perform(agent, 'call', id, argsJson)}
];
