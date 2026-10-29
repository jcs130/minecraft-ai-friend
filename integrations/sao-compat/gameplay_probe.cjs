'use strict'
/** Explicit line-driven acceptance client; no model, automatic action loop or OP. */
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline')
const {createSAOBot}=require('./sao_bot.cjs'),{attachSaoGameplay}=require('./sao-client.cjs')
const root=path.resolve(process.argv[2]),username=process.argv[3]??'SAOQuestProbe'
const bot=createSAOBot({root,username}),port=attachSaoGameplay(bot)
const output=path.join(root,'acceptance',`gameplay-${username}.jsonl`);fs.mkdirSync(path.dirname(output),{recursive:true})
function record(kind,result){const row={kind,observedAt:new Date().toISOString(),result};fs.appendFileSync(output,JSON.stringify(row)+'\n');const {data,...small}=result??{};for(const key of ['before','after','inventoryChanges','self','menu','operation'])delete small[key];if(data){small.dataSummary={...data};for(const key of ['before','after','nodes','skills','tasks','rewards','description','operations'])delete small.dataSummary[key];}console.log(JSON.stringify({kind,...small}))}
bot.on('error',e=>record('error',{message:e.message}));bot.on('end',reason=>record('end',{reason}))
bot.on('saoGameplayReply',row=>{if(!row.readOnly)record('private_action_receipt',row)})
bot.nativeReady.then(()=>record('ready',{uuid:bot._client.uuid,position:bot.entity.position})).catch(e=>record('not_ready',{reason:e.message}))
let serial=Promise.resolve()
readline.createInterface({input:process.stdin,terminal:false}).on('line',line=>{serial=serial.then(async()=>{
 const q=JSON.parse(line);await bot.nativeReady
 if(q.op==='quit'){bot.quit('gameplay acceptance complete');setTimeout(()=>process.exit(0),1000).unref();return}
 if(q.op==='read')return record(q.operation,await port.read(q.operation,q.arguments??{}))
 if(q.op==='snapshot')return record('snapshot',await bot.native.snapshot())
 if(q.op==='mutate'){
  const prepared=await port.prepare(q.operation,q.arguments??{},q.requestId)
  bot.chat(prepared.command) // Probe only: production EngineWorld uses its existing mc_do queue.
  return record(q.operation,await prepared.wait())
 }
 throw Error('unknown_probe_operation')
}).catch(e=>record('probe_error',{message:e.message,diagnostic:e.diagnostic}))})
