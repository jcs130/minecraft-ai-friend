import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
// Fixture items, terrain, loot commands and teleports are restricted to this disposable copy.
const stage='E:/MC/staging/treasure-maps-20261008';
const roots=['E:/MC/ops/repairs/treasure-maps-20261008','F:/MC-backups/repairs/treasure-maps-20261008'];
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const rcon=q=>command(q,40000,{port:25587,properties:stage+'/server.properties'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const resume=process.argv[2]==='resume',stamp=Date.now();
const previous=resume?JSON.parse(readFileSync(roots[0]+'/pending-restart.json','utf8')):null;
const report={passed:false,checks:[],messages:{},packets:{},started:new Date().toISOString(),
 candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.98.jar')).digest('hex').toUpperCase()};
const bots=[];
const check=(name,ok,detail='')=>{assert.ok(ok,name+': '+detail);report.checks.push(name);console.log('PASS '+name);};
const make=async name=>{
 const b=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'});bots.push(b);
 report.messages[name]=[];report.packets[name]=[];b.on('messagestr',s=>report.messages[name].push(s));
 b._client.on('custom_payload',p=>{if(p.channel==='mcagent:market')report.packets[name].push(JSON.parse(p.data.toString('utf8')));});
 b.on('error',e=>(report.errors??=[]).push(String(e)));
 await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j);});await sleep(1200);return b;
};
const ask=async(b,q,delay=1000)=>{const n=report.messages[b.username].length;b.chat(q);await sleep(delay);return report.messages[b.username].slice(n).join('\n');};
const packet=async(b,q,type)=>{const n=report.packets[b.username].length;const s=await ask(b,q);const p=report.packets[b.username].slice(n).find(p=>p.type===type);assert.ok(p,s);return p;};
const info=b=>packet(b,'/mycli guild map','MC_TREASURE_MAP');
const verify=b=>packet(b,'/mycli guild verify','MC_MARKET_CHECK');
const qa=async(q)=>{const p=JSON.parse(await rcon('mapqa '+q));assert.ok(!p.error,JSON.stringify(p));return p;};
const fp=b=>qa('fingerprint '+b.username);
const tp=async(b,x,y,z)=>{await qa('mana '+b.username);await rcon(`minecraft:tp ${b.username} ${x} ${y} ${z}`);await sleep(1200);};
const walk=async(b,x,z)=>{
 const start=Date.now();await b.lookAt(new Vec3(x,b.entity.position.y+1.62,z),true);b.setControlState('forward',true);
 try{while(Math.hypot(b.entity.position.x-x,b.entity.position.z-z)>.9){if(Date.now()-start>45000)throw new Error('stuck '+JSON.stringify(b.entity.position)+' -> '+x+','+z);await b.lookAt(new Vec3(x,b.entity.position.y+1.62,z),true);await sleep(80);}}
 finally{b.setControlState('forward',false);}await sleep(350);
};
const route=async(b,points)=>{for(const [x,z]of points)await walk(b,x,z);};
const cfg={'schema-version':1,sites:{},tasks:{map_hunt:{scope:'personal',repeat:'destination',title:'图上的远行',description:'直接使用已有地图，实际探索并返回交付记录',icon:'FILLED_MAP',reward:{fame:12,emeralds:4,bonus:'BREAD','bonus-count':3},steps:[{title:'寻图、调查与归来',description:'原图不动，真实探索后返回',goal:'map_hunt',target:4,'zone-size':4,'min-distance':24,'min-seconds':15,'min-sections':1,'treasure-radius':32,'return-radius':16}]}}};
const configFile=stage+'/plugins/AgentFriend/task-market.yml';
const write=async c=>{writeFileSync(configFile,JSON.stringify(c,null,2));return rcon('mycli admin market reload');};
const accept=async b=>check('accept existing map',/已接公会委托/.test(await ask(b,'/mycli guild accept tm_map_hunt')));
const flat=async(x,y,z,xx,zz)=>{
 await rcon(`minecraft:forceload add ${x} ${z} ${xx} ${zz}`);
 await rcon(`minecraft:fill ${x} ${y+4} ${z} ${xx} ${y+4} ${zz} minecraft:glass`);
 await rcon(`minecraft:fill ${x} ${y-1} ${z} ${xx} ${y-1} ${zz} minecraft:stone`);
 await rcon(`minecraft:fill ${x} ${y} ${z} ${xx} ${y+3} ${zz} minecraft:air`);
};
try{
 check('isolated candidate 0.3.98',/0\.3\.98/.test(await rcon('version AgentFriend')));
 if(resume){
   const a=await make(previous.player);const p=await verify(a);
   check('normal restart preserves map and natural loot proof',p.evidence.map.mapId===previous.map.mapId&&p.evidence.treasureOpened&&p.evidence.treasureProof.source==='natural_loot_generation_and_actual_open_inventory');
   check('normal restart preserves completed route and return requirement',!p.ready&&p.reason==='return_to_acceptance_point'&&p.evidence.distance===previous.evidence.distance);
   check('restart preserves original map bytes',JSON.stringify(await fp(a))===JSON.stringify(previous.fingerprint));
   await tp(a,1401.5,101,1001.5);check('returned treasure report verifies',(await verify(a)).ready);
   check('treasure final reward succeeds once',/委托交付成功/.test(await ask(a,'/mycli guild claim')));
   check('repeated claim has no active contract',!/委托交付成功/.test(await ask(a,'/mycli guild claim')));
   await qa('copy '+a.username);check('copied renamed new map ID cannot repeat destination',/map_destination_already_completed/.test(await ask(a,'/mycli guild accept tm_map_hunt')));
   const original=previous.ruin;await qa(`map ${a.username} ${original.x+1} ${original.z} red_x`);await accept(a);
   await tp(a,...previous.ruinInside);check('same natural structure with shifted marker cannot pay again',(await verify(a)).reason==='map_destination_already_completed');
   await ask(a,'/mycli guild abandon');
 }else{
   // These fixtures verify map/route/loot accounting; suppress incidental mob knockback while checking standing.
   await rcon('minecraft:difficulty peaceful');
   check('new map goal hot loads',/已热加载/.test(await write(cfg)));
   const a=await make('MpA'+String(stamp).slice(-6)),b=await make('MpB'+String(stamp).slice(-6));
   for(const bot of bots){await rcon(`minecraft:effect give ${bot.username} minecraft:resistance 1800 4 true`);await rcon(`minecraft:effect give ${bot.username} minecraft:fire_resistance 1800 0 true`);}
   await flat(1398,101,998,1442,1065);await tp(a,1401.5,101,1001.5);
   check('empty hand refuses map contract',/hold_explorer_or_treasure_map/.test(await ask(a,'/mycli guild accept tm_map_hunt')));
   await qa(`map ${a.username} 1420 1030 none`);const ordinary=await fp(a);
   check('ordinary filled map refuses target',!(await info(a)).success);
   check('ordinary map untouched',JSON.stringify(ordinary)===JSON.stringify(await fp(a)));
   await qa(`map ${a.username} 26000 26000 red_x`);check('unreachable map target outside existing world limit is refused',/map_target_outside_world_border/.test(await ask(a,'/mycli guild accept tm_map_hunt')));
   for(const icon of ['mansion','monument']){await qa(`map ${a.username} 1420 1030 ${icon}`);check(icon+' explorer marker recognized',(await info(a)).success);}
   await qa(`map ${a.username} 1420 1030 red_x`);const synthetic=await fp(a);let m=await info(a);
   check('uses real marker instead of distant map center',m.success&&m.map.x===1420&&m.map.z===1030);
   await accept(a);check('reading and acceptance leave original item bytes unchanged',JSON.stringify(synthetic)===JSON.stringify(await fp(a)));
   const menu=await ask(a,'/mycli guild market menu');check('vanilla inventory market opens',!!a.currentWindow);a.closeWindow(a.currentWindow);
   await rcon('minecraft:setblock 1420 101 1030 minecraft:chest');await tp(a,1420.5,101,1028.5);
   await a.openContainer(a.blockAt(new Vec3(1420,101,1030))).then(w=>w.close());
   await route(a,[[1434.5,1028.5],[1434.5,1046.5],[1410.5,1046.5]]);
   let p=await verify(a);check('crafted chest and walking at arbitrary coordinates are insufficient',!p.ready&&!p.evidence.treasureOpened);
   await ask(a,'/mycli guild abandon');
   // Generate an authentic Dungeons and Taverns map through its unchanged original loot table in this copy.
   await tp(a,1401.5,101,1001.5);await rcon('minecraft:clear '+a.username);
   report.originalLoot=await rcon(`execute at ${a.username} run minecraft:loot give ${a.username} loot nova_structures:chests/tavern_quest/undead_crypt`);await sleep(700);
   const originalMap=a.inventory.items().find(i=>i.name==='filled_map');assert.ok(originalMap,report.originalLoot);await a.equip(originalMap,'hand');
   const originalFingerprint=await fp(a);m=await info(a);report.ruinMap=m;
   check('authentic existing ruins loot map recognized',m.success&&m.map.icon==='red_x'&&m.map.title.includes('Undead'));
   await accept(a);check('authentic ruins map retained on acceptance',JSON.stringify(originalFingerprint)===JSON.stringify(await fp(a)));
   await tp(a,m.map.x+.5,150,m.map.z+.5);await sleep(2300);
   const data=await qa(`pieces world nova_structures:undead_crypt ${m.map.x} ${m.map.z}`);report.ruinMetadata=data;
   const box=data.starts.flatMap(s=>s.pieces).filter(v=>v[3]-v[0]>=14&&v[5]-v[2]>=14&&v[4]-v[1]>=5).sort((q,r)=>(r[3]-r[0])*(r[5]-r[2])-(q[3]-q[0])*(q[5]-q[2]))[0];assert.ok(box,JSON.stringify(data));
   const [x,y,z,xx,yy,zz]=box,fy=y+1;const inside=[x+2.5,fy,z+2.5];report.ruinBox=box;
   await flat(x+1,fy,z+1,xx-1,zz-1);await tp(a,...inside);
   p=await verify(a);check('arrival alone cannot complete ruins',!p.ready&&p.evidence.distinctZones===0);
   await sleep(2200);p=await verify(a);check('standing earns no exploration',p.evidence.distance===0&&p.evidence.movingSeconds===0);
   await tp(a,x+8.5,fy,z+2.5);p=await verify(a);check('teleports do not add route',p.evidence.distance===0);
   await tp(a,...inside);
   const changed=structuredClone(cfg);changed.tasks.map_hunt.steps[0]['min-seconds']=900;changed.tasks.map_hunt.reward.emeralds=1;
   check('hot change accepted while old journey persists',/已热加载/.test(await write(changed)));
   await route(a,[[xx-2.5,z+2.5],[xx-2.5,zz-2.5],[x+2.5,zz-2.5],[x+2.5,z+2.5]]);p=await verify(a);report.ruinEvidence=p;
   check('red cross map surveys actual ruins not guessed treasure',p.evidence.structure==='nova_structures:undead_crypt'&&p.evidence.mode==='structure');
   check('actual route completes but requires return',!p.ready&&p.reason==='return_to_acceptance_point',JSON.stringify(p));
   check('accepted map requirements remain frozen across hot update',p.evidence.requirements.minMovingSeconds===15);
   check('distant claim cannot reward',!/委托交付成功/.test(await ask(a,'/mycli guild claim')));
   check('map details remain private',!report.packets[b.username].some(p=>p.type==='MC_TREASURE_MAP'||p.type==='MC_MARKET_CHECK'));
   await tp(a,1401.5,101,1001.5);check('returned real ruins report verifies',(await verify(a)).ready);
   check('real ruins contract rewards',/委托交付成功/.test(await ask(a,'/mycli guild claim')));
   check('original ruins map retained after full completion',JSON.stringify(originalFingerprint)===JSON.stringify(await fp(a)));
   await qa('copy '+a.username);check('copy with different ID cannot farm ruins reward',/map_destination_already_completed/.test(await ask(a,'/mycli guild accept tm_map_hunt')));
   for(const mutate of [c=>c.tasks.map_hunt.steps[0]['zone-size']=1,c=>c.tasks.map_hunt.steps[0].target=1,c=>c.tasks.map_hunt.steps[0]['return-radius']=1000]){
     const bad=structuredClone(cfg);mutate(bad);check('invalid map conditions reject reload',/校验失败/.test(await write(bad)));
   }await write(cfg);
   const locate=await rcon('execute positioned 6000 70 -6000 run minecraft:locate structure minecraft:buried_treasure');report.treasureLocate=locate;
   const coords=locate.match(/\[(-?\d+), ~, (-?\d+)\]/);assert.ok(coords,locate);const tx=Number(coords[1]),tz=Number(coords[2]);
   await qa(`map ${a.username} ${tx} ${tz} red_x`);const treasureFingerprint=await fp(a);const treasureMap=(await info(a)).map;
   await accept(a);check('different destination can be accepted the same day',true);
   await tp(a,tx+.5,150,tz+.5);await sleep(2300);
   const td=await qa(`pieces world minecraft:buried_treasure ${tx} ${tz}`);report.treasureMetadata=td;const [bx,by,bz]=td.starts[0].pieces[0];
   // Excavate a test walkway without touching the original natural chest or its loot table.
   // Put the walkway one block above the chest so its original waterlogged state cannot push the actor away.
   for(const [ax,az,ex,ez]of [[bx-24,bz-24,bx-1,bz+24],[bx+1,bz-24,bx+24,bz+24],[bx,bz-24,bx,bz-1],[bx,bz+1,bx,bz+24]])await flat(ax,by+1,az,ex,ez);
   await rcon(`minecraft:setblock ${bx} ${by+5} ${bz} minecraft:glass`);
   await rcon(`minecraft:fill ${bx} ${by+1} ${bz} ${bx} ${by+4} ${bz} minecraft:air`);
   await tp(a,bx+.5,by+1,bz-2.5);await verify(a);
   const chest=a.blockAt(new Vec3(bx,by,bz));check('natural buried treasure chest remains present',chest?.name==='chest');
   await a.openContainer(chest).then(w=>w.close());await sleep(900);p=await verify(a);report.treasureFirst=p;report.lootEvents=await qa('lootlog');
   check('actual native loot generation and actual open are recorded',p.evidence.treasureOpened&&p.evidence.mode==='treasure'&&p.evidence.treasureProof.source==='natural_loot_generation_and_actual_open_inventory',JSON.stringify(p));
   check('opening alone does not finish adventure',!p.ready);
   await tp(b,1401.5,101,1001.5);await qa(`map ${b.username} ${tx} ${tz} red_x`);await accept(b);await tp(b,bx+.5,by+1,bz-2.5);
   await b.openContainer(b.blockAt(new Vec3(bx,by,bz))).then(w=>w.close());await sleep(700);
   check('already searched natural chest cannot earn a new discovery',!(await verify(b)).evidence.treasureOpened);await ask(b,'/mycli guild abandon');
   await route(a,[[bx+20.5,bz-2.5],[bx+20.5,bz+18.5],[bx-2.5,bz+18.5],[bx-2.5,bz-20.5]]);p=await verify(a);
   check('treasure needs real route and returning with report',p.reason==='return_to_acceptance_point'&&p.evidence.distance>=24&&p.evidence.movingSeconds>=15,JSON.stringify(p));
   check('original treasure map retained after finding chest',JSON.stringify(treasureFingerprint)===JSON.stringify(await fp(a)));
   const pending={player:a.username,map:treasureMap,evidence:p.evidence,fingerprint:treasureFingerprint,ruin:m.map,ruinInside:inside};
   for(const root of roots)writeFileSync(root+'/pending-restart.json',JSON.stringify(pending,null,2));
 }
 report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;console.error(e.stack);}
finally{
 for(const b of bots)b.quit('map fixture finished');await sleep(700);report.finished=new Date().toISOString();
 for(const root of roots)writeFileSync(root+`/map-${resume?'restart':'stage'}-${stamp}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));
}
