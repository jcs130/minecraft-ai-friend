'use strict'
// Finite real UDP login/pack/world acceptance, only a marked loopback bridge.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const bedrock=require(process.env.MAW_BEDROCK_CLIENT_MODULE||'bedrock-protocol')
const root=path.resolve(process.env.MAW_FOM_BEDROCK_QA||'');assert(process.env.MAW_FOM_BEDROCK_QA)
const config=JSON.parse(fs.readFileSync(path.join(root,'qa.json')))
assert.equal(config.mode,'offline_qa');assert.equal(fs.readFileSync(path.join(config.bridgeDir,'.fom-bedrock-qa'),'utf8').trim(),'loopback-only')
const state=JSON.parse(fs.readFileSync(path.join(config.bridgeDir,'ops/health.json')));assert(state.healthy&&Date.now()/1000-state.heartbeatEpoch<15)
const report={schemaVersion:1,at:new Date().toISOString(),checks:[],packDownloads:[],messages:[],inventoryPackets:[],stackResponses:[],chunks:0,actualXboxValidated:false,actualPhoneTested:false,productionServerRestarted:false,modelRequests:0}
const wait=async(predicate,ms=25000)=>{const end=Date.now()+ms;while(!predicate()&&!error&&Date.now()<end)await new Promise(r=>setTimeout(r,100));if(error)throw Error(error);assert(predicate(),'wait expired')}
const check=(name,pass)=>{report.checks.push({name,pass:!!pass});assert(pass,name);console.log('PASS '+name)}
const digest=data=>crypto.createHash('sha256').update(data).digest('hex')
const uuid=value=>{const b=Buffer.from(value.replaceAll('-',''),'hex');b.subarray(0,8).reverse();b.subarray(8,16).reverse();const s=b.toString('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`}
let client,send,error,spawned=false,fixture=false;const packs=[],received=new Map(),complete=new Set(),inventory=[]
const execFile=require('node:util').promisify(require('node:child_process').execFile)
const ownConsole=async command=>{const {stdout}=await execFile('E:/MC/runtime/python-3.12.14/python.exe',['-X','utf8','E:/MC/servers/fom-2.42/ops/service-tools/fom_service.py','console','--config',config.mainConfig,'--command',command,'--wait','10'],{encoding:'utf8',timeout:120000,windowsHide:true});const receipt=JSON.parse(stdout);assert(receipt.ok&&receipt.deliveryKnown);return receipt}
const nativeJson=(message,prefix)=>{const at=message.indexOf(prefix+' ');assert(at>=0);return JSON.parse(message.slice(at+prefix.length+1,message.lastIndexOf('}')+1))}
async function nativeInventory(){const at=report.messages.length;say('/fom inventory');await wait(()=>report.messages.slice(at).some(m=>m.message.includes('MC_FOM_INVENTORY ')));return nativeJson(report.messages.slice(at).find(m=>m.message.includes('MC_FOM_INVENTORY ')).message,'MC_FOM_INVENTORY')}
const say=message=>send('text',{type:'chat',category:'authored',needs_translation:false,source_name:'FomBedrockQA',message,xuid:'',platform_chat_id:'',has_filtered_message:false})
async function main(){
 client=bedrock.createClient({host:'127.0.0.1',port:28993,version:'1.26.51',username:'FomBedrockQA',offline:true,followPort:false,skipPing:true,raknetBackend:'raknet-native',conLog:()=>{}})
 send=client.write.bind(client);client.write=(n,p)=>n==='resource_pack_client_response'?undefined:send(n,p)
 const response=status=>send('resource_pack_client_response',{response_status:status,response_status_name:status==='send_packs'?'askingserverforpacks':status==='have_all_packs'?'finishedloadingpacks':'resourcepackstackfinished',resourcepackids:status==='send_packs'?packs.map(p=>p.uuid+'_'+p.version):[]})
 client.on('error',e=>{error=e.message});client.on('kick',p=>{error='bedrock kicked: '+JSON.stringify(p)})
 client.on('resource_packs_info',p=>{report.packsRequired=p.must_accept;packs.push(...p.texture_packs.map(r=>({...r,uuid:uuid(r.uuid)})));response('send_packs')})
 client.on('resource_pack_data_info',p=>{received.set(p.pack_id,{...p,chunks:new Map()});for(let i=0;i<p.chunk_count;i++)send('resource_pack_chunk_request',{pack_id:p.pack_id,chunk_index:i})})
 client.on('resource_pack_chunk_data',p=>{try{const item=received.get(p.pack_id);item.chunks.set(p.chunk_index,Buffer.from(p.payload));if(item.chunks.size!==item.chunk_count||complete.has(p.pack_id))return;const raw=Buffer.concat(Array.from({length:item.chunk_count},(_,i)=>item.chunks.get(i)));assert.equal(BigInt(raw.length),BigInt(item.size));assert.equal(digest(raw),Buffer.from(item.hash).toString('hex'));complete.add(p.pack_id);report.packDownloads.push({id:p.pack_id,bytes:raw.length,sha256:digest(raw)});if(complete.size===packs.length)response('have_all_packs')}catch(e){error=e.message}})
 client.on('resource_pack_stack',()=>response('completed'));client.on('spawn',()=>{spawned=true});client.on('start_game',p=>{report.startGame={position:p.player_position,dimension:p.dimension,levelId:p.level_id}})
 client.on('level_chunk',()=>{report.chunks++});client.on('text',p=>{if(/MC_AUTH_|MC_FOM_|MC_FOM_COMPAT/.test(p.message||''))report.messages.push({message:p.message,type:p.type,at:Date.now()})})
 client.on('inventory_content',p=>{if(report.inventoryPackets.length<25)report.inventoryPackets.push(p);if(p.window_id==='inventory')p.input.forEach((item,i)=>{inventory[i]=item})})
 client.on('inventory_slot',p=>{if(p.window_id==='inventory')inventory[p.slot]=p.item})
 client.on('item_stack_response',p=>report.stackResponses.push(p))
 client.on('container_open',p=>{report.containers??=[];report.containers.push(p)})
 client.on('network_stack_latency',p=>{report.latencyPackets??=[];if(report.latencyPackets.length<12)report.latencyPackets.push({timestamp:String(p.timestamp),needsResponse:p.needs_response})})
 await wait(()=>spawned&&report.chunks>0,60000)
 check('real Bedrock UDP login reaches native FOM terrain',!!report.startGame&&report.chunks>0)
 check('native FOM icon pack must be accepted and downloads with its announced SHA256',report.packsRequired&&report.packDownloads.length>0)
 const expected=JSON.parse(fs.readFileSync(path.join(config.bridgeDir,'plugins/Geyser/resource-contract.json')))
 check('download is the exact FOM pack rather than retired-world resources',report.packDownloads.some(p=>p.sha256===expected.files['maw-native-icons.mcpack'].sha256))
 say('/fom status');await wait(()=>report.messages.some(m=>m.message.includes('MC_FOM_AUTH ')))
 const authText=report.messages.find(m=>m.message.includes('MC_FOM_AUTH ')).message;const auth=JSON.parse(authText.slice(authText.indexOf('MC_FOM_AUTH ')+12));report.nativeAuth=auth
 check('Bedrock account is isolated from Java and Agent names',auth.username==='b_FomBedrockQA')
 check('native mixed-login policy authorizes first guest without a fabricated password',auth.authenticated===true&&auth.passwordRegistered===false)
 say('/fom inventory');await wait(()=>report.messages.some(m=>m.message.includes('MC_FOM_INVENTORY ')))
 say('/fom nearby');await wait(()=>report.messages.some(m=>m.message.includes('MC_FOM_NEARBY ')))
 check('own native inventory and nearby-entity queries return through Bedrock',true)
 check('Bedrock position comes from the native body rather than origin placeholder',auth.position&&Math.abs(auth.position.y)>1)
 if(process.argv.includes('--items')){
  const before=await nativeInventory();report.fixtureBefore=before;assert(!before.items.some(i=>['farmersdelight:rice','create:shaft','irons_spellbooks:scroll'].includes(i.nativeId)),'Never overwrite or clear pre-existing fixture item types');assert(!before.items.some(i=>i.slot===8),'Keep pre-existing hotbar items')
  fixture=true
  for(const [id,count] of [['farmersdelight:rice',4],['create:shaft',3],['irons_spellbooks:scroll',1]])await ownConsole('execute run give b_FomBedrockQA '+id+' '+count)
  const supplied=await nativeInventory();report.fixtureSupplied=supplied
  check('three actual mod item types reach the Bedrock connection',supplied.items.some(i=>i.nativeId==='farmersdelight:rice'&&i.count===4)&&supplied.items.some(i=>i.nativeId==='create:shaft'&&i.count===3)&&supplied.items.some(i=>i.nativeId==='irons_spellbooks:scroll'&&i.count===1))
  const rice=supplied.items.find(i=>i.nativeId==='farmersdelight:rice');await wait(()=>inventory[rice.slot]?.count===4)
  const item=inventory[rice.slot];report.riceBedrock=item
  check('native mod stack carries a real Bedrock item and server network stack identity',item.network_id!==0&&item.has_stack_id&&Number.isInteger(item.stack_id))
  assert(!inventory[8]||inventory[8].count===0)
  send('interact',{action_id:'open_inventory',target_entity_id:client.entityId,has_position:false})
  await wait(()=>report.containers?.some(p=>p.window_id==='inventory'))
  send('item_stack_request',{requests:[{request_id:1,actions:[{type_id:'swap',legacy_type_id:2,source:{slot_type:{container_id:'hotbar_and_inventory'},slot:rice.slot,stack_id:item.stack_id},destination:{slot_type:{container_id:'hotbar_and_inventory'},slot:8,stack_id:0}}],custom_names:[],cause:'chat_public'}]})
  await wait(()=>report.stackResponses.some(p=>p.responses?.some(r=>r.request_id===1)))
  const response=report.stackResponses.flatMap(p=>p.responses||[]).find(r=>r.request_id===1)
  check('ordinary Bedrock inventory swap gets an authoritative success',response.status==='ok')
  const after=await nativeInventory();report.fixtureAfter=after
  check('native mod identity and count survive the real Bedrock inventory operation',after.items.some(i=>i.nativeId==='farmersdelight:rice'&&i.slot===8&&i.count===4)&&after.items.reduce((n,i)=>n+i.count,0)===before.items.reduce((n,i)=>n+i.count,0)+8&&after.cursor.count===0)
  check('original QA guide/items remain in their original slots',before.items.every(i=>after.items.some(a=>a.slot===i.slot&&a.nativeId===i.nativeId&&a.count===i.count&&a.displayName===i.displayName)))
 }
 if(process.argv.includes('--soak')){
  const before=await nativeInventory()
  for(let i=0;i<5;i++){
   await new Promise(resolve=>setTimeout(resolve,15000))
   const after=await nativeInventory();assert.equal(after.playerUuid,before.playerUuid);assert.deepEqual(after.items,before.items)
  }
  check('real Bedrock session survives 75 seconds with native state and inventory retained',!error)
 }
}
main().catch(e=>{report.error=e.stack;process.exitCode=1;console.error(e.stack)}).finally(async()=>{
 if(fixture)try{for(const [id,count] of [['farmersdelight:rice',4],['create:shaft',3],['irons_spellbooks:scroll',1]])await ownConsole('execute run clear b_FomBedrockQA '+id+' '+count);report.fixtureCleanupDelivered=true;report.fixtureCleanup=await nativeInventory();assert.deepEqual(report.fixtureCleanup.items,report.fixtureBefore.items);check('only temporary QA items removed; original inventory fully retained',true)}catch(e){report.cleanupError=e.message;process.exitCode=1}
 client?.close();const file=path.join(root,'udp-smoke-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2));console.log(JSON.stringify({checks:report.checks,packs:report.packDownloads,chunks:report.chunks,error:report.error,report:file}))
})
