// One-shot geometry application in the marked, loopback-only synthetic stage.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';

const stage = process.env.CRYPT_QA_STAGE;
const root = process.env.CRYPT_QA_REPORT_ROOT;
const bridge = process.env.CRYPT_QA_RCON;
assert(stage && root && bridge);
assert.equal(fs.readFileSync(path.join(stage, '.shop-qa'), 'utf8'),
    'FRESH_RPG_SHOP_QA_NO_PLAYER_DATA');
const properties = fs.readFileSync(path.join(stage, 'server.properties'), 'utf8');
assert(/^server-ip=127\.0\.0\.1\r?$/m.test(properties)
    && /^server-port=25928\r?$/m.test(properties)
    && /^rcon.port=25929\r?$/m.test(properties));
const {command} = await import(pathToFileURL(bridge));
const rc = text => command(text, 15000, {port: 25929, properties: stage + '/server.properties'});
const plan = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./connector.json', import.meta.url)), 'utf8'));
assert(plan.reasons.length === 0 && plan.changes === plan.cells.length
    && plan.changes <= 100 && plan.routeIntersections === 0 && plan.world === 'world');
const ledger = path.join(root, 'qa-connector-application.json');
assert(!fs.existsSync(ledger), 'Inspect the original result; never overwrite an uncertain application');
const state = {at: new Date().toISOString(), productionModified: false,
    planned: plan.cells.length, actions: [], ownedPins: [], success: false};
const save = () => fs.writeFileSync(ledger, JSON.stringify(state, null, 2));
const blockId = block => block.Name + (block.Properties ? '[' + Object.entries(block.Properties)
    .map(([key, value]) => {
        assert(/^[a-z0-9_]+$/.test(key) && /^[a-z0-9_]+$/.test(String(value)));
        return key + '=' + value;
    }).join(',') + ']' : '');

save();
try {
    assert(/There are 0 of|共有0名玩家/.test(await rc('minecraft:list')),
        'Synthetic actors must leave while the fixture changes');
    await rc('minecraft:scoreboard objectives add cryptgeomqa dummy');
    async function probe(holder, text) {
        await rc('minecraft:execute store success score ' + holder + ' cryptgeomqa run ' + text);
        const reply = await rc('minecraft:scoreboard players get ' + holder + ' cryptgeomqa');
        const numbers = reply.match(/-?\d+/g);
        assert(numbers?.length === 1, 'Unambiguous native success score required');
        return Number(numbers[0]);
    }
    for (const [x, z] of [[1152, 224], [1168, 224]]) {
        if (!await probe('#force', `minecraft:forceload query ${x} ${z}`)) {
            await rc(`minecraft:forceload add ${x} ${z}`);
            state.ownedPins.push([x, z]);
            save();
        }
    }
    let loaded = false;
    for (let i = 0; i < 50; i++) {
        if (await probe('#loaded', 'minecraft:execute if loaded 1166 86 229')) {
            loaded = true;
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(loaded, 'The marked geometry must load before preimage checks');
    for (const cell of plan.cells) {
        const [x, y, z] = cell.pos;
        assert(x >= 1158 && x <= 1171 && y >= 85 && y <= 97 && z >= 226 && z <= 233);
        assert.equal(await probe('#before', 'minecraft:execute if block '
            + cell.pos.join(' ') + ' ' + blockId(cell.before)), 1,
        'Original geometry differs at ' + cell.pos + '; no block writes');
    }
    for (const cell of plan.cells) {
        const action = {...cell, phase: 'reserved'};
        state.actions.push(action);
        save();
        action.reply = await probe('#changed', 'minecraft:setblock '
            + cell.pos.join(' ') + ' ' + blockId(cell.after));
        action.phase = 'reply_received';
        save();
        assert([0, 1].includes(action.reply));
        action.phase = 'completed';
        save();
    }
    state.postconditionMismatches = [];
    for (const cell of plan.cells) {
        if (await probe('#after', 'minecraft:execute if block '
            + cell.pos.join(' ') + ' ' + blockId(cell.after)) !== 1) {
            state.postconditionMismatches.push(cell.pos);
        }
    }
    state.success = state.postconditionMismatches.length === 0;
    if (!state.success) process.exitCode = 1;
} catch (error) {
    state.error = String(error);
    process.exitCode = 1;
} finally {
    // Keep owned pin coordinates and each reserved action for inspection and explicit QA cleanup.
    save();
    console.log(JSON.stringify({success: state.success, actions: state.actions.length,
        productionModified: false}));
}
