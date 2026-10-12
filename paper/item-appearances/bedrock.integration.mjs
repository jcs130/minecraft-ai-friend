// Download the actual pack through the existing Geyser UDP connection, then
// inspect translated equipment. This does not claim phone/Xbox pixel parity.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
const stage=process.env.MC_STAGE_PAPER,root=process.env.MC_TEST_REPORT_DIR,packFile=process.env.MC_TEST_ITEM_PACK;
assert(stage&&root&&packFile&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
const geyser=fs.readFileSync(stage+'/plugins/Geyser-Spigot/config.yml','utf8').split(/^remote:/m)[0];assert.match(geyser,/^ {2}address: 127\.0\.0\.1\r?$/m);
const port=Number(geyser.match(/^ {2}port: (\d+)/m)?.[1]);assert(port>=19150&&port!==19132);
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:Number(props.match(/^rcon.port=(256\d\d)$/m)?.[1])});
const require=createRequire(process.env.MC_TEST_BEDROCK_REQUIRE_FROM??'E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json');
const be=require('bedrock-protocol'),hash=b=>createHash('sha256').update(b).digest('hex');
const run=process.env.MC_TEST_RUN_LABEL??'1';assert.match(run,/^[a-z0-9-]{1,16}$/);
const report={at:new Date().toISOString(),scope:'actual isolated Geyser pack download and inventory protocol; no phone/Xbox pixels',checks:[],packs:[],items:[],texts:[],errors:[]};
const check=(name,ok,details)=>{report.checks.push({name,pass:!!ok,details});assert(ok,name);console.log('PASS '+name);};
async function until(fn,label,ms=30000){const end=Date.now()+ms;while(Date.now()<end){if(report.errors.length)throw Error('Protocol failure before '+label);if(fn())return;await sleep(50);}throw Error('Timeout '+label);}
let client,spawned=false,finishing=false,downloaded=false,offer,stack,inventory=[],registry=[];
const downloads=new Map();
// This pinned diagnostic library exposes Bedrock's two LE UUID longs as raw
// RFC bytes. Pack requests use textual UUIDs, so normalize just this test's
// binary offer field (Cloudburst BedrockCodecHelper.readUuid), not the server.
function offeredUuid(value){const bytes=Buffer.from(value.replaceAll('-',''),'hex');assert.equal(bytes.length,16);bytes.subarray(0,8).reverse();bytes.subarray(8,16).reverse();const s=bytes.toString('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
const safe=fn=>(...args)=>{try{fn(...args);}catch(e){report.errors.push(e.stack??String(e));}};
try {
 check('candidate enabled',(await rc('version AgentFriend')).includes('0.4.33'));
 client=be.createClient({host:'127.0.0.1',port,version:'1.26.51',offline:true,username:'ag_ArtQABE33',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
 client.on('session',p=>{p.xuid='9000000987433';});client.on('spawn',()=>{spawned=true;});
 client.on('error',e=>report.errors.push(e.message));client.on('disconnect',p=>{if(!finishing)report.errors.push(JSON.stringify(p));});
 const wire=client.write.bind(client);
 // bedrock-protocol normally says "completed" without downloading anything.
 // Suppress only those automatic acknowledgements and perform the real flow.
 client.write=(name,p)=>name==='resource_pack_client_response'?undefined:wire(name,p);
 const response=(status,ids=[])=>{const packet={response_status:status,response_status_name:{completed:'resourcepackstackfinished',send_packs:'downloading',have_all_packs:'downloadingfinished'}[status],resourcepackids:ids};report.responses??=[];report.responses.push(packet);wire('resource_pack_client_response',packet);};
 client.on('resource_packs_info',safe(p=>{offer=p;report.offer=p;assert(p.texture_packs.length>0);response('send_packs',p.texture_packs.map(x=>offeredUuid(x.uuid)+'_'+x.version));}));
 client.on('resource_pack_data_info',safe(p=>{
   assert(Number(p.size)>0&&Number(p.size)<=16*1024*1024&&p.chunk_count>0&&p.chunk_count<128);
   assert(!downloads.has(p.pack_id));downloads.set(p.pack_id,{info:p,chunks:new Map()});
   for(let i=0;i<p.chunk_count;i++)wire('resource_pack_chunk_request',{pack_id:p.pack_id,chunk_index:i});
 }));
 client.on('resource_pack_chunk_data',safe(p=>{
   const row=downloads.get(p.pack_id);assert(row&&p.chunk_index<row.info.chunk_count);const bytes=Buffer.from(p.payload);
   if(row.chunks.has(p.chunk_index)){assert(row.chunks.get(p.chunk_index).equals(bytes));return;}row.chunks.set(p.chunk_index,bytes);
   if(row.chunks.size===row.info.chunk_count){
     row.bytes=Buffer.concat(Array.from({length:row.info.chunk_count},(_,i)=>row.chunks.get(i)));assert.equal(row.bytes.length,Number(row.info.size));
     assert.equal(hash(row.bytes),Buffer.from(row.info.hash).toString('hex'));report.packs.push({id:p.pack_id,bytes:row.bytes.length,sha256:hash(row.bytes)});
   }
   if(!downloaded&&downloads.size===offer.texture_packs.length&&[...downloads.values()].every(x=>x.bytes)){downloaded=true;response('have_all_packs');}
 }));
 client.on('resource_pack_stack',safe(p=>{stack=p;assert(downloaded,'stack must follow complete byte download');response('completed');}));
 client.on('item_registry',p=>{registry=p.itemstates;});
 client.on('inventory_content',p=>{if(p.window_id==='inventory')inventory=p.input;});
 client.on('inventory_slot',p=>{if(p.window_id==='inventory')inventory[p.slot]=p.item;});
 client.on('text',p=>report.texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));
 await until(()=>spawned,'Bedrock spawn after real pack download',45000);
 const expected=hash(fs.readFileSync(packFile));check('exact custom pack bytes downloaded through existing UDP',downloaded&&report.packs.some(p=>p.sha256===expected));
 check('required resource pack stack acknowledged after download',offer.must_accept===true&&!!stack);
 const name='.ag_ArtQABE33';check('ordinary Floodgate player is actually on Paper',(await rc('list')).includes(name));
 for(const[id,model]of [['frost_sword',731001],['blink_dagger',731002],['mechanical_crossbow',731003],['focus_wand',731004],['abyss_verdict',731005]]){
   const definition=registry.find(i=>i.name==='qiandengji:'+id);check(id+' has a real custom Bedrock runtime definition',definition?.component_based===true);
   const result=await rc(`itemartqa give ${name} ${id}`);assert(!result.includes('QA_ERROR'),result);
   await until(()=>inventory[0]?.network_id===definition.runtime_id&&inventory[0]?.count===1,'real custom item '+id);
   const row=JSON.parse(await rc(`itemartqa inspect ${name}`));check(id+' translated inventory retains original Java item and metadata',row.modelData===model&&row.originalGameplayEqual&&row.appearance===id);
   report.items.push({id,definition,wire:inventory[0],server:row});
 }
 const at=report.texts.length;wire('command_request',{command:'/mycli inventory item 0',origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});
 await until(()=>report.texts.slice(at).some(s=>s.startsWith('MC_ITEM ')),'Bedrock item description');
 check('Bedrock CLI agrees with the same authoritative appearance',JSON.parse(report.texts.slice(at).find(s=>s.startsWith('MC_ITEM ')).slice(8)).appearance.id==='qiandengji:abyss_verdict');
 check('no unexpected Bedrock transport errors',report.errors.length===0);
}catch(error){report.errors.push(error.stack??String(error));}
finally{finishing=true;client?.close();await sleep(600);report.passed=report.errors.length===0&&report.checks.every(c=>c.pass);fs.writeFileSync(root+'/bedrock-'+run+'.json',JSON.stringify(report,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));process.exit(report.passed?0:1);}
