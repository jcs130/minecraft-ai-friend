import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {createMaidPort, decodeMaidReply} from '../agent/maid-port.mjs';

assert.equal(await readFile('.maid-spellbook-qa', 'utf8'), 'SYNTHETIC_MAID_SPELLBOOK_ONLY');
const properties = resolve('server.properties');
const configured = (await readFile(properties, 'utf8')).split(/\r?\n/);
for (const setting of ['server-ip=127.0.0.1', 'server-port=26482', 'rcon.port=26483', 'online-mode=false']) {
    assert(configured.includes(setting));
}
const {maid: maidId, owner: ownerId, username: owner, synthetic} = JSON.parse(await readFile('fixture.json', 'utf8'));
assert(synthetic && owner === 'MaidBrainQA');
const {createBot} = createRequire(process.env.MAID_VORTEX_JAVA)('mineflayer');
const baseline = process.argv.includes('--baseline');
const report = {synthetic: true, baseline, checks: []};
const bots = [], ports = [];
let model;
const runId = randomUUID().slice(0, 8);
const rc = async cmd => (await command(cmd, 12000, {port: 26483, properties})).trim();
const minecraft = cmd => rc('minecraft:' + cmd);
const control = (action, args = '') => rc(`maidvortexqa ${action} ${maidId} ${args}`.trim());
const check = (name, pass, details) => {
    report.checks.push({name, passed: !!pass, details});
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
    assert(pass, name);
};

async function until(read, timeout = 7000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        const found = await read();
        if (found) return found;
        await delay(100);
    }
    return null;
}

async function connect(username) {
    const bot = createBot({host: '127.0.0.1', port: 26482, username, version: '1.21.1', auth: 'offline',
        hideErrors: true, physicsEnabled: false});
    bots.push(bot);
    await Promise.race([once(bot, 'spawn'), delay(22000, null, {ref: false}).then(() => {
        throw Error(`Java join timed out for ${username}`);
    })]);
    assert(await until(() => bot.player?.uuid));
    const port = createMaidPort(bot);
    ports.push(port);
    return {bot, port, id: bot.player.uuid};
}

const targetTag = 'MaidMagicTargetQA';
const playerHealth = async (player, amount) => Number((await control('health', [player, amount].join(' ').trim())).match(/health=([\d.]+)/)?.[1]);
const mobHealth = async tag => Number((await minecraft(`data get entity @e[tag=${tag},limit=1] Health`)).match(/data: ([\d.]+)/)?.[1]);
async function summon(tag, x, z) {
    await minecraft(`summon zombie ${x} 90 ${z} {Tags:["${targetTag}","${tag}"],PersistenceRequired:1b,Silent:1b}`);
}

try {
    const session = await connect(owner);
    const ask = (action, args) => session.port.request({action, maidId, ...args});
    const context = async () => {
        const reply = await ask('context');
        assert(reply.ok, JSON.stringify(reply));
        return reply.data;
    };
    const cast = (spellId, requestId) => ask('cast', {spellId, requestId});
    const mode = (action, id) => ask(action, {requestId: runId + '-' + id});
    check('owner retains the original synthetic UUID', session.id === ownerId);
    for (const fixtureCommand of ['gamerule doMobSpawning false', 'gamerule doDaylightCycle false', 'gamerule randomTickSpeed 0',
        'gamerule naturalRegeneration false', 'time set 18000', 'difficulty normal', 'weather clear',
        `kill @e[tag=${targetTag}]`, 'fill 285 89 285 333 89 315 stone', 'fill 285 90 285 333 94 315 air',
        'fill 285 95 285 333 95 315 stone', `tp ${owner} 299.5 90 303.5`, `tp ${maidId} 300.5 90 301.5`]) {
        await minecraft(fixtureCommand);
    }
    await control('freeze-maid');
    check('real Vortex Apprentice Staff equipped', (await control('equip')).includes('item=mage_apprentice_staff'));
    check('owner resumes guard through the existing follow action', (await mode('follow', 'begin')).data?.status === 'applied');
    assert(await until(async () => await control('level', owner + ' 1') === 'level=1'));
    const ownerMana = await control('owner', owner);
    const starter = await context();
    if (baseline) {
        await summon('baseline_spellbook', 305.5, 301.5);
        await control('target');
        const firstHit = await until(async () => (await context()).companion?.rpg?.lastHitSpellId);
        check('old bridge still fires a basic projectile', ['arcane_bolt', 'mage_staff_bolt'].includes(firstHit));
        check('old bridge exposes no skill catalogue to the owner', starter.companion?.rpg?.spells === undefined);
    } else {
        const catalog = starter.companion.rpg.spells;
        report.spells = catalog;
        const byId = Object.fromEntries(catalog.map(spell => [spell.id, spell]));
        check('loaded registry yields the three mage spells and the staff attack',
            byId.arcane_bolt?.unlocked && byId.mage_staff_bolt?.unlocked && byId.ember_lance?.minLevel === 3
            && byId.astral_convergence?.minLevel === 8 && catalog.every(row => row.manaCost >= 0 && row.cooldownMillis >= 650));
        check('level one locks advanced spells and omits other classes',
            !byId.ember_lance.unlocked && !byId.astral_convergence.unlocked && !byId.wardens_bloom && !byId.arcane_nova);
        check('agent refuses an undiscovered or locked ID before dispatch',
            (await cast('astral_convergence', runId + '-locked')).status === 'not_dispatched');

        const ally = await connect('MaidSpellAllyQA');
        const guest = await connect('MaidSpellGuestQA');
        await control('owner', ally.bot.username);
        await control('owner', guest.bot.username);
        await delay(300);
        await minecraft(`tp ${ally.bot.username} 299.5 90 300.5`);
        await minecraft(`tp ${guest.bot.username} 299.5 90 299.5`);
        const party = await control('party', owner + ' ' + ally.bot.username);
        check('fixture distinguishes an actual party member from another nearby player',
            party.includes(ownerId) && party.includes(ally.id) && !party.includes(guest.id));
        let visibleParty;
        const eligible = await until(async () => {
            visibleParty = await control('visible-party', owner + ' ' + ally.bot.username);
            return visibleParty.startsWith('allies=[' + ally.bot.username);
        });
        check('the ally is within the registered party and visible to the owner', eligible, visibleParty);
        assert.equal(await control('level', owner + ' 8'), 'level=8');
        const full = await context();
        check('level eight exposes unlocked fire and group spells with an exact command',
            full.companion.rpg.spells.filter(spell => ['ember_lance', 'astral_convergence'].includes(spell.id)).every(spell => spell.unlocked)
            && full.capabilities.includes('cast'));
        const rejected = await guest.port.request({action: 'context', maidId});
        check('visitor cannot discover owner-only spell controls', rejected.ok === false && rejected.error === 'not_owned');
        await playerHealth(owner, 5);
        await playerHealth(ally.bot.username, 5);
        await playerHealth(guest.bot.username, 5);
        const id = runId + '-heal';
        const result = await cast('astral_convergence', id);
        report.heal = result;
        const healing = result.data?.observation;
        check('explicit cast heals partner and party member without any damage target', result.data?.status === 'applied'
            && result.data.operationId === id && healing?.effectsApplied && healing.hitTargetIds.length === 0
            && healing.healedTargetIds.length === 2 && healing.healedTargetIds.includes(ownerId) && healing.healedTargetIds.includes(ally.id),
            healing);
        const after = await Promise.all([playerHealth(owner), playerHealth(ally.bot.username), playerHealth(guest.bot.username)]);
        check('physical health rises only for the observed allies', after[0] > 5 && after[1] > 5 && after[2] === 5, after);
        const duplicate = await cast('astral_convergence', id);
        check('duplicate operation returns its original journal entry without healing again',
            duplicate.data?.replayed === true && duplicate.data.observation.manaRemaining === healing.manaRemaining
            && await playerHealth(owner) === after[0]);
        check('reused ID with a changed spell is rejected',
            (await cast('ember_lance', id)).error === 'request_conflict');
        const queried = await ask('receipt', {operationId: id, operationAction: 'cast'});
        check('agent can retrieve the original cast observation by operation ID', queried.data?.operationId === id
            && queried.data.observation.spellId === 'astral_convergence');
        assert.equal(await control('level', owner + ' 3'), 'level=3');
        await mode('sit', 'before-ember');
        await summon('ember_spellbook', 305.5, 301.5);
        await control('target');
        check('single target was staged at full health', await mobHealth('ember_spellbook') === 80);
        await mode('follow', 'ember');
        const ember = await until(async () => {
            const last = (await context()).companion.rpg.lastCast;
            return last?.spellId === 'ember_lance' && last;
        });
        report.ember = ember;
        await mode('sit', 'check-bleed');
        const afterEmber = await mobHealth('ember_spellbook');
        check('guard independently chooses Ember Lance and damages a high-health hostile',
            ember?.hitTargetIds.length === 1 && afterEmber < 80, afterEmber);
        check('the Vortex bleed continues damaging the same mob while the maid is sitting',
            await until(async () => await mobHealth('ember_spellbook') < afterEmber));
        await minecraft(`kill @e[tag=${targetTag}]`);
        await delay(2000);
        assert.equal(await control('level', owner + ' 8'), 'level=8');
        check('owner can halt guard while staging multiple enemies', (await mode('sit', 'hold')).data?.status === 'applied');
        await minecraft(`tp ${maidId} 300.5 90 301.5`);
        await summon('astral_a', 305.5, 301.5);
        await summon('astral_b', 305.5, 303.5);
        await summon('astral_c', 305.5, 299.5);
        await summon('afu_site_dungeon', 306.5, 300.5);
        await control('target');
        const previous = (await context()).companion.rpg.lastCastAt;
        await mode('follow', 'group');
        const area = await until(async () => {
            const state = (await context()).companion.rpg;
            return state.lastCastAt !== previous && state.lastCast?.spellId === 'astral_convergence' && state.lastCast;
        });
        report.area = area;
        const afterArea = await Promise.all(['astral_a', 'astral_b', 'astral_c'].map(mobHealth));
        check('guard chooses Astral Convergence for three nearby eligible targets',
            area?.hitTargetIds.length === 3 && afterArea.every(health => health < 80), afterArea);
        check('ineligible encounter enemy remains untouched', await mobHealth('afu_site_dungeon') === 80);
        check('maid spending leaves owner mana unchanged', await control('mana', owner) === ownerMana);

        await minecraft(`kill @e[tag=${targetTag}]`);
        await minecraft(`tp ${maidId} 300.5 90 301.5`);
        await minecraft(`tp ${owner} 299.5 90 303.5`);
        await playerHealth(owner, 5);
        check('original body can use the configured test DSH backend',
            (await ask('brain', {choice:'dsh', requestId:runId + '-dsh'})).data?.status === 'applied');
        const calls = [], conversation = [];
        model = createServer(async (req, response) => {
            try {
                let raw = '';
                for await (const body of req) raw += body;
                const input = JSON.parse(raw);
                calls.push(input);
                const tool = input.tools?.find(row => row.function?.name === 'cast_vortex_spell');
                const reply = tool ? {role:'assistant', content:null, tool_calls:[{id:'qa-astral-spell', type:'function',
                    function:{name:'cast_vortex_spell', arguments:'{"spellId":"astral_convergence"}'}}]}
                    : {role:'assistant', content:'星界汇聚已经帮你恢复了。'};
                response.writeHead(200, {'content-type':'application/json'});
                response.end(JSON.stringify({id:'spellbook-fixture', object:'chat.completion', model:'qwen3.7-plus',
                    choices:[{index:0, message:reply, finish_reason:tool ? 'tool_calls' : 'stop'}],
                    usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
            } catch {
                response.writeHead(400).end();
            }
        });
        model.listen(19088, '127.0.0.1');
        await once(model, 'listening');
        session.bot._client.on('custom_payload', packet => {
            const reply = decodeMaidReply(packet, ownerId);
            if (reply?.action === 'chat-result') conversation.push(reply);
        });
        await delay(7400);
        session.bot.chat(`${full.name}，请放星界汇聚给我回血。`);
        const fromModel = await until(() => conversation.find(row => row.data.observation?.actions), 13000);
        const offered = calls.find(input => input.tools?.some(row => row.function?.name === 'cast_vortex_spell'));
        const allowed = offered?.tools.find(row => row.function?.name === 'cast_vortex_spell').function.parameters.properties.spellId.enum;
        const modelAction = fromModel?.data?.observation?.actions?.[0];
        report.model = {backend:offered?.model, allowed, result:fromModel, requests:calls.length};
        check('nearby partner conversation gives the model only the current unlocked spell IDs',
            allowed?.includes('astral_convergence') && allowed.includes('ember_lance') && !allowed.includes('wardens_bloom'));
        check('the model tool routes into the same cast journal and actually heals the player',
            modelAction?.action === 'cast' && modelAction.status === 'applied'
            && modelAction.observation?.healedTargetIds.includes(ownerId) && await playerHealth(owner) > 5, modelAction);
    }
} finally {
    if (model) {
        model.closeAllConnections();
        model.close();
    }
    for (const port of ports) port.close();
    for (const bot of bots) bot.quit();
    await writeFile(baseline ? 'spellbook-baseline.json' : 'spellbook-candidate.json', JSON.stringify(report, null, 2) + '\n');
}
