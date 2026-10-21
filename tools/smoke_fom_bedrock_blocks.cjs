'use strict'
// Real, finite UDP/chunk/update acceptance. Only an explicitly marked loopback
// QA bridge and its isolated world can be used; no production world writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {runtimeAt}=require('./bedrock_chunk_runtime.cjs')
const execFile=require('node:util').promisify(require('node:child_process').execFile)
const bedrock=require(process.env.MAW_BEDROCK_CLIENT_MODULE||'bedrock-protocol')
const root=path.resolve(process.env.MAW_FOM_BEDROCK_QA||'');assert(process.env.MAW_FOM_BEDROCK_QA)
const config=JSON.parse(fs.readFileSync(path.join(root,'qa.json'))),bridge=config.bridgeDir,catalogDir=path.join(bridge,'plugins/Geyser')
assert.equal(config.mode,'offline_qa');assert.equal(fs.readFileSync(path.join(bridge,'.fom-bedrock-qa'),'utf8').trim(),'loopback-only')
assert(path.resolve(config.mainConfig).toLowerCase().includes('research'))
const owner=JSON.parse(fs.readFileSync(path.join(bridge,'ops/health.json')));assert(owner.healthy&&Date.now()/1000-owner.heartbeatEpoch<15)
const definitions=JSON.parse(fs.readFileSync(path.join(catalogDir,'native-block-catalog.json'))),contract=JSON.parse(fs.readFileSync(path.join(catalogDir,'native-block-contract.json')))
const report={schemaVersion:1,at:new Date().toISOString(),checks:[],sessions:[],fixtures:[],actualPhoneTested:false,actualXboxValidated:false,modelRequests:0}
let client,error,heartbeat,current,active=false
const check=(name,ok)=>{report.checks.push({name,pass:!!ok});assert(ok,name);console.log('PASS '+name)}
const wait=async(fn,ms=30000)=>{let until=Date.now()+ms;while(!fn()&&!error&&Date.now()<until)await new Promise(r=>setTimeout(r,100));if(error)throw Error(error);assert(fn(),'wait expired')}
const hash=raw=>crypto.createHash('sha256').update(raw).digest('hex')
const uuid=value=>{const b=Buffer.from(value.replaceAll('-',''),'hex');b.subarray(0,8).reverse();b.subarray(8,16).reverse();const s=b.toString('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`}
const ownConsole=async command=>{const {stdout}=await execFile('E:/MC/runtime/python-3.12.14/python.exe',['-X','utf8','E:/minecraft-ai-friend-society-lab/tools/fom_service.py','console','--config',config.mainConfig,'--command',command,'--wait','10'],{windowsHide:true,encoding:'utf8',timeout:90000});const result=JSON.parse(stdout);assert(result.ok&&result.deliveryKnown);return result}
const same=(a,b)=>a.x===b.x&&a.y===b.y&&a.z===b.z
function trace(pos,javaId,after){const log=fs.readFileSync(path.join(bridge,'ops/logs/bedrock.log'),'utf8').slice(after);return [...log.matchAll(/MAW_NATIVE_BLOCK_TRACE kind=(\w+) x=(-?\d+) y=(-?\d+) z=(-?\d+) javaId=(\d+) runtimeId=(-?\d+)/g)].map(m=>({kind:m[1],x:+m[2],y:+m[3],z:+m[4],javaId:+m[5],runtimeId:(+m[6])>>>0})).find(r=>same(r,pos)&&r.javaId===javaId)}
async function connect(){
 error=null;current={chunks:[],updates:[],packs:[],messages:[],blockNames:[]};report.sessions.push(current);let spawned=false,send
 const advertised=[],downloads=new Map(),done=new Set()
 client=bedrock.createClient({host:'127.0.0.1',port:28993,username:'FomBlocksQA',offline:true,version:'1.26.51',raknetBackend:'raknet-native',skipPing:true,followPort:false,conLog:()=>{}})
 send=client.write.bind(client);client.write=(n,p)=>n==='resource_pack_client_response'?undefined:send(n,p)
 current.say=message=>send('text',{type:'chat',category:'authored',needs_translation:false,source_name:'FomBlocksQA',message,xuid:'',platform_chat_id:'',has_filtered_message:false})
 const response=status=>send('resource_pack_client_response',{response_status:status,response_status_name:status==='send_packs'?'askingserverforpacks':status==='have_all_packs'?'finishedloadingpacks':'resourcepackstackfinished',resourcepackids:status==='send_packs'?advertised.map(p=>p.uuid+'_'+p.version):[]})
 client.on('error',e=>{error=e.message});client.on('kick',p=>{error='kick '+JSON.stringify(p)})
 client.on('resource_packs_info',p=>{advertised.push(...p.texture_packs.map(r=>({...r,uuid:uuid(r.uuid)})));response('send_packs')})
 client.on('resource_pack_data_info',p=>{downloads.set(p.pack_id,{...p,parts:new Map()});for(let i=0;i<p.chunk_count;i++)send('resource_pack_chunk_request',{pack_id:p.pack_id,chunk_index:i})})
 client.on('resource_pack_chunk_data',p=>{try{const item=downloads.get(p.pack_id);item.parts.set(p.chunk_index,Buffer.from(p.payload));if(item.parts.size!==item.chunk_count||done.has(p.pack_id))return;const raw=Buffer.concat(Array.from({length:item.chunk_count},(_,i)=>item.parts.get(i)));assert.equal(hash(raw),Buffer.from(item.hash).toString('hex'));done.add(p.pack_id);current.packs.push({bytes:raw.length,sha256:hash(raw)});if(done.size===advertised.length)response('have_all_packs')}catch(e){error=e.message}})
 client.on('resource_pack_stack',()=>response('completed'));client.on('spawn',()=>{spawned=true})
 client.on('start_game',p=>{current.position=p.player_position;current.blockNames=p.block_properties.map(r=>r.name)})
 client.on('level_chunk',p=>{current.chunks.push(p)})
 client.on('update_block',p=>{current.updates.push(p)})
 client.on('text',p=>{if((p.message||'').includes('MC_FOM_AUTH '))current.messages.push(p.message);if(current.airToken&&(p.message||'').includes(current.airToken))current.airConfirmed=true})
 client.on('network_stack_latency',p=>{if(p.needs_response)send('network_stack_latency',{timestamp:p.timestamp,needs_response:false})})
 await wait(()=>spawned&&current.chunks.length,90000);active=true
 heartbeat=setInterval(()=>{if(!error)current.say('/fom status')},10000)
 current.say('/fom status');await wait(()=>current.messages.length>0)
 const message=current.messages.at(-1);current.auth=JSON.parse(message.slice(message.indexOf('MC_FOM_AUTH ')+12))
 check('native block pack downloaded with exact SHA',current.packs.some(p=>p.sha256===contract.files['maw-native-blocks.mcpack'].sha256))
 check('every custom block definition reaches the actual Bedrock login',definitions.blocks.every(b=>current.blockNames.includes(b.identifier)))
}
async function disconnect(){clearInterval(heartbeat);active=false;client?.close();await new Promise(r=>setTimeout(r,1000))}
async function main(){
 await connect();const first=current.auth,pos={x:Math.floor(first.position.x)+3,y:Math.floor(first.position.y)+2,z:Math.floor(first.position.z)+3}
 current.airToken='MC_BLOCK_QA_AIR_'+crypto.randomBytes(8).toString('hex')
 await ownConsole(`execute if block ${pos.x} ${pos.y} ${pos.z} minecraft:air run tellraw b_FomBlocksQA ${JSON.stringify({text:current.airToken})}`);await wait(()=>current.airConfirmed);report.fixtures.push(pos)
 const selected=['create:andesite_casing','create:shaft[axis=x]','create:shaft[axis=y]','create:shaft[axis=z]','farmersdelight:tomato_crate'].map(name=>{
  const [base,props]=name.split('['),axis=props?.slice(0,-1)
  return definitions.states.find(s=>(s.nativeState===base||s.nativeState.startsWith(base+'['))&&(!axis||s.nativeState.includes(axis))&&!s.nativeState.includes('waterlogged=true'))
 });assert(selected.every(Boolean),'all test models must exist')
 for(const row of selected){
  const offset=fs.readFileSync(path.join(bridge,'ops/logs/bedrock.log'),'utf8').length,start=current.updates.length
  await ownConsole(`execute run setblock ${pos.x} ${pos.y} ${pos.z} ${row.nativeState}`)
  await wait(()=>trace(pos,row.javaId,offset));const expected=trace(pos,row.javaId,offset)
  await wait(()=>current.updates.slice(start).some(p=>same(p.position,pos)&&(p.block_runtime_id>>>0)===expected.runtimeId))
  check('real block update selects exact native model: '+row.nativeState,true);report.fixtures.push({state:row.nativeState,...expected})
 }
 const last=selected.at(-1),expected=report.fixtures.at(-1),at=current.updates.length
 await ownConsole(`execute run setblock ${pos.x} ${pos.y} ${pos.z} minecraft:gold_block`);await wait(()=>current.updates.slice(at).some(p=>same(p.position,pos)&&(p.block_runtime_id>>>0)!==expected.runtimeId));check('vanilla replacement removes prior mod appearance',true)
 await ownConsole(`execute run setblock ${pos.x} ${pos.y} ${pos.z} ${last.nativeState}`);await disconnect();await connect()
 check('same authenticated native body after reconnect',current.auth.playerUuid===first.playerUuid)
 await wait(()=>current.chunks.some(p=>runtimeAt(p,pos)===expected.runtimeId));check('initial chunk after reconnect contains the exact custom runtime at absolute position',true)
 const before=current.updates.length;await ownConsole(`execute run setblock ${pos.x} ${pos.y} ${pos.z} minecraft:air`);await wait(()=>current.updates.slice(before).some(p=>same(p.position,pos)&&(p.block_runtime_id>>>0)!==expected.runtimeId));check('native block removal clears custom state',true)
}
main().catch(e=>{report.error=e.stack;process.exitCode=1;console.error(e.stack)}).finally(async()=>{
 try{const pos=report.fixtures[0];if(pos)await ownConsole(`execute run setblock ${pos.x} ${pos.y} ${pos.z} minecraft:air`)}catch(e){report.cleanupError=e.message;process.exitCode=1}
 await disconnect();for(const s of report.sessions){delete s.say;s.chunkCount=s.chunks.length;delete s.chunks}
 const file=path.join(root,'udp-blocks-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2));console.log(JSON.stringify({checks:report.checks,error:report.error,report:file}))
})
