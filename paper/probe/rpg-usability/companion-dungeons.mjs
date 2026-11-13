import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';

const stage = resolve(process.env.COMPANION_DUNGEON_STAGE);
const gamePort = Number(process.env.COMPANION_DUNGEON_PORT);
const baseline = process.argv.includes('--baseline');
const properties = resolve(stage, 'server.properties');
assert.equal(await readFile(resolve(stage, '.companion-dungeons-qa'), 'utf8'), 'SYNTHETIC_COMPANION_DUNGEONS_ONLY');
assert([26334, 26336].includes(gamePort));
const lines = (await readFile(properties, 'utf8')).split(/\r?\n/);
for (const setting of ['server-ip=127.0.0.1', 'server-port='+gamePort, 'rcon.port='+(gamePort+1)]) assert(lines.includes(setting));
const fixture = JSON.parse(await readFile(resolve(stage, 'fixture.json'), 'utf8'));
assert(fixture.synthetic && fixture.username === 'MaidBrainQA');
const {createBot} = createRequire(process.env.MINEFLAYER_PACKAGE)('mineflayer');
const report = {baseline, checks: []};
const clients = [];
const rc = async text => (await command(text, 12000, {port:gamePort+1, properties})).trim();
const mc = text => rc('minecraft:' + text);
const ownerName = fixture.username;
const maid = fixture.maid;
const position = async id => (await mc('data get entity '+id+' Pos')).match(/-?\d+(?:\.\d+)?(?=d)/g)?.map(Number);
const close = (a,b,n) => a && b && Math.hypot(...a.map((value,index)=>value-b[index])) <= n;
const isDim = async (id,dim) => (await mc('execute at '+id+' if dimension '+dim)).includes('Test passed');
const teleport = async (id,dim,x,y,z) =>
    assert.match(await mc(`execute in ${dim} run minecraft:tp ${id} ${x} ${y} ${z}`), /Teleported/);
const token = id => {
    const compact=id.replaceAll('-','');
    return [0,8,16,24].map(i=>parseInt(compact.slice(i,i+8),16)|0).join(',');
};
function check(label, result) {
    report.checks.push({label, passed:Boolean(result)});
    console.log((result ? 'PASS ' : 'FAIL ')+label);
    assert(result,label);
}
async function until(query, label, timeout=18000) {
    for (const end=Date.now()+timeout; Date.now()<end;) {
        const result=await query();
        if (result) return result;
        await delay(200);
    }
    throw Error('Timed out: '+label);
}
async function connect(username) {
    const bot=createBot({host:'127.0.0.1',port:gamePort,username,auth:'offline',version:'1.21.1',hideErrors:true,physicsEnabled:false});
    clients.push(bot);
    bot.lines=[];
    bot.on('messagestr',message=>bot.lines.push(message));
    bot.on('error',error=>{bot.failure=error.message;});
    installRecipePacketBypass(bot._client);
    await until(()=>bot.entity&&bot.player?.uuid,username,45000);
    return bot;
}
async function ask(bot,text,predicate) {
    const index=bot.lines.length;
    await delay(Math.max(0,1150-(Date.now()-(bot.sent??0))));
    bot.sent=Date.now();
    bot.chat(text);
    return until(()=>bot.lines.slice(index).find(predicate),text);
}
async function maidAction(bot, action, request) {
    const reply=await ask(bot,'/qdmaid '+action+' '+maid+' '+request,line=>line.startsWith('QD_MAID ')&&line.includes(request));
    return JSON.parse(reply.slice(reply.indexOf('{')));
}
async function floor(dimension,x,y,z,radius=3) {
    await mc(`execute in ${dimension} run forceload add ${x-radius} ${z-radius} ${x+radius} ${z+radius}`);
    await until(async()=>(await mc(`execute in ${dimension} if loaded ${x} ${y} ${z}`)).includes('Test passed'),'loaded '+dimension);
    assert.match(await mc(`execute in ${dimension} run fill ${x-radius} ${y-1} ${z-radius} ${x+radius} ${y-1} ${z+radius} stone`),/filled|changed|No blocks/i);
    await mc(`execute in ${dimension} run fill ${x-radius} ${y} ${z-radius} ${x+radius} ${y+2} ${z+radius} air`);
}
async function setup(owner) {
    await mc('gamerule doMobSpawning false');
    await mc('gamerule keepInventory true');
    await mc('clear '+ownerName);
    assert.match(await rc('dailyqa readiness-ground '+ownerName),/ground=ready/);
    await teleport(ownerName,'minecraft:overworld',-595.5,92,-312.5);
    for (const [slot,item] of [['head','helmet'],['chest','chestplate'],['legs','leggings'],['feet','boots']])
        await mc(`item replace entity ${ownerName} armor.${slot} with minecraft:iron_${item}`);
    for (const [item,n] of [['iron_sword',1],['bow',1],['arrow',16]]) await mc(`give ${ownerName} minecraft:${item} ${n}`);
    if (!await position(maid)) {
        await mc(`summon touhou_little_maid:maid -593.5 92 -312.5 {UUID:[I;${token(maid)}],Owner:[I;${token(fixture.owner)}],CustomName:'"SyntheticGuard"',PersistenceRequired:1b,Invulnerable:1b,NeoForgeData:{qiandengji_follow:{schemaVersion:1,walkDistance:32,stopDistance:16,returnDistance:64}}}`);
    } else await teleport(maid,'minecraft:overworld',-593.5,92,-312.5);
    await until(async()=>close(await position(maid),await position(ownerName),9),'synthetic maid and owner together');
    check('bound original synthetic owner',owner.player.uuid===fixture.owner);
    if (baseline) {
        assert.match(await rc('maidvortexqa pack-staff '+maid+' 1'),/packed=mage_apprentice_staff/);
    } else {
        const staff=async()=>JSON.parse((await rc('qdmaid guard-starter '+maid+' '+fixture.owner)).split('QD_MAID_GUARD_STARTER ')[1]);
        const first=await staff();
        check('console issues a genuine starter staff into one unlocked empty slot',first.status==='issued'&&first.staffId==='mage_apprentice_staff');
        const again=await staff();
        check('second provisioning keeps the same item in the same slot',again.status==='already_present'&&again.slot===first.slot);
        const denied=await ask(owner,'/qdmaid guard-starter '+maid+' '+fixture.owner,line=>line.startsWith('QD_MAID '));
        check('a player cannot provision equipment through the console action',denied.includes('permission_denied'));
    }
    const equipped=await maidAction(owner,'context','initial'+Date.now());
    assert(equipped.ok && equipped.data.maidId===maid);
}
async function tower(owner) {
    const start=await ask(owner,'/mycli arena start',line=>line.startsWith('MC_DUNGEON_START '));
    check('first trial floor starts through normal admission',start.includes('floor=1'));
    await until(async()=>Math.abs((await position(maid))?.[1]-69)<3,'native companion arrives on trial floor');
    const sample=await until(async()=>{
        const output=await rc('mycli admin dungeonaudit');
        return output.includes('MC_DUNGEON_AUDIT floor=1') && /\blastDamage=/.test(output) && output;
    },'authored trial mob');
    report.trialAtStart=sample;
    if (baseline) {
        await delay(7500);
        report.trialAfter=await rc('mycli admin dungeonaudit');
        check('old guard never deals damage to the authored trial mobs',
            !/(?:MAGIC|ENTITY_ATTACK|PROJECTILE):(?:UNKNOWN|TOUHOU_LITTLE_MAID)/i.test(report.trialAfter)
            && !(await maidAction(owner,'context','oldGuard')).data.companion.rpg?.lastHitAt);
    } else {
        let last;
        await until(async()=>{
            last=(await maidAction(owner,'context','guard'+Date.now())).data;
            return last.companion.rpg?.lastHitTargetId;
        },'real Vortex cast hits an authored tower enemy',18000);
        check('tower damage came from the original maid casting a real configured skill',
            last.maidId===maid && last.companion.rpg.lastHitSpellId==='arcane_bolt' && last.companion.rpg.lastHitAt);
        report.towerHit=last.companion.rpg;
    }
    await ask(owner,'/mycli arena leave',line=>line.includes('已返回地面'));
}
async function site(owner) {
    const context=async()=> (await maidAction(owner,'context','site'+Date.now())).data;
    await floor('minecraft:overworld',3200,81,2400,6);
    await teleport(ownerName,'minecraft:overworld',3205.5,81,2400.5);
    const joined=await until(async()=>close(await position(maid),await position(ownerName),4),'companion on the site entrance',25000);
    assert(joined);
    const previous=(await context()).companion.rpg.lastHitTargetId;
    await teleport(maid,'minecraft:overworld',3195.5,81,2400.5);
    const result=JSON.parse((await ask(owner,'/mycli dungeon start qa_guard_own --json',
        line=>line.startsWith('MC_SITE_DUNGEON_RESULT '))).split('MC_SITE_DUNGEON_RESULT ')[1]);
    assert(result.success,JSON.stringify(result));
    const waiting=(await context()).ownerDistance;
    check('outside combat, the 32/16 walking profile still keeps the ten-block gap',waiting>8);
    const found=await until(async()=>{
        const output=await rc('mycli admin dungeonaudit');
        return /SITE id=qa_guard_own .*phase=fighting/.test(output) && output;
    },'actual site run and mob');
    check('site party enters through its usual gate',found.includes('party=1'));
    await until(async()=>{
        const state=await context();
        const audit=await rc('mycli admin dungeonaudit');
        report.approach={distance:state.ownerDistance,position:state.position,guard:state.companion.state,
            owner:await position(ownerName),line:audit.split(/\r?\n/).find(line=>line.includes('SITE id=qa_guard_own '))};
        return state.ownerDistance<7;
    },'armed companion closes the gap during combat');
    check('companion walks inside spell range when combat starts',true);
    const hit=await until(async()=>{
        const rpg=(await context()).companion.rpg;
        return rpg.lastHitTargetId && rpg.lastHitTargetId!==previous && rpg;
    },'configured staff hits the active site room mob');
    check('original companion cast a real Vortex spell in the site dungeon',hit.lastHitSpellId==='arcane_bolt');
    report.siteHit=hit;
    await ask(owner,'/mycli dungeon leave qa_guard_own --json',line=>line.startsWith('MC_SITE_DUNGEON_RESULT '));
}

async function foreignRoom(owner) {
    const guest=await connect('ag_RUReadyA');
    await floor('minecraft:overworld',3400,81,2400);
    await mc('item replace entity '+ownerName+' armor.chest with minecraft:air');
    // The guest starts the site. The companion's owner cannot auto-enroll without the chestplate.
    await teleport(guest.username,'minecraft:overworld',3400.5,81,2400.5);
    await mc('effect give '+guest.username+' resistance 35 4 true');
    for (const [slot,item] of [['head','helmet'],['chest','chestplate'],['legs','leggings'],['feet','boots']])
        await mc(`item replace entity ${guest.username} armor.${slot} with minecraft:iron_${item}`);
    for (const item of ['iron_sword','bow','arrow']) await mc(`give ${guest.username} minecraft:${item}`);
    const result=JSON.parse((await ask(guest,'/mycli dungeon start qa_guard_foreign --json',
        line=>line.startsWith('MC_SITE_DUNGEON_RESULT '))).split('MC_SITE_DUNGEON_RESULT ')[1]);
    assert(result.success,JSON.stringify(result));
    const enemy='@e[tag=afu_site_qa_guard_foreign,limit=1]';
    await until(async()=>(await mc('execute if entity '+enemy)).includes('Test passed'),'foreign room mob');
    await teleport(ownerName,'minecraft:overworld',3401.5,81,2402.5);
    await teleport(maid,'minecraft:overworld',3400.5,81,2402.5);
    const before=(await maidAction(owner,'context','foreignBefore')).data;
    const hp=await mc('data get entity '+enemy+' Health');
    await delay(4000);
    const after=(await maidAction(owner,'context','foreignAfter')).data;
    const later=await mc('data get entity '+enemy+' Health');
    const party=(await rc('mycli admin dungeonaudit')).split(/\r?\n/).find(line=>line.includes('SITE id=qa_guard_foreign '));
    report.foreign={hp,later,party,position:after.position,previousTarget:before.companion.rpg.lastHitTargetId,
        currentTarget:after.companion.rpg.lastHitTargetId};
    check('companion cannot attack another party’s active site', /entity data: [\d.]+f$/.test(hp)
        && hp===later && party?.includes('party=1') && close(after.position,[3400.5,81,2400.5],6)
        && report.foreign.previousTarget===report.foreign.currentTarget);
    await ask(guest,'/mycli dungeon leave qa_guard_foreign --json',line=>line.startsWith('MC_SITE_DUNGEON_RESULT '));
}
async function recall(owner) {
    const other = await connect('MaidRecallGuest');
    await floor('minecraft:overworld',304,90,304);
    await floor('minecraft:the_nether',80,90,80);
    await teleport(ownerName,'minecraft:overworld',304.5,90,304.5);
    await teleport(maid,'minecraft:overworld',306.5,90,304.5);
    assert((await maidAction(owner,'stay','stay'+Date.now())).ok);
    await teleport(ownerName,'minecraft:the_nether',80.5,90,80.5);
    await until(()=>isDim(ownerName,'minecraft:the_nether'),'owner in Nether');
    assert(await isDim(maid,'minecraft:overworld'));
    const unauthorized=await maidAction(other,'recall','guest'+Date.now());
    check('visitor cannot recall a maid that belongs to somebody else',!unauthorized.ok&&unauthorized.error==='not_owned');
    const request='recall'+Date.now();
    const result=await maidAction(owner,'recall',request);
    check('the owner directly recalls the original maid across dimensions',
        result.ok&&result.data.status==='applied'&&result.data.observation.arrived===true
        && await isDim(maid,'minecraft:the_nether') && close(await position(maid),await position(ownerName),5));
    const replay=await maidAction(owner,'recall',request);
    check('repeated request returns the same result without a new teleport',replay.data.replayed===true);
}

try {
    const owner=await connect(ownerName);
    await setup(owner);
    await tower(owner);
    if (!baseline) {
        await site(owner);
        await foreignRoom(owner);
        await recall(owner);
    }
    check('ordinary clients stayed connected',clients.every(bot=>!bot.failure));
} catch(error) {
    report.error=String(error);
    report.recent=clients.map(bot=>({name:bot.username,lines:bot.lines.slice(-12)}));
    console.error(error);
    process.exitCode=1;
} finally {
    for (const bot of clients) bot.quit();
    await writeFile(resolve(stage,'companion-dungeons.proof.json'),JSON.stringify(report,null,2)+'\n');
}
