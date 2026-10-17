// Private loopback world fixture only. Gives test items and changes fixture blocks.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';
assert(process.env.MC_VILLAGE_MINE_QA_ROOT,'Explicit private fixture root required');
const root=path.resolve(process.env.MC_VILLAGE_MINE_QA_ROOT).replaceAll('\\','/'),setup=JSON.parse(fs.readFileSync(root+'/stage.json'));
const stage=path.resolve(setup.stage).replaceAll('\\','/');assert.equal(path.dirname(stage),'E:/MC/staging');
assert.equal(fs.readFileSync(stage+'/.village-mine-stage','utf8').trim(),'village-mine-20261017');
const props=fs.readFileSync(stage+'/server.properties','utf8');
for(const line of ['server-ip=127.0.0.1','server-port=25830','rcon.port=25831','motd=VILLAGE_MINE_ISOLATED_20261017'])assert(props.split(/\r?\n/).includes(line));
assert(!fs.existsSync(root+'/lab-verification.json'),'Keep the first verification report');
const plan=JSON.parse(fs.readFileSync(root+'/mine-plan.json')),require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const {Vec3}=require('vec3'),{pathfinder,Movements,goals}=createRequire('E:/Cortico/package.json')('mineflayer-pathfinder');
const rc=q=>command(q,20000,{properties:stage+'/server.properties',port:25831});
const out={at:new Date().toISOString(),formalChanged:false,checks:[],queries:[],walks:[]};
const check=(name,pass)=>{out.checks.push({name,pass:!!pass});assert(pass,name);};
const bots=[],messages=new Map();
async function connect(username){const bot=require('mineflayer').createBot({host:'127.0.0.1',port:25830,username,version:'1.21.1',auth:'offline',hideErrors:true,checkTimeoutInterval:60000});bots.push(bot);messages.set(username,[]);bot.on('messagestr',s=>messages.get(username).push(s));bot.on('error',e=>{out.clientErrors??=[];out.clientErrors.push(e.message);});installRecipePacketBypass(bot._client,{enabled:true});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('spawn timeout')),30000);bot.once('spawn',()=>{clearTimeout(timer);resolve();});bot.once('kicked',m=>{clearTimeout(timer);reject(Error(String(m)));});});return bot;}
async function move(bot,p){await rc('minecraft:gamemode spectator '+bot.username);const moved=await rc('minecraft:execute in minecraft:overworld run minecraft:tp '+bot.username+' '+p.join(' '));assert(moved.includes('Teleported'),moved);await rc('minecraft:gamemode survival '+bot.username);await sleep(650);}
async function query(bot,action,p,expected,name,standing){if(standing)await move(bot,standing);await sleep(450);const start=messages.get(bot.username).length;bot.chat('/mycli protect '+action+' '+p.join(' ')+' --json');
 let row;for(let i=0;i<50;i++){const text=messages.get(bot.username).slice(start).find(s=>s.startsWith('MC_PROTECTION ')&&s.includes('{'));if(text){row=JSON.parse(text.slice(text.indexOf('{')));break;}await sleep(100);}
 out.queries.push({name,action,position:p,expected,response:row});assert(row,'Missing private query '+name);check(name,row.allowed===expected);return row;}
async function walk(bot,name,goal){let timer;const row={name,start:bot.entity.position.clone()};out.walks.push(row);
 try{await Promise.race([bot.pathfinder.goto(new goals.GoalNear(...goal,1)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('walk timeout '+name)),90000);})]);row.end=bot.entity.position.clone();check(name,row.end.distanceTo(new Vec3(goal[0]+.5,goal[1],goal[2]+.5))<2.5);}
 finally{clearTimeout(timer);}}
try{
 check('running production plugin combination',(await rc('version AgentFriend')).includes('0.4.47'));
 const bot=await connect('ag_MineQA17'),guest=await connect('ag_MineGuest17');await sleep(1200);messages.get(guest.username).length=0;
 await rc('minecraft:clear '+bot.username);
 for(const p of plan.containers)await rc('minecraft:execute in minecraft:overworld run minecraft:data merge block '+p.join(' ')+' {Items:[]}');
 // Reset only this isolated fixture: a previous walk may have left the gate open.
 await rc('minecraft:execute in minecraft:overworld run minecraft:setblock -653 68 -484 minecraft:spruce_fence_gate[facing=east,in_wall=false,open=false,powered=false]');
 bot.loadPlugin(pathfinder);const movements=new Movements(bot);movements.canDig=false;movements.allow1by1towers=false;movements.allowParkour=false;movements.allowSprinting=false;movements.canOpenDoors=true;movements.scafoldingBlocks=[];bot.pathfinder.setMovements(movements);bot.pathfinder.thinkTimeout=12000;bot.pathfinder.tickTimeout=25;
 await rc('minecraft:effect give '+bot.username+' minecraft:saturation 600 2 true');
 await move(bot,[plan.entrance[0]+.5,plan.entrance[1],plan.entrance[2]+.5]);
 check('headframe floor received',bot.blockAt(new Vec3(-657,67,-484))?.name==='stone_bricks');
 check('public gate exists and begins closed',bot.blockAt(new Vec3(-653,68,-484))?.name==='spruce_fence_gate'&&bot.blockAt(new Vec3(-653,68,-484)).getProperties().open===false);
 await query(bot,'use',[-653,68,-484],true,'ordinary player can use gate');
 await query(bot,'break',[-657,67,-484],false,'mine infrastructure is protected');
 for(const [i,p]of plan.containers.entries())await query(bot,'container',p,true,'public barrel '+(i+1)+' is accessible');
 await query(bot,'container',[-659,68,-480],true,'public furnace is accessible');
 await query(bot,'use',[-659,68,-488],true,'public workbench is accessible');
 await query(bot,'break',[-556,60,-461],false,'fresh deep shaft in village denied',[-555.5,67,-460.5]);
 await query(bot,'break',[-558,54,-478],false,'digging below existing bedrock via side gap denied',[-557.5,68,-477.5]);
 await query(bot,'place',[-556,60,-461],true,'placing escape/repair blocks below guard still permitted',[-555.5,67,-460.5]);
 await query(bot,'break',[-632,75,-511],true,'existing public wheat remains harvestable',[-631.5,75,-510.5]);
 await query(bot,'break',[-632,74,-511],true,'existing farmland remains editable');
 await query(bot,'break',[-560,66,-470],false,'original plaza protection retained',[-559.5,67,-469.5]);
 await query(bot,'break',[-702,36,-484],true,'mining beyond public landing permitted',[-700.5,36,-483.5]);
 await move(bot,[plan.entrance[0]+.5,plan.entrance[1],plan.entrance[2]+.5]);
 const gate=bot.blockAt(new Vec3(-653,68,-484));await bot.activateBlock(gate);await sleep(350);check('gate actually opens for visitor',bot.blockAt(gate.position).getProperties().open===true);
 await walk(bot,'walk down three-wide lit stairs',[-700,36,-484]);
 await rc('minecraft:give '+bot.username+' minecraft:iron_pickaxe 1');await sleep(250);const pick=bot.inventory.items().find(i=>i.name==='iron_pickaxe');assert(pick);await bot.equip(pick,'hand');
 // Dedicated outside fixture: actual completed vanilla dig, not just permission prediction.
 await rc('minecraft:execute in minecraft:overworld run minecraft:setblock -702 36 -484 minecraft:stone');await sleep(250);await bot.dig(bot.blockAt(new Vec3(-702,36,-484)));await sleep(350);
 check('ordinary player actually mines outside landing',(await rc('minecraft:execute in minecraft:overworld if block -702 36 -484 minecraft:air')).includes('Test passed'));
 await walk(bot,'walk back upstairs without digging or placing',[-655,68,-484]);
 // Public barrel persistence and return, using only QA-owned fixture cobblestone.
 await rc('minecraft:give '+bot.username+' minecraft:cobblestone 4');await sleep(300);
 const cobble=bot.inventory.items().find(i=>i.name==='cobblestone'),count=()=>bot.inventory.items().filter(i=>i.name==='cobblestone').reduce((n,i)=>n+i.count,0),before=count();
 const serverCount=async()=>{const raw=await rc('minecraft:data get entity '+bot.username+' Inventory[{id:"minecraft:cobblestone"}].count');const match=raw.match(/entity data: (\d+)/);assert(match,raw);return Number(match[1]);};
 const chest=await bot.openContainer(bot.blockAt(new Vec3(...plan.containers[0])));await chest.deposit(cobble.type,null,2);await sleep(300);
 // While a container is open Mineflayer's bot.inventory can be an older window;
 // read this window's player slots and the server instead of assuming a loss.
 const windowCount=chest.slots.slice(chest.inventoryStart,chest.inventoryEnd).filter(i=>i?.name==='cobblestone').reduce((n,i)=>n+i.count,0);
 out.barrelTransaction={before,openPlayerSlots:windowCount,openCachedInventory:count(),serverAfterDeposit:await serverCount()};
 check('public barrel deposit confirmed',chest.containerItems().filter(i=>i.name==='cobblestone').reduce((n,i)=>n+i.count,0)===2&&windowCount===before-2&&out.barrelTransaction.serverAfterDeposit===before-2);chest.close();await sleep(300);
 const reopened=await bot.openContainer(bot.blockAt(new Vec3(...plan.containers[0])));check('public barrel survives close and reopen',reopened.containerItems().some(i=>i.name==='cobblestone'&&i.count===2));await reopened.withdraw(cobble.type,null,2);await sleep(300);
 out.barrelTransaction.serverAfterWithdrawal=await serverCount();check('public barrel withdrawal restores count',out.barrelTransaction.serverAfterWithdrawal===before&&reopened.containerItems().length===0);reopened.close();await sleep(300);
 const start=plan.route[0];await move(bot,[start.x+.5,start.y+1,start.z+.5]);await walk(bot,'walk new road from village shop',[plan.entrance[0],plan.entrance[1],plan.entrance[2]]);
 // Denied native dig in a clearly labelled private fixture under the village.
 await rc('minecraft:execute in minecraft:overworld run minecraft:fill -557 59 -461 -555 59 -459 minecraft:stone');
 await rc('minecraft:execute in minecraft:overworld run minecraft:setblock -557 60 -461 minecraft:stone');
 await rc('minecraft:execute in minecraft:overworld run minecraft:fill -556 60 -461 -555 62 -460 minecraft:air');
 await move(bot,[-555.5,60,-460.5]);const msg=messages.get(bot.username).length,protectedBlock=bot.blockAt(new Vec3(-557,60,-461));assert(protectedBlock?.name==='stone');
 const attempt=bot.dig(protectedBlock).catch(e=>({error:e.message}));await Promise.race([attempt,sleep(3000)]);bot.stopDigging();await sleep(300);
 check('timed digging cannot break the village underground guard',(await rc('minecraft:execute in minecraft:overworld if block -557 60 -461 minecraft:stone')).includes('Test passed'));
 check('denial names the public mine route',messages.get(bot.username).slice(msg).some(s=>s.includes('村西矿坑')&&s.includes('-652')));
 check('private operations do not leak to another player',!messages.get(guest.username).some(s=>s.startsWith('MC_PROTECTION')||s.includes('本片Y≤')));
 await rc('minecraft:save-all flush');out.performance=await rc('minecraft:tick query');out.passed=true;
}catch(e){out.error=e.stack;out.messages=Object.fromEntries(messages);process.exitCode=1;}
finally{for(const bot of bots){bot.pathfinder?.stop();bot.quit('isolated mining facility test complete');}fs.writeFileSync(root+'/lab-verification.json',JSON.stringify(out,null,2),{flag:'wx'});await sleep(250);await rc('minecraft:stop');console.log(JSON.stringify({passed:out.passed,checks:out.checks.length,failed:out.checks.filter(c=>!c.pass),walks:out.walks.map(w=>({name:w.name,end:w.end})),error:out.error}));}
