// Destructive fixture checks: explicitly gated to the private loopback copy.
// Production uses per-block native preimage checks and entity clearance instead.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';
assert(process.env.MC_SHAFT_FILL_QA_ROOT,'Explicit isolated fixture root required');
const root=path.resolve(process.env.MC_SHAFT_FILL_QA_ROOT).replaceAll('\\','/'),setup=JSON.parse(fs.readFileSync(root+'/stage.json')),stage=path.resolve(setup.stage).replaceAll('\\','/');
assert.equal(path.dirname(stage),'E:/MC/staging');assert.equal(fs.readFileSync(stage+'/.village-shaft-fill-stage','utf8').trim(),'village-shaft-fill-20261017');
const props=fs.readFileSync(stage+'/server.properties','utf8');for(const line of ['server-ip=127.0.0.1','server-port=25830','rcon.port=25831','motd=VILLAGE_MINE_ISOLATED_20261017'])assert(props.split(/\r?\n/).includes(line));
assert(!fs.existsSync(root+'/lab-verification.json'),'Preserve earlier verification');
const {templates}=await import('file:///'+root+'/templates.mjs'),plan=JSON.parse(fs.readFileSync(root+'/plan.json'));
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),{Vec3}=req('vec3');
const {pathfinder,Movements,goals}=createRequire('E:/Cortico/package.json')('mineflayer-pathfinder');
const rc=q=>command(q,20000,{properties:stage+'/server.properties',port:25831}),out={at:new Date().toISOString(),formalChanged:false,checks:[],walks:[]};
const check=(name,pass)=>{out.checks.push({name,pass:!!pass});assert(pass,name);};let bot;
try{
 check('actual production plugin version is used',(await rc('version AgentFriend')).includes('0.4.47'));
 check('plan only replaces air and soft plants',plan.changes.every(c=>/^minecraft:(air|cave_air|void_air|short_grass|tall_grass|fern|large_fern)$/.test(c.before.Name)));
 const chunks=new Set(plan.changes.map(c=>Math.floor(c.x/16)+','+Math.floor(c.z/16)));for(const k of chunks){const[x,z]=k.split(',').map(Number);await rc(`minecraft:forceload add ${x*16} ${z*16}`);}
 const batches=templates(plan.changes,stage,'lab');for(const b of batches){const response=await rc('minecraft:execute in minecraft:overworld run minecraft:place template '+b.id+' '+b.origin.join(' '));assert(/Loaded template|Placed template/.test(response),response);}out.templateCount=batches.length;
 bot=req('mineflayer').createBot({host:'127.0.0.1',port:25830,username:'ag_ShaftQA17',version:'1.21.1',auth:'offline',hideErrors:true,checkTimeoutInterval:60000});installRecipePacketBypass(bot._client);bot.on('error',e=>{out.clientErrors??=[];out.clientErrors.push(e.message);});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('spawn timeout')),30000);bot.once('spawn',()=>{clearTimeout(timer);resolve();});bot.once('kicked',s=>reject(Error(String(s))));});
 bot.loadPlugin(pathfinder);const movements=new Movements(bot);movements.canDig=false;movements.allow1by1towers=false;movements.allowParkour=false;movements.allowSprinting=false;movements.scafoldingBlocks=[];bot.pathfinder.setMovements(movements);
 await rc('minecraft:effect give '+bot.username+' minecraft:saturation 300 2 true');
 for(const component of plan.components.filter(c=>c.accepted)){
  const p=component.points[0];await rc('minecraft:gamemode spectator '+bot.username);await rc(`minecraft:tp ${bot.username} ${p.x+.5} ${p.grade+1} ${p.z+.5}`);await rc('minecraft:gamemode survival '+bot.username);await sleep(1400);
  check('standing on repaired pit '+component.id,Math.abs(bot.entity.position.y-(p.grade+1))<.2&&bot.blockAt(new Vec3(p.x,p.grade,p.z))?.boundingBox==='block');
  let target;for(const[dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]])for(const dy of[0,1,-1]){const x=p.x+dx,z=p.z+dz,y=p.grade+1+dy,floor=bot.blockAt(new Vec3(x,y-1,z));if(floor?.boundingBox==='block'&&bot.blockAt(new Vec3(x,y,z))?.name==='air'&&bot.blockAt(new Vec3(x,y+1,z))?.name==='air'){target=[x,y,z];break;}}
  assert(target,'Safe exit exists from repaired pit');let timer;try{await Promise.race([bot.pathfinder.goto(new goals.GoalNear(...target,0)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('walk timeout')),15000);})]);}finally{clearTimeout(timer);}
  out.walks.push({component:component.id,end:bot.entity.position.clone()});check('walk off repaired pit '+component.id,bot.entity.position.distanceTo(new Vec3(target[0]+.5,target[1],target[2]+.5))<1.2);
 }
 await rc('minecraft:save-all flush');out.passed=true;
}catch(e){out.error=e.stack;process.exitCode=1;}
finally{bot?.pathfinder?.stop();bot?.quit();fs.writeFileSync(root+'/lab-verification.json',JSON.stringify(out,null,2),{flag:'wx'});await rc('minecraft:stop');console.log(JSON.stringify({passed:out.passed,checks:out.checks.length,walks:out.walks.length,failed:out.checks.filter(c=>!c.pass),error:out.error}));}
