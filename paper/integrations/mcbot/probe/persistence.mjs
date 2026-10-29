/** Cold-start inventory/RPG continuity and actual protected-world placement. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2],prior=process.env.MCBOT_PRIOR_RECEIPT??'mbstable1b';
assert(/^[a-z0-9]+$/.test(label)&&/^[a-z0-9]+$/.test(prior));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const props=await fs.readFile(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25928\r?$/m);assert.match(props,/^rcon.port=25929\r?$/m);
const previous=JSON.parse(await fs.readFile(stage+'/mcbot-'+prior+'.json','utf8'));assert(previous.passed&&previous.identity);
const {owner,body,uuid,inventory}=previous.identity,report={checks:[],passed:false,productionChanged:false};
const check=(label,ok)=>{assert(ok,label);report.checks.push(label);console.log('PASS '+label);};
report.setup=[];const rc=async q=>{const result=await command(q,15000,{properties:stage+'/server.properties',port:25929});report.setup.push({command:q,result});return result;};
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer'),bot=mf.createBot({host:'127.0.0.1',port:25928,version:previous.protocolVersion,username:owner,auth:'offline',hideErrors:true,checkTimeoutInterval:60000});installRecipePacketBypass(bot._client);
const replies=[];let ready=false,seq=0,epoch;bot.on('spawn',()=>{ready=true;});bot.on('error',()=>{});
const until=async(fn,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(80);}throw Error('Timeout '+label);};
bot._client.on('custom_payload',p=>{if(p.channel!=='mcbot:s2c')return;let n=0,i=0,shift=0;do{const b=p.data[i++];n|=(b&127)<<shift;shift+=7;if(!(b&128))break;}while(i<3);assert.equal(p.data.length-i,n);replies.push(JSON.parse(p.data.subarray(i).toString('utf8')));});
function send(p){const data=Buffer.from(JSON.stringify(p)),prefix=[];let n=data.length;do{prefix.push((n&127)|(n>127?128:0));n>>>=7;}while(n);bot._client.write('custom_payload',{channel:'mcbot:c2s',data:Buffer.concat([Buffer.from(prefix),data])});}
async function summon(){const at=replies.length;send({kind:'summon',name:body});const result=await until(()=>replies.slice(at).find(p=>['summon_result','companion_state'].includes(p.kind)&&p.companion_uuid&&p.body_id),'recall');epoch=result.body_id;return result;}
async function call(tool,args={},task=0){const id=++seq,at=replies.length;send({kind:'tool_call',seq:id,task_id:task,tool,args,body_id:epoch});return until(()=>replies.slice(at).find(p=>p.kind==='tool_result'&&p.seq===id),'tool '+tool,80000);}
try{
 await until(()=>ready&&bot.world.getColumnAt(bot.entity.position),'real loaded owner');bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcbot:s2c')});await sleep(350);
 const recalled=await summon();check('normal cold start recalls original body UUID',recalled.companion_uuid===uuid);
 const bag=await call('inventory');check('cold start preserves all original occupied slots, name and durability',bag.ok&&inventory.every(slot=>JSON.stringify(bag.data.slots[slot.slot])===JSON.stringify(slot)));
 check('cold start does not duplicate retained valuables',['minecraft:diamond','minecraft:iron_ingot'].every(item=>bag.data.slots.filter(s=>s.item===item).reduce((n,s)=>n+s.count,0)===inventory.filter(s=>s.item===item).reduce((n,s)=>n+s.count,0)));
 const state=await call('status');const old=previous.receipts.filter(p=>p.data?.rpg?.available).at(-1).data.rpg;
 check('cold start retains same native class and experience',state.ok&&state.data.rpg.combat===old.combat&&state.data.rpg.level===old.level&&state.data.rpg.xp===old.xp);
 // These terrain writes are confined to the marked, disposable QA world.
 await rc('minecraft:execute in minecraft:aincrad run minecraft:forceload add 32 32 48 48');await sleep(400);
 await rc('minecraft:execute in minecraft:aincrad run minecraft:fill 32 80 32 48 80 48 stone');await rc('minecraft:execute in minecraft:aincrad run minecraft:fill 32 81 32 48 86 48 air');
 await rc(`minecraft:execute in minecraft:aincrad run minecraft:tp ${owner} 40.5 81 40.5`);await rc(`minecraft:execute in minecraft:aincrad run minecraft:tp ${body} 42.5 81 40.5`);await sleep(1200);
 const entered=await call('status');if(!entered.ok)await summon();
 const world=await call('status');check('body and protocol can traverse an existing Paper dimension',world.ok&&world.data.dimension==='minecraft:aincrad'&&world.data.companion_uuid===uuid);
 await rc('minecraft:give '+body+' cobblestone 1');const before=(await call('inventory')).data.slots.filter(s=>s.item==='minecraft:cobblestone').reduce((n,s)=>n+s.count,0);
 send({kind:'task_begin',task_id:501,read_only:false,autonomous:true,body_id:epoch});await sleep(100);
 const placed=await call('place_block',{x:43,y:81,z:40,item:'cobblestone'},501);report.protection={ok:placed.ok,feedback:placed.feedback,data:placed.data};
 const after=(await call('inventory')).data.slots.filter(s=>s.item==='minecraft:cobblestone').reduce((n,s)=>n+s.count,0);
 const unchanged=await rc('minecraft:execute in minecraft:aincrad if block 43 81 40 air');
 check('protected-world placement makes no edit and consumes no carried block',!placed.ok&&before===after&&unchanged.includes('Test passed'));
 send({kind:'task_end',task_id:501});await rc(`minecraft:execute in minecraft:overworld run minecraft:tp ${owner} 200.5 81 200.5`);await rc(`minecraft:execute in minecraft:overworld run minecraft:tp ${body} ${state.data.x+.5} ${state.data.y} ${state.data.z+.5}`);
 await sleep(500);
 // Two self-placed blocks are the only breakable route through this disposable corridor.
 const x=400+Number(label.match(/\d+$/)?.[0]??0)*32;
 await rc(`minecraft:forceload add ${x-2} 300 ${x+11} 304`);await sleep(400);
 await rc(`minecraft:fill ${x-6} 80 300 ${x+10} 80 304 bedrock`);
 await rc(`minecraft:fill ${x} 80 300 ${x+10} 84 304 bedrock`);await rc(`minecraft:fill ${x+1} 81 302 ${x+9} 82 302 air`);
 await rc(`minecraft:tp ${owner} ${x-1.5} 81 302.5`);await rc(`minecraft:tp ${body} ${x+2.5} 81 302.5`);await sleep(700);
 send({kind:'task_begin',task_id:510,read_only:false,autonomous:true,body_id:epoch});await sleep(100);
 for(const y of [81,82]){const result=await call('place_block',{x:x+4,y,z:302,item:'cobblestone'},510);check('real body self-places corridor block '+y,result.ok);}
 check('stale planning air cannot erase live ownership; actual air still clears metadata',(await rc(`mcbot-native-check ${uuid} ${x+4} 81 302`)).startsWith('PASS snapshot'));
 const bagWithTool=await call('inventory');const pick=bagWithTool.data.slots.find(s=>s.item==='minecraft:iron_pickaxe');assert(pick,'real retained pickaxe');
 check('real retained pickaxe equipped for route', (await call('equip',{slot:pick.slot},510)).ok);
 send({kind:'task_end',task_id:510});await sleep(100);
 const begin=async(id,autonomous)=>{send({kind:'task_begin',task_id:id,read_only:false,autonomous,body_id:epoch});await sleep(100);};
 const target={x:x+8,y:81,z:302};await begin(512,false);
 const needs=await call('move_to',target,512);
 check('route returns concrete authorization ID and original-client summary',!needs.ok&&needs.feedback.startsWith('NEED_CONFIRM:')&&needs.data.authorization_id&&needs.data.authorization_summary&&needs.data.changes?.length===1);
 const approval=needs.data.authorization_id,approveSeq=++seq,approvalStart=replies.length;
 send({kind:'authorize',seq:approveSeq,task_id:512,authorization_id:approval,body_id:epoch});
 check('official authorize packet without allow accepts exact plan',(await until(()=>replies.slice(approvalStart).find(p=>p.kind==='tool_result'&&p.seq===approveSeq),'approval')).ok);
 const next=await call('move_to',{...target,authorization_id:approval},512);
 check('one-cell approval does not grant the second corridor block',!next.ok&&next.feedback.startsWith('NEED_CONFIRM:')&&next.data.authorization_id!==approval);
 const first=needs.data.changes[0],second=next.data.changes[0];
 check('approved cell alone was mined before the next confirmation',first.y!==second.y&&(await rc(`minecraft:execute if block ${first.x} ${first.y} ${first.z} air`)).includes('Test passed')&&(await rc(`minecraft:execute if block ${second.x} ${second.y} ${second.z} cobblestone`)).includes('Test passed'));
 const staleSeq=++seq,staleStart=replies.length;send({kind:'authorize',seq:staleSeq,task_id:512,authorization_id:approval,body_id:epoch});
 check('stale approval cannot authorize a replacement plan',!(await until(()=>replies.slice(staleStart).find(p=>p.seq===staleSeq),'stale approval')).ok);
 send({kind:'task_end',task_id:512});await begin(513,true);
 const finished=await call('move_to',target,513);check('explicit autonomous route completes remaining native movement',finished.ok);
 send({kind:'task_end',task_id:513});
 await rc(`minecraft:tp ${body} ${x+2.5} 81 302.5`);await rc(`minecraft:give ${body} cobblestone 2`);await begin(514,true);
 for(const y of [81,82])assert((await call('place_block',{x:x+4,y,z:302,item:'cobblestone'},514)).ok);
 send({kind:'task_end',task_id:514});await begin(515,true);
 const walked=await call('move_to',{...target,walk_only:true},515);
 check('walk-only overrides autonomous mode and never breaks either corridor block',!walked.ok&&(await rc(`minecraft:execute if block ${x+4} 81 302 cobblestone`)).includes('Test passed')&&(await rc(`minecraft:execute if block ${x+4} 82 302 cobblestone`)).includes('Test passed'));
 send({kind:'task_end',task_id:515});
 await rc(`minecraft:fill ${x+4} 81 302 ${x+4} 82 302 air`);await rc(`minecraft:tp ${body} ${x+1.5} 81 302.5`);await sleep(300);await begin(516,true);
 const moving=++seq,movingStart=replies.length;send({kind:'tool_call',seq:moving,task_id:516,tool:'move_to',args:{x:x+9,y:81,z:302},body_id:epoch,accept:true});
 await until(()=>replies.slice(movingStart).some(p=>p.kind==='job_ack'&&p.seq===moving),'accepted movement');await sleep(150);
 send({kind:'cancel',task_id:516});const stopped=await until(()=>replies.slice(movingStart).find(p=>p.kind==='job_event'&&p.seq===moving),'movement cancelled');
 await sleep(450);const pos=async()=>{const text=await rc(`minecraft:data get entity ${body} Pos`),match=text.match(/\[([-\d.Ee+d, ]+)\]/);assert(match,text);return match[1].split(',').map(parseFloat);};
 const stoppedAt=await pos();await sleep(1000);const later=await pos();
 check('cancel stops actual native movement rather than only its program',stopped.phase==='cancelled'&&stoppedAt[0]<x+8&&Math.hypot(...later.map((v,i)=>v-stoppedAt[i]))<.15);
 check('cancel releases actual native task record',(await rc(`mcbot-native-check ${uuid} idle`)).startsWith('PASS native task'));
 report.passed=true;
}finally{bot.quit();report.receipts=replies;await fs.writeFile(stage+'/mcbot-persistence-'+label+'.json',JSON.stringify(report,null,2));}
