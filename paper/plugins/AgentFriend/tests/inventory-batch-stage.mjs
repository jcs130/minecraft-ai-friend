import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setTimeout as wait} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';

const stage = process.env.INVENTORY_BATCH_STAGE;
const report = process.env.INVENTORY_BATCH_REPORT;
const properties = stage + '/server.properties';
assert.equal(await readFile(stage+'/.inventory-quick-qa','utf8'),'SYNTHETIC_INVENTORY_QUICK_ONLY');
const settings = (await readFile(properties,'utf8')).split(/\r?\n/);
for (const line of ['server-ip=127.0.0.1','server-port=26984','rcon.port=26985']) assert(settings.includes(line));
const rc = text => command(text,12000,{port:26985,properties});
const {createBot} = createRequire(process.env.MINEFLAYER_PACKAGE)('mineflayer');
const bots=[], checks=[];
const check = (name,truth) => { assert(truth,name); checks.push(name); console.log('PASS',name); };
async function until(fn, name, ms=14000) {
    for (const end=Date.now()+ms;Date.now()<end;) { const value=fn(); if(value)return value; await wait(100); }
    throw Error('Timeout: '+name);
}
async function spawn(name) {
    const b=createBot({host:'127.0.0.1',port:26984,username:name,auth:'offline',version:'1.21.1',physicsEnabled:false,hideErrors:true});
    bots.push(b); b.lines=[]; b.on('messagestr',line=>b.lines.push(line)); b.on('error',()=>{});
    installRecipePacketBypass(b._client);
    await until(()=>b.entity&&b.player?.uuid,name,60000);
    return b;
}
async function ask(bot,command,prefix='MC_INVENTORY_BATCH') {
    await wait(1100);
    const start=bot.lines.length; bot.chat(command);
    try {
        const row=await until(()=>bot.lines.slice(start).find(s=>s.startsWith(prefix+' ')),command);
        await wait(180); return JSON.parse(row.slice(prefix.length+1));
    } catch(e) { throw Error(e.message+' received '+bot.lines.slice(start).join(' / ').slice(0,1100)); }
}
const quick = (bot,action,options='') => ask(bot,'/mycli inventory '+action+(options?' '+options:'')+' --json','MC_INVENTORY_BATCH');
const stash = bot => ask(bot,'/mycli arena stash summary --json','MC_STASH_OVERVIEW');
const replace = (bot,slot,item) => rc('minecraft:item replace entity '+bot.username+' '+slot+' with minecraft:'+item);
const count = (bot,name) => bot.inventory.slots.filter(i=>i?.name===name).reduce((n,i)=>n+i.count,0);
const fillHalf = (x,z,countAtLast) => rc('minecraft:data merge block '+x+' 76 '+z+' {Items:['+Array.from({length:27},(_,i)=>
    '{Slot:'+i+'b,id:"minecraft:'+(i===26&&countAtLast?'string':'bedrock')+'",count:'+(i===26&&countAtLast?countAtLast:64)+'}').join(',')+']}');
try {
    const player=await spawn('QaPackOne');
    if (process.argv.includes('--restart')) {
        const overview=await stash(player);
        check('stored surplus survives a cold process restart',overview.totalItems>=43);
        const chest=await rc('minecraft:data get block 17 76 13 Items[{Slot:26b}]');
        check('donated items survive a cold process restart',chest.includes('string')&&chest.includes('64'));
        check('original hotbar and remaining string survive restart',count(player,'string')===27&&count(player,'dirt')===8);
        const packed=await spawn('QaPackTenth');
        await wait(1800);await rc('minecraft:gamemode survival '+packed.username);
        await rc('minecraft:clear '+packed.username);await replace(packed,'inventory.0','string 19');
        const packedBefore=await stash(packed);check('all ten private pages are occupied',packedBefore.occupiedSlots===540);
        const partial=await quick(packed,'store');
        check('fills four places on page ten and keeps fifteen',partial.moved===4&&partial.manaSpent===2&&partial.leftForCapacity===15&&count(packed,'string')===15);
        const capped=await quick(packed,'store');
        check('private overflow stays in the bag with zero fee',capped.reason==='destination_full'&&capped.manaSpent===0&&count(packed,'string')===15);
    } else {
        const other=await spawn('QaPackOther');
        check('fixture actors have ordinary permissions', !(JSON.parse(await readFile(stage+'/ops.json','utf8'))).some(op=>[player.username,other.username].includes(op.name)));
        await rc('minecraft:gamemode survival '+player.username);
        await rc('minecraft:gamemode survival '+other.username);
        await rc('minecraft:forceload add 16 7 17 13');
        for (const z of [7,9,11,13]) for (const [x,side] of [[16,'left'],[17,'right']]) {
            await rc('minecraft:setblock '+x+' 76 '+z+' minecraft:chest[facing=north,type='+side+']');
        }
        const audit=await rc('mycli admin sharedstorage audit');
        check('four physical public double chests are available',audit.includes('"available":true') && audit.includes('"slots":216'));
        await wait(2500);
        await rc('minecraft:clear '+player.username); await rc('minecraft:clear '+other.username);
        await replace(player,'hotbar.0','dirt 8'); await replace(player,'armor.head','iron_helmet');
        await replace(player,'weapon.offhand','shield'); await replace(player,'inventory.0','dirt 21');
        await replace(player,'inventory.1','string 24'); await replace(player,'inventory.2','string 5');
        await replace(player,'inventory.3','stone[custom_name=\'{"text":"Keep me"}\'] 5');
        const prev=await quick(player,'clean','--dry-run');
        check('clean preview lists the exact 21 discardable items',prev.dryRun && prev.discarded[0].count===21 && count(player,'dirt')===29);
        const clean=await quick(player,'clean');
        check('clean protects hotbar, offhand, helmet and custom items',clean.changed&&count(player,'dirt')===8&&count(player,'shield')===1
              &&count(player,'iron_helmet')===1&&count(player,'stone')===5);
        check('clean merges both ordinary string stacks',clean.mergedItems===5&&count(player,'string')===29);
        check('clean repeated against unchanged contents makes no change',!(await quick(player,'clean')).changed);
        await replace(player,'inventory.4','arrow 64'); await replace(player,'inventory.5','arrow 16');
        await replace(player,'inventory.6','iron_sword'); await replace(player,'inventory.7','iron_sword');
        const otherBefore=await stash(other),ownBefore=await stash(player);
        const preview=await quick(player,'store','--dry-run');
        check('store preview predicts the batch without debiting inventory or mana',preview.moved===0&&preview.plannedItems===46&&preview.manaSpent===0&&count(player,'arrow')===80);
        const stored=await quick(player,'store');
        check('one store moves 46 and charges once for the remote transfer',stored.moved===46&&stored.manaSpent===2);
        check('keeps working arrows, one weapon, and tagged stone',count(player,'arrow')===64&&count(player,'iron_sword')===1&&count(player,'stone')===5);
        check('all goods arrived at the original private owner', (await stash(player)).totalItems-ownBefore.totalItems===46 && (await stash(other)).totalItems===otherBefore.totalItems);
        const again=await quick(player,'store'); check('repeat store moves zero and charges zero',again.moved===0&&again.manaSpent===0);
        await replace(player,'inventory.1','string 30');
        await fillHalf(16,13,0); await fillHalf(17,13,61);
        const offered=await quick(player,'donate','--dry-run');
        check('donation preview accounts for the three remaining places',offered.plannedItems===3&&offered.leftForCapacity===27&&count(player,'string')===30);
        const donation=await quick(player,'donate');
        check('donation only debits what the public chest accepted',donation.reason==='partial'&&donation.moved===3&&count(player,'string')===27);
        check('real chest inventory received the three items',(await rc('minecraft:data get block 17 76 13 Items[{Slot:26b}].count')).includes('64'));
        const full=await quick(player,'donate');check('full public chest leaves the bag intact',full.reason==='destination_full'&&full.moved===0&&count(player,'string')===27);
        await rc('minecraft:gamemode spectator '+player.username);
        const blocked=await quick(player,'donate');check('spectator cannot transfer',!blocked.success&&blocked.reason==='survival_required');
        await rc('minecraft:gamemode survival '+player.username);
        const invalid=await ask(player,'/mycli inventory donate QaPackOther');
        check('cannot donate on another actor\'s behalf',!invalid.success&&invalid.reason==='invalid_argument');
    }
} finally {
    for(const b of bots)b.quit();
    await writeFile(report,JSON.stringify({at:new Date().toISOString(),checks,syntheticOnly:true},null,2));
}

