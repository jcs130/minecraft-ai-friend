'use strict'
const {contract}=require('./sao-client.cjs')
const SAO_TOOL={name:'mc_sao',tags:['read','act'],description:'On-demand SAO server API for your own quests, profession, equipped skills and points. Start with operation:"help" (short index), then help with arguments.operation for ONE schema/example. Read one requested page/detail only. Mutations use the existing core queue and return a requestId to reconcile; no extra controller or automatic retries.',parameters:{type:'object',additionalProperties:false,properties:{operation:{type:'string',maxLength:80},arguments:{type:'object',additionalProperties:true},request_id:{type:'string',pattern:'^[A-Za-z0-9:_-]{1,64}$',maxLength:64}},required:['operation']}}
// A short name enum is discovery, not an injected quest book or every action schema.
SAO_TOOL.parameters.properties.operation.enum=['help',...contract.operations.map(op=>op.id)]
SAO_TOOL.description+=' Exact detail example: {"operation":"help","arguments":{"operation":"sao.quest.show"}}. Put that operation\'s parameters inside arguments, e.g. {"operation":"sao.quest.show","arguments":{"quest_id":"<observed ID>"}}.'
SAO_TOOL.description+=' Returned read/help/availableActions contain exact mc_invoke calls; use those observed links.'
function link(operation,args={}){return {tool:'mc_invoke',arguments:{name:'mc_sao',arguments:{operation,arguments:args}}}}
/** Derived invocation links, never invented world facts or automatically followed actions. */
function navigable(reply){
 if(!reply.ok||!reply.data||reply.complete===false)return reply
 const out=structuredClone(reply),d=out.data
 if(reply.operation==='sao.quests.list')for(const q of d.quests??[])q.read=link('sao.quest.show',{quest_id:q.id})
 if(reply.operation==='sao.professions'){
  for(const p of d.professions??[])p.read=link('sao.professions',{profession_id:p.id})
  if(Number.isInteger(d.id))d.availableActions=[link('sao.profession.choose',{profession_id:d.id})]
 }
 if(reply.operation==='sao.quest.show'&&!d.detailsHidden){
  d.availableActions=[]
  if(d.canStart)for(const t of d.tasks??[])if(!t.completed&&t.submissionMode==='submit')d.availableActions.push(link('sao.task.submit',{task_id:t.id}))
  if(d.completed)for(const r of d.rewards??[])if(!r.claimed&&!r.blocked)d.availableActions.push(link('sao.reward.claim',{reward_id:r.id}))
 }
 if(reply.operation==='sao.capabilities'){
  if(d.operation)d.invocationExample=link(d.operation.id,d.operation.example)
  else for(const op of d.operations??[])op.help=link('help',{operation:op.id})
 }
 return out
}
async function executeSaoTool(port,args,ctx,enqueue){
 const operation=args.operation==='help'?'sao.capabilities':args.operation,input=args.arguments??{}
 const spec=port.operations().find(row=>row.id===operation)
 if(!spec)return {text:JSON.stringify({status:'invalid_arguments',reason:'unknown_operation',knownOperations:port.operations().map(op=>op.id),next_safe_read:{tool:'mc_sao',arguments:{operation:'help'}}}),failed:true}
 let requestId,submissionStarted=false
 try{
  ctx?.signal?.throwIfAborted()
  if(spec.readOnly){const reply=navigable(await port.read(operation,input));return {text:JSON.stringify(reply),failed:reply.ok===false}}
  requestId=args.request_id??port.requestId(ctx?.callId)
  const prepared=await port.prepare(operation,input,requestId)
  ctx?.signal?.throwIfAborted()
  submissionStarted=true
  const queued=await enqueue({steps:[{skill:'chat',text:prepared.command}],queue:'append'},ctx)
  if(typeof queued==='string'||queued.failed)return queued
  const receipt=await prepared.wait()
  const data={...queued.data,serverOperationRequestId:requestId,serverReceipt:receipt,nativeActionCompleted:receipt.status==='completed'&&receipt.outcomeKnown!==false,goal_completed:false,next_safe_read:link('sao.action_status',{action_request_id:requestId})}
  return {...queued,text:queued.text+'\n'+JSON.stringify(data),data}
 }catch(error){return {text:JSON.stringify({status:submissionStarted?'unknown':'blocked',reason:error.message,diagnostic:error.diagnostic,example:error.example,requestId,outcomeKnown:!submissionStarted,completed:submissionStarted?null:0,retryable:false,retryAutomatically:false,...(submissionStarted?{next_safe_read:link('sao.action_status',{action_request_id:requestId})}:{})}),failed:true}}
}
module.exports={SAO_TOOL,executeSaoTool,navigable}
