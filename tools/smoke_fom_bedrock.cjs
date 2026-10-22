'use strict'
// Finite real UDP login/pack/world acceptance, only a marked loopback bridge.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const bedrock=require(process.env.MAW_BEDROCK_CLIENT_MODULE||'bedrock-protocol')
const {runtimeAt}=require('./bedrock_chunk_runtime.cjs')
const root=path.resolve(process.env.MAW_FOM_BEDROCK_QA||'');assert(process.env.MAW_FOM_BEDROCK_QA)
const config=JSON.parse(fs.readFileSync(path.join(root,'qa.json')))
assert.equal(config.mode,'offline_qa');assert.equal(fs.readFileSync(path.join(config.bridgeDir,'.fom-bedrock-qa'),'utf8').trim(),'loopback-only')
const state=JSON.parse(fs.readFileSync(path.join(config.bridgeDir,'ops/health.json')));assert(state.healthy&&Date.now()/1000-state.heartbeatEpoch<15)
const report={schemaVersion:1,at:new Date().toISOString(),checks:[],packDownloads:[],messages:[],inventoryPackets:[],stackResponses:[],chunks:0,actualXboxValidated:false,actualPhoneTested:false,productionServerRestarted:false,modelRequests:0}
const wait=async(predicate,ms=25000)=>{const end=Date.now()+ms;while(!predicate()&&!error&&Date.now()<end)await new Promise(r=>setTimeout(r,100));if(error)throw Error(error);assert(predicate(),'wait expired')}
const check=(name,pass)=>{report.checks.push({name,pass:!!pass});assert(pass,name);console.log('PASS '+name)}
const digest=data=>crypto.createHash('sha256').update(data).digest('hex')
const uuid=value=>{const b=Buffer.from(value.replaceAll('-',''),'hex');b.subarray(0,8).reverse();b.subarray(8,16).reverse();const s=b.toString('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`}
let client,send,error,heartbeat,spawned=false,fixture=false,serverTimePackets=0;const packs=[],received=new Map(),complete=new Set(),inventory=[],chunkPackets=[]
const cookingTest=process.argv.includes('--cooking-pot'),motionTest=process.argv.includes('--motion'),modelTest=process.argv.includes('--models')||motionTest,blockItemTest=process.argv.includes('--block-items'),temporaryMaidTag='fom_bedrock_qa_'+crypto.randomBytes(8).toString('hex')
const potionMetadataTest=process.argv.includes('--potion-metadata'),potionTag=temporaryMaidTag+'_potion'
const soulSlabTest=process.argv.includes('--soul-slab')
const colonyTest=process.argv.includes('--colony')
const fixtureItems=[['farmersdelight:rice',4],['create:shaft',3],['irons_spellbooks:scroll',1],...(modelTest?[['touhou_little_maid:smart_slab_empty',1]]:[]),...(blockItemTest?[['create:andesite_casing',3],['farmersdelight:tomato_crate',2]]:[]),...(colonyTest?[['minecolonies:clipboard',1]]:[])]
const execFile=require('node:util').promisify(require('node:child_process').execFile)
const ownConsole=async command=>{const {stdout}=await execFile('E:/MC/runtime/python-3.12.14/python.exe',['-X','utf8',path.join(__dirname,'fom_service.py'),'console','--config',config.mainConfig,'--command',command,'--wait','10'],{encoding:'utf8',timeout:120000,windowsHide:true});const receipt=JSON.parse(stdout);assert(receipt.ok&&receipt.deliveryKnown);return receipt}
const nativeJson=(message,prefix)=>{const at=message.indexOf(prefix+' ');assert(at>=0);return JSON.parse(message.slice(at+prefix.length+1,message.lastIndexOf('}')+1))}
const unsigned=n=>{const bytes=[];n>>>=0;do{let b=n&127;n>>>=7;if(n)b|=128;bytes.push(b)}while(n);return Buffer.from(bytes)}
function sendDescriptor(name,params,item){
 // The pinned serverbound 2193 codec uses ItemDescriptor's i16/i16 +
 // oneOf<netId,requestId,legacyId>, rather than clientbound ItemV4. Preserve
 // the rest of the library's packet serializer and the real observed net ID.
 const full=client.serializer.createPacketBuffer({name,params}),legacy=client.serializer.proto.createPacketBuffer('ItemV4',item)
 const at=full.indexOf(legacy);assert(at>=0&&full.indexOf(legacy,at+1)<0)
 const header=Buffer.alloc(4);header.writeInt16LE(item.network_id,0);header.writeUInt16LE(item.count,2)
 const descriptor=Buffer.concat([header,unsigned(item.metadata||0),Buffer.from(name==='mob_equipment'?[1,0]:[1]),unsigned((item.stack_id<<1)^(item.stack_id>>31)),unsigned(item.block_runtime_id||0),unsigned(0)])
 client.sendBuffer(Buffer.concat([full.subarray(0,at),descriptor,full.subarray(at+legacy.length)]),true)
}
async function nativeInventory(){const at=report.messages.length;say('/fom inventory');await wait(()=>report.messages.slice(at).some(m=>m.message.includes('MC_FOM_INVENTORY ')));return nativeJson(report.messages.slice(at).find(m=>m.message.includes('MC_FOM_INVENTORY ')).message,'MC_FOM_INVENTORY')}
async function nativeBlock(at){const start=report.messages.length;say(`/fom inspect ${at.x} ${at.y} ${at.z}`);await wait(()=>report.messages.slice(start).some(m=>m.message.includes('MC_FOM_BLOCK ')));return nativeJson(report.messages.slice(start).find(m=>m.message.includes('MC_FOM_BLOCK ')).message,'MC_FOM_BLOCK')}
async function inventoryUntil(predicate){
 // Console delivery acknowledges stdin, not execution on the game thread.
 // Observe completion without repeating give/clear commands.
 const end=Date.now()+25000;let snapshot
 do{snapshot=await nativeInventory();if(predicate(snapshot))return snapshot;await new Promise(r=>setTimeout(r,200))}while(Date.now()<end)
 assert.fail('native inventory did not reach the expected fixture state')
}
// Read-only diagnostics are still chat commands to vanilla's spam limiter.
// Serialize every query, including the keepalive query, below that limit.
let chatTail=Promise.resolve(),nextChatAt=0
const say=message=>{
 const pending=chatTail.then(async()=>{
  await new Promise(r=>setTimeout(r,Math.max(0,nextChatAt-Date.now())))
  if(error)throw Error(error)
  nextChatAt=Date.now()+1250
  send('text',{type:'chat',category:'authored',needs_translation:false,source_name:'FomBedrockQA',message,xuid:'',platform_chat_id:'',has_filtered_message:false})
 })
 chatTail=pending.catch(e=>{error??=e.message});return chatTail
}
async function main(){
 client=bedrock.createClient({host:'127.0.0.1',port:28993,version:'1.26.51',username:'FomBedrockQA',offline:true,followPort:false,skipPing:true,raknetBackend:'raknet-native',conLog:()=>{}})
 send=client.write.bind(client);client.write=(n,p)=>n==='resource_pack_client_response'?undefined:send(n,p)
 const response=status=>send('resource_pack_client_response',{response_status:status,response_status_name:status==='send_packs'?'askingserverforpacks':status==='have_all_packs'?'finishedloadingpacks':'resourcepackstackfinished',resourcepackids:status==='send_packs'?packs.map(p=>p.uuid+'_'+p.version):[]})
 client.on('error',e=>{error=e.message});client.on('kick',p=>{error='bedrock kicked: '+JSON.stringify(p)})
 client.on('resource_packs_info',p=>{report.packsRequired=p.must_accept;packs.push(...p.texture_packs.map(r=>({...r,uuid:uuid(r.uuid)})));response('send_packs')})
 client.on('resource_pack_data_info',p=>{received.set(p.pack_id,{...p,chunks:new Map()});for(let i=0;i<p.chunk_count;i++)send('resource_pack_chunk_request',{pack_id:p.pack_id,chunk_index:i})})
 client.on('resource_pack_chunk_data',p=>{try{const item=received.get(p.pack_id);item.chunks.set(p.chunk_index,Buffer.from(p.payload));if(item.chunks.size!==item.chunk_count||complete.has(p.pack_id))return;const raw=Buffer.concat(Array.from({length:item.chunk_count},(_,i)=>item.chunks.get(i)));assert.equal(BigInt(raw.length),BigInt(item.size));assert.equal(digest(raw),Buffer.from(item.hash).toString('hex'));complete.add(p.pack_id);report.packDownloads.push({id:p.pack_id,bytes:raw.length,sha256:digest(raw)});if(complete.size===packs.length)response('have_all_packs')}catch(e){error=e.message}})
 client.on('resource_pack_stack',()=>response('completed'));client.on('spawn',()=>{spawned=true});client.on('start_game',p=>{report.startGame={position:p.player_position,dimension:p.dimension,levelId:p.level_id}})
 client.on('set_time',p=>{serverTimePackets++;report.nativeTimePackets??=[];if(report.nativeTimePackets.length<24)report.nativeTimePackets.push({time:p.time,at:Date.now()})})
 client.on('level_chunk',p=>{report.chunks++;if(process.argv.includes('--place')||soulSlabTest)chunkPackets.push(p)});client.on('text',p=>{if(/MC_AUTH_|MC_FOM_|MC_FOM_COMPAT/.test(p.message||''))report.messages.push({message:p.message,type:p.type,at:Date.now()})})
 client.on('inventory_content',p=>{if(report.inventoryPackets.length<25)report.inventoryPackets.push(p);if(p.window_id==='inventory')p.input.forEach((item,i)=>{inventory[i]=item})})
 client.on('inventory_slot',p=>{if(p.window_id==='inventory')inventory[p.slot]=p.item})
 client.on('item_registry',p=>{report.itemRegistry=p.itemstates.map(i=>({name:i.name,runtime_id:i.runtime_id}))})
 client.on('add_entity',p=>{if(p.entity_type?.startsWith('maw_native:')){report.models??=[];report.models.push({identifier:p.entity_type,runtimeId:String(p.runtime_id),position:p.position})}})
 client.on('move_entity',p=>{report.moves??=[];if(report.moves.length<300)report.moves.push({id:String(p.runtime_entity_id),position:p.position})})
 client.on('set_entity_data',p=>{if(motionTest){report.actorMetadata??=[];if(report.actorMetadata.length<1000)report.actorMetadata.push(p)}})
 client.on('animate_entity',p=>{if(motionTest){report.actorAnimations??=[];if(report.actorAnimations.length<100)report.actorAnimations.push(p)}})
 client.on('add_item_entity',p=>{if(potionMetadataTest){report.itemEntities??=[];if(report.itemEntities.length<50)report.itemEntities.push(p)}})
 client.on('item_stack_response',p=>report.stackResponses.push(p))
 client.on('container_open',p=>{report.containers??=[];report.containers.push(p)})
 client.on('update_block',p=>{if(cookingTest){report.blockUpdates??=[];if(report.blockUpdates.length<1000)report.blockUpdates.push(p)}})
 client.on('inventory_content',p=>{if(cookingTest){report.containerContents??={};report.containerContents[String(p.window_id)]=p.input}})
 client.on('inventory_slot',p=>{if(cookingTest){const rows=report.containerContents?.[String(p.window_id)];if(rows)rows[p.slot]=p.item}})
 client.on('network_stack_latency',p=>{report.latencyPackets??=[];if(report.latencyPackets.length<12)report.latencyPackets.push({timestamp:String(p.timestamp),needsResponse:p.needs_response});if(p.needs_response)send('network_stack_latency',{timestamp:p.timestamp,needs_response:false})})
 await wait(()=>spawned&&report.chunks>0,60000)
 // This protocol-only QA client does not generate a real player's continuous
 // auth-input ticks. Keep the test active with private read-only native queries
 // while asynchronous console checks run; do not fabricate keepalive replies.
 heartbeat=setInterval(()=>{if(!error)say('/fom status')},10000);report.readOnlyHeartbeatSeconds=10
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
 if(soulSlabTest){
  const before=await nativeInventory(),slot=Array.from({length:9},(_,i)=>i).find(i=>!before.items.some(r=>r.slot===i))
  assert(Number.isInteger(slot),'Need an empty QA hotbar slot')
  const floor={x:Math.floor(auth.position.x)+1,y:Math.floor(auth.position.y)-1,z:Math.floor(auth.position.z)+1}
  const ground=await nativeBlock(floor);assert.equal(ground.nativeId,'minecraft:grass_block')
  const runtime=chunkPackets.map(p=>runtimeAt(p,floor)).find(id=>id!==undefined);assert(Number.isInteger(runtime))
  report.soulSlabFixture={before,slot,tag:temporaryMaidTag+'_slab',floor,originalGround:ground}
  await ownConsole('execute run give b_FomBedrockQA touhou_little_maid:smart_slab_init 1')
  await inventoryUntil(s=>s.items.some(i=>i.slot===slot&&i.nativeId==='touhou_little_maid:smart_slab_init'))
  const equip=async()=>{
   await wait(()=>inventory[slot]?.network_id>0)
   sendDescriptor('mob_equipment',{runtime_entity_id:client.entityId,item:inventory[slot],slot:slot+9,selected_slot:slot,window_id:'inventory'},inventory[slot])
   const native=await inventoryUntil(s=>s.selectedHotbar===slot),held=native.items.find(i=>i.slot===slot)
   const expected=JSON.parse(fs.readFileSync(path.join(config.bridgeDir,'plugins/Geyser/maw-native-items.json'))).items.find(i=>i.nativeItem===held.nativeId)
   assert(expected);await wait(()=>inventory[slot]?.count===held.count&&report.itemRegistry?.find(i=>i.runtime_id===inventory[slot]?.network_id)?.name===expected.bedrockIdentifier)
  }
  // TLM imposes a 20-server-tick cooldown after capture/spawn. Fixed wall
  // sleeps are insufficient while a native export/save temporarily stalls ticks.
  // Java broadcasts time every 20 ticks; observe three subsequent packets.
  const waitNativeCooldown=async()=>{const before=serverTimePackets;await wait(()=>serverTimePackets>=before+3,60000)}
  const useFloor=()=>sendDescriptor('inventory_transaction',{transaction:{legacy:{legacy_request_id:0,legacy_transactions:null},transaction_type:'item_use',actions:[],transaction_data:{action_type:'click_block',trigger_type:'player_input',block_position:floor,face:1,hotbar_slot:slot,hand:'main_hand',held_item:inventory[slot],player_pos:{...auth.position,y:auth.position.y+1.62},click_pos:{x:.5,y:1,z:.5},block_runtime_id:runtime,client_prediction:'success',client_cooldown_state:'off'}}},inventory[slot])
  const nearby=async()=>{const start=report.messages.length;say('/fom nearby');await wait(()=>report.messages.slice(start).some(m=>m.message.includes('MC_FOM_NEARBY ')));return nativeJson(report.messages.slice(start).find(m=>m.message.includes('MC_FOM_NEARBY ')).message,'MC_FOM_NEARBY')}
  const oldEntities=new Set((await nearby()).entities.map(e=>e.uuid)),modelsBefore=report.models?.length||0
  await equip();useFloor()
  await inventoryUntil(s=>s.items.some(i=>i.slot===slot&&i.nativeId==='touhou_little_maid:smart_slab_empty'))
  const created=(await nearby()).entities.filter(e=>e.nativeId==='touhou_little_maid:maid'&&!oldEntities.has(e.uuid));assert.equal(created.length,1)
  const maid=created[0];report.soulSlabFixture.uuid=maid.uuid;report.soulSlabNativeEntity=maid
  assert(/^[a-f0-9-]{36}$/.test(maid.uuid));await ownConsole('execute run tag '+maid.uuid+' add '+report.soulSlabFixture.tag)
  await wait(()=>report.models?.length>modelsBefore);const actor=report.models.at(-1)
  check('using the native soul slab spawns a real maid and returns the empty charm rather than placing a block',true)
  assert.equal((await nativeBlock(floor)).nativeId,ground.nativeId)
  await waitNativeCooldown();await equip()
  sendDescriptor('inventory_transaction',{transaction:{legacy:{legacy_request_id:0,legacy_transactions:null},transaction_type:'item_use_on_entity',actions:[],transaction_data:{entity_runtime_id:BigInt(actor.runtimeId),action_type:'interact',hotbar_slot:slot,held_item:inventory[slot],player_pos:{...auth.position,y:auth.position.y+1.62},click_pos:{x:0,y:.6,z:0}}}},inventory[slot])
  await inventoryUntil(s=>s.items.some(i=>i.slot===slot&&i.nativeId==='touhou_little_maid:smart_slab_has_maid'))
  assert(!(await nearby()).entities.some(e=>e.uuid===maid.uuid))
  check('ordinary Bedrock interaction captures the same maid into maid_info without disconnecting',!error)
  const icons=JSON.parse(fs.readFileSync(path.join(config.bridgeDir,'plugins/Geyser/maw-native-items.json'))).items
  const expected=icons.find(i=>i.nativeItem==='touhou_little_maid:smart_slab_has_maid')
  await wait(()=>report.itemRegistry?.find(i=>i.runtime_id===inventory[slot]?.network_id)?.name===expected.bedrockIdentifier)
  check('captured soul slab receives its occupied original icon',true)
  await waitNativeCooldown();await equip();useFloor()
  await inventoryUntil(s=>s.items.some(i=>i.slot===slot&&i.nativeId==='touhou_little_maid:smart_slab_empty'))
  assert((await nearby()).entities.some(e=>e.uuid===maid.uuid))
  assert.equal((await nativeBlock(floor)).nativeId,ground.nativeId)
  check('captured maid releases again with the original UUID and the ground is unchanged',!error)
 }
 if(potionMetadataTest){
  await ownConsole('execute at b_FomBedrockQA run summon minecraft:item ~2 ~1 ~ {Tags:["'+potionTag+'"],NoGravity:1b,PickupDelay:32767s,Item:{id:"minecraft:potion",count:1,components:{"minecraft:potion_contents":{potion:"minecraft:water_breathing"}}}}')
  await wait(()=>report.itemEntities?.some(p=>report.itemRegistry?.find(i=>i.runtime_id===p.item?.network_id)?.name==='minecraft:potion'))
  check('real potion ItemStack metadata crosses ViaVersion and reaches Bedrock without stream misalignment',true)
 }
 if(process.argv.includes('--recover-fixture')){
  const file=process.argv[process.argv.indexOf('--recover-fixture')+1],previous=JSON.parse(fs.readFileSync(file))
  assert.equal(previous.nativeAuth.playerUuid,auth.playerUuid)
  const before=await nativeInventory();assert.deepEqual(before.items,previous.fixtureAfter.items)
  if(blockItemTest){
   const catalog=JSON.parse(fs.readFileSync(path.join(config.bridgeDir,'plugins/Geyser/native-block-catalog.json')))
   for(const id of ['create:andesite_casing','farmersdelight:tomato_crate']){
    const row=catalog.blockItems.find(r=>r.nativeItem===id),slot=before.items.find(r=>r.nativeId===id);assert(row&&slot)
    await wait(()=>report.itemRegistry?.find(r=>r.runtime_id===inventory[slot.slot]?.network_id)?.name===row.bedrockIdentifier)
    check('native 3D inventory identity survives same-body reconnect: '+id,true)
   }
  }
  for(const [id,count] of previous.suppliedTypes)await ownConsole('execute run clear b_FomBedrockQA '+id+' '+count)
  const after=await inventoryUntil(s=>JSON.stringify(s.items)===JSON.stringify(previous.fixtureBefore.items));assert.deepEqual(after.items,previous.fixtureBefore.items)
  report.recoveredFixture=file;check('previous interrupted QA fixture reconciled by exact native inventory',true)
 }
 if(process.argv.includes('--items')||cookingTest){
  const before=await nativeInventory();report.fixtureBefore=before
  // The native first-login gift is a soul charm. Retain it and only supply
  // missing fixture types; never clear somebody's pre-existing item stack.
  report.suppliedTypes=fixtureItems.filter(([id])=>!before.items.some(i=>i.nativeId===id));assert(!before.items.some(i=>i.slot===8),'Keep pre-existing hotbar items')
  fixture=true
  for(const [id,count] of report.suppliedTypes)await ownConsole('execute run give b_FomBedrockQA '+id+' '+count)
  const supplied=await inventoryUntil(s=>fixtureItems.every(([id,count])=>s.items.some(i=>i.nativeId===id&&i.count>=count)));report.fixtureSupplied=supplied
  check('three actual mod item types reach the Bedrock connection',supplied.items.some(i=>i.nativeId==='farmersdelight:rice'&&i.count===4)&&supplied.items.some(i=>i.nativeId==='create:shaft'&&i.count===3)&&supplied.items.some(i=>i.nativeId==='irons_spellbooks:scroll'&&i.count===1))
  const rice=supplied.items.find(i=>i.nativeId==='farmersdelight:rice');await wait(()=>inventory[rice.slot]?.count===4)
  const item=inventory[rice.slot];report.riceBedrock=item
  if(modelTest){
   const icons=JSON.parse(fs.readFileSync(path.join(config.bridgeDir,'plugins/Geyser/maw-native-items.json'))).items
   for(const id of ['farmersdelight:rice','touhou_little_maid:smart_slab_init','touhou_little_maid:smart_slab_empty',...(colonyTest?['minecolonies:clipboard']:[])]){
    const row=icons.find(i=>i.nativeItem===id),slot=supplied.items.find(i=>i.nativeId===id)
    assert(row&&slot);await wait(()=>inventory[slot.slot]?.count===slot.count)
    const runtime=inventory[slot.slot].network_id,actual=report.itemRegistry?.find(i=>i.runtime_id===runtime)
    report.iconBindings??=[];report.iconBindings.push({nativeItem:id,nativeSlot:slot.slot,bedrockRuntimeId:runtime,actual,expected:row.bedrockIdentifier})
    check('actual Bedrock runtime identity selects original icon: '+id,actual?.name===row.bedrockIdentifier)
   }
  }
  if(blockItemTest){
   const catalog=JSON.parse(fs.readFileSync(path.join(config.bridgeDir,'plugins/Geyser/native-block-catalog.json')))
   for(const id of ['create:andesite_casing','farmersdelight:tomato_crate']){
    const row=catalog.blockItems.find(r=>r.nativeItem===id),slot=supplied.items.find(r=>r.nativeId===id);assert(row&&slot)
    await wait(()=>inventory[slot.slot]?.count===slot.count)
    const item=inventory[slot.slot],actual=report.itemRegistry.find(r=>r.runtime_id===item.network_id)
    report.blockItemBindings??=[];report.blockItemBindings.push({nativeItem:id,slot:slot.slot,actual,blockRuntime:item.block_runtime_id})
    console.log(JSON.stringify({nativeItem:id,actual,blockRuntime:item.block_runtime_id,expected:row.bedrockIdentifier}))
    check('native three-dimensional block item identity: '+id,actual?.name===row.bedrockIdentifier&&item.block_runtime_id!==0)
   }
  }
  check('native mod stack carries a real Bedrock item and server network stack identity',item.network_id!==0&&item.has_stack_id&&Number.isInteger(item.stack_id))
  assert(!inventory[8]||inventory[8].count===0)
  send('interact',{action_id:'open_inventory',target_entity_id:client.entityId,has_position:false})
  await wait(()=>report.containers?.some(p=>p.window_id==='inventory'))
  send('item_stack_request',{requests:[{request_id:1,actions:[{type_id:'swap',legacy_type_id:2,source:{slot_type:{container_id:'hotbar_and_inventory'},slot:rice.slot,stack_id:item.stack_id},destination:{slot_type:{container_id:'hotbar_and_inventory'},slot:8,stack_id:0}}],custom_names:[],cause:'chat_public'}]})
  await wait(()=>report.stackResponses.some(p=>p.responses?.some(r=>r.request_id===1)))
  const response=report.stackResponses.flatMap(p=>p.responses||[]).find(r=>r.request_id===1)
  check('ordinary Bedrock inventory swap gets an authoritative success',response.status==='ok')
  if(cookingTest){
   // A protocol-only QA client must apply the authoritative stack response as
   // the real Bedrock client does; Geyser need not resend inventory_content.
   const moved=response.containers?.filter(c=>['hotbar','inventory','hotbar_and_inventory'].includes(c.slot_type?.container_id)).flatMap(c=>c.slots).find(s=>s.slot===8&&s.count===item.count)
   assert(moved&&Number.isInteger(moved.item_stack_id));inventory[8]={...structuredClone(item),stack_id:moved.item_stack_id,count:moved.count};inventory[rice.slot]={network_id:0}
  }
  const after=await nativeInventory();report.fixtureAfter=after
  check('native mod identity and count survive the real Bedrock inventory operation',after.items.some(i=>i.nativeId==='farmersdelight:rice'&&i.slot===8&&i.count===4)&&after.items.reduce((n,i)=>n+i.count,0)===before.items.reduce((n,i)=>n+i.count,0)+report.suppliedTypes.reduce((n,i)=>n+i[1],0)&&after.cursor.count===0)
  check('original QA guide/items remain in their original slots',before.items.every(i=>after.items.some(a=>a.slot===i.slot&&a.nativeId===i.nativeId&&a.count===i.count&&a.displayName===i.displayName)))
  if(blockItemTest){
   let native=after.items.find(r=>r.nativeId==='create:andesite_casing');assert(native);assert(!inventory[9]||inventory[9].count===0)
   if(process.argv.includes('--place')){
    const pos={x:Math.floor(auth.position.x)+1,y:Math.floor(auth.position.y),z:Math.floor(auth.position.z)},floor={...pos,y:pos.y-1}
    const inspect=nativeBlock
    const empty=await inspect(pos);assert(empty.status==='ok'&&empty.air,'QA placement must use an empty block');report.placementPosition=pos
    const runtime=chunkPackets.map(p=>runtimeAt(p,floor)).find(id=>id!==undefined);assert(Number.isInteger(runtime));report.clickedBlockRuntime=runtime
    send('container_close',{window_id:'inventory',window_type:'inventory',server:false})
    sendDescriptor('mob_equipment',{runtime_entity_id:client.entityId,item:inventory[native.slot],slot:native.slot+9,selected_slot:native.slot,window_id:'inventory'},inventory[native.slot])
    let selected=await nativeInventory();assert.equal(selected.selectedHotbar,native.slot)
    sendDescriptor('inventory_transaction',{transaction:{legacy:{legacy_request_id:0,legacy_transactions:null},transaction_type:'item_use',actions:[],transaction_data:{action_type:'click_block',trigger_type:'player_input',block_position:floor,face:1,hotbar_slot:native.slot,hand:'main_hand',held_item:inventory[native.slot],player_pos:{...auth.position,y:auth.position.y+1.62},click_pos:{x:.5,y:1,z:.5},block_runtime_id:runtime,client_prediction:'success',client_cooldown_state:'off'}}},inventory[native.slot])
    await new Promise(resolve=>setTimeout(resolve,1200));const actual=await inspect(pos),consumed=await nativeInventory();report.nativePlacement={block:actual,inventory:consumed}
    check('real Bedrock use places the original native mod block and consumes exactly one item',actual.nativeId==='create:andesite_casing'&&consumed.items.find(r=>r.nativeId==='create:andesite_casing')?.count===native.count-1)
    native=consumed.items.find(r=>r.nativeId==='create:andesite_casing')
    send('interact',{action_id:'open_inventory',target_entity_id:client.entityId,has_position:false});await new Promise(resolve=>setTimeout(resolve,200))
   }
   send('item_stack_request',{requests:[{request_id:2,actions:[{type_id:'swap',legacy_type_id:2,source:{slot_type:{container_id:'hotbar_and_inventory'},slot:native.slot,stack_id:inventory[native.slot].stack_id},destination:{slot_type:{container_id:'hotbar_and_inventory'},slot:9,stack_id:0}}],custom_names:[],cause:'chat_public'}]})
   await wait(()=>report.stackResponses.some(p=>p.responses?.some(r=>r.request_id===2)))
   const response=report.stackResponses.flatMap(p=>p.responses||[]).find(r=>r.request_id===2),result=await nativeInventory()
   check('native 3D block item survives real Bedrock inventory swap',response.status==='ok'&&result.items.some(r=>r.slot===9&&r.nativeId==='create:andesite_casing'&&r.count===native.count))
   report.fixtureAfter=result
  }
 }
 if(cookingTest){
  const pos={x:Math.floor(auth.position.x)+2,y:Math.floor(auth.position.y),z:Math.floor(auth.position.z)}
  assert((await nativeBlock(pos)).air,'Only use an observed empty fixture cell');report.cookingPosition=pos
  await ownConsole(`execute run setblock ${pos.x} ${pos.y} ${pos.z} farmersdelight:cooking_pot`)
  await wait(()=>report.blockUpdates?.some(p=>p.position.x===pos.x&&p.position.y===pos.y&&p.position.z===pos.z))
  const runtime=report.blockUpdates.find(p=>p.position.x===pos.x&&p.position.y===pos.y&&p.position.z===pos.z).block_runtime_id
  const before=await nativeInventory(),rice=before.items.find(i=>i.nativeId==='farmersdelight:rice');assert(rice&&rice.slot<9)
  const heldForPot=structuredClone(inventory[rice.slot]);assert(heldForPot.network_id!==0)
  send('container_close',{window_id:'inventory',window_type:'inventory',server:false})
  sendDescriptor('mob_equipment',{runtime_entity_id:client.entityId,item:inventory[rice.slot],slot:rice.slot+9,selected_slot:rice.slot,window_id:'inventory'},inventory[rice.slot])
  const opened=report.containers?.length||0
  sendDescriptor('inventory_transaction',{transaction:{legacy:{legacy_request_id:0,legacy_transactions:null},transaction_type:'item_use',actions:[],transaction_data:{action_type:'click_block',trigger_type:'player_input',block_position:pos,face:1,hotbar_slot:rice.slot,hand:'main_hand',held_item:inventory[rice.slot],player_pos:{...auth.position,y:auth.position.y+1.62},click_pos:{x:.5,y:.8,z:.5},block_runtime_id:runtime,client_prediction:'success',client_cooldown_state:'off'}}},inventory[rice.slot])
  await wait(()=>report.containers?.slice(opened).some(p=>p.window_id!=='inventory'))
  const container=report.containers.slice(opened).find(p=>p.window_id!=='inventory'),id=String(container.window_id)
  // Bedrock's standard chest UI pads a Java 9x1 window to 27 visual cells.
  // Only indices 0..8 are real native pot slots; padding is not native stock.
  await wait(()=>report.containerContents?.[id]?.length===27)
  report.cookingLayout={nativeSlots:9,bedrockVisualSlots:27,paddingIsNativeInventory:false}
  check('ordinary Bedrock use opens the nine native cooking-pot slots in its standard container UI',true)
  const swap=(request,source,destination)=>send('item_stack_request',{requests:[{request_id:request,actions:[{type_id:'swap',legacy_type_id:2,source,destination}],custom_names:[],cause:'chat_public'}]})
  const response=id=>report.stackResponses.flatMap(p=>p.responses||[]).find(r=>r.request_id===id)
  swap(51,{slot_type:{container_id:'hotbar_and_inventory'},slot:rice.slot,stack_id:inventory[rice.slot].stack_id},{slot_type:{container_id:'level_entity'},slot:0,stack_id:0})
  await wait(()=>response(51));assert.equal(response(51).status,'ok')
  await inventoryUntil(s=>!s.items.some(i=>i.nativeId==='farmersdelight:rice'))
  const deposited=response(51).containers?.filter(c=>['container','level_entity'].includes(c.slot_type?.container_id)).flatMap(c=>c.slots).find(s=>s.slot===0&&s.count===4)
  if(deposited){assert(Number.isInteger(deposited.item_stack_id));report.containerContents[id][0]={...heldForPot,count:4,stack_id:deposited.item_stack_id};inventory[rice.slot]={network_id:0}}
  await wait(()=>report.containerContents[id][0]?.count===4)
  const inside=report.containerContents[id][0];check('Bedrock puts the original mod rice into the native ingredient slot',inside.network_id!==0&&inside.has_stack_id)
  swap(52,{slot_type:{container_id:'level_entity'},slot:0,stack_id:inside.stack_id},{slot_type:{container_id:'hotbar_and_inventory'},slot:rice.slot,stack_id:0})
  await wait(()=>response(52));assert.equal(response(52).status,'ok')
  await inventoryUntil(s=>s.items.some(i=>i.nativeId==='farmersdelight:rice'&&i.slot===rice.slot&&i.count===4))
  check('Bedrock retrieves the exact native stack without losing components or count',true)
  send('container_close',{window_id:container.window_id,window_type:container.window_type,server:false})
 }
 if(modelTest){
  const modelId=motionTest?'touhou_little_maid:hakurei_reimu':'touhou_little_maid:hourai_doll'
  const definition=JSON.parse(fs.readFileSync(path.join(config.bridgeDir,'plugins/Geyser/modpack-catalog.json'))).models.find(m=>m.modelId===modelId)
  assert(definition)
  // Soul-slab fixtures may already have spawned this same model. Historic
  // packets belong to a different actor and cannot prove this fixture moved.
  const modelStart=report.models?.length||0
  await ownConsole('execute at b_FomBedrockQA run summon touhou_little_maid:maid ~2 ~ ~2 {model_id:"'+modelId+'",Tags:["'+temporaryMaidTag+'"],NoAI:'+(motionTest?'1b':'0b')+',PersistenceRequired:1b}')
  await wait(()=>report.models?.slice(modelStart).some(m=>m.identifier===definition.bedrockIdentifier))
  const model=report.models.slice(modelStart).find(m=>m.identifier===definition.bedrockIdentifier)
  check('real native maid arrives as her own original custom model',!!model)
  await ownConsole('execute at b_FomBedrockQA run tp @e[tag='+temporaryMaidTag+',limit=1] ~5 ~ ~2')
  await wait(()=>report.moves?.some(m=>m.id===model.runtimeId&&Math.abs(m.position.x-model.position.x)>1))
  check('original maid entity movement reaches the same Bedrock actor',true)
  if(motionTest){
   const pose=(start,value)=>(report.actorMetadata||[]).slice(start).some(p=>String(p.runtime_entity_id)===model.runtimeId&&p.metadata?.some(m=>(m.key===2||m.key==='variant')&&m.value===value))
   let start=report.actorMetadata?.length||0
   // Controlled QA velocity runs actual native entity physics. Teleports alone
   // are explicitly NOT accepted as evidence of walking or autonomous AI.
   await ownConsole('execute run data merge entity @e[tag='+temporaryMaidTag+',limit=1] {NoAI:0b,NoGravity:1b,Motion:[0.12d,0.0d,0.0d]}')
   await wait(()=>pose(start,1));check('native relative movement selects the downloaded walking controller',true)
   start=report.actorMetadata.length
   await ownConsole('execute run data merge entity @e[tag='+temporaryMaidTag+',limit=1] {NoAI:1b,Motion:[0.0d,0.0d,0.0d]}')
   await wait(()=>pose(start,0));check('walking expires to idle after native motion stops',true)
   start=report.actorMetadata.length
   await ownConsole('execute run data merge entity @e[tag='+temporaryMaidTag+',limit=1] {Sitting:1b}')
   await wait(()=>pose(start,4));check('native sitting metadata selects the sitting controller',true)
   start=report.actorMetadata.length
   await ownConsole('execute run data merge entity @e[tag='+temporaryMaidTag+',limit=1] {Sitting:0b}')
   await wait(()=>pose(start,0));check('native standing metadata restores idle on the same actor',true)
   report.motionSource='actual_server_physics_and_synched_metadata';report.autonomousMaidAiTested=false
  }
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
 if(report.soulSlabFixture)try{
  const f=report.soulSlabFixture
  if(f.uuid)await ownConsole('execute run kill @e[tag='+f.tag+']')
  const snapshot=await nativeInventory(),item=snapshot.items.find(i=>i.slot===f.slot)
  assert(item&&/^touhou_little_maid:smart_slab_(init|empty|has_maid)$/.test(item.nativeId)&&item.count===1)
  await ownConsole('execute run item replace entity b_FomBedrockQA hotbar.'+f.slot+' with minecraft:air')
  // Other explicitly supplied fixtures may still be present in a combined
  // run. Remove this slot only; their later cleanup verifies the full baseline.
  const expected=snapshot.items.filter(i=>i.slot!==f.slot)
  for(const original of f.before.items)assert.deepEqual(expected.find(i=>i.slot===original.slot),original)
  await inventoryUntil(s=>JSON.stringify(s.items)===JSON.stringify(expected))
  check('soul-slab fixture removed and the original QA inventory retained',true)
 }catch(e){report.soulSlabCleanupError=e.message;process.exitCode=1}
 if(potionMetadataTest)try{await ownConsole('execute run kill @e[tag='+potionTag+']')}catch(e){report.cleanupError=e.message;process.exitCode=1}
 if(report.cookingPosition)try{const p=report.cookingPosition;await ownConsole(`execute if block ${p.x} ${p.y} ${p.z} farmersdelight:cooking_pot run setblock ${p.x} ${p.y} ${p.z} minecraft:air`);await new Promise(r=>setTimeout(r,300));report.cookingCleanup=await nativeBlock(p);check('temporary Bedrock cooking pot removed with native confirmation',report.cookingCleanup.air===true)}catch(e){report.cleanupError=e.message;process.exitCode=1}
 if(report.placementPosition)try{const p=report.placementPosition;await ownConsole(`execute if block ${p.x} ${p.y} ${p.z} create:andesite_casing run setblock ${p.x} ${p.y} ${p.z} minecraft:air`);const until=Date.now()+25000;do{report.placementCleanup=await nativeBlock(p);if(report.placementCleanup.air)break;await new Promise(r=>setTimeout(r,200))}while(Date.now()<until);check('temporary placed mod block removed with native world confirmation',report.placementCleanup.air===true)}catch(e){report.cleanupError=e.message;process.exitCode=1}
 if(modelTest)try{await ownConsole('execute run kill @e[tag='+temporaryMaidTag+']')}catch(e){report.cleanupError=e.message;process.exitCode=1}
 if(fixture)try{
  if(process.argv.includes('--retain-fixture')&&!report.error){assert(report.fixtureAfter);report.fixtureRetainedForReconnect=true}
  else {for(const [id,count] of report.suppliedTypes)await ownConsole('execute run clear b_FomBedrockQA '+id+' '+count);report.fixtureCleanupDelivered=true;const expected=report.soulSlabFixture&&!report.soulSlabCleanupError?report.soulSlabFixture.before.items:report.fixtureBefore.items;report.fixtureCleanup=await inventoryUntil(s=>JSON.stringify(s.items)===JSON.stringify(expected));assert.deepEqual(report.fixtureCleanup.items,expected);check('only temporary QA items removed; original inventory fully retained',true)}
 }catch(e){report.cleanupError=e.message;process.exitCode=1}
 clearInterval(heartbeat);client?.close();const file=path.join(root,'udp-smoke-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2));console.log(JSON.stringify({checks:report.checks,packs:report.packDownloads,chunks:report.chunks,error:report.error,report:file}))
})
