// Production read-only: no block edits or stock transfers, one temporary ordinary client.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';

const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const roots=['E:/MC/ops/repairs/land-ownership-20261008','F:/MC-backups/repairs/land-ownership-20261008'];
const expected='3C78F0F66120EEA06A3CAA1BC1A31CC6178FA4266D1779252925BDCFF3D504F7';
const owner='00000000-0000-0000-0009-00000d9f9c7b',name='LandAudit90';
const rcon=text=>command(text,15000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const json=text=>JSON.parse(text.slice(text.indexOf('{')));
const report={passed:false,checks:[],messages:[],server:{},startedAt:new Date().toISOString()};
const land=[],protection=[];let bot,windows=0,whitelisted=false,origin;
const check=(s,ok)=>{report.checks.push({name:s,ok:!!ok});assert.ok(ok,s);console.log('PASS '+s);};
async function until(test,label){for(let i=0;i<150;i++){if(test())return;await sleep(100);}throw new Error('Timeout: '+label);}
async function tp(x,y,z){await rcon(`minecraft:tp ${name} ${x} ${y} ${z}`);await until(()=>bot.entity.position.distanceTo(new Vec3(x,y,z))<2,'probe teleport');await sleep(500);}
async function ask(text,type){const start=land.length;bot.chat(text);await until(()=>land.slice(start).some(p=>p.type===type),text);return land.slice(start).find(p=>p.type===type);}
try{
  report.candidateSha256=createHash('sha256').update(readFileSync('E:/MC/server/plugins/AgentFriend-0.3.90.jar')).digest('hex').toUpperCase();
  check('enabled production JAR matches isolated candidate',report.candidateSha256===expected);
  const deadline=Date.now()+60000;report.server.version='';
  while(Date.now()<deadline){try{report.server.version=await rcon('version AgentFriend');if(report.server.version.includes('0.3.90'))break;}catch{}await sleep(1000);}
  check('runtime version is 0.3.90',report.server.version.includes('0.3.90'));
  const audit=json(await rcon('mycli admin land audit'));report.server.land=audit;
  check('only actual guild claim exists, with MicroKQ owner',audit.ready&&audit.count===1&&audit.lands[0].id==='adventurers_guild'&&audit.lands[0].ownerUuid===owner);
  check('guild bounds and public use are correct',JSON.stringify(audit.lands[0].min)==='[-498,64,-509]'&&JSON.stringify(audit.lands[0].max)==='[-480,76,-495]'&&audit.lands[0].visitorUse&&audit.lands[0].opBypass===false);
  report.server.stock=json(await rcon('mycli admin guildstorageaudit'));check('legacy stock protection uses same owner',report.server.stock.ownerReady&&report.server.stock.ownerUuid===owner&&!report.server.stock.opBypass);
  for(const dim of ['overworld','the_nether','the_end']){
    const difficulty=await rcon('minecraft:execute in minecraft:'+dim+' run minecraft:difficulty');
    const keep=await rcon('minecraft:execute in minecraft:'+dim+' run minecraft:gamerule keepInventory');
    report.server[dim]={difficulty,keep};check(dim+' normal difficulty and keepInventory',difficulty.toLowerCase().includes('normal')&&keep.includes('true'));
  }
  report.server.goddess=await rcon('minecraft:data get entity Goddess playerGameType');check('Goddess is still spectator',/data: 3\b/.test(report.server.goddess));
  const whitelist=JSON.parse(readFileSync('E:/MC/server/whitelist.json','utf8'));assert.ok(!whitelist.some(p=>p.name===name),'temporary probe identity must be new');
  await rcon('minecraft:whitelist add '+name);whitelisted=true;
  bot=mineflayer.createBot({host:'127.0.0.1',port:25565,username:name,auth:'offline',version:'1.20.6'});
  bot.on('messagestr',s=>report.messages.push(s));bot._client.on('open_window',()=>windows++);
  bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:land')land.push(JSON.parse(p.data.toString()));if(p.channel==='mcagent:protection')protection.push(JSON.parse(p.data.toString()));});
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reject);});origin=bot.entity.position.clone();await sleep(3000);bot.setQuickBarSlot(8);
  await tp(-492.5,67,-503.5);
  const info=await ask('/mycli land here','MC_LAND_INFO');check('ordinary client sees owner and visitor role',info.ownerUuid===owner&&info.role==='visitor'&&info.ready);
  const rights=await ask('/mycli land info adventurers_guild','MC_LAND_PERMISSIONS');check('visitor can use public services, cannot build or store',rights.use&&rights.interact&&!rights.break&&!rights.place&&!rights.container);
  for(const z of [-505,-504,-503]){
    const start=report.messages.length,opened=windows;
    const block=bot.blockAt(new Vec3(-494,67,z));assert.equal(block.name,'barrel');await bot.activateBlock(block);
    await until(()=>report.messages.slice(start).some(s=>s.startsWith('MC_GUILD_ACCESS ')),'private stock denial');await sleep(200);
    const receipt=json(report.messages.slice(start).find(s=>s.startsWith('MC_GUILD_ACCESS ')));
    check('private barrel '+z+' refuses access before GUI',windows===opened&&receipt.allowed===false&&receipt.ownerUuid===owner&&report.messages.slice(start).some(s=>s.includes('无权操作')&&s.includes('公共箱')));
  }
  check('native protection payload is delivered',protection.some(p=>p.allowed===false&&p.ownerUuid===owner));
  for(const action of ['break','place','container']){
    const start=report.messages.length;bot.chat(`/mycli protect ${action} -494 67 -505`);
    await until(()=>report.messages.slice(start).some(s=>s.startsWith('MC_PROTECTION ')),action+' preflight');
    const p=json(report.messages.slice(start).find(s=>s.startsWith('MC_PROTECTION ')));
    check(action+' preflight identifies actual land and owner',p.allowed===false&&p.landId==='adventurers_guild'&&p.ownerUuid===owner);
  }
  const oldWindows=windows;bot.chat('/mycli guild menu');await until(()=>windows>oldWindows,'guild menu');check('visitor can open public quest menu',!!bot.currentWindow);bot.closeWindow(bot.currentWindow);
  bot.chat('/mycli land menu');await until(()=>JSON.stringify(bot.currentWindow?.title??'').includes('领地归属'),'land menu');check('27-slot native land menu opens',bot.currentWindow.inventoryStart===27);bot.closeWindow(bot.currentWindow);
  await tp(-474.5,67,-493.5);
  for(const z of [-495,-493,-491,-489]){
    if(z===-489)await tp(-474.5,67,-490.5);
    const w=await bot.openContainer(bot.blockAt(new Vec3(-473,67,z)));check('public chest '+z+' opens read-only',w.inventoryStart===54);bot.closeWindow(w);
  }
  check('outside public chests are unclaimed',(await ask('/mycli land here','MC_LAND_INFO')).status==='unclaimed');
  const before=json(readFileSync(roots[0]+'/production-before-manifest.json','utf8'));
  const marketSha=createHash('sha256').update(readFileSync(before.files.market.source)).digest('hex').toUpperCase();check('28-template market configuration preserved',marketSha===before.files.market.sha256);
  report.server.gifts=await rcon('mycli admin giftcatalog');
  report.server.eye=await rcon('cortieye');report.server.mspt=await rcon('mspt');
  report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{
  if(bot&&origin&&bot._client.state==='play')try{await rcon(`minecraft:tp ${name} ${origin.x} ${origin.y} ${origin.z}`);}catch{}
  bot?.quit();if(whitelisted)try{await rcon('minecraft:whitelist remove '+name);}catch(error){report.passed=false;report.cleanupError=String(error);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();for(const root of roots){writeFileSync(root+'/live-result.'+Date.now()+'.json',JSON.stringify(report,null,2));writeFileSync(root+'/live-result.json',JSON.stringify(report,null,2));}
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,eye:report.server.eye}));
  setTimeout(()=>process.exit(report.passed?0:1),300);
}
