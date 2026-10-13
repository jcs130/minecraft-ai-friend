// Native Java/Eye and Bedrock wire checks; not a phone/Xbox visual claim.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/exploration-gallery-20261014/paper',root='E:/MC/ops/repairs/exploration-gallery-20261014';
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');fix1206PotionProtocol(req);
const report={checks:[],errors:[],passed:false},bots=[];let be,closing=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rc=q=>command(q,15000,{port:25675,properties:stage+'/server.properties'});
const check=(label,ok)=>{assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);};
async function until(fn,label,ms=30000){for(let end=Date.now()+ms;Date.now()<end;){if(await fn())return;await sleep(150);}throw Error('Timeout '+label);}
async function join(username){const b=req('mineflayer').createBot({host:'127.0.0.1',port:25674,username,version:'1.20.6',auth:'offline',checkTimeoutInterval:60000});bots.push(b);b.lines=[];b.cameras=[];b.books=[];
 installRecipePacketBypass(b._client);b.on('messagestr',s=>b.lines.push(s));b._client.on('camera',p=>b.cameras.push(p.cameraId));b._client.on('open_book',p=>b.books.push(p));b.on('error',e=>{if(!closing)report.errors.push(e.message);});
 await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'Java spawn');return b;}
try{
 check('isolated candidate identified',readFileSync(stage+'/server.properties','utf8').includes('server-ip=127.0.0.1')&&(await rc('version AgentFriend')).includes('0.4.37'));
 const data=JSON.parse(readFileSync(stage+'/plugins/AgentFriend/photo-journal.json'));
 const works=Object.values(data.players).flatMap(p=>Object.values(p.photos??{}));const publicWork=works.find(p=>p.published);assert(publicWork);
 const owner=await join('ag_Photo37'),eye=await join('ag_Photo37_eye');
 await until(()=>eye.game.gameMode==='spectator'&&eye.cameras.at(-1)===owner.entity.id,'Eye actual attachment');check('Eye actually follows owner',true);
 const privateWork=works.find(r=>r.author===owner.username);assert(privateWork);
 owner.chat('/mycli photo info '+privateWork.name);await until(()=>owner.lines.some(s=>s.includes('摄影：')),'private photo info');
 check('Java receives native story book',owner.books.length>0);
 await until(()=>eye.lines.some(s=>s.includes('摄影：')),'paired Eye private reply');check('paired Eye receives owner caption',true);
 const bp=createRequire('E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json')('bedrock-protocol');
 const suffix=String(Date.now()).slice(-5),name='PhotoBE'+suffix,texts=[],opens=[],contents=[],mapPackets=[];let spawned=false;
 be=bp.createClient({host:'127.0.0.1',port:19178,version:'1.26.51',offline:true,username:name,raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
 be.on('session',p=>{p.xuid='90000000000'+suffix;});be.on('spawn',()=>spawned=true);be.on('error',e=>{if(!closing)report.errors.push(e.message);});
 be.on('text',p=>texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));be.on('container_open',p=>opens.push(p));be.on('inventory_content',p=>contents.push({window:p.window_id,slots:p.input?.length,items:p.input?.filter(i=>i.network_id!==0).length}));be.on('clientbound_map_item_data',p=>mapPackets.push({id:String(p.map_id),colors:p.colors?.length}));
 const send=q=>be.write('command_request',{command:q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});
 await until(()=>spawned,'Bedrock world');check('Bedrock joins actual Geyser world',(await rc('minecraft:list')).includes('.'+name));
 await rc('minecraft:tp .'+name+' -593.5 69 -367.5 180 0');await sleep(1200);
 send('/mycli photo gallery');await until(()=>opens.length&&contents.some(c=>c.window!==0&&c.slots>=36&&c.items>0),'Bedrock gallery');check('Bedrock opens translated gallery with real items',true);
 const win=opens.at(-1);be.write('container_close',{window_id:win.window_id,window_type:win.window_type,server:false});await sleep(500);
 send('/mycli photo info '+publicWork.id);await until(()=>texts.some(s=>s.includes('摄影：'+publicWork.author)),'Bedrock public caption');check('Bedrock public work has title and real author',texts.some(s=>s.includes(publicWork.title)));
 await until(()=>mapPackets.length>0,'Bedrock map pixels');check('Bedrock receives original native map data',true);
 check('public Bedrock does not receive owner private caption',!texts.some(s=>s.includes('摄影：ag_Photo37')));
 report.bedrock={protocol:2193,texts,opens,contents,mapPackets};report.eye={cameras:eye.cameras,lines:eye.lines};report.java={books:owner.books,lines:owner.lines};
 check('no client errors',report.errors.length===0);report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{closing=true;be?.close();for(const b of bots)b.quit('Isolated photo compatibility done');await sleep(500);writeFileSync(root+'/photo-compat-'+Date.now()+'.json',JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));process.exit(report.passed?0:1);}
