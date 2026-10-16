// Loopback Java/Eye and real Geyser protocol. This is not phone/Xbox pixel QA.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {randomUUID,createHash} from 'node:crypto';import {setTimeout as sleep} from 'node:timers/promises';import {command} from '../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage=process.env.MC_ARCHIVE_TEST_SERVER,root=process.env.MC_ARCHIVE_TEST_OUTPUT;
assert(stage&&root&&stage.replaceAll('\\','/').startsWith('E:/MC/staging/'));
const props=fs.readFileSync(stage+'/server.properties','utf8');assert(/^motd=QD_PUBLIC_ARCHIVES_TEST_ONLY$/m.test(props)&&/^server-port=25914$/m.test(props)&&/^rcon.port=25915$/m.test(props));
assert(/address: 127\.0\.0\.1\r?\n  port: 19212/.test(fs.readFileSync(stage+'/plugins/Geyser-Spigot/config.yml','utf8')));
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),bp=createRequire('E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json')('bedrock-protocol');
const rc=q=>command(q,20000,{port:25915,properties:stage+'/server.properties'}),report={at:new Date().toISOString(),checks:[],errors:[],physicalDeviceVerified:false,sha256:createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.48.jar')).digest('hex')};
const bots=[];let bedrock,closing=false;function check(name,ok){assert(ok,name);report.checks.push(name);console.log('PASS '+name);}
async function until(f,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await f())return;await sleep(100);}throw Error('Timeout '+label);}
async function join(username){const b=req('mineflayer').createBot({host:'127.0.0.1',port:25914,username,version:'1.21.1',auth:'offline',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});bots.push(b);installRecipePacketBypass(b._client);b.physicsEnabled=false;b.lines=[];b.cameras=[];b.on('messagestr',s=>b.lines.push(s.replace(/§[0-9a-fk-or]/gi,'')));b._client.on('camera',p=>b.cameras.push(p.cameraId));b.on('error',e=>{if(!closing)report.errors.push(e.message);});await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'Java spawn');return b;}
try{
 const prior=fs.readdirSync(root).filter(n=>/^native-.*\.json$/.test(n)).sort().map(n=>JSON.parse(fs.readFileSync(root+'/'+n))).filter(p=>p.passed).at(-1);assert(prior);report.sourceBook=prior.bookId;
 const owner=await join('ag_ArchiveQA'),eye=await join('ag_ArchiveQA_eye');
 await until(()=>eye.game.gameMode==='spectator'&&eye.cameras.at(-1)===owner.entity.id,'actual paired archive Eye');check('actual Eye is spectating its author',true);
 const from=eye.lines.length;owner.chat('/mycli archive info '+prior.bookId+' --json');await until(()=>eye.lines.slice(from).some(s=>s.includes('公共档案馆')),'Eye archive summary');check('Eye receives readable private summary without machine blob',!eye.lines.slice(from).some(s=>s.startsWith('MC_ARCHIVE ')));
 const suffix=String(Date.now()).slice(-5),username='ArchiveBE'+suffix,texts=[],windows=[],bookItems=[];let spawned=false;
 bedrock=bp.createClient({host:'127.0.0.1',port:19212,version:'1.26.51',offline:true,username,raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
 bedrock.on('session',p=>{p.xuid='90000000000'+suffix;});bedrock.on('spawn',()=>spawned=true);bedrock.on('error',e=>{if(!closing)report.errors.push(String(e));});
 bedrock.on('text',p=>texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));bedrock.on('container_open',p=>windows.push(p));
 for(const name of['inventory_slot','inventory_content'])bedrock.on(name,p=>{const value=JSON.stringify(p,(_k,v)=>typeof v==='bigint'?String(v):v);if(value.includes('营地的第一篇日记')||value.includes('ag_ArchiveQA'))bookItems.push(p);});
 await until(()=>spawned,'real Bedrock world');check('Bedrock account actually enters candidate through Geyser',(await rc('minecraft:list')).includes('.'+username));
 const send=q=>bedrock.write('command_request',{command:q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});
 send('/mycli archive list book --json');await until(()=>texts.some(s=>s.startsWith('MC_ARCHIVE ')&&s.includes(prior.bookId)),'Bedrock public catalog');check('Bedrock discovers the same public author and diary ID',true);
 await sleep(500);send('/mycli archive read '+prior.bookId+' --json');await until(()=>texts.some(s=>s.startsWith('MC_ARCHIVE ')&&s.includes('"text"')&&s.includes('营地')),'Bedrock public body');
 await until(()=>bookItems.length>0,'translated Bedrock written book contents');check('Geyser translates actual author, title and native written-book contents',true);
 await sleep(500);send('/mycli archive menu');await until(()=>windows.some(w=>w.window_id!==undefined),'Bedrock native archive menu');check('Bedrock receives native public archive menu',true);
 report.eye={lines:eye.lines,cameras:eye.cameras};report.bedrock={protocol:2193,texts,windows,bookItems};check('no client protocol errors',report.errors.length===0);report.passed=true;
}catch(e){report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{closing=true;bedrock?.close();for(const b of bots)b.quit();await sleep(700);fs.writeFileSync(root+'/compat-'+Date.now()+'.json',JSON.stringify(report,(_k,v)=>typeof v==='bigint'?String(v):v,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failure:report.failure??null}));}
