// Real loopback Java 1.20.6 / Geyser Bedrock protocol paths; not a phone/Xbox visual test.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const root='E:/MC/research/paper-task-routes-20261015',stage=root+'/stage',attempt=process.argv[2]??'A';
assert.match(attempt,/^[A-Z][0-9]?$/);const output=root+'/compat-'+attempt+'.json';assert(!fs.existsSync(output));
const props=fs.readFileSync(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
assert.match(props,/^server-port=25840\r?$/m);assert.match(props,/^motd=TASK_ROUTES_ISOLATED_20261015\r?$/m);
const out={at:new Date().toISOString(),checks:[],errors:[],productionModified:false,physicalDeviceVerified:false};
let java,bedrock,closing=false;const lines=[],texts=[],windows=[];let chunks=0,spawned=false;
const check=(name,value)=>{assert(value,name);out.checks.push(name);console.log('PASS '+name)};
async function until(fn,label,timeout=35000){for(const end=Date.now()+timeout;Date.now()<end;){const value=await fn();if(value)return value;await sleep(100)}throw Error('Timeout '+label)}
try {
 const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');fix1206PotionProtocol(req);
 java=req('mineflayer').createBot({host:'127.0.0.1',port:25840,username:'ag_RouteOld'+attempt,version:'1.20.6',auth:'offline',checkTimeoutInterval:60000,hideErrors:true});
 installRecipePacketBypass(java._client);java.on('messagestr',s=>lines.push(s));java.on('error',e=>{if(!closing)out.errors.push('Java '+e.message)});
 await until(()=>java.entity&&java.world.getColumnAt(java.entity.position),'legacy Java spawn');
 java.chat('/mycli tasks list combat --json');const catalog=await until(()=>lines.find(s=>s.startsWith('MC_TASKS ')),'legacy route reply');
 check('ViaVersion legacy Java discovers same combat tasks',JSON.parse(catalog.slice(9)).items.some(t=>t.id==='tm_starter_blade'));
 await sleep(1200);java.chat('/mycli tasks menu --json');await until(()=>java.currentWindow?.inventoryStart===27,'legacy vanilla route menu');
 check('legacy Java receives native route menu',java.currentWindow.slots.slice(0,27).filter(Boolean).length===9);
 java.closeWindow(java.currentWindow);
 const be=createRequire('E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json')('bedrock-protocol');
 bedrock=be.createClient({host:'127.0.0.1',port:19240,version:'1.26.51',offline:true,username:'BedRoute'+attempt,raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
 bedrock.on('session',p=>{p.xuid='9000000015340'});bedrock.on('spawn',()=>{spawned=true});bedrock.on('level_chunk',()=>chunks++);
 bedrock.on('text',p=>texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));bedrock.on('container_open',p=>windows.push(p));
 bedrock.on('inventory_content',p=>{out.lastInventorySlots=p.input?.length??p.items?.length});
 bedrock.on('error',e=>{if(!closing)out.errors.push('Bedrock '+e)});
 await until(()=>spawned&&chunks>0,'real UDP world spawn');check('Bedrock receives real world chunks',true);
 const send=q=>bedrock.queue('command_request',{command:q,origin:{type:'player',uuid:bedrock.profile.uuid,request_id:'',player_entity_id:0n},internal:false,version:'1.26.51'});
 const before=texts.length;send('/mycli tasks list');await until(()=>texts.slice(before).some(s=>s.includes('战斗讨伐')),'Bedrock Chinese route list');
 check('Bedrock default uses readable Chinese without JSON',!texts.slice(before).some(s=>s.startsWith('MC_TASKS ')));
 await sleep(1200);send('/mycli tasks info tm_starter_blade --json');
 const detail=await until(()=>texts.find(s=>s.startsWith('MC_TASKS ')),'Bedrock JSON detail');
 check('Bedrock optional JSON exposes native weapon conditions',JSON.parse(detail.slice(9)).steps[0].combat.attack==='melee');
 await sleep(1200);send('/mycli tasks menu');await until(()=>windows.length>0,'Bedrock route menu');
 check('Geyser translates the original route menu',windows.at(-1).window_id!==undefined);
 check('no compatibility client error',out.errors.length===0);out.passed=true;
}catch(error){out.failure=error.stack;console.error(error.stack);process.exitCode=1}
finally {closing=true;java?.quit();bedrock?.close();await sleep(400);fs.writeFileSync(output,JSON.stringify(out,null,2),{flag:'wx'});console.log(JSON.stringify({passed:out.passed??false,checks:out.checks.length}));process.exit(process.exitCode??0)}
