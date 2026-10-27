// Actual party rescue, interruption, room-clear revival and wipe. The guarded
// fixture injects lethal damage and freezes attackers; it never revives players
// or clears a room. Room enemies are killed with real client attack packets.
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {command} from '../../ops/rcon-client.mjs';
const require=createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json');
const mf=require('mineflayer'),nav=createRequire(new URL('../../../packages/agent-mc-world/package.json',import.meta.url));
const {pathfinder,Movements,goals}=nav('mineflayer-pathfinder');
const stage='E:/MC/staging/aincrad-conquest-20261027',label=process.argv[2];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),out={checks:[],messages:[],errors:[],hits:0};let victim,rescuer;
const rcon=async q=>{const t=await command(q,15000,{port:25925,properties:stage+'/server.properties'});if(q.startsWith('qdqa ')&&!t.includes('QDQA_OK'))throw Error(t);return t;};
const check=(v,t)=>{assert.ok(v,t);out.checks.push(t);};
const state=async b=>{const raw=await rcon('qdqa rescue '+b.username);return JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));};
async function until(fn,label,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(200);}throw Error(label+' timeout');}
async function connect(username){const b=mf.createBot({host:'127.0.0.1',port:25924,username,version:'1.21.1',auth:'offline',checkTimeoutInterval:60000});b.loadPlugin(pathfinder);b.on('messagestr',t=>out.messages.push({name:username,text:t}));b.on('error',e=>out.errors.push(e.message));
 await Promise.race([new Promise((r,j)=>{b.once('spawn',r);b.once('end',j);}),sleep(30000).then(()=>{throw Error('join timeout');})]);await sleep(1300);
 const m=new Movements(b);m.canDig=false;m.allow1by1towers=false;m.allowParkour=false;m.scafoldingBlocks=[];b.pathfinder.setMovements(m);return b;}
async function chat(b,q){b.chat(q);await sleep(800);}
const enemies=()=>Object.values(rescuer.entities).filter(e=>['husk','skeleton','vindicator'].includes(e.name)&&e.position.distanceTo(rescuer.entity.position)<24);
try{
 victim=await connect('ag_RescueVictim');rescuer=await connect('ag_RescueHelper');
 for(const b of [victim,rescuer]){await chat(b,'/mycli dungeon leave');await rcon('qdqa cooldown '+b.username);await rcon('qdqa kit '+b.username);await rcon('qdqa castle '+b.username);await chat(b,'/mycli profession choose warrior');}
 await chat(victim,'/mycli dungeon start aincrad_01');await chat(rescuer,'/mycli dungeon join aincrad_01');
 await until(()=>enemies().length>=2,'first room actual enemies',20000);
 out.firstLethal=await rcon('qdqa lethal '+victim.username);
 await until(async()=>(await state(victim)).downed,'first damage actually enters downed state',3000);
 check((await state(victim)).downed===true&&victim.health>0,'lethal damage enters real waiting state instead of vanilla death');
 await until(async()=>JSON.stringify(await state(rescuer)).includes('rescuing'),'nearby rescue starts');await sleep(1400);
 out.progressBeforeInterruption=await state(rescuer);
 check(JSON.stringify(out.progressBeforeInterruption).includes('progress'),'actual rescue reports progress');
 await rescuer.pathfinder.goto(new goals.GoalNear(852,69,-1140,0));
 await sleep(600);out.interrupted=await state(rescuer);
 check(JSON.stringify(out.interrupted).includes('waiting')&&!JSON.stringify(out.interrupted).includes('rescuing'),'leaving four blocks interrupts rather than preserving partial progress');
 await rescuer.pathfinder.goto(new goals.GoalNear(victim.entity.position.x,victim.entity.position.y,victim.entity.position.z,2));
 await until(async()=>!(await state(victim)).downed,'ten-second nearby revival',18000);
 check(out.messages.some(m=>m.name===victim.username&&m.text.includes('reason=nearby_teammate')),'nearby revival has explicit server reason');
 await sleep(2500);
 // Move the victim using the client to the opposite verified corner. The
 // helper fights the actual frozen enemies outside the nearby-rescue radius,
 // so a room clear must be the cause of this second revival.
 await victim.pathfinder.goto(new goals.GoalNear(852,69,-1140,0));
 out.secondLethal=await rcon('qdqa lethal '+victim.username);
 await until(async()=>(await state(victim)).downed,'second damage actually enters downed state',3000);
 check((await state(victim)).downed===true,'second lethal event also waits for party');
 await rescuer.equip(rescuer.inventory.items().find(i=>i.name==='iron_sword'),'hand');
 const end=Date.now()+90000;
 while(enemies().length&&Date.now()<end){const target=enemies().sort((a,b)=>a.position.distanceTo(rescuer.entity.position)-b.position.distanceTo(rescuer.entity.position))[0];
  if(target.position.distanceTo(rescuer.entity.position)>2.8)rescuer.pathfinder.setGoal(new goals.GoalFollow(target,2),true);
  else{rescuer.pathfinder.setGoal(null);rescuer.clearControlStates();await rescuer.lookAt(target.position.offset(0,1.1,0));rescuer.attack(target);out.hits++;}
  if(out.hits>0&&out.hits%8===0)(out.observations??=[]).push(await rcon('qdqa encounter '+rescuer.username));
  await sleep(700);
 }
 rescuer.pathfinder.setGoal(null);
 check(enemies().length===0&&out.hits>0,'real melee attacks clear the first room');
 await until(async()=>!(await state(victim)).downed,'room-clear revival');
 check(out.messages.some(m=>m.name===victim.username&&m.text.includes('status=revived')&&/room|clear/.test(m.text)),'room clear revives with a separate actual reason');
 await Promise.all([victim,rescuer].map(b=>b.pathfinder.goto(new goals.GoalNear(844,69,-1160,2))));
 await until(()=>enemies().length>=3,'second-room actual enemies');
 await rcon('qdqa lethal '+victim.username);await rcon('qdqa lethal '+rescuer.username);
 await until(async()=>!(await state(victim)).downed&&!(await state(rescuer)).downed,'wipe exits safely');
 await chat(victim,'/mycli dungeon status aincrad_01');
 check(out.messages.some(m=>/all_downed|party_wipe|全队倒下|全队倒地/.test(m.text)),'party wipe explains why the run ended');
 const receipt=await rcon('qdqa receipt '+victim.username);out.receipt=receipt;
 check(receipt.includes('receipt=false')&&receipt.includes('floorProof=false'),'partial clear and wipe never award a formal floor or loot receipt');
}catch(e){out.errors.push(e.stack||String(e));if(rescuer)try{out.failureObservation=await rcon('qdqa encounter '+rescuer.username);}catch{}}
finally{for(const b of [victim,rescuer])if(b){b.pathfinder?.setGoal(null);b.chat('/mycli dungeon leave');await sleep(800);b.quit('rescue QA finished');}await sleep(400);await writeFile(stage+'/client-'+label+'.json',JSON.stringify(out,null,2));console.log(JSON.stringify({checks:out.checks,errors:out.errors,hits:out.hits}));process.exitCode=out.errors.length?1:0;}
