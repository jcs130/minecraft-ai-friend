// Bedrock protocol acceptance on an isolated loopback Geyser. This does not
// claim physical phone/Xbox rendering or controller input acceptance.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
const stage=process.env.MC_STAGE_PAPER,ops=process.env.MC_TEST_OPS,root=process.env.MC_TEST_REPORT_DIR;
assert.ok(stage&&ops&&root&&process.env.MC_TEST_BEDROCK_REQUIRE_FROM,'Set isolated test paths');
assert.ok(resolve(stage).toLowerCase().includes('staging'));
const javaProperties=readFileSync(join(stage,'server.properties'),'utf8');
assert.match(javaProperties,/^server-ip=127\.0\.0\.1$/m);assert.match(javaProperties,/^server-port=256\d\d$/m);
const geyser=readFileSync(join(stage,'plugins/Geyser-Spigot/config.yml'),'utf8').split(/^remote:/m)[0];
assert.match(geyser,/^ {2}address: 127\.0\.0\.1$/m);
const port=Number(geyser.match(/^ {2}port: (\d+)$/m)?.[1]);assert.ok(port>=19150&&port!==19132);
const {command}=await import(pathToFileURL(join(ops,'rcon-client.mjs')));
const rcon=q=>command(q,15000,{properties:join(stage,'server.properties'),port:Number(javaProperties.match(/^rcon.port=(\d+)$/m)?.[1])});
const be=createRequire(process.env.MC_TEST_BEDROCK_REQUIRE_FROM)('bedrock-protocol');
const label=process.argv[2]||'1';assert.match(label,/^[a-z0-9-]{1,16}$/);
const report={scope:'isolated self-signed Floodgate fixture; not phone/Xbox',at:new Date().toISOString(),checks:[],errors:[],texts:[],opens:[],contents:[]};
const candidateVersion=process.env.MC_TEST_CANDIDATE_VERSION||'0.4.24';assert.match(candidateVersion,/^\d+\.\d+\.\d+$/);
report.candidateSha256=createHash('sha256').update(readFileSync(join(stage,'plugins/AgentFriend-'+candidateVersion+'.jar'))).digest('hex');
let client,finishing=false,spawned=false;
async function until(fn,name,ms=30000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Timeout: '+name);}
function send(q){client.write('command_request',{command:q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});}
async function query(q){await sleep(800);const at=report.texts.length;send(q);await until(()=>report.texts.slice(at).some(t=>t.startsWith('MC_TRADE ')),q);return JSON.parse(report.texts.slice(at).find(t=>t.startsWith('MC_TRADE ')).slice(9));}
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);};
try{
  assert.ok((await rcon('version AgentFriend')).includes(candidateVersion));
  client=be.createClient({host:'127.0.0.1',port,version:'1.26.51',offline:true,username:'TradeBE01',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
  client.on('session',p=>{p.xuid='9000000123456';});
  client.on('spawn',()=>spawned=true);client.on('error',e=>report.errors.push(e.message));
  client.on('disconnect',p=>{if(!finishing)report.errors.push('Disconnected: '+JSON.stringify(p));});
  client.on('text',p=>report.texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));
  client.on('container_open',p=>report.opens.push(p));
  client.on('inventory_content',p=>report.contents.push({window:p.window_id,slots:p.input?.length,nonempty:p.input?.filter(i=>i.network_id!==0).length,items:p.input}));
  await until(()=>spawned,'native Bedrock spawn');check('real Bedrock client connects through isolated Geyser',true);
  const all=await query('/mycli trade list');check('Bedrock reads complete bounded JSON from live traders',all.schema===1&&all.offers.length>0&&all.shopkeepers==='ready'&&all.scope==='loaded_merchants_only');
  const buy=await query('/mycli trade buy 面包');check('Chinese item search works through Bedrock command protocol',buy.total>0&&buy.offers.every(o=>o.result.id==='minecraft:bread'&&o.direction==='player_buys'));
  const sell=await query('/mycli trade sell 小麦');check('Bedrock distinguishes farmers buying wheat from selling it',sell.total>0&&sell.offers.every(o=>o.direction==='player_sells'));
  const id=buy.offers[0].merchantId;const locate=await query('/mycli trade locate '+id);check('Bedrock receives actual merchant location',locate.type==='locate'&&Number.isInteger(locate.location.x));
  send('/mycli trade stop');await sleep(800);send('/mycli trade menu');
  await until(()=>report.opens.length>0&&report.contents.some(c=>c.window!==0&&c.slots>=45&&c.nonempty>=10),'native translated trade GUI');
  check('Geyser translates trade board into populated native Bedrock inventory',true);
  const wire=JSON.stringify(report.contents,(_,v)=>typeof v==='bigint'?v.toString():v);
  check('translated item lore contains quotes and private navigation hints',wire.includes('商旅')||wire.includes('定位')||wire.includes('报价'));
  check('no protocol errors',report.errors.length===0);
}catch(e){report.errors.push(e.stack||String(e));}
finally{finishing=true;client?.close();report.success=report.errors.length===0;writeFileSync(join(root,'trade-bedrock-'+label+'.json'),JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n',{flag:'wx'});console.log(JSON.stringify({success:report.success,checks:report.checks,errors:report.errors}));await sleep(400);process.exit(report.success?0:1);}
