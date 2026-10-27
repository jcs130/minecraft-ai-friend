// Actual spell commands and native Bukkit target/damage events, QA port only.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {command} from '../../ops/rcon-client.mjs';
const require=createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json');
const {createBot}=require('mineflayer');
const stage='E:/MC/staging/aincrad-conquest-20261027',label=process.argv[2]||'skills';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const result={checks:[],errors:[],messages:[],receipts:[]};let tank,ally;
const check=(ok,message)=>{assert.ok(ok,message);result.checks.push(message);};
const rcon=async q=>{const text=await command(q,12000,{properties:stage+'/server.properties',port:25925});result.receipts.push({command:q,response:text});assert.match(text,/QDQA_OK/);return text;};
async function connect(username){const b=createBot({host:'127.0.0.1',port:25924,version:'1.21.1',auth:'offline',username});b.on('messagestr',t=>result.messages.push(t));b.on('error',e=>result.errors.push(e.message));await Promise.race([new Promise((r,j)=>{b.once('spawn',r);b.once('end',x=>j(Error(x)));}),sleep(25000).then(()=>{throw Error('join timeout')})]);return b;}
async function chat(b,q){const start=result.messages.length;b.chat(q);await sleep(650);return result.messages.slice(start).join('\n');}
function damage(text){return Number(/damage=([0-9.]+)/.exec(text)?.[1]);}
try{
 tank=await connect('ag_TankSkillQA');ally=await connect('ag_AllySkillQA');await sleep(4500);
 await rcon('qdqa setup '+ally.username);await rcon('qdqa setup '+tank.username);
 await chat(tank,'/mycli profession choose tank');
 for(const skill of ['tank_taunt','tank_bastion']){await chat(tank,'/mycli skills learn '+skill);await chat(tank,'/mycli skills prepare '+skill);}
 // The copied flat-world region policy cancels hostile damage. Use the actual
 // conquest map, without changing any protection flag, and await teleport grace.
 await rcon('qdqa castle '+ally.username);await rcon('qdqa castle '+tank.username);await rcon('qdqa difficulty');await sleep(5000);
 await rcon('qdqa spawn '+tank.username);await sleep(400);
 const mob=Object.values(tank.entities).find(e=>e.name==='zombie');check(!!mob,'real visible hostile target');
 await tank.lookAt(mob.position.offset(0,1,0));await sleep(250);
 await rcon('qdqa target '+tank.username+' '+ally.username);
 await chat(tank,'/mycli cast tank_taunt');check((await rcon('qdqa mob '+tank.username)).includes('target='+tank.username),'taunt changes native target');
 check((await rcon('qdqa targetevent '+tank.username+' '+ally.username)).includes('target='+tank.username),'taunt lease resists natural retarget event');
 await sleep(3600);check((await rcon('qdqa targetevent '+tank.username+' '+ally.username)).includes('target='+ally.username),'expired taunt releases target');
 await rcon('qdqa recover '+tank.username);const baseline=damage(await rcon('qdqa damage '+tank.username+' 10'));
 check(baseline>3,'native nonzero baseline damage');await rcon('qdqa recover '+tank.username);
 await tank.lookAt(mob.position.offset(0,1,0));await sleep(250);await chat(tank,'/mycli cast tank_bastion');
 const front=damage(await rcon('qdqa damage '+tank.username+' 10'));check(Math.abs(front-Math.max(baseline*.5,baseline-3))<.02,'bastion reduces final frontal damage with cap');
 await rcon('qdqa recover '+tank.username);await tank.look(tank.entity.yaw+Math.PI,0);await sleep(250);
 const rear=damage(await rcon('qdqa damage '+tank.username+' 10'));check(Math.abs(rear-baseline)<.02,'bastion does not protect rear');
 result.damage={baseline,front,rear};
 await sleep(18500);
 // Real incoming hits knock the player beyond the six-block taunt radius.
 // Reset only the QA position before testing the independent event veto.
 await rcon('qdqa castle '+tank.username);await tank.lookAt(mob.position.offset(0,1,0));await sleep(300);
 check(!(await rcon('qdqa mob '+tank.username)).includes('missing'),'fixture hostile survives until veto check');
 await rcon('qdqa recover '+tank.username);await rcon('qdqa veto '+tank.username+' yes');
 const before=await rcon('qdqa metrics '+tank.username);check((await chat(tank,'/mycli cast tank_taunt')).includes('protected_target'),'another plugin can veto taunt');
 const after=await rcon('qdqa metrics '+tank.username);check(before===after,'fully denied taunt refunds mana');
 await rcon('qdqa veto '+tank.username+' no');await rcon('qdqa shield '+tank.username+' no');
 check((await chat(tank,'/mycli cast tank_taunt')).includes('equipment_required'),'missing shield is explicit equipment denial');
 check(!(await chat(tank,'/mycli status')).includes('null'),'status remains readable');
}catch(e){result.errors.push(e.stack||String(e));}
finally{for(const b of [tank,ally])b?.quit('tank mechanics QA finished');await sleep(500);await fs.writeFile(stage+'/client-'+label+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks,errors:result.errors,damage:result.damage}));process.exitCode=result.errors.length?1:0;}
