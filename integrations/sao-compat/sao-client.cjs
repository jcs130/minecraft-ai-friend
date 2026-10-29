'use strict'
const {randomUUID,createHash}=require('node:crypto')
const {parameterProblem}=require('../tau-ceti/native-bridge/native-client.cjs')
const contract=require('./sao-operations.json')
const operations=new Map(contract.operations.map(row=>[row.id,row]))
const ID=/^[A-Za-z0-9:_-]{1,64}$/
function prepareCommand(operation,args,requestId){
 const spec=operations.get(operation)
 if(!spec||spec.readOnly)throw Error('declared_mutation_required')
 const problem=parameterProblem(args,spec.parameters);if(problem)throw Object.assign(Error('invalid_arguments'),{diagnostic:problem,example:spec.example})
 if(typeof requestId!=='string'||!ID.test(requestId))throw Error('request_id_required')
 const command=`/saoagent do ${requestId} ${operation} ${Buffer.from(JSON.stringify(args)).toString('base64url')}`
 if(command.length>contract.limits.actionCommandChars)throw Error('action_command_budget')
 return command
}
function attachSaoGameplay(bot,{timeoutMs=8000}={}){
 const pending=new Map(),receipts=new Map();let closed=false,capabilities=null
 const own=()=>bot._client.uuid?.toLowerCase()
 function receive(packet){
  if(packet.channel!=='maw_agent:sao_state'||!Buffer.isBuffer(packet.data)||packet.data.length>contract.limits.stateBytes)return
  try{
   const row=JSON.parse(packet.data.toString('utf8'));if(row.schemaVersion!==1||row.bodyId?.toLowerCase()!==own()||typeof row.requestId!=='string'||!ID.test(row.requestId))return
   const wait=pending.get(row.requestId);if(wait&&wait.operation!==row.operation)return
   if(row.readOnly===false){if(receipts.size>=1024&&!receipts.has(row.requestId))receipts.delete(receipts.keys().next().value);receipts.set(row.requestId,row)}
   if(wait){clearTimeout(wait.timer);pending.delete(row.requestId);wait.resolve(row)}
   bot.emit('saoGameplayReply',row)
  }catch{}
 }
 bot._client.on('custom_payload',receive)
 bot.once('end',()=>{closed=true;for(const [requestId,p]of pending){clearTimeout(p.timer);p.resolve({ok:false,status:'unknown',reason:'connection_closed',requestId,outcomeKnown:false,retryAutomatically:false})}pending.clear()})
 function waitFor(operation,requestId,timeout){
  if(pending.has(requestId))throw Error('request_already_waiting')
  return new Promise(resolve=>{const timer=setTimeout(()=>{pending.delete(requestId);resolve({ok:false,status:'unknown',reason:'reply_not_yet_observed',requestId,operation,outcomeKnown:false,retryAutomatically:false})},timeout);pending.set(requestId,{operation,resolve,timer})})
 }
 async function read(operation,args={}){
  const spec=operations.get(operation);if(!spec?.readOnly)return {ok:false,status:'invalid_arguments',reason:'read_operation_required'}
  const issue=parameterProblem(args,spec.parameters);if(issue)return {ok:false,status:'invalid_arguments',reason:'invalid_arguments',diagnostic:issue,example:spec.example}
  if(closed)return {ok:false,status:'offline',reason:'connection_closed'}
  const requestId=randomUUID(),result=waitFor(operation,requestId,timeoutMs)
  bot._client.write('custom_payload',{channel:'maw_agent:sao_query',data:Buffer.from(JSON.stringify({requestId,operation,arguments:args}))})
  return result
 }
 async function available(){if(!capabilities?.ok)capabilities=await read('sao.capabilities');return capabilities}
 async function prepare(operation,args,requestId){
  const cap=await available();if(!cap.ok)throw Object.assign(Error('sao_provider_not_observed'),{receipt:cap})
  if(!cap.data?.operations?.some(o=>o.id===operation&&!o.readOnly))throw Error('operation_not_installed')
  const command=prepareCommand(operation,args,requestId)
  receipts.delete(requestId) // A prior local receipt cannot stand in for this submission's conflict/dedup acknowledgement.
  return {command,requestId,wait:()=>receipts.has(requestId)?Promise.resolve(receipts.get(requestId)):waitFor(operation,requestId,1200)}
 }
 return {read,available,prepare,operations:()=>structuredClone(contract.operations),cachedReceipt:id=>receipts.get(id)??null,
  requestId:callId=>typeof callId==='string'&&callId?`sao_${createHash('sha256').update(callId).digest('hex').slice(0,40)}`:randomUUID()}
}
module.exports={attachSaoGameplay,prepareCommand,contract}
