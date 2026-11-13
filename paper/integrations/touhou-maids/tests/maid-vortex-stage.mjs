import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createMaidPort} from '../agent/maid-port.mjs';

const label = process.argv[2];
assert.match(label, /^[a-z0-9]+$/);
assert.equal(await readFile('.maid-vortex-qa', 'utf8'), 'SYNTHETIC_MAID_VORTEX_ONLY');
const properties = resolve('server.properties');
const server = await readFile(properties, 'utf8');
for (const setting of ['server-ip=127.0.0.1', 'server-port=26164', 'rcon.port=26165']) {
    assert(server.split(/\r?\n/).includes(setting));
}
const fixture = JSON.parse(await readFile('fixture.json', 'utf8'));
assert(fixture.synthetic && fixture.username === 'MaidBrainQA');
const {command} = await import(process.env.MAID_VORTEX_RCON);
const {createBot} = createRequire(process.env.MAID_VORTEX_JAVA)('mineflayer');
const rc = async text => (await command(text, 15000, {port: 26165, properties})).trim();
const {maid: maidId, username} = fixture;
const args = process.argv.slice(3);
const report = {synthetic: true, checks: [], physicalBedrockDevice: false, graphicalJavaClient: false};
const bots = [];
let owner, eye, guest, bedrock, model, port, bedrockMaid;

function check(name, condition) {
    report.checks.push({name, passed: !!condition});
    console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
    assert(condition, name);
}

async function until(read, name, timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const result = await read();
        if (result) return result;
        await delay(150);
    }
    check(name, false);
}

async function connect(name) {
    const bot = createBot({host: '127.0.0.1', port: 26164, version: '1.21.1', username: name,
        auth: 'offline', hideErrors: true, physicsEnabled: false});
    bots.push(bot);
    const wire = {animations: [], particles: [], sounds: [], errors: [], cameras: []};
    bot.on('error', error => wire.errors.push(error.message));
    bot.on('kicked', reason => wire.errors.push(String(reason)));
    bot._client.on('animation', packet => wire.animations.push(packet));
    bot._client.on('world_particles', packet => wire.particles.push(packet));
    bot._client.on('sound_effect', packet => wire.sounds.push(packet));
    bot._client.on('camera', packet => wire.cameras.push(packet.cameraId));
    bot._client.on('action_bar', packet => { wire.lastActionBar = packet.text; });
    await Promise.race([
        new Promise((accept, reject) => {
            bot.once('spawn', accept);
            bot.once('kicked', reason => reject(new Error(`${name} was kicked: ${JSON.stringify(reason)}`)));
            bot.once('error', reject);
        }),
        delay(25000, null, {ref: false}).then(() => { throw new Error(`Java spawn timed out for ${name}`); }),
    ]);
    await until(() => bot.player?.uuid, `Java player info ${name}`, 8000);
    return {bot, wire, maid: () => Object.values(bot.entities).find(entity => entity.uuid === maidId)};
}

const selector = '@e[tag=MaidMagicTargetQA,limit=1]';
const bedrockOwnerFixtureId = '14d30a2a-6d03-475a-b2d2-e6a6a81822fa';
const control = (action, actor = username) => rc(`maidvortexqa ${action} ${maidId} ${actor}`);
const ask = (action, extra = {}) => port.request({action, maidId, ...extra});
const context = async () => (await ask('context')).data;
const number = text => Number(text.match(/(?:data: |ownerMana=)(-?[\d.]+)/)?.[1]);
const health = async () => number(await rc(`minecraft:data get entity ${selector} Health`));
const targetUuid = async () => (await rc(`minecraft:data get entity ${selector} UUID`)).match(/\[I;\s*([^\]]+)\]/)?.[1]
    .split(/,\s*/).map(value => (Number(value) >>> 0).toString(16).padStart(8, '0')).join('')
    .replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/, '$1-$2-$3-$4-$5');

async function enemy(extraTag = '', mob = 'zombie', x = 305.5) {
    await rc('minecraft:kill @e[tag=MaidMagicTargetQA]');
    await rc(`minecraft:summon minecraft:${mob} ${x} 90 301.5 {Tags:["MaidMagicTargetQA","${extraTag || 'qa_hostile'}"],PersistenceRequired:1b,Silent:1b,CanPickUpLoot:0b}`);
    await control('target');
    return health();
}

try {
    owner = await connect(username);
    port = createMaidPort(owner.bot, {timeoutMs: 5000});
    check('synthetic original owner identity', owner.bot.player.uuid === fixture.owner);
    for (const cmd of ['gamerule doMobSpawning false', 'gamerule doDaylightCycle false', 'gamerule randomTickSpeed 0',
        'gamerule doPatrolSpawning false', 'gamerule doTraderSpawning false', 'gamerule doInsomnia false',
        'time set 18000', 'weather clear', 'difficulty normal', 'kill @e[tag=MaidMagicTargetQA]', 'kill ' + bedrockOwnerFixtureId,
        'fill 285 89 285 333 89 315 minecraft:stone', 'fill 285 90 285 333 94 315 minecraft:air',
        'fill 285 95 285 333 95 315 minecraft:stone',
        `tp ${username} 299.5 90 303.5`, `tp ${maidId} 300.5 90 301.5`]) {
        await rc('minecraft:' + cmd);
    }
    check('original maid can follow through the existing owner command', (await ask('follow', {requestId: `${label}-${randomUUID().slice(0,8)}-follow`})).data?.status === 'applied');
    await control('freeze-maid');
    await rc(`minecraft:tp ${maidId} 300.5 90 301.5`);
    check('fixture equips a genuine Vortex Apprentice Staff', (await control('equip')).includes('item=mage_apprentice_staff'));
    const ownerMana = number(await control('owner'));
    check('owner mana is ready independently', ownerMana > 0);

    if (args.includes('--baseline') || args.includes('--optional')) {
        const initial = await enemy();
        await delay(2600);
        check('unadapted Vortex staff leaves the original target unharmed', initial === await health());
        check('existing maid context remains available', (await context()).maidId === maidId);
    } else if (args.includes('--mana-config')) {
        const initial = await enemy();
        const blocked = await until(async () => {
            const view = (await context()).companion;
            return view.state === 'rpg_mana_low' && view;
        }, 'mage reports configured mana requirement');
        check('insufficient mana changes neither target health nor hit receipt', initial === await health() && blocked.rpg.lastHitTargetId !== await targetUuid());
        check('insufficient mana does not charge the owner', number(await control('mana')) === ownerMana);
    } else {
        guest = await connect('MaidMagicGuestQA');
        await rc('minecraft:gamemode creative MaidMagicGuestQA');
        await rc('minecraft:tp MaidMagicGuestQA 298.5 90 304.5');
        await until(() => guest.maid(), 'unmodified Java receives original maid entity');
        check('vanilla projection is an Allay with the original maid UUID', guest.maid().name === 'allay');
        if (args.includes('--eye')) {
            eye = await connect('VortexMagicEyeQA');
            await until(() => eye.wire.cameras.includes(owner.bot.entity.id), 'CortiEyeMirror attaches the real camera protocol', 17000);
            check('CortiEye receives the same projected maid', await until(() => eye.maid()?.name === 'allay', 'attached Eye sees maid'));
        }
        if (args.includes('--bedrock')) {
            check('the synthetic maid uses the supported Dafeiyu YSM texture', (await control('model')).includes('model=qd_dafeiyu texture=pearl'));
            const visualKey = 'ysm:' + Buffer.from('qd_dafeiyu').toString('base64url') + ':' + Buffer.from('pearl').toString('base64url');
            await until(async () => (await control('read-model')).includes('visual=' + visualKey),
                'the visual registry observes the synthetic YSM choice before joining Bedrock');
            const fixtureApi = await import(process.env.MAID_VORTEX_BEDROCK);
            bedrock = fixtureApi.bedrockFixture({host: '127.0.0.1', port: 26166, username: 'VortexMaidBedQA'});
            bedrock.particles = [];
            bedrock.client.on('spawn_particle_effect', packet => bedrock.particles.push(packet));
            bedrock.client.on('level_event', packet => bedrock.particles.push(packet));
            await until(() => bedrock.spawned && bedrock.realChunks, 'Bedrock joins isolated Geyser', 65000);
            await rc('minecraft:tp .VortexMaidBedQA 298.5 90 303.5');
            const nbt = createRequire(process.env.MAID_VORTEX_JAVA)('prismarine-nbt');
            bedrockMaid = await until(() => {
                const schema = bedrock.propertyDefinitions.map(packet => nbt.simplify(packet.nbt))
                    .find(value => value.type === 'qiandengji:maid')?.properties;
                if (!schema) return null;
                const modelIndex = schema.findIndex(property => property.name === 'qiandengji:model');
                const matches = bedrock.entities.filter(entity => entity.entity_type === 'qiandengji:maid'
                    && bedrock.properties.get(String(entity.runtime_id))?.ints.get(modelIndex) === 209);
                return matches.length === 1 && {schema, modelIndex, entity: matches[0]};
            }, 'Bedrock receives the original fixture’s Dafeiyu appearance');
            check('Bedrock downloads and verifies the real maid resource pack', [...bedrock.packDownloads.values()].some(pack => pack.valid));
        }

        await rc(`minecraft:item replace entity ${maidId} weapon.mainhand with minecraft:blaze_rod`);
        await rc('minecraft:fill 303 90 292 303 94 310 minecraft:stone');
        let first = await enemy();
        const targetId = await targetUuid();
        await control('equip');
        await delay(2200);
        report.beforeFirstCast = {initialHealth: first, health: await health(), companion: (await context()).companion,
            maidPosition: await rc(`minecraft:data get entity ${maidId} Pos`), targetPosition: await rc(`minecraft:data get entity ${selector} Pos`),
            damage: await control('damage')};
        check('a wall blocks the staff before damage or receipt', first === 80 && report.beforeFirstCast.health === first
            && report.beforeFirstCast.companion?.rpg?.lastHitTargetId !== targetId);
        await rc(`minecraft:item replace entity ${maidId} weapon.mainhand with minecraft:blaze_rod`);
        await rc('minecraft:fill 303 90 292 303 94 310 minecraft:air');
        await delay(2200);
        check('a plain blaze rod cannot cast', await health() === first);
        check('current target is identified independently of old encounters', !!targetId);
        const hits = new Map();
        const receipts = new Set();
        report.hits = {};
        const inRange = await rc(`minecraft:tp ${maidId} 300.5 90 301.5`);
        assert.match(inRange, /Teleported/);
        await control('equip');
        await until(async () => {
            const magic = (await context()).companion?.rpg;
            if (magic?.lastHitTargetId === targetId && !receipts.has(magic.lastHitAt)) {
                receipts.add(magic.lastHitAt);
                if (hits.has(magic.lastHitSpellId)) return false;
                const hit = await control('damage');
                hits.set(magic.lastHitSpellId, {time: magic.lastHitAt, health: await health(), observedDamage: hit,
                    mana: magic.manaAtLastCombatCheck});
                report.hits = Object.fromEntries(hits);
            }
            return hits.has('arcane_bolt') && hits.has('mage_staff_bolt');
        }, 'both real spell definitions hit', 17000);
        check('initial magic hits are attributed to the original NPC and both configured spells change health',
            [...hits.values()].every(hit => hit.health < first && hit.observedDamage.startsWith(targetId + ' base=')));
        check('the NPC spends its own mana and leaves owner mana intact',
            hits.get('mage_staff_bolt').mana < 84 && hits.get('arcane_bolt').mana < 84 && number(await control('mana')) === ownerMana);

        const staffItem = await until(() => guest.maid().equipment?.find(item => item?.name === 'blaze_rod'), 'vanilla equipment receives blaze-rod staff');
        const seen = client => client.wire.animations.some(packet => packet.entityId === client.maid()?.id);
        check('Java observes the named maid carrying and swinging the actual staff', !!staffItem && seen(guest));
        check('Java receives actual spell particles and sound', guest.wire.particles.length > 0 && guest.wire.sounds.length > 0);
        if (eye) check('attached CortiEye observes the same swing, particles and sound', seen(eye) && eye.wire.particles.length > 0 && eye.wire.sounds.length > 0);
        if (bedrock) {
            const {schema, modelIndex, entity: maid} = bedrockMaid;
            const runtimeId = String(maid.runtime_id);
            report.bedrockModel = {runtimeId, expectedModel: 209, schema, observed: [...bedrock.properties.get(runtimeId).ints],
                modelState: await control('read-model'), initial: maid.properties, history: bedrock.propertyHistory
                    .filter(row => row.id === runtimeId).slice(0, 8)};
            check('Bedrock selects the mapped Dafeiyu geometry and pearl texture', bedrock.properties.get(runtimeId).ints.get(modelIndex) === 209);
            const attacks = bedrock.propertyHistory.filter(row => row.id === runtimeId).flatMap(row => row.packet?.floats ?? []);
            const attack = schema.findIndex(property => property.name === 'qiandengji:attack');
            const equips = bedrock.equipment.filter(packet => String(packet.runtime_entity_id) === runtimeId && packet.item?.network_id > 0);
            report.bedrockCombat = {model: bedrock.properties.get(runtimeId).ints.get(modelIndex),
                attackSamples: attacks.filter(value => value.index === attack).map(value => value.value),
                equipmentPackets: equips.length, particles: bedrock.particles.length, sounds: bedrock.sounds.length};
            check('Bedrock receives actual maid equipment and a nonzero cast animation', equips.length > 0 && attacks.some(value => value.index === attack && value.value > 0));
            check('Bedrock receives cast particles and positional sounds without disconnect', bedrock.particles.length > 0 && bedrock.sounds.length > 0 && bedrock.errors.length === 0);
        }

        const lastHit = (await context()).companion.rpg.lastHitTargetId;
        let before = await enemy('MaidMagicCancelQA');
        await until(async () => (await context()).companion?.state === 'rpg_hit_blocked', 'cancelled damage remains blocked');
        check('cancelled damage reports no new successful cast', await health() === before && (await context()).companion.rpg.lastHitTargetId === lastHit);
        before = await enemy('afu_site_dungeon');
        await delay(2200);
        check('reserved encounter mobs cannot be advanced by NPC magic', await health() === before);
        before = await enemy('afu_dungeon_mob');
        await delay(1900);
        check('trial-tagged mobs cannot be advanced by NPC magic', await health() === before);
        before = await enemy('afu_dungeon_mob');
        await control('vortex-encounter');
        await rc(`minecraft:tag ${selector} remove afu_dungeon_mob`);
        await delay(2200);
        check('Vortex instance mob is also protected by its tag', await health() === before);
        before = await enemy('', 'villager');
        await delay(1900);
        check('a neutral bystander is not attacked', await health() === before);
        await rc(`minecraft:gamemode spectator ${username}`);
        before = await enemy();
        await delay(2200);
        check('owner spectator state prevents casting', await health() === before);
        await control('owner');
        await ask('stay', {requestId: `${label}-${randomUUID().slice(0,8)}-stay`});
        before = await enemy();
        await delay(2200);
        check('explicit stay prevents combat', await health() === before);
        check('the original entity and owner survive combat and role changes', (await context()).ownerId === fixture.owner);
        check('all stock Java sessions remain connected', bots.every(bot => bot.entity) && [owner, guest, ...(eye ? [eye] : [])].every(client => client.wire.errors.length === 0));

        await rc('minecraft:gamemode survival MaidMagicGuestQA');
        await control('player-staff', 'MaidMagicGuestQA');
        await until(() => guest.bot.heldItem?.name === 'blaze_rod', 'player mage receives real class staff');
        await rc('minecraft:tp MaidMagicGuestQA 300.5 90 301.5 -90 0');
        const ground = await until(() => {
            if (Math.abs(guest.bot.entity.position.x - 300.5) > .15) return null;
            const block = guest.bot.blockAt(guest.bot.entity.position.floored().offset(0, -1, 0));
            return block?.name === 'stone' && block;
        }, 'player mage has a loaded interaction target');
        await guest.bot.activateBlock(ground);
        await until(async () => (await health()) < before, 'existing right-click player spell still damages');
        check('player continues to use Vortex class weapon through the original client path', (await health()) < before);

        if (bedrock) {
            await rc('minecraft:kill @e[tag=MaidMagicTargetQA]');
            await rc(`minecraft:tp ${maidId} 300.5 90 301.5`);
            await rc('minecraft:tp .VortexMaidBedQA 300.5 90 302.5');
            const bedrockCommand = value => bedrock.client.write('command_request', {command: value, internal: false,
                version: '52', origin: {type: 'player', uuid: randomUUID(), request_id: '', player_entity_id: 0n}});
            model = createServer(async (request, response) => {
                for await (const _chunk of request) { /* Read the isolated request before replying. */ }
                response.writeHead(200, {'content-type': 'application/json'});
                response.end(JSON.stringify({id: 'maid-vortex-bedrock-qa', object: 'chat.completion', model: 'fixture',
                    choices: [{index: 0, finish_reason: 'stop', message: {role: 'assistant', content: '今天一起练习法术吧。'}}]}));
            });
            await new Promise((accept, reject) => model.once('error', reject).listen(26168, '127.0.0.1', accept));
            const start = bedrock.texts.length;
            bedrockCommand(`/qdmaid say ${maidId} 今天要练习什么？`);
            const reply = await until(() => bedrock.texts.slice(start).find(line => line.includes('今天一起练习法术吧')),
                'Bedrock visitor receives a real NPC conversation reply', 16000);
            check('Bedrock can talk to the same maid as a visitor', !!reply);
            const opens = bedrock.opens.length;
            bedrockCommand(`/qdmaid menu ${maidId}`);
            await delay(1400);
            check('Bedrock visitor cannot open the original owner’s backpack', bedrock.opens.length === opens);

            const uuidReply = await rc('minecraft:data get entity .VortexMaidBedQA UUID');
            const values = uuidReply.match(/\[I;\s*([^\]]+)\]/)?.[1];
            check('isolated Bedrock UUID resolves to a real player', !!values);
            const fixtureId = bedrockOwnerFixtureId;
            await rc(`minecraft:kill ${fixtureId}`);
            await rc(`minecraft:summon touhou_little_maid:maid 301.5 90 301.5 {UUID:[I;${[0, 8, 16, 24].map(offset => parseInt(fixtureId.replaceAll('-', '').slice(offset, offset + 8), 16) | 0).join(',')}],Owner:[I;${values}],PersistenceRequired:1b}`);
            await delay(500);
            await rc(`minecraft:tp .VortexMaidBedQA 301.5 90 302.5`);
            bedrockCommand(`/qdmaid menu ${fixtureId}`);
            await until(() => bedrock.opens.length > opens, 'Bedrock owner can open their own native backpack');
            check('Bedrock owner receives a real translated container and keeps the connection', bedrock.opens.length > opens && bedrock.errors.length === 0);
        }
    }
} catch (error) {
    if (owner && port) report.contextOnFailure = (await context().catch(() => undefined))?.companion;
    if (owner) report.ownerGameModeOnFailure = owner.bot.game.gameMode;
    if (guest) report.playerActionBar = guest.wire.lastActionBar;
    if (bedrock) report.bedrockErrors = bedrock.errors;
    report.error = String(error.stack || error);
    console.error(report.error);
    process.exitCode = 1;
} finally {
    bedrock?.client.close();
    model?.close();
    port?.close();
    for (const bot of bots) bot.quit();
    await writeFile(resolve('..', `${label}.proof.json`), JSON.stringify(report, null, 2));
}
