// Isolated unsigned fixture only: verifies translation/resource transfer, never production Xbox identity.
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const stage=process.env.MC_BEDROCK_QA,output=process.env.MC_BEDROCK_RESULT,from=process.env.MC_BEDROCK_REQUIRE_FROM;
assert(stage?.startsWith('E:/MC/staging/bedrock-connectivity-'));assert(output&&from);
await fs.access(stage+'/.bedrock-connectivity-qa');
const config=await fs.readFile(stage+'/plugins/Geyser-Spigot/config.yml','utf8');
assert.match(config,/address: 127\.0\.0\.1/);assert.match(config,/validate-bedrock-login: false/);
assert.match(await fs.readFile(stage+'/plugins/Geyser-Spigot/lan-discovery.properties','utf8'),/enabled=false/);
const be=createRequire(from)('bedrock-protocol'),hash=b=>createHash('sha256').update(b).digest('hex');
// bedrock-protocol's legacy UUID reader reverses each 64-bit half in this packet.
function offeredUuid(value){const b=Buffer.from(value.replaceAll('-',''),'hex');assert.equal(b.length,16);b.subarray(0,8).reverse();b.subarray(8,16).reverse();const s=b.toString('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
const result={checks:[],errors:[],packDownloads:[],packets:{},identityFixtureOnly:true,productionChanged:false};let client,closing=false,spawned=false,downloadsComplete=false,offer;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const until=async(fn,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){if(result.errors.length)throw Error(result.errors[0]);if(fn())return;await sleep(100);}throw Error('Timeout '+label);};
try{
 client=be.createClient({host:'127.0.0.1',port:39871,version:'1.26.51',offline:true,username:'BedrockQA07',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:20000});
 client.on('session',p=>{p.xuid='9000000000007';});client.on('spawn',()=>spawned=true);
 client.on('error',e=>{if(!closing)result.errors.push(e.message);});client.on('disconnect',p=>{if(!closing)result.errors.push('Disconnect '+JSON.stringify(p));});
 const send=client.write.bind(client),downloads=new Map();client.write=(name,p)=>name==='resource_pack_client_response'?undefined:send(name,p);
 const response=(status,ids=[])=>send('resource_pack_client_response',{response_status:status,response_status_name:{completed:'resourcepackstackfinished',send_packs:'downloading',have_all_packs:'downloadingfinished'}[status],resourcepackids:ids});
 const safe=fn=>p=>{try{fn(p);}catch(e){result.errors.push(e.message);}};
 client.on('resource_packs_info',safe(p=>{offer=p;assert(p.must_accept);assert(p.texture_packs.length>0);response('send_packs',p.texture_packs.map(x=>offeredUuid(x.uuid)+'_'+x.version));}));
 client.on('resource_pack_data_info',safe(p=>{assert(Number(p.size)<128*1024*1024);downloads.set(p.pack_id,{info:p,chunks:new Map()});for(let i=0;i<p.chunk_count;i++)send('resource_pack_chunk_request',{pack_id:p.pack_id,chunk_index:i});}));
 client.on('resource_pack_chunk_data',safe(p=>{
  const row=downloads.get(p.pack_id);assert(row);const b=Buffer.from(p.payload);if(row.chunks.has(p.chunk_index)){assert(row.chunks.get(p.chunk_index).equals(b));return;}row.chunks.set(p.chunk_index,b);
  if(row.chunks.size===row.info.chunk_count){row.bytes=Buffer.concat(Array.from({length:row.info.chunk_count},(_,i)=>row.chunks.get(i)));assert.equal(row.bytes.length,Number(row.info.size));assert.equal(hash(row.bytes),Buffer.from(row.info.hash).toString('hex'));result.packDownloads.push({sha256:hash(row.bytes),bytes:row.bytes.length});}
  if(!downloadsComplete&&downloads.size===offer.texture_packs.length&&[...downloads.values()].every(x=>x.bytes)){downloadsComplete=true;response('have_all_packs');}
 }));
 client.on('resource_pack_stack',safe(()=>{assert(downloadsComplete);response('completed');}));
 for(const event of ['start_game','item_registry','inventory_content','level_chunk'])client.on(event,p=>{result.packets[event]=(result.packets[event]||0)+1;if(event==='start_game')result.position=p.player_position;});
 await until(()=>spawned,'world spawn');result.checks.push('real Bedrock world spawn','all required resource bytes verified');
 await until(()=>result.packets.inventory_content>0&&result.packets.level_chunk>0,'inventory and world data');result.checks.push('inventory and chunks received');
 let reply=false;client.on('text',p=>{if(/help|帮助|Showing|列表/i.test(p.message))reply=true;});
 send('command_request',{command:'/help',origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});
 await until(()=>reply,'private command reply',15000);result.checks.push('ordinary player command response');
}catch(e){result.errors.push(e.stack||String(e));}
finally{closing=true;try{client?.close();}catch{}await fs.writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exit(result.errors.length?1:0);}
