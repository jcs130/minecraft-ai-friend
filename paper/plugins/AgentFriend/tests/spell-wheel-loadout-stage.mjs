import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {isDeepStrictEqual} from 'node:util';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';

const stage=await fs.realpath(process.env.WHEEL_LOADOUT_STAGE);
assert.equal((await fs.readFile(path.join(stage,'.wheel-loadout-qa'),'utf8')).trim(),'SYNTHETIC_WHEEL_LOADOUT_ONLY');
const properties=path.join(stage,'server.properties');
const props=(await fs.readFile(properties,'utf8')).split(/\r?\n/);
for(const value of ['server-ip=127.0.0.1','server-port=26875','rcon.port=26876','online-mode=false'])assert(props.includes(value));
const mineflayer=createRequire(path.resolve(process.env.MINEFLAYER_PACKAGE))('mineflayer');
const rc=text=>command(text,10000,{port:26876,properties});
const bots=[],checks=[];
const cells=[10,11,12,13,14,15,16,19];
function check(name,ok){assert(ok,name);checks.push(name);console.log('PASS '+name);}
async function until(fn,label,ms=7000){for(const end=Date.now()+ms;Date.now()<end;){const value=fn();if(value)return value;await sleep(40);}throw Error('Timeout: '+label);}
async function connect(name){
 const bot=mineflayer.createBot({host:'127.0.0.1',port:26875,username:name,version:'1.21.1',auth:'offline',hideErrors:true});bots.push(bot);
 bot.lines=[];bot.on('messagestr',s=>bot.lines.push(s));bot.on('error',e=>console.error(String(e)));installRecipePacketBypass(bot._client);
 await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position),'spawn',45000);await sleep(1000);return bot;
}
async function chat(bot,text){await sleep(300);const mark=bot.lines.length;bot.chat(text);return mark;}
async function line(bot,mark,text){return until(()=>bot.lines.slice(mark).find(s=>s.includes(text)),text);}
async function open(bot){if(bot.currentWindow)bot.closeWindow(bot.currentWindow);await chat(bot,'/mycli menu wheel');return until(()=>bot.currentWindow?.slots[4]&&bot.currentWindow,'wheel and contents');}
async function click(bot,slot){const prev=bot.currentWindow;await bot.clickWindow(slot,0,0);return until(()=>bot.currentWindow&&bot.currentWindow!==prev&&bot.currentWindow.slots[4]&&bot.currentWindow,'new menu and contents');}
async function read(bot){const text=await rc('wheelqa read '+bot.username);const start=text.indexOf('{');assert(start>=0,text);return JSON.parse(text.slice(start));}
function stable(s){const copy=structuredClone(s);delete copy.mana;delete copy.wheel;return copy;}
async function config(bot,index){await open(bot);await click(bot,33);return click(bot,cells[index]);}
let failure;
try{
 const bot=await connect('WheelLoadQA1');
 const w=await open(bot);
 // This assertion is also the pre-change regression: the live baseline has no configuration control.
 check('wheel has an in-menu configuration entry',w.slots[33]?.name==='repeater');
 if(process.argv.includes('--before'))throw Error('baseline unexpectedly already supports configuration');
 if(process.argv.includes('--restart')){
  const expected=JSON.parse(await fs.readFile(path.join(stage,'wheel-loadout-expected.json'),'utf8'));
  const actual=await read(bot);
  await fs.writeFile(path.join(stage,'wheel-restart-snapshots.json'),JSON.stringify({expected,actual},null,2));
  check('same actor retains exact eight saved slots after normal restart',JSON.stringify(actual.wheel)===JSON.stringify(expected.wheel));
  check('restart retains inventory, learned spells, class and original active skill',isDeepStrictEqual(stable(actual),stable(expected)));
  check('reopened wheel displays the persisted profession shortcut',w.slots[19]?.name==='enchanted_book');
  check('real Floodgate forms preserve configuration actions and cancellation',/passed=true/.test(await rc('wheelqa forms '+bot.username)));
 }else{
  bot.closeWindow(bot.currentWindow);
  await rc('minecraft:gamerule naturalRegeneration false');
  await rc('minecraft:fill 20 -53 20 36 -53 36 minecraft:stone');
  await rc('minecraft:tp '+bot.username+' 26.5 -52 26.5');
  if(!(await read(bot)).abilities.some(id=>id.startsWith('mycli:mage_')))await line(bot,await chat(bot,'/mycli profession choose mage --json'),'"saved":true');
  await open(bot);await click(bot,33);await click(bot,22);
  const defaults=await open(bot);
  check('default quick wheel prioritizes a genuinely learned profession skill',defaults.slots[10]?.name==='enchanted_book');
  check('unconfigured quick wheel contains all eight cells',cells.every(s=>defaults.slots[s]));
  const before=await read(bot);
  await config(bot,7);
  const picker=await click(bot,33);
  check('profession picker exposes learned skill without casting',picker.slots[10]?.name==='enchanted_book');
  await click(bot,10);
  const configured=await read(bot);
  await fs.writeFile(path.join(stage,'wheel-resource-snapshots.json'),JSON.stringify({before,configured},null,2));
  check('configuration preserves character resources and inventory',isDeepStrictEqual(stable(before),stable(configured))&&configured.mana.current>=before.mana.current);
  check('moving the same skill clears its previous slot instead of duplicating',configured.wheel[0]===''&&configured.wheel[7]===before.abilities[0].slice('mycli:'.length)&&new Set(configured.wheel.filter(Boolean)).size===configured.wheel.filter(Boolean).length);
  await open(bot);
  check('saved layout mixes common and profession spells in fixed positions',bot.currentWindow.slots[10]?.name==='light_gray_dye'&&bot.currentWindow.slots[19]?.name==='enchanted_book'&&cells.some(s=>bot.currentWindow.slots[s]?.name==='golden_apple'));
  await config(bot,1);await click(bot,32);
  check('clear removes only a shortcut, not the learned spell',(await read(bot)).wheel[1]==='');
  await open(bot);
  const profession=await click(bot,31);
  check('all learned profession spells remain accessible outside quick slots',profession.slots[10]?.name==='enchanted_book');
  const common=await click(bot,31);
  check('full common catalogue remains accessible',common.slots[30]?.name==='arrow');
  const second=await click(bot,30);
  check('common catalogue pagination remains functional',second.slots[16]?.name==='firework_rocket'&&second.slots[19]?.name==='glowstone_dust');
  const firstCommon=await click(bot,28);await bot.clickWindow(19,0,0);
  const waypoints=await until(()=>bot.currentWindow&&bot.currentWindow!==firstCommon&&bot.currentWindow,'waypoint target selector');
  check('targeted travel opens destination selector rather than choosing a destination',!JSON.stringify(waypoints.title).includes('screen.qiandeng_controls.spell_wheel'));
  bot.closeWindow(bot.currentWindow);
  await rc('minecraft:kill @e[tag=wheel_loadout_target]');
  await rc('minecraft:summon minecraft:husk 29 -52 26.5 {NoAI:1b,Silent:1b,Tags:["wheel_loadout_target"]}');
  const target=await until(()=>Object.values(bot.entities).find(e=>e.name==='husk'&&e.position.distanceTo(bot.entity.position)<8),'target');
  await bot.lookAt(target.position.offset(0,1,0),true);
  await open(bot);const beforeCast=await read(bot);const castMark=bot.lines.length;await bot.clickWindow(19,0,0);
  await line(bot,castMark,'技能已执行');
  check('configured profession button invokes the original RPG caster',true);
  const afterCast=await read(bot);
  check('real profession cast consumes original mana',afterCast.mana.current<beforeCast.mana.current);
  await open(bot);const cooldownMark=bot.lines.length;await bot.clickWindow(19,0,0);await line(bot,cooldownMark,'[cooldown]');
  check('immediate repeat cannot bypass original cooldown',!bot.lines.slice(cooldownMark).some(s=>s.includes('技能已执行')));
  const other=await connect('WheelLoadQA2');await open(other);
  check('another player has independent defaults',!(await read(other)).wheel?.length&&other.currentWindow.slots[10]?.name!=='enchanted_book');
  await config(other,0);await click(other,32);
  check('editing another player does not replace first player slots',JSON.stringify((await read(bot)).wheel)===JSON.stringify(afterCast.wheel));
  await open(other);await click(other,33);await click(other,22);
  check('restore recommendation removes only the personal override',!(await read(other)).wheel?.length);
  const saved=await read(bot);bot.quit();await sleep(500);
  const again=await connect('WheelLoadQA1');await open(again);
  check('reconnect restores exact shortcut order',JSON.stringify((await read(again)).wheel)===JSON.stringify(saved.wheel));
  const forms=await rc('wheelqa forms '+again.username);console.log(forms);
  check('real Bedrock form codec accepts quick, edit and skill picker pages',/passed=true checks=43/.test(forms));
  await fs.writeFile(path.join(stage,'wheel-loadout-expected.json'),JSON.stringify(await read(again),null,2));
 }
}catch(e){failure=String(e);for(const b of bots)console.error(b.username,b.lines.slice(-10),b.currentWindow?.slots.slice(0,36).map((s,i)=>s?`${i}:${s.name}`:null).filter(Boolean));process.exitCode=1;}
finally{
 for(const b of bots)b.quit();await sleep(250);
 await fs.writeFile(path.join(stage,'wheel-loadout-'+(process.argv.includes('--before')?'before':process.argv.includes('--restart')?'restart':'after')+'.json'),JSON.stringify({passed:!failure,checks,error:failure??null,productionTouched:false},null,2));
 if(failure)console.error(failure);else console.log('WHEEL_LOADOUT passed=true checks='+checks.length);
}
process.exit(process.exitCode??0);
