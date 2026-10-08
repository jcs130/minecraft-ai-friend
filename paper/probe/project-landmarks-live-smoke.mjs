// Production read-only: temporary ordinary client, queries and opening a public box; no construction or stock transfers.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const roots=['E:/MC/ops/repairs/project-landmarks-20261008','F:/MC-backups/repairs/project-landmarks-20261008'];
const expected='ECFFB3A910E77BB9A8AAC47ED048D8B7D8FE75EA2845413BE030A34AE99039F0';
const name='LandmarkAudit91',owner='ccba3629-1f58-33d2-bd0c-f7ba6e699816',mengmeng='00000000-0000-0000-0009-00000d9f9c7b';
const rcon=q=>command(q,15000),sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=s=>JSON.parse(s.slice(s.indexOf('{')));
const report={passed:false,startedAt:new Date().toISOString(),checks:[],messages:[],packets:[],server:{}};let bot,origin,added=false,windows=0,lastChat=0;
const check=(label,ok,detail)=>{report.checks.push({name:label,ok:!!ok,detail});assert.ok(ok,label+': '+JSON.stringify(detail??''));console.log('PASS '+label);};
const until=async(f,label,timeout=16000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await f())return;await sleep(100);}throw new Error(label+' timeout');};
async function chat(q){await sleep(Math.max(0,1150-(Date.now()-lastChat)));lastChat=Date.now();bot.chat(q);}
async function ask(q,type,channel){const start=report.packets.length;await chat(q);await until(()=>report.packets.slice(start).some(p=>p.type===type&&(!channel||p.channel===channel)),q);await sleep(150);return report.packets.slice(start).find(p=>p.type===type&&(!channel||p.channel===channel));}
async function tp(x,y,z){await rcon(`minecraft:tp ${name} ${x} ${y} ${z}`);await until(()=>bot.entity.position.distanceTo(new Vec3(x,y,z))<1,'probe position');await sleep(500);}
try{
 report.candidateSha256=createHash('sha256').update(readFileSync('E:/MC/server/plugins/AgentFriend-0.3.91.jar')).digest('hex').toUpperCase();check('production JAR matches both isolated reports',report.candidateSha256===expected);
 report.server.version=await rcon('version AgentFriend');check('runtime AgentFriend is 0.3.91',report.server.version.includes('0.3.91'));
 report.server.land=json(await rcon('mycli admin land audit'));const guild=report.server.land.lands.find(l=>l.id==='adventurers_guild'),tower=report.server.land.lands.find(l=>l.id==='sky_view_tower');
 check('guild keeps MicroKQ private ownership and no public-storage exception',guild?.ownerUuid===mengmeng&&!guild.landmarkEnabled&&guild.publicContainers===0);
 check('completed tower belongs to verified original CortiLan UUID',tower?.ownerUuid===owner&&tower.builderUuid===owner&&tower.projectTask==='tm_sky_view_tower'&&tower.projectRun==='5806c539-ec5e-4006-a5a1-64d1b0795161');
 check('tower claim uses the original bounded site with visitors allowed',JSON.stringify(tower.min)==='[-572,74,-582]'&&JSON.stringify(tower.max)==='[-554,90,-568]'&&tower.visitorUse&&tower.landmarkEnabled);
 check('only the real gift chest is explicitly public',tower.publicContainers===1);
 check('no isolated claims leaked into live registry',report.server.land.lands.every(l=>!l.id.startsWith('qa_')));
 report.server.market=await rcon('mycli admin market list');check('all 29 task templates and seven registered sites remain',(report.server.market.match(/^tm_/gm)||[]).length===29&&(report.server.market.match(/^site=/gm)||[]).length===7&&report.server.market.includes('tm_sky_view_tower enabled=true project_completed'));
 for(const dim of ['overworld','the_nether','the_end']){const difficulty=await rcon('minecraft:execute in minecraft:'+dim+' run minecraft:difficulty'),keep=await rcon('minecraft:execute in minecraft:'+dim+' run minecraft:gamerule keepInventory');report.server[dim]={difficulty,keep};check(dim+' normal difficulty and keepInventory',difficulty.toLowerCase().includes('normal')&&keep.includes('true'));}
 report.server.goddess=await rcon('minecraft:data get entity Goddess playerGameType');check('Goddess remains spectator',/data: 3\b/.test(report.server.goddess));
 const whitelist=JSON.parse(readFileSync('E:/MC/server/whitelist.json','utf8'));assert.ok(!whitelist.some(v=>v.name===name));await rcon('minecraft:whitelist add '+name);added=true;
 bot=mineflayer.createBot({host:'127.0.0.1',port:25565,username:name,auth:'offline',version:'1.20.6'});bot.on('messagestr',s=>report.messages.push(s));bot._client.on('open_window',()=>windows++);
 bot._client.on('custom_payload',p=>{if(['mcagent:land','mcagent:landmark','mcagent:market'].includes(p.channel))report.packets.push({channel:p.channel,...JSON.parse(p.data.toString())});});
 await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);});origin=bot.entity.position.clone();await sleep(1000);bot.setQuickBarSlot(8);await sleep(150);assert.equal(bot.heldItem,null,'container probe must use an empty hand, not the skill compass');
 await tp(-492.5,67,-503.5);const rights=await ask('/mycli land info adventurers_guild','MC_LAND_PERMISSIONS');check('ordinary guild visitor can use services but cannot break or store',rights.use&&rights.interact&&!rights.break&&!rights.place&&!rights.container);
 const b=new Vec3(-494,67,-503);const pn=report.packets.length,wn=windows;await bot.activateBlock(bot.blockAt(b));await until(()=>report.packets.slice(pn).some(p=>p.type==='MC_LAND_ACCESS'),'actual private barrel refusal');await until(()=>report.messages.some(s=>s.includes('无权操作')),'Chinese refusal delivery');check('guild private barrel still denies before opening with explicit error',windows===wn&&report.messages.some(s=>s.includes('无权操作')));
 const snapshot=await ask('/mycli guild engineering tm_sky_view_tower','MC_MARKET_DETAIL');check('ordinary Agent sees completed-project handover policy',snapshot.handover?.landId==='sky_view_tower'&&snapshot.handover.ownerPolicy==='verified_completing_contractor');
 const future=await ask('/mycli guild engineering tm_village_watch_post','MC_MARKET_DETAIL');check('future watch-post commission grants its completing contractor',future.handover?.landId==='village_watch_post'&&future.handover.landmarkEnabled===true);
 const publicList=await ask('/mycli landmark list','MC_LANDMARK_LIST');report.publicLandmarkTotal=publicList.total;check('ordinary client can query the public landmark registry',publicList.scope==='public'&&Number.isInteger(publicList.total));
 const mine=await ask('/mycli landmark mine','MC_LANDMARK_LIST');check('ordinary visitor cannot manage another player building',mine.scope==='own'&&mine.total===0);
 const attempt=await ask('/mycli landmark publish sky_view_tower 不属于我的地点','MC_LANDMARK_RESULT');check('server explicitly refuses unauthorized publication',attempt.status==='denied'&&attempt.reason==='not_land_owner'&&attempt.spentMana===0);
 const building=await ask('/mycli landmark info sky_view_tower','MC_LANDMARK_INFO');check('full private protocol provides actual builder and manager',building.ownerUuid===owner&&building.builderUuid===owner&&building.publicContainers===1);
 await tp(-557.5,85,-572.5);await until(()=>bot.blockAt(new Vec3(-558,85,-572))?.name==='chest','live gift chest');const opening=new Promise(r=>bot.once('windowOpen',r));await bot.activateBlock(bot.blockAt(new Vec3(-558,85,-572)));const gift=await opening;check('real public tower gift chest opens for a visitor without taking items',gift.slots.length>0);bot.closeWindow(gift);
 const at=await ask('/mycli land here','MC_LAND_PERMISSIONS');check('opening the gift chest does not grant build rights',!at.break&&!at.place);
 const menuCount=windows;await chat('/mycli landmark menu');await until(()=>windows>menuCount,'native landmark menu');check('production native landmark menu opens',JSON.stringify(bot.currentWindow?.title??'').includes('公共地标'));bot.closeWindow(bot.currentWindow);
 check('new Agent chat records fit short histories',report.messages.filter(s=>s.startsWith('MC_LANDMARK_')).every(s=>s.length<=400));
 report.server.gifts=await rcon('mycli admin giftcatalog');check('Goddess gift catalogue remains ready',report.server.gifts.includes('"ready":true'));
 report.server.eye=await rcon('cortieye');report.server.roster=await rcon('minecraft:list uuids');report.server.mspt=await rcon('mspt');report.passed=true;
}catch(e){report.error=String(e.stack??e);process.exitCode=1;}
finally{
 if(bot){if(bot.currentWindow)bot.closeWindow(bot.currentWindow);if(origin)try{await tp(origin.x,origin.y,origin.z);}catch{}bot.quit();await sleep(200);}
 if(added)try{await rcon('minecraft:whitelist remove '+name);}catch(e){report.cleanupError=String(e);report.passed=false;process.exitCode=1;}
 report.finishedAt=new Date().toISOString();for(const dst of roots)writeFileSync(dst+'/live-result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,eye:report.server.eye,publicLandmarkTotal:report.publicLandmarkTotal,mspt:report.server.mspt}));
}
