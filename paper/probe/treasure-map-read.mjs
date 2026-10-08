// Read-only production probe: no map creation, acceptance, exploration, opening real containers or reward claim.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const phase=process.argv[2];assert.ok(['stage','live'].includes(phase));const stage=phase==='stage';
const server=stage?'E:/MC/staging/treasure-maps-20261008':'E:/MC/server',roots=['E:/MC/ops/repairs/treasure-maps-20261008','F:/MC-backups/repairs/treasure-maps-20261008'];
const req=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(req);const mf=req('mineflayer');
const rcon=q=>command(q,15000,stage?{port:25587,properties:server+'/server.properties'}:{}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const name='MapRead98',lines=[],packets=[],report={phase,passed:false,checks:[],sha256:createHash('sha256').update(readFileSync(server+'/plugins/AgentFriend-0.3.98.jar')).digest('hex').toUpperCase()};let b,added=false;
const check=(name,ok,detail)=>{report.checks.push({name,passed:!!ok,detail});assert.ok(ok,name+': '+JSON.stringify(detail));console.log('PASS '+name);};
const ask=async(q,type)=>{const n=packets.length,l=lines.length;b.chat(q);await sleep(1250);const p=packets.slice(n).find(p=>p.type===type);if(type)assert.ok(p,lines.slice(l).join('\n'));return type?p:lines.slice(l);};
const parse=s=>JSON.parse(s.slice(s.indexOf('{')));
try{
 check('expected runtime',/0\.3\.98/.test(await rcon('version AgentFriend')));
 const reply=await rcon('minecraft:whitelist add '+name);assert.match(reply,/Added/);added=true;
 b=mf.createBot({host:stage?'127.0.0.1':'192.168.3.163',port:stage?25567:25565,username:name,auth:'offline',version:'1.20.6'});
 b.on('messagestr',s=>lines.push(s));b.on('error',e=>report.connectionError=String(e));
 b._client.on('custom_payload',p=>{if(p.channel==='mcagent:market')packets.push(JSON.parse(p.data.toString('utf8')));});
 await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j);});await sleep(6500);
 const invBefore=JSON.stringify(b.inventory.slots);
 const discovery=parse((await ask('/mycli explain guild.map')).find(s=>s.startsWith('MC_CLI_DETAIL ')));
 check('guild.map discoverable without client changes',discovery.id==='guild.map'&&discovery.mode==='read');
 const m=await ask('/mycli guild map','MC_TREASURE_MAP');check('no target map gives explicit safe reply',!m.success&&m.mapsConsumed===false);
 const board=await ask('/mycli guild market','MC_MARKET_BOARD');report.board=board;
 check('original 34 tasks plus map task remain visible',board.tasks?.length===35,board.tasks?.length);
 const detail=await ask('/mycli guild market tm_map_hunt','MC_MARKET_DETAIL');report.detail=detail;const rules=detail.steps?.[0]?.mapHunt;
 check('map contract requires exploration and return',detail.id==='tm_map_hunt'&&detail.repeat==='destination'&&rules?.minDistance===24&&rules?.minMovingSeconds===15&&rules?.returnRadius===16,detail);
 check('fresh natural treasure and destination rule exposed',rules?.freshNaturalTreasureRequired&&rules?.destinationOncePerPlayer);
 await ask('/mycli guild market menu');check('vanilla inventory menu includes existing map contract',b.currentWindow?.slots.some(s=>s?.name==='filled_map'));if(b.currentWindow)b.closeWindow(b.currentWindow);
 const skills=(await ask('/mycli skills list profession'));const header=parse(skills.find(s=>s.startsWith('MC_SPELL_LIST ')));
 check('36 skills and direct profession discovery retained',header.catalogTotal===36&&header.professionTotal===16&&header.catalogVersion==='0.3.98');
 const rescue=parse((await ask('/mycli arena status')).find(s=>s.startsWith('MC_TRIAL_RESCUE_STATE ')));
 check('existing rescue remains four blocks ten seconds',rescue.radius===4&&rescue.seconds===10);
 const status=await ask('/mycli guild status');check('read-only checks did not accept a task',!status.some(s=>s.includes('图上的远行')));
 check('read-only checks leave real inventory unchanged',JSON.stringify(b.inventory.slots)===invBefore);
 report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;console.error(e.stack);}
finally{if(b)b.quit();await sleep(500);if(added)await rcon('minecraft:whitelist remove '+name);report.messages=lines;report.packets=packets;report.at=new Date().toISOString();for(const root of roots)writeFileSync(root+'/read-'+phase+'-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
