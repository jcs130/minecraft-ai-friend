// Finite, marked-loopback QA only. The viewer and native queries share the
// action bot; production accounts, worlds and controllers are never selected.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {monitorEventLoopDelay} from 'node:perf_hooks';
const run=promisify(execFile),config=JSON.parse(fs.readFileSync(process.argv[2]));
const raw=JSON.parse(fs.readFileSync(config.mainConfig));
assert(raw.publicGameAccess===false&&path.resolve(raw.serverDir).toLowerCase().includes('research'));
assert.equal(fs.readFileSync(path.join(path.dirname(config.mainConfig),'.native-view-qa'),'utf8').trim(),'loopback-only');
const state=JSON.parse(fs.readFileSync(path.join(raw.runtimeDir,'health.json')));assert(state.healthy&&Date.now()/1000-state.heartbeatEpoch<15);
assert(/^[A-Za-z0-9_]{1,16}$/.test(config.username)&&config.gamePort>=39000&&config.viewerPort>=39000);
const require=createRequire(path.join(config.gateway,'gate/gate.cjs')),mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const adapterModule=await import(config.viewerHostModule),prepared=await adapterModule.prepareNativeConnection({assetDirectory:config.assetDirectory,viewerPort:config.viewerPort});
const report={schemaVersion:1,at:new Date().toISOString(),checks:[],productionActions:0,modelRequests:0,errors:[],fixtures:[]};
const output=config.outputDirectory;assert(output&&!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
let bot,session;const loopDelay=monitorEventLoopDelay({resolution:20});loopDelay.enable();
const check=(name,ok)=>{report.checks.push({name,pass:!!ok});assert(ok,name);console.log('PASS '+name);save();};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(predicate,ms=30000)=>{const end=Date.now()+ms;while(!predicate()&&Date.now()<end)await sleep(100);assert(predicate(),'QA postcondition timeout');};
const consoleCommand=async command=>{const {stdout}=await run('E:/MC/runtime/python-3.12.14/python.exe',['-X','utf8',path.resolve(import.meta.dirname,'fom_service.py'),'console','--config',config.mainConfig,'--command',command,'--wait','10'],{windowsHide:true,encoding:'utf8',timeout:90000});const result=JSON.parse(stdout);assert(result.ok&&result.deliveryKnown);return result;};
const inventory=()=>session.query({action:'inventory'});
async function main(){
 bot=mineflayer.createBot({host:'127.0.0.1',port:config.gamePort,username:config.username,version:'1.21.1',auth:'offline',hideErrors:true,checkTimeoutInterval:config.keepAliveTimeoutMs??30000});
 session=prepared.attach(bot);
 report.keepAlives=[];bot._client.on('keep_alive',()=>report.keepAlives.push(new Date().toISOString()));
 bot.on('error',e=>report.errors.push({name:e.name,message:e.message}));bot.on('kicked',reason=>report.errors.push({name:'kick',message:String(reason)}));
 const messages=[];bot.on('messagestr',text=>{if(text.includes('MC_FOM_'))messages.push(text);});
 await wait(()=>bot.entity&&session.query({action:'status'}).loadedColumns>0,60000);
 report.initialStatus=session.query({action:'status'});check('original same-account terrain stream reaches the Mineflayer action body',report.initialStatus.available);
 bot.chat('/fom status');await wait(()=>messages.some(s=>s.includes('MC_FOM_AUTH ')));
 const message=messages.find(s=>s.includes('MC_FOM_AUTH ')),auth=JSON.parse(message.slice(message.indexOf('MC_FOM_AUTH ')+12));report.auth=auth;
 check('native observation is bound to the exact authenticated action player UUID',auth.playerUuid===bot._client.uuid&&auth.authenticated===true);
 await wait(()=>inventory().available);report.initialInventory=inventory();
 if(config.reconcileFrom){
  const previous=JSON.parse(fs.readFileSync(config.reconcileFrom));assert(previous.auth.playerUuid===bot._client.uuid&&previous.closed);
  for(const f of previous.fixtures??[]){
   const before=session.query({action:'block',position:f.position});assert(before.available&&(before.air||before.nativeId===f.id),'Previous QA fixture must still match');
   if(!before.air){await consoleCommand(`execute if block ${f.position.x} ${f.position.y} ${f.position.z} ${f.id} run setblock ${f.position.x} ${f.position.y} ${f.position.z} minecraft:air`);await wait(()=>session.query({action:'block',position:f.position}).air===true);}
  }
  for(const [id,count] of previous.suppliedItems??[]){
   const held=inventory().inventory.slots.filter(s=>s.item?.name===id).reduce((n,s)=>n+s.item.count,0);
   assert(held===0||held===count,'Only reconcile exact quantities from this QA fixture ledger');
   if(held){await consoleCommand(`execute run clear ${config.username} ${id} ${count}`);await wait(()=>inventory().available&&!inventory().inventory.slots.some(s=>s.item?.name===id));}
  }
  report.reconciledPreviousFixture=true;
 }
 const origin=bot.entity.position.floored();report.origin={x:origin.x,y:origin.y,z:origin.z};
 const nativeIds=['create:andesite_casing','farmersdelight:tomato_crate','create:experience_block'];
 for(let i=0;i<nativeIds.length;i++){
  const position={x:origin.x+i*2-2,y:origin.y,z:origin.z-3};
  const before=session.query({action:'block',position});assert(before.available&&before.air,'Use only observed empty QA fixture cells');
  report.fixtures.push({position,id:nativeIds[i]});
  await consoleCommand(`execute run setblock ${position.x} ${position.y} ${position.z} ${nativeIds[i]}`);
  await wait(()=>session.query({action:'block',position}).nativeId===nativeIds[i]);
  const result=session.query({action:'block',position}),proxy=bot.blockAt(new Vec3(position.x,position.y,position.z));
  check('original native block identity and collision retained: '+nativeIds[i],result.nativeId===nativeIds[i]&&result.collision.available&&proxy);
  report.fixtures[i].observation=result;report.fixtures[i].proxy={name:proxy.name,stateId:proxy.stateId};
 }
 const given=[['create:andesite_casing',3],['farmersdelight:rice',4]];
 report.suppliedItems=[];
 for(const [id,count] of given){assert(!inventory().inventory.slots.some(s=>s.item?.name===id),'Do not modify pre-existing QA item types');report.suppliedItems.push([id,count]);save();await consoleCommand(`execute run give ${config.username} ${id} ${count}`);}
 await wait(()=>given.every(([id,count])=>inventory().inventory?.slots.some(s=>s.item?.name===id&&s.item.count===count)));
 report.suppliedInventory=inventory();
 check('raw inventory item IDs render as native mod items rather than projected paper',inventory().inventory.slots.some(s=>s.item?.name==='create:andesite_casing'&&s.available));
 const casing=inventory().inventory.slots.find(s=>s.item?.name==='create:andesite_casing');assert(!bot.inventory.slots[9]);
 await bot.moveSlotItem(casing.slot,9);
 await wait(()=>inventory().inventory.slots.some(s=>s.slot===9&&s.item?.name==='create:andesite_casing'&&s.item.count===3));
 check('ordinary Mineflayer inventory operation retains original native identity and count',true);
 const tag=adapterModule.nativeItemIdentity(bot.inventory.slots[9]);
 check('original names remain available to core selectors without changing the wire item',tag?.name==='create:andesite_casing'&&tag.playerUuid===bot._client.uuid&&bot.inventory.slots[9].count===3);
 await bot.equip(bot.inventory.slots[9],'hand');
 await wait(()=>bot.heldItem&&adapterModule.nativeItemIdentity(bot.heldItem)?.name==='create:andesite_casing');
 check('ordinary Mineflayer equip operates the original mod item',true);
 await bot.lookAt(new Vec3(origin.x+.5,origin.y+1,origin.z-3),true);
 await session.listen();report.viewerUrl=session.url;report.ready=true;save();
 console.log(JSON.stringify({ready:true,viewerUrl:session.url,report:path.join(output,'report.json')}));
 const until=Date.now()+Math.min(600,Math.max(0,config.holdSeconds??0))*1000;
 while(Date.now()<until&&!fs.existsSync(path.join(output,'finish'))){save();await sleep(1000);}
 report.finalInventory=inventory();report.finalStatus=session.query({action:'status'});
 check('same action connection remains healthy after rendering acceptance',report.finalStatus.available&&report.errors.length===0);
}
try{await main();}catch(error){report.error=error.stack;process.exitCode=1;console.error(error.stack);}finally{
 if(session&&bot?.entity&&session.query({action:'status'}).available){
  try{
   for(const f of report.fixtures){await consoleCommand(`execute if block ${f.position.x} ${f.position.y} ${f.position.z} ${f.id} run setblock ${f.position.x} ${f.position.y} ${f.position.z} minecraft:air`);await wait(()=>session.query({action:'block',position:f.position}).air===true);}
   for(const [id,count] of report.suppliedItems??[])await consoleCommand(`execute run clear ${config.username} ${id} ${count}`);
   if(report.suppliedItems)await wait(()=>inventory().available&&inventory().inventory&&!inventory().inventory.slots.some(s=>(report.suppliedItems??[]).some(([id])=>s.item?.name===id)));
   report.cleanupInventory=inventory();report.cleanupDelivered=true;
  }catch(error){report.cleanupError=error.message;process.exitCode=1;}
 }else if(report.fixtures.length||report.suppliedItems?.length)report.cleanupPending=true;
 loopDelay.disable();report.eventLoopDelayMs={max:loopDelay.max/1e6,mean:loopDelay.mean/1e6};
 await session?.close();if(bot){bot.quit();await sleep(300);}report.closed=true;save();
 console.log(JSON.stringify({checks:report.checks.length,error:report.error,cleanupError:report.cleanupError,report:path.join(output,'report.json')}));
}
