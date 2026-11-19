import fs from 'node:fs';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const {command}=await import(pathToFileURL(process.env.RCON_CLIENT));
import assert from 'node:assert/strict';
const lab=path.resolve(process.env.COMPASS_QA_WORLD);
const props=Object.fromEntries(fs.readFileSync(path.join(lab,'server.properties'),'utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
assert.equal(props['server-ip'],'127.0.0.1');
const port=Number(props['server-port']);assert(Number.isInteger(port)&&port>0);
assert.equal(fs.readFileSync(lab+'/.chat-travel-qa','utf8'),'SYNTHETIC_CHAT_TRAVEL_ONLY');
const rc=cmd=>command(cmd,20000,{properties:lab+'/server.properties',port:Number(props['rcon.port'])});
const mineflayer=createRequire(process.env.MINEFLAYER_ANCHOR)('mineflayer');
const stamp=Date.now().toString().slice(-4),checks=[],bots=[];
const profiles=JSON.parse(fs.readFileSync(lab+'/plugins/QiandengVoice/npc-voices.json')).roles;
const yui=profiles.find(p=>p.aliases?.includes('结衣')),fish=profiles.find(p=>p.aliases?.includes('肥鱼'));
function check(label,v){assert.ok(v,label);checks.push(label);console.log(label)}
async function until(f,what,ms=18000){const start=Date.now();while(Date.now()-start<ms){if(await f())return;await pause(125)}throw Error('timeout: '+what)}
function ints(id){const b=Buffer.from(id.replaceAll('-',''),'hex');return [0,4,8,12].map(i=>b.readInt32BE(i)).join(',')}
async function bot(n){const b=mineflayer.createBot({host:'127.0.0.1',port,username:n+stamp,auth:'offline',version:'1.21.1',hideErrors:true});bots.push(b);b.lines=[];b.on('messagestr',m=>b.lines.push(m));b.on('error',e=>console.log('bot',e.message));let inWorld=false;b.once('spawn',()=>inWorld=true);await until(()=>inWorld,'spawn '+n);return b}
const dim=d=>'minecraft:'+d;
async function prepareBody(p,d,x){
  assert(p.id.startsWith('10000000-')&&p.ownerId.startsWith('20000000-'));
  const prefix='minecraft:execute in '+dim(d)+' run ';
  await rc(prefix+'forceload add '+(x-5)+' 395 '+(x+5)+' 405');
  await rc(prefix+'fill '+(x-5)+' 99 395 '+(x+5)+' 99 405 minecraft:stone');
  await rc(prefix+'fill '+(x-5)+' 100 395 '+(x+5)+' 104 405 minecraft:air');
  // The isolated body may already exist in another dimension. Use the original UUID.
  let moved=false;
  for(const from of ['overworld','the_nether','the_end']){
    const result=await rc('minecraft:execute in '+dim(from)+' as '+p.id+' in '+dim(d)+' run minecraft:teleport @s '+(x+.5)+' 100 400.5');
    if(/Teleport|传送/i.test(result)){moved=true;break}
  }
  if(!moved)await rc(prefix+'minecraft:summon touhou_little_maid:maid '+(x+.5)+' 100 400.5 {UUID:[I;'+ints(p.id)+'],Owner:[I;'+ints(p.ownerId)+'],PersistenceRequired:1b,Invulnerable:1b,NoAI:1b,CustomName:\'"'+p.aliases[0]+'"\'}');
  await rc(prefix+'minecraft:effect clear '+p.id+' minecraft:invisibility');
  await rc(prefix+'data merge entity '+p.id+' {NoAI:1b,Invulnerable:1b}');
  const actual=await rc('minecraft:execute in '+dim(d)+' as '+p.id+' at @s if dimension '+dim(d)+' run minecraft:data get entity @s Pos');assert(actual.includes(x+'.5d'),p.name+' position '+actual);
}
async function travel(b,name,d,x){
  const start=b.lines.length;b.chat('/mycli locate');await until(()=>b.currentWindow,'find teammates');
  let w=b.currentWindow;
  const index=(name)=>w.slots.slice(0,27).findIndex(s=>s?.name==='ender_pearl'&&JSON.stringify(s.components??s).includes(name));
  let slot=index(name);
  if(slot<0)throw Error('missing '+name+' '+JSON.stringify(w.slots.slice(0,27).filter(Boolean).map(s=>[s.slot,s.name,JSON.stringify(s.components??s).slice(0,180)])));
  await b.clickWindow(slot,0,0);
  await until(()=>b.lines.slice(start).some(v=>v.includes('已安全抵达')),'arrival '+name+' '+JSON.stringify(b.lines.slice(-6)));
  const at=await rc('minecraft:execute in '+dim(d)+' as '+b.username+' at @s if dimension '+dim(d)+' run minecraft:data get entity @s Pos');
  const pos=at.match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);assert(pos,at);assert(Math.hypot(+pos[1]-x-.5,+pos[2]-100,+pos[3]-400.5)<4,at);
  check('clicked pearl to '+name+'; actual dimension '+d+' and distance under four blocks',true);
}
try{
 await prepareBody(yui,'overworld',400);await prepareBody(fish,'the_nether',420);
 const a=await bot('CompassQa'),b=await bot('PeerQa');
 for(const p of [a,b]){await rc('gamemode survival '+p.username);await rc('minecraft:effect give '+p.username+' minecraft:resistance 600 4 true')}
 a.chat('/mycli locate list');await until(()=>a.lines.some(s=>s.includes('MC_PLAYER')&&s.includes('肥鱼')),'list body',9000);
 for(const p of [yui,fish])check('listed original '+p.aliases[0]+' UUID',a.lines.some(l=>l.includes('MC_PLAYER')&&l.includes(p.id)));
 check('regular player listed',a.lines.some(s=>s.includes('MC_PLAYER')&&s.includes(b.username)));
 await travel(a,'肥鱼','the_nether',420);await travel(b,'结衣','overworld',400);
 let start=b.lines.length;b.chat('/mycli locate 结衣');await until(()=>b.lines.slice(start).some(l=>l.includes('正在追踪 结衣')),'tracking');
 check('resident tracking acknowledges target',true);
 await rc('minecraft:effect give '+fish.id+' minecraft:invisibility 60 0 true');
 start=b.lines.length;b.chat('/mycli locate tp 肥鱼');await until(()=>b.lines.slice(start).some(l=>l.includes('不可定位')),'invisible refused');
 check('hidden companion refused after original listing',true);
} catch(e){console.error(e.stack);for(const b of bots)console.error(b.lines.slice(-8));process.exitCode=1} finally{
 if(process.env.COMPASS_QA_REPORT)fs.writeFileSync(process.env.COMPASS_QA_REPORT,JSON.stringify({passed:!process.exitCode,checks},null,2));for(const b of bots)b.quit();
}

