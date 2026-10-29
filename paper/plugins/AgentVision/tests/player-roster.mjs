/** Spatial occlusion must not manufacture player login/logout transitions. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const [stage,output,mode]=process.argv.slice(2);assert(['baseline','candidate'].includes(mode));
assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const props=await fs.readFile(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25928\r?$/m);assert.match(props,/^rcon.port=25929\r?$/m);
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:25929});
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const bots=[],report={mode,checks:[],packets:[],transportEnds:[],passed:false,productionChanged:false};
const check=(label,ok)=>{assert(ok,label);report.checks.push(label);console.log('PASS '+label);};
async function until(fn,label){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Timeout '+label);}
const entity=(b,id)=>Object.values(b.entities).find(e=>e.uuid?.toLowerCase()===id.toLowerCase());
try{
 await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:time set day');
 await rc('minecraft:forceload add 94 94 115 108');await sleep(600);
 await rc('minecraft:fill 94 80 94 115 80 108 stone');await rc('minecraft:fill 94 81 94 115 87 108 air');
 for(const username of ['ag_RosterView','RosterSource']){
  const b=mf.createBot({host:'127.0.0.1',port:25928,username,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});bots.push(b);installRecipePacketBypass(b._client);b.on('error',e=>report.transportEnds.push(e.message));b.on('end',why=>report.transportEnds.push(username+':'+why));
  await until(()=>b.entity,'spawn '+username);await b.waitForChunksToLoad();
  await rc('minecraft:gamemode creative '+username);
  await rc('minecraft:tp '+username+' '+(username==='ag_RosterView'?'100.5':'108.5')+' 81 100.5');
  await sleep(700);await until(()=>b.entity.position.y>80&&b.entity.position.x>99,'fixture teleport '+username);
 }
 const [viewer,source]=bots,uuid=source.player.uuid;await until(()=>entity(viewer,uuid),'initial actual player entity');const originalId=entity(viewer,uuid).id;
 let joins=0,leaves=0,recording=false;viewer.on('playerJoined',p=>{if(recording&&p.username==='RosterSource')joins++;});viewer.on('playerLeft',p=>{if(recording&&p.username==='RosterSource')leaves++;});
 viewer._client.on('packet',(p,m)=>{if(recording&&['player_info','player_remove','entity_destroy','spawn_entity'].includes(m.name))report.packets.push({at:Date.now(),name:m.name,mentionsTarget:JSON.stringify(p).toLowerCase().includes(uuid.toLowerCase()),action:p.action,ids:p.entityIds,entityId:p.entityId});});
 await sleep(1000);recording=true;
 for(let n=0;n<5;n++){
  await rc('minecraft:fill 104 81 94 104 86 106 stone');await until(()=>!entity(viewer,uuid),'actual hidden entity '+n);check('hidden player retains online identity '+n,!!viewer.players.RosterSource);
  await rc('minecraft:fill 104 81 94 104 86 106 glass');await until(()=>entity(viewer,uuid),'actual revealed entity '+n);check('reveal reuses existing server entity '+n,entity(viewer,uuid).id===originalId);
 }
 report.beforeRealQuit={joins,leaves,removes:report.packets.filter(p=>p.name==='player_remove'&&p.mentionsTarget).length};
 check('same target TCP connection through all visibility cycles',report.transportEnds.length===0&&source.entity.id===originalId);
 if(mode==='baseline')check('old bytecode reproduces synthetic leave/add transitions',leaves>=5&&joins>=5&&report.beforeRealQuit.removes>=5);
 else{check('spatial filtering sends no player-info removal',report.beforeRealQuit.removes===0);check('spatial filtering emits no fake joins or leaves',joins===0&&leaves===0);}
 await rc('minecraft:fill 104 81 94 104 86 106 stone');await until(()=>!entity(viewer,uuid),'hidden before real exit');await sleep(250);const before=leaves;
 source.quit('actual QA disconnect');await until(()=>!viewer.players.RosterSource,'real logout still removes identity');
 check('genuine logout remains observable',mode==='baseline'?leaves>before:leaves===before+1);report.afterRealQuit={joins,leaves};report.passed=true;
}finally{await fs.writeFile(output,JSON.stringify(report,null,2));for(const b of bots)if(!b._client.ended)b.quit();}
