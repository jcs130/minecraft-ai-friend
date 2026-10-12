// Actual browser bundle + actual isolated Mineflayer inventory/entity stream.
// No production listener, player, browser profile or game data is changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const stage=process.env.MC_STAGE_PAPER,root=process.env.MC_TEST_REPORT_DIR,assets=process.env.MC_TEST_VIEWER_ASSETS,viewerRoot=process.env.MC_TEST_VIEWER_ROOT;
assert(stage&&root&&assets&&viewerRoot&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
const port=Number(props.match(/^server-port=(256\d\d)$/m)?.[1]);assert(port);
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:Number(props.match(/^rcon.port=(256\d\d)$/m)?.[1])});
const require=createRequire(process.env.MF_REQUIRE_FROM??'E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mf=require('mineflayer'),vr=createRequire(viewerRoot+'/package.json'),express=vr('express'),{Server}=vr('socket.io');
const {createViewerChunkStream,createViewerEntityStream}=await import(pathToFileURL(viewerRoot+'/packages/modern-viewer/src/viewer-stream.mts'));
const {viewerPhotoPage}=await import(pathToFileURL(viewerRoot+'/packages/modern-viewer/renderer-src/host/viewer-photo-page.mjs'));
const {serializeViewerItem,serializeViewerWindow}=await import(pathToFileURL(viewerRoot+'/packages/modern-viewer/src/mc-modern-viewer.mts'));
const {createViewerHeadTextures}=await import(pathToFileURL(viewerRoot+'/packages/modern-viewer/renderer-src/host/viewer-head-textures.mjs'));
const {itemHeadProfile}=await import(pathToFileURL(viewerRoot+'/packages/modern-viewer/renderer-src/src/modern-viewer/item-profile.js'));
const cr=createRequire(process.env.MC_TEST_BROWSER_DEPS??'E:/MC/ops/photo-camera-0.4.19/package.json'),puppeteer=cr('puppeteer-core');
const run=process.env.MC_TEST_RUN_LABEL??'1';assert.match(run,/^[a-z0-9-]{1,16}$/);
const report={at:new Date().toISOString(),scope:'real WebGL bundle with actual staging inventory and observed server swing; no native Java/phone pixel equality claim',bundleSha256:createHash('sha256').update(fs.readFileSync(assets+'/dist/modern-viewer.js')).digest('hex'),checks:[],errors:[],browserErrors:[],screenshots:[],models:[]};
const check=(name,ok,details)=>{report.checks.push({name,pass:!!ok,details});assert(ok,name);console.log('PASS '+name);};
const clients=[],sessions=new Set();let browser,server,io,debugPage,releaseTexture,finishing=false;
async function until(fn,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(30);}throw Error('Timeout '+label);}
const plain=value=>JSON.parse(JSON.stringify(value,(_k,v)=>typeof v==='bigint'?v.toString():v));
const item=i=>i?plain(serializeViewerItem({version:'1.20.6'},i,i.slot)):null;
const entity=e=>e?plain({id:e.id,name:e.type==='player'?'player':e.name,type:e.type,username:e.username,uuid:e.uuid,pos:e.position,position:e.position,yaw:e.yaw,pitch:e.pitch,headYaw:e.headYaw,width:e.width,height:e.height,metadata:e.metadata,equipment:e.equipment?.map(item)}):null;
async function join(name){const bot=mf.createBot({host:'127.0.0.1',port,username:name,version:'1.20.6',auth:'offline',logErrors:false,defaultChatPatterns:false});installRecipePacketBypass(bot._client);clients.push(bot);bot.on('error',e=>{if(!finishing)report.errors.push(e.stack);});await until(()=>bot.entity&&bot.player?.uuid,'native actor '+name);await sleep(1800);return bot;}
async function screenshot(page,name){const file=path.join(root,'browser-'+run+'-'+name+'.png');await page.screenshot({path:file,omitBackground:true});report.screenshots.push(file);}
try{
 check('matching candidate is enabled',(await rc('version AgentFriend')).includes('0.4.33'));
 const bot=await join('ag_ArtQAView'),actor=await join('ag_ArtQAView2');
 await rc('minecraft:fill -551 120 -447 -535 120 -431 minecraft:stone');
 await rc('minecraft:tp '+bot.username+' -543.5 121 -438.5');await rc('minecraft:tp '+actor.username+' -543.5 121 -443.5 0 0');
 await rc('minecraft:time set day');await rc('minecraft:weather clear');await sleep(1200);
 await bot.look(0,0,true);bot.setQuickBarSlot(0);actor.setQuickBarSlot(0);
 await rc('itemartqa give '+actor.username+' frost_sword');
 const app=express();server=createServer(app);io=new Server(server,{serveClient:false});
 const headTextures=createViewerHeadTextures();
 const textureGate=new Promise(resolve=>{releaseTexture=resolve;});
 app.get('/head-texture/:file',async(req,res)=>{await textureGate;await headTextures.serve(req,res,req.path,bot);});
 app.get('/index.js',(_q,res)=>res.sendFile(assets+'/dist/modern-viewer.js'));
 app.get('/photo/',async(_q,res)=>res.type('html').send(await viewerPhotoPage(assets)));
 app.use('/textures',express.static(assets+'/public/textures/1.20.6'));
 app.use(express.static(assets+'/public'));
 io.on('connection',socket=>{
   const chunks=createViewerChunkStream({bot,socket,viewDistance:3,emit:(n,v)=>socket.emit(n,v)});
   const entities=createViewerEntityStream({bot,socket,serialize:e=>e.id===bot.entity.id?null:entity(e)});
   socket.emit('version','1.20.6');socket.emit('viewerSession',{mode:'body',playerUuid:bot.player.uuid,playerName:bot.username,entityId:bot.entity.id,connectionId:'itemart-'+run});
   let seq=0;
   const sync=()=>{
     const self=entity(bot.entity),slots=bot.inventory.slots;
     socket.emit('position',{pos:bot.entity.position,yaw:bot.entity.yaw,pitch:bot.entity.pitch,player:self});
     socket.emit('avatarState',{seq:++seq,capturedAt:Date.now(),entity:self,movementState:'NOT_MOVING',velocity:bot.entity.velocity,onGround:bot.entity.onGround,health:bot.health,maxHealth:20,food:bot.food,oxygen:20,quickBarSlot:bot.quickBarSlot,equipment:bot.entity.equipment.map(item),offhand:item(slots[45]),hotbar:Array.from({length:9},(_,i)=>({index:i,slot:i+36,item:item(slots[i+36])})),inventory:slots.map(item),usingHeldItem:bot.usingHeldItem===true});
     socket.emit('time',bot.time.timeOfDay);chunks.updatePosition(bot.entity.position);
     socket.emit('containerState',bot.currentWindow?serializeViewerWindow(bot,bot.currentWindow):null);
     for(const e of Object.values(bot.entities))if(e.id!==bot.entity.id)entities.queue(e,true);
   };
   sync();const timer=setInterval(sync,100),close=()=>{clearInterval(timer);chunks.close();entities.close();sessions.delete(close);};sessions.add(close);socket.once('disconnect',close);
 });
 // Use the second connection's real server animation packet, not a fake UI event.
 actor.on('entitySwingArm',e=>{if(e.id===actor.entities[bot.entity.id]?.id){report.serverSwings=(report.serverSwings??0)+1;io.emit('entityAnimation',{id:bot.entity.id,animation:'oneSwing',isSelf:true});}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
 const served=Buffer.from(await(await fetch(origin+'/index.js')).arrayBuffer());check('HTTP serves the exact new renderer bytes',createHash('sha256').update(served).digest('hex')===report.bundleSha256);
 browser=await puppeteer.launch({executablePath:process.env.MC_TEST_BROWSER_PATH,headless:true,pipe:true,timeout:30000});
 const page=await browser.newPage();debugPage=page;await page.setViewport({width:1280,height:720,deviceScaleFactor:1});page.on('pageerror',e=>report.browserErrors.push(e.message));
 page.on('response',response=>{if(response.url().includes('/head-texture/'))(report.headResponses??=[]).push({url:response.url().split('/head-texture/')[1],status:response.status()});});
 await page.setRequestInterception(true);page.on('request',r=>{const u=r.url();if(u.startsWith(origin+'/')||u.startsWith('data:')||u.startsWith('blob:'))void r.continue();else void r.abort();});
 await page.goto(origin+'/?distance=2&fov=70',{waitUntil:'domcontentloaded',timeout:25000});
 await page.waitForFunction(()=>globalThis.itemAppearanceDiagnostics?.().items===5,{timeout:45000});
 let bagSlot=bot.inventory.slots.findIndex(i=>itemHeadProfile(i)?.hash==='8dcc6eb40f3bada41e4339888d6d207437598bdbd175c2e731191d5a9a42d3c8');
 check('real Minepacks shortcut retains its original profile and Chinese name',bagSlot>=0&&item(bot.inventory.slots[bagSlot]).displayName==='大背包',{slot:bagSlot,item:bagSlot>=0?item(bot.inventory.slots[bagSlot]):null});
 async function aligned(label){
   const results=[];
   for(let i=0;i<9;i++){
     bot.setQuickBarSlot(i);
     await page.waitForFunction(index=>document.querySelector('[data-corti-selection]')?.style.left===`${-2+40*index}px`,{timeout:10000},i);
     results.push(await page.evaluate(index=>{
       const bg=document.querySelector('.corti-hotbar').getBoundingClientRect(),selection=document.querySelector('[data-corti-selection]').getBoundingClientRect();
       const slot=document.querySelector('[data-corti-slots]').children[index],slotRect=slot.getBoundingClientRect(),img=slot.querySelector('img')?.getBoundingClientRect(),scale=bg.width/364;
       return {index,delta:(selection.left+selection.width/2-bg.left)/scale-(22+40*index),slotDelta:(slotRect.left+slotRect.width/2-bg.left)/scale-(22+40*index),iconDelta:img?(img.left+img.width/2-bg.left)/scale-(22+40*index):0};
     },i));
   }
   check(label+' all nine original sprite centers align',results.every(r=>Math.abs(r.delta)<.51&&Math.abs(r.slotDelta)<.51&&Math.abs(r.iconDelta)<.51),results);
 }
 await aligned('1280px Web');
 check('delayed texture never displays a generic Steve head',await page.evaluate(()=>!document.querySelector('[data-corti-slots] img[src="/icons/player_head.png"]')));
 const oldBagSlot=bagSlot,freeSlot=bot.inventory.slots.findIndex((i,n)=>n>=37&&n<=44&&!i);assert(freeSlot>=0);
 await bot.moveSlotItem(bagSlot,freeSlot);await until(()=>!bot.inventory.slots[oldBagSlot]&&itemHeadProfile(bot.inventory.slots[freeSlot])?.hash,'actual backpack moved while texture pending');
 await page.waitForFunction(index=>!document.querySelector('[data-corti-slots]').children[index].dataset.identity.includes('profile:'),{},oldBagSlot-36);
 bagSlot=freeSlot;releaseTexture();
 if(bagSlot<36||bagSlot>44){await bot.moveSlotItem(bagSlot,37);await sleep(250);}
 const heldBagSlot=bot.inventory.slots.findIndex(i=>itemHeadProfile(i)?.hash==='8dcc6eb40f3bada41e4339888d6d207437598bdbd175c2e731191d5a9a42d3c8');
 bot.setQuickBarSlot(heldBagSlot-36);
 await page.waitForFunction(()=>document.querySelector('[data-corti-slots] [data-head-status="ready"] .corti-head-icon')?.naturalWidth===64,{timeout:20000});
 await page.waitForFunction(()=>globalThis.world?.holdingBlock?.holdingBlock?.userData?.headStatus==='ready',{timeout:20000});
 await sleep(450);
 check('backpack hotbar and held object use the same original texture',await page.evaluate(()=>({head:globalThis.world.holdingBlock.holdingBlock.userData.headTextureHash,generic:[...document.querySelectorAll('[data-corti-slots] img')].some(i=>i.src.endsWith('/icons/player_head.png'))})).then(s=>s.head==='8dcc6eb40f3bada41e4339888d6d207437598bdbd175c2e731191d5a9a42d3c8'&&!s.generic));
 check('late texture paints only the new slot, never its old position',await page.evaluate(([oldIndex,newIndex])=>{const slots=document.querySelector('[data-corti-slots]').children;return !slots[oldIndex].querySelector('.corti-head-icon')&&!!slots[newIndex].querySelector('.corti-head-icon');},[oldBagSlot-36,bagSlot-36]));
 await screenshot(page,'backpack');
 await bot.chat('/backpack');await until(()=>bot.currentWindow,'real backpack window');
 await page.waitForFunction(()=>!document.querySelector('#corti-menu')?.hidden&&document.querySelector('#corti-menu [data-head-status="ready"] .corti-head-icon')?.naturalWidth===64,{timeout:20000});
 check('actual opened Minepacks window shows the original shortcut icon',await page.evaluate(()=>!document.querySelector('#corti-menu img[src="/icons/player_head.png"]')));await screenshot(page,'backpack-window');
 bot.closeWindow(bot.currentWindow);await sleep(250);bot.setQuickBarSlot(0);
 const hand=()=>page.evaluate(()=>{const h=globalThis.world?.holdingBlock,root=h?.holdingBlock,mesh=root?.children?.[0];return {id:root?.userData?.appearanceId??null,geometryUuid:mesh?.geometry?.uuid,textureUuid:mesh?.material?.map?.uuid,geometries:globalThis.world?.renderer?.info?.memory?.geometries,textures:globalThis.world?.renderer?.info?.memory?.textures,arm:h?.armTransformGroup?.matrix?.elements,visible:!!root?.parent,diagnostic:globalThis.itemAppearanceDiagnostics?.()};});
 for(const[id,num]of [['frost_sword',731001],['blink_dagger',731002],['mechanical_crossbow',731003],['focus_wand',731004],['abyss_verdict',731005]]){
   await rc('itemartqa give '+bot.username+' '+id);await until(()=>bot.inventory.slots[36]?.components?.some(c=>c.type==='custom_model_data'&&c.data===num),'real '+id);
   await page.waitForFunction(id=>globalThis.world?.holdingBlock?.holdingBlock?.userData?.appearanceId==='qiandengji:'+id,{},id);await sleep(350);
   const state=await hand();check(id+' actual first-person GPU mesh follows native inventory',state.visible&&state.id==='qiandengji:'+id);report.models.push(state);
   check(id+' HUD uses its own icon',await page.evaluate(id=>[...document.querySelectorAll('[data-corti-slots] img')].some(i=>i.src.endsWith('/item-appearances/icons/'+id+'.png')),id));
   await screenshot(page,id);
 }
 const stable=await hand();await sleep(1600);const later=await hand();check('idle rendering reuses the same weapon geometry and texture',!!stable.geometryUuid&&later.geometryUuid===stable.geometryUuid&&later.textureUuid===stable.textureUuid,{stable,later});
 bot.swingArm();await until(()=>report.serverSwings>0,'native server swing');await sleep(60);const swing=await hand();check('observed native swing changes the existing hand transform',JSON.stringify(stable.arm)!==JSON.stringify(swing.arm));
 await page.goto(origin+'/?overlay=1&distance=2&fov=70',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>globalThis.world?.holdingBlock?.holdingBlock?.userData?.appearanceId==='qiandengji:abyss_verdict',{timeout:45000});await sleep(1000);
 check('OBS uses an alpha canvas with the actual weapon',await page.evaluate(()=>globalThis.world.renderer.getContext().getContextAttributes().alpha===true&&globalThis.world.holdingBlock.holdingBlock.userData.appearanceId==='qiandengji:abyss_verdict'));
 await aligned('1280px OBS');
 await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});await aligned('1920px OBS');
 await page.setViewport({width:1280,height:720,deviceScaleFactor:1});bot.setQuickBarSlot(heldBagSlot-36);
 await page.waitForFunction(()=>globalThis.world?.holdingBlock?.holdingBlock?.userData?.headStatus==='ready',{timeout:20000});
 check('OBS retains the real backpack icon and held texture',await page.evaluate(()=>!!document.querySelector('[data-corti-slots] [data-head-status="ready"] .corti-head-icon')&&!document.querySelector('[data-corti-slots] img[src="/icons/player_head.png"]')));
 await screenshot(page,'obs');
 await page.goto(origin+'/photo/?photo=1&distance=2&fov=70',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>globalThis.__photoReady?.()===true,{timeout:55000});
 const photo=await page.evaluate(()=>{let ids=[];globalThis.world?.scene?.traverse(n=>{if(n.userData?.appearanceId)ids.push(n.userData.appearanceId);});return {ids,photo:__lanternRenderer.photoMode,hand:globalThis.world?.holdingBlock?.cameraGroup?.visible};});
 check('HUD-free photo uses the actual other player weapon geometry',photo.photo&&photo.ids.includes('qiandengji:frost_sword'),photo);await screenshot(page,'photo');
 const actorBagSlot=actor.inventory.slots.findIndex(i=>itemHeadProfile(i)?.hash==='8dcc6eb40f3bada41e4339888d6d207437598bdbd175c2e731191d5a9a42d3c8');
 assert(actorBagSlot>=36&&actorBagSlot<=44);actor.setQuickBarSlot(actorBagSlot-36);
 await page.waitForFunction(()=>{let ready=false;globalThis.world?.scene?.traverse(n=>{if(n.userData?.headStatus==='ready')ready=true;});return ready&&__photoReady();},{timeout:20000});
 check('HUD-free photo also renders the other player original backpack texture',await page.evaluate(()=>globalThis.itemHeadDiagnostics().ready>0));await screenshot(page,'photo-backpack');
 check('no browser JavaScript errors',report.browserErrors.length===0,report.browserErrors);
}catch(error){report.errors.push(error.stack??String(error));if(debugPage){report.failureState=await debugPage.evaluate(()=>({head:globalThis.itemHeadDiagnostics?.(),hand:globalThis.world?.holdingBlock?.holdingBlock?.userData,slots:[...document.querySelectorAll('[data-corti-slots] .corti-slot')].map(s=>({title:s.title,html:s.innerHTML.slice(0,500),dataset:{...s.dataset}}))})).catch(()=>null);await screenshot(debugPage,'failure').catch(()=>{});}}
finally{finishing=true;releaseTexture?.();await browser?.close();for(const close of sessions)close();await new Promise(resolve=>io?io.close(resolve):resolve());if(server?.listening)await new Promise(resolve=>server.close(resolve));for(const bot of clients)if(!bot._client.ended)bot.quit();await sleep(600);report.passed=report.errors.length===0&&report.checks.every(c=>c.pass);fs.writeFileSync(root+'/browser-'+run+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors,browserErrors:report.browserErrors}));process.exit(report.passed?0:1);}
