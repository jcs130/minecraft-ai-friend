/** Ordinary clients against the explicitly marked loopback QA server. No production writes. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',out=process.argv[2],tag=process.argv[3]??'b1';assert(out?.startsWith('E:/MC/ops/repairs/rpg-checkpoint-20261029-'));assert(/^[a-z0-9]{1,3}$/.test(tag));
assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const bots=[],report={checks:[],receipts:[],productionChanged:false};
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS '+name);};
const until=async(fn,label,ms=30000)=>{for(const end=Date.now()+ms;Date.now()<end;){const v=await fn();if(v)return v;await sleep(150);}throw Error('timeout '+label);};
const rc=async q=>{const s=await command(q,15000,{port:25929,properties:stage+'/server.properties'});report.receipts.push({q,text:s});return s;};
async function connect(name){const b=mf.createBot({host:'127.0.0.1',port:25928,username:name,version:'1.21.1',auth:'offline',respawn:true,hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.messages=[];b.deaths=0;
 b.on('messagestr',s=>b.messages.push(s));b.on('death',()=>b.deaths++);b.on('kicked',r=>report.receipts.push({name,kicked:String(r)}));b.on('error',e=>report.receipts.push({name,error:String(e)}));installRecipePacketBypass(b._client);
 await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'spawn '+name);b.physicsEnabled=false;return b;
}
async function ask(b,q,prefix){await sleep(Math.max(0,1100-(Date.now()-(b.lastChat??0))));const mark=b.messages.length;b.lastChat=Date.now();b.chat(q);const line=await until(()=>b.messages.slice(mark).find(s=>s.startsWith(prefix)),q);const text=line.slice(prefix.length);let data;try{data=JSON.parse(text);}catch{data=text;}report.receipts.push({name:b.username,q,data});return data;}
const state=(b,id)=>(ask(b,'/mycli dungeon status '+id+' --json','MC_SITE_DUNGEON_STATE '));
const action=(b,q)=>(ask(b,'/mycli dungeon '+q+' --json','MC_SITE_DUNGEON_RESULT '));
const rpg=b=>ask(b,'/mycli status --json','MC_RPG ');
const count=(b,name)=>b.inventory.items().filter(i=>i.name===name).reduce((n,i)=>n+i.count,0);
async function pos(b){const s=await rc('minecraft:data get entity '+b.username+' Pos');const m=s.match(/\[([^\]]+)\]/);assert(m,s);return m[1].split(',').map(parseFloat);}
async function tp(b,x,z=2400.5){await rc(`minecraft:tp ${b.username} ${x} 81 ${z}`);await sleep(200);}
async function hurt(b){await rc('qduse heal '+b.username);await rc('minecraft:damage '+b.username+' 1000 minecraft:generic');}
async function fighting(b,id,stageNo){await until(async()=>{const s=await state(b,id);return s.phase==='fighting'&&s.stage===stageNo;},'fight '+id+'/'+stageNo);await rc('qduse freezehostiles '+b.username);}
async function clearRoom(b,id){await rc(`minecraft:damage @e[tag=afu_site_${id},limit=1] 1000 minecraft:player_attack by ${b.username}`);}
async function gear(b){await rc('qduse emptybag '+b.username);await rc('qduse armor '+b.username);await rc('minecraft:give '+b.username+' minecraft:iron_sword');await rc('minecraft:give '+b.username+' minecraft:diamond 3');await rc('qduse hunger '+b.username+' 20');await rc('qduse heal '+b.username);}
try{
 const [a,b,x,eye]=await Promise.all(['ag_RUCPa','ag_RUCPb','ag_RUCPx','ag_RUCPEye'].map(name=>connect(name+tag)));
 await rc('minecraft:gamerule keepInventory true');
 for(const base of [3000,3200,3400]){await rc(`minecraft:forceload add ${base-10} 2394 ${base+32} 2406`);await rc(`minecraft:fill ${base-10} 80 2394 ${base+32} 80 2406 stone`);await rc(`minecraft:fill ${base-10} 81 2394 ${base+32} 85 2406 air`);}
 for(const p of [a,b,x]){await rc('minecraft:gamemode survival '+p.username);await tp(p,3000.5);check('native class selected '+p.username,(await ask(p,'/mycli profession choose knight --json','MC_RPG ')).saved);}
 await rc('minecraft:gamemode spectator '+eye.username);await tp(eye,2990.5);
 const ops=JSON.parse(await fs.readFile(stage+'/ops.json','utf8'));check('clients operate without OP',[a,b,x].every(p=>!ops.some(o=>o.uuid===p._client.uuid||o.name===p.username)));
 await rc('qduse fullbag '+a.username);await rc('qduse mana '+a.username+' 50');
 const fullMark=a.messages.length;await rc('qduse pickup '+a.username);
 a._client.write('position',{x:3000.6,y:81,z:2400.5,onGround:true});
 const hint=await until(()=>a.messages.slice(fullMark).find(s=>s.includes('inventory_full')),'actual blocked pickup hint');
 check('real blocked pickup offers an executable slot and quantity',/\/mycli arena stash putslot \d+ 64/.test(hint)&&!hint.includes('putslot <'));
 const full=await rpg(a),selection=full.nextCommand?.match(/^\/mycli arena stash putslot (\d+) (\d+)$/);
 const selected=selection&&Number(selection[1]);check('full bag advice contains a real reversible transfer',full.guide.reason==='inventory_full'&&selection&&selected>=0&&selected<36&&selected!==a.quickBarSlot&&Number(selection[2])===64);
 const before=count(a,'stone');const put=await ask(a,full.nextCommand,'MC_STASH_PUT ');check('remote slot deposit moves a real stack',typeof put==='string'&&put.includes('moved=64'));
 await until(()=>count(a,'stone')===before-64,'slot update');check('remote deposit completes without opening a GUI',!a.currentWindow);
 const listed=await ask(a,'/mycli arena stash list 1','MC_STASH ');check('stored item is in the personal chest',typeof listed==='string'&&listed.includes('count=64'));
 await ask(a,'/mycli arena stash take 1 64','MC_STASH_TAKE ');await until(()=>count(a,'stone')===before,'real withdrawal');check('remote withdrawal restores the exact original item total',count(a,'stone')===before);
 await gear(a);await rc('minecraft:give '+a.username+' minecraft:iron_boots');await sleep(400);
 const item=a.inventory.items().find(i=>i.name==='iron_boots');assert(item);const invSlot=item.slot>=36?item.slot-36:item.slot;
 const moneyBefore=(await ask(a,'/mycli trade wallet --json','MC_RPG ')).balance;
 const quote=await ask(a,'/mycli arena recycle quote bag '+invSlot+' 1','MC_ARENA_ECONOMY ');const quoteId=quote.details?.quoteId??quote.quoteId;assert(quoteId,JSON.stringify(quote));
 check('recycling quote does not remove the item',count(a,'iron_boots')===1);
 const sold=await ask(a,'/mycli arena recycle sell '+quoteId,'MC_ARENA_ECONOMY ');await until(()=>count(a,'iron_boots')===0,'recycled item');
 const moneyAfter=(await ask(a,'/mycli trade wallet --json','MC_RPG ')).balance;
 check('recycling really removes gear and credits native gold',sold.success&&moneyAfter>moneyBefore);
 const twice=await ask(a,'/mycli arena recycle sell '+quoteId,'MC_ARENA_ECONOMY ');check('a consumed recycling quote cannot sell or credit twice',!twice.success&&(await ask(a,'/mycli trade wallet --json','MC_RPG ')).balance===moneyAfter);
 await tp(a,3000.5);await tp(b,2990.5);await tp(x,2990.5);
 check('solo checkpoint run starts',(await action(a,'start qa_checkpoint')).success);await fighting(a,'qa_checkpoint',1);await clearRoom(a,'qa_checkpoint');
 await until(async()=>{const s=await state(a,'qa_checkpoint');return s.stage===2&&s.checkpointRoom===1;},'first checkpoint');
 await tp(a,3012.5);await fighting(a,'qa_checkpoint',2);await hurt(a);
 await until(async()=>{const s=await state(a,'qa_checkpoint');return s.failures===1&&s.attemptsRemaining===2&&s.retrying;},'first failure');
 await until(async()=>Math.abs((await pos(a))[0]-3000.5)<4,'first checkpoint return');check('solo first lethal hit returns to the cleared checkpoint without death or loss',a.deaths===0&&count(a,'diamond')===3);
 await tp(a,3012.5);await fighting(a,'qa_checkpoint',2);await clearRoom(a,'qa_checkpoint');await until(async()=>(await state(a,'qa_checkpoint')).stage===3,'second checkpoint');
 await tp(a,3024.5);await fighting(a,'qa_checkpoint',3);await tp(x,3031.5);
 await tp(x,3024.5);check('another team cannot teleport into the active Boss room',Math.abs((await pos(x))[0]-3031.5)<1);
 await tp(x,3030.5);x._client.write('position',{x:3029.4,y:81,z:2400.5,onGround:true});await sleep(500);check('another team cannot walk through the Boss boundary',(await pos(x))[0]>3029.5);
 await tp(eye,3024.5);check('registered spectator remains able to observe the Boss',Math.abs((await pos(eye))[0]-3024.5)<1);
 await hurt(a);await until(async()=>{const s=await state(a,'qa_checkpoint');return s.failures===2&&s.attemptsRemaining===1&&s.retrying&&s.checkpointRoom===2;},'second failure');
 await until(async()=>Math.abs((await pos(a))[0]-3012.5)<4,'second checkpoint return');check('later defeat uses the latest cleared room and retains progress',(await state(a,'qa_checkpoint')).stage===3&&a.deaths===0);
 await tp(a,3024.5);await fighting(a,'qa_checkpoint',3);await hurt(a);
 const ended=await until(async()=>{const s=await state(a,'qa_checkpoint');return !s.active?s:false;},'third defeat');
 check('exactly the third defeat ends the challenge with an explicit reason',ended.lastOutcome.reason==='attempts_exhausted'&&ended.lastOutcome.failures===3&&ended.lastOutcome.attemptsRemaining===0&&a.deaths===0);
 await tp(x,3024.5);check('Boss boundary unlocks after the owning run ends',Math.abs((await pos(x))[0]-3024.5)<1);
 for(const p of [a,b]){await gear(p);await tp(p,3400.5);}
 await ask(a,'/mycli guild party create --json','MC_RPG ');await ask(a,'/mycli guild party invite '+b.username+' --json','MC_RPG ');await ask(b,'/mycli guild party accept --json','MC_RPG ');
 check('the native leader admits both real party members',(await action(a,'start qa_team_retry')).success);await fighting(a,'qa_team_retry',1);await clearRoom(a,'qa_team_retry');
 await until(async()=>(await state(a,'qa_team_retry')).stage===2,'team first clear');for(const p of [a,b])await tp(p,3412.5);await fighting(a,'qa_team_retry',2);
 await hurt(a);await until(()=>a.messages.some(s=>s.includes('status=downed')),'team downed');await sleep(11000);
 const rescued=await state(a,'qa_team_retry');check('real teammate rescue does not spend a challenge chance',rescued.failures===0&&rescued.attemptsRemaining===3&&a.deaths===0);
 await hurt(a);await hurt(b);await until(async()=>{const s=await state(a,'qa_team_retry');return s.failures===1&&s.retrying;},'team wipe');
 await until(async()=>Math.abs((await pos(a))[0]-3400.5)<4&&Math.abs((await pos(b))[0]-3400.5)<4,'team checkpoint');
 check('a full-party defeat consumes one shared chance and restores both teammates',(await state(a,'qa_team_retry')).attemptsRemaining===2&&a.deaths+b.deaths===0);
 await gear(x);await tp(x,3200.5);check('independent solo run starts',(await action(x,'start qa_solo_retry')).success);await fighting(x,'qa_solo_retry',1);await hurt(x);
 await until(async()=>{const s=await state(x,'qa_solo_retry');return s.failures===1&&s.attemptsRemaining===2;},'solo retained chance');
 report.beforeCold={team:await state(a,'qa_team_retry'),solo:await state(x,'qa_solo_retry'),names:[a.username,b.username,x.username,eye.username]};report.mechanismsComplete=true;
 await rc('minecraft:stop');console.log('QA stopped for genuine cold-restart verification.');
}catch(error){report.failed=String(error);throw error;}
finally{report.actorMessages=bots.map(b=>({name:b.username,messages:b.messages.slice(-35)}));for(const b of bots)b.quit();await fs.writeFile(out+'/checkpoint-audit.json',JSON.stringify(report,null,2)+'\n');}
