import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {recallConversation,runOnce} from '../companion-memory.mjs';
import {GoalCheckpointBook} from '../../../../../packages/agent-mc-world/core/goal-checkpoint.ts';
import {parseGoalPlan} from '../../../../../packages/agent-mc-world/core/goal-plan.ts';

const npc='10000000-0000-0000-0000-000000000011',other='10000000-0000-0000-0000-000000000012';
const a='20000000-0000-0000-0000-000000000021',b='20000000-0000-0000-0000-000000000022';
const coreRoot=fileURLToPath(new URL('../../../../../packages/agent-mc-world',import.meta.url));
const goalScope=(cfg,maid=npc)=>({realm:cfg.realm,account:`npc:${maid}`,agent:maid});
function intendedGoal(text='交付鲜花，再回收多余铁剑并购买食物'){
  const plan=parseGoalPlan([{do:'完成鲜花委托',judgment:'本人的真实交付回执'},
    {do:'取得食物',verify:{source:'inventory',item:'bread',count:'>=1'}}]);
  assert.ok(!plan.error);
  return {slot:1,revision:1,text,plan,blueprint:null,day:null,realTime:new Date(1000).toISOString(),at:1000};
}

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'companion-memory-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const cfg={schema:1,coreRoot,source:true,journalRoot:join(root,'journal'),dataDir:join(root,'memory'),
    realm:'synthetic-companion-tests',npcs:[{maidId:npc},{maidId:other}]};
  async function evidence(maid,speaker,id,reply) {
    const dir=join(cfg.journalRoot,maid);await mkdir(dir,{recursive:true});
    const row={schemaVersion:1,id,maidId:maid,speakerId:speaker,message:'一起去冒险吗？',at:1000};
    await writeFile(join(dir,id+'-request.json'),JSON.stringify(row));
    await writeFile(join(dir,id+'-result.json'),JSON.stringify({...row,status:'answered',decision:'talk',reply}));
  }
  return {root,cfg,evidence};
}

test('core notebook retains Unicode evidence, deduplicates after importer crash, and isolates each speaker/NPC',async t=>{
  const {cfg,evidence}=await fixture(t);
  await evidence(npc,a,'30000000-0000-0000-0000-000000000031','阿岚，我们一起找种子');
  await evidence(npc,b,'30000000-0000-0000-0000-000000000032','仅与乙共享的经历');
  await evidence(other,a,'30000000-0000-0000-0000-000000000033','另一角色的经历');
  assert.equal((await runOnce(cfg))[0].imported,2);
  const read=p=>readFile(p,'utf8').then(JSON.parse);
  const receipt=join(cfg.dataDir,npc,'companion-import.json');
  const before=await read(receipt);
  await rm(receipt); // Simulates crash after core stored notes, before importer saved its bookkeeping.
  await runOnce(cfg);
  assert.deepEqual(Object.fromEntries(Object.entries(await read(receipt)).map(([k,v])=>[k,v.id])),
    Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.id])));
  const recall=await read(join(cfg.journalRoot,npc,`recall-${a}.json`));
  assert.equal(recall.historical,true);assert.equal(recall.items.length,1);
  assert.match(recall.items[0].evidence.reply,/阿岚/);
  assert.doesNotMatch(JSON.stringify(recall),/仅与乙共享|另一角色/);
  assert.equal((await runOnce(cfg))[0].imported,0);
});

test('shared external scope, duplicate identity and simultaneous writers are rejected',async t=>{
  const {cfg}=await fixture(t);
  await assert.rejects(runOnce({...cfg,npcs:[{maidId:npc},{maidId:npc}]}),/duplicate/);
  const memory={mode:'remote',provider:'powercontext',endpoint:'http://localhost:1',scopeId:'shared'};
  await assert.rejects(runOnce({...cfg,npcs:[{maidId:npc,memory},{maidId:other,memory}]}),/shared_memory_scope/);
  await mkdir(join(cfg.dataDir,'companion-sync.lock'),{recursive:true});
  await assert.rejects(runOnce(cfg),{code:'EEXIST'});
});

test('topic recall uses hybrid retrieval and returns only allowed original reply IDs',async t=>{
  const {cfg}=await fixture(t);
  const conversations = [];
  const searches = [];
  let available = true;
  const endpoint = createServer(async (request,response)=>{
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    let reply;
    if (request.url === '/v1/memory/remember') {
      const artifact = {family:'atomic-memory',artifact_id:`qa-${conversations.length}`,revision:1};
      const memory = {artifact, kind:body.kind,state:'active',text:body.text};
      conversations.push(memory);
      reply = {changed:true,records:[memory]};
    } else {
      searches.push(body);
      if(!available)response.statusCode=503;
      reply = {hits: conversations.toReversed().map(memory=>({memory}))};
    }
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify(reply));
  });
  t.after(()=>endpoint.close());
  await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
  cfg.npcs[0].memory={mode:'remote',provider:'powercontext',scopeId:'only-this-body',
    endpoint:`http://127.0.0.1:${endpoint.address().port}`};
  const dir=join(cfg.journalRoot,npc);
  await mkdir(dir,{recursive:true});
  const stamp = suffix=>`30000000-0000-0000-0000-0000000000${suffix}`;
  const shared=stamp(71),privateId=stamp(72),otherPeer=stamp(73),unfinished=stamp(74),request=stamp(75);
  const historic=(id,speakerId,channel,message,status='answered')=>writeFile(join(dir,id+'-result.json'),JSON.stringify({
    schemaVersion:1,id,maidId:npc,speakerId,channel,message,reply:'收到',status,at:1000}));
  await historic(shared,a,'public','旧水车旁边留了灯笼');
  await historic(privateId,a,'nearby','那个秘密只有我听到');
  await historic(otherPeer,b,'public','另一个玩家的经历');
  await historic(unfinished,a,'public','没有送达的回执','failed');
  assert.equal((await runOnce(cfg))[0].imported,4);
  const before = await readFile(join(cfg.dataDir,npc,'companion-import.json'));
  const input=join(dir,request+'-request.json');
  const submit=(channel)=>writeFile(input,JSON.stringify({schemaVersion:1,kind:'social_dialogue',status:'accepted',
    id:request,maidId:npc,speakerId:a,channel,at:Date.now(),message:'以前能避雨的地方是哪儿？'}));
  await submit('public');
  const publicRecall=await recallConversation(cfg,npc,request);
  assert.deepEqual(publicRecall,{mode:'hybrid',degraded:false,sourceRequestIds:[shared]});
  assert.equal(searches.at(-1).mode,'hybrid');
  assert.equal(searches.at(-1).query,'以前能避雨的地方是哪儿？');
  assert.equal(searches.at(-1).scope_id,'only-this-body');
  await submit('private');
  const privateRecall=await recallConversation(cfg,npc,request);
  assert.deepEqual(privateRecall.sourceRequestIds,[privateId,shared]);
  assert.deepEqual(await recallConversation(cfg,other,request),{mode:'local',sourceRequestIds:[]});
  available=false;
  const offline=await recallConversation(cfg,npc,request);
  assert.equal(offline.mode,'local');
  assert.equal(offline.degraded,true);
  assert.deepEqual(await readFile(join(cfg.dataDir,npc,'companion-import.json')),before);
  assert.equal(conversations.length,4);
});

test('a dialogue and its actual action import separately, with own-action recall and the original request reference',async t=>{
  const {cfg,evidence}=await fixture(t);
  const request='30000000-0000-0000-0000-000000000031',action='30000000-0000-0000-0000-000000000041';
  await evidence(npc,a,request,'我先试试疾步');
  await writeFile(join(cfg.journalRoot,npc,action+'-result.json'),JSON.stringify({schemaVersion:1,
    id:action,maidId:npc,speakerId:npc,at:1001,channel:'internal',kind:'resident_action',
    sourceRequestId:request,message:'实际施法结果',status:'recorded',
    reply:JSON.stringify({requestId:request,action:'cast',completed:true,manaSpent:5})}));
  assert.equal((await runOnce(cfg))[0].imported,2);
  const own=JSON.parse(await readFile(join(cfg.journalRoot,npc,`recall-${npc}.json`),'utf8'));
  assert.equal(own.items.length,1);
  assert.equal(own.items[0].evidence.sourceRequestId,request);
  assert.equal(JSON.parse(own.items[0].evidence.reply).completed,true);
  const dialogue=JSON.parse(await readFile(join(cfg.journalRoot,npc,`recall-${a}.json`),'utf8'));
  assert.equal(dialogue.items.length,1);assert.equal(dialogue.items[0].evidence.reply,'我先试试疾步');
  assert.equal((await runOnce(cfg))[0].imported,0);
});

test('unavailable PowerContext keeps durable local evidence and performs no unconfirmed write replay',async t=>{
  const {cfg,evidence}=await fixture(t);
  await evidence(npc,a,'30000000-0000-0000-0000-000000000031','网络断开时也要记住');
  cfg.npcs=[{maidId:npc,memory:{mode:'remote',provider:'powercontext',scopeId:'dedicated-synthetic',
    endpoint:'http://127.0.0.1:1',timeoutMs:100}}];
  await runOnce(cfg);
  const first=JSON.parse(await readFile(join(cfg.dataDir,npc,'companion-import.json'),'utf8'));
  assert.equal(Object.keys(first).length,1);
  assert.notEqual(Object.values(first)[0].index.status,'stored');
  const recall=JSON.parse(await readFile(join(cfg.journalRoot,npc,`recall-${a}.json`),'utf8'));
  assert.match(recall.items[0].evidence.reply,/网络断开/);
  assert.equal(recall.retrieval.degraded,true);
  assert.equal((await runOnce(cfg))[0].imported,0);
});

test('large service results and private notices preserve scoped originals without blocking later recall',async t=>{
  const {cfg}=await fixture(t);const dir=join(cfg.journalRoot,npc);await mkdir(dir,{recursive:true});
  const action='30000000-0000-0000-0000-000000000051',notice='30000000-0000-0000-0000-000000000052';
  const original={schemaVersion:1,id:action,maidId:npc,speakerId:npc,kind:'resident_action',
    sourceRequestId:'30000000-0000-0000-0000-000000000050',status:'recorded',reply:'真实库存与交易记录。'.repeat(2400)};
  const raw=JSON.stringify(original);await writeFile(join(dir,action+'-result.json'),raw);
  await writeFile(join(dir,notice+'-result.json'),JSON.stringify({schemaVersion:1,id:notice,maidId:npc,speakerId:npc,kind:'game_notice',channel:'private',reply:'本人的试炼奖励已入箱'}));
  assert.equal((await runOnce(cfg))[0].imported,2);
  assert.equal(await readFile(join(dir,action+'-result.json'),'utf8'),raw);
  const own=JSON.parse(await readFile(join(dir,`recall-${npc}.json`),'utf8'));
  const large=own.items.find(x=>x.evidence.id===action).evidence;
  assert.equal(large.payloadTruncated,true);assert.equal(large.sourceJournal,action+'-result.json');
  assert.equal(large.sourceRequestId,original.sourceRequestId);assert.match(large.payloadSha256,/^[0-9a-f]{64}$/);
  assert.equal(own.items.find(x=>x.evidence.id===notice).evidence.reply,'本人的试炼奖励已入箱');
  assert.equal((await runOnce(cfg))[0].imported,0);
});

test('core goals survive harness restarts as scoped intentions, never stale physical proof',async t=>{
  const {root,cfg}=await fixture(t);cfg.goalsDirectory=join(root,'goals');
  const book=new GoalCheckpointBook(cfg.goalsDirectory),goal=intendedGoal();
  goal.plan.steps[1].state='verified';goal.plan.steps[1].evidence={observedAt:42,connectionGeneration:1,realm:'old',dimension:'old',verdict:'ok',results:[]};
  book.save(goalScope(cfg),[goal]);
  book.save(goalScope({...cfg,realm:'another-realm'}),[intendedGoal('另一个世界的秘密目标')]);
  await runOnce(cfg);
  const own=JSON.parse(await readFile(join(cfg.journalRoot,npc,'core-goals.json'),'utf8'));
  assert.equal(own.status,'available');assert.equal(own.semantics,'intentions_not_current_world_evidence');
  assert.equal(own.goals[0].text,goal.text);assert.equal(own.goals[0].plan.steps[1].state,'pending');
  assert.equal(own.goals[0].plan.steps[1].evidence,null);assert.doesNotMatch(JSON.stringify(own),/秘密目标/);
  const peer=JSON.parse(await readFile(join(cfg.journalRoot,other,'core-goals.json'),'utf8'));
  assert.deepEqual(peer.goals,[]);
  new GoalCheckpointBook(cfg.goalsDirectory).save(goalScope(cfg),[]);
  await runOnce(cfg);
  assert.deepEqual(JSON.parse(await readFile(join(cfg.journalRoot,npc,'core-goals.json'),'utf8')).goals,[]);
});

test('invalid or excessive core goals are visible as unavailable, with original checkpoints retained',async t=>{
  const {root,cfg}=await fixture(t);cfg.goalsDirectory=join(root,'goals');
  new GoalCheckpointBook(cfg.goalsDirectory).save(goalScope(cfg),[intendedGoal('目'.repeat(9000))]);
  await runOnce(cfg);
  let own=JSON.parse(await readFile(join(cfg.journalRoot,npc,'core-goals.json'),'utf8'));
  assert.equal(own.status,'unavailable');assert.equal(own.reason,'goal_context_budget');assert.deepEqual(own.goals,[]);
  const file=join(cfg.goalsDirectory,(await readdir(cfg.goalsDirectory))[0]);
  await writeFile(file,'corrupt-checkpoint');await runOnce(cfg);
  own=JSON.parse(await readFile(join(cfg.journalRoot,npc,'core-goals.json'),'utf8'));
  assert.equal(own.reason,'core_goal_checkpoint_unavailable');assert.equal(await readFile(file,'utf8'),'corrupt-checkpoint');
  assert.equal(JSON.parse(await readFile(join(cfg.journalRoot,other,'core-goals.json'),'utf8')).status,'available');
  delete cfg.goalsDirectory;await runOnce(cfg);
  assert.equal(JSON.parse(await readFile(join(cfg.journalRoot,npc,'core-goals.json'),'utf8')).status,'not_configured');
});

test('goal projection configuration rejects a relative authority path',async t=>{
  const {cfg}=await fixture(t);
  await assert.rejects(runOnce({...cfg,goalsDirectory:'relative-goals'}),/absolute_core_goals_directory_required/);
});

test('legacy private self-notices recover only the immutable filename ID and import without rewriting or duplication',async t=>{
  const {cfg}=await fixture(t);const dir=join(cfg.journalRoot,npc);await mkdir(dir,{recursive:true});
  const id='30000000-0000-0000-0000-000000000061',name=id+'-result.json';
  const raw=JSON.stringify({maidId:npc,speakerId:npc,channel:'private',kind:'game_notice',reply:'购买成功，奖励在个人箱待领取',sentAt:'2026-11-17T00:00:00Z'});
  await writeFile(join(dir,name),raw);assert.equal((await runOnce(cfg))[0].imported,1);
  assert.equal(await readFile(join(dir,name),'utf8'),raw);
  const own=JSON.parse(await readFile(join(dir,`recall-${npc}.json`),'utf8'));
  assert.equal(own.items[0].evidence.id,id);assert.equal(own.items[0].evidence.legacyEnvelopeRecovered,true);
  assert.equal(own.items[0].evidence.sourceJournal,name);assert.equal((await runOnce(cfg))[0].imported,0);
});

test('legacy compatibility never repairs another speaker, malformed notice or a conflicting record ID',async t=>{
  const {cfg}=await fixture(t);const dir=join(cfg.journalRoot,npc);await mkdir(dir,{recursive:true});
  const id='30000000-0000-0000-0000-000000000061',file=join(dir,id+'-result.json');
  const base={maidId:npc,speakerId:npc,channel:'private',kind:'game_notice',reply:'notice',sentAt:'2026-11-17T00:00:00Z'};
  for(const invalid of [{...base,speakerId:a},{...base,sentAt:'invalid'},{...base,kind:'resident_action'},
    {...base,id:'30000000-0000-0000-0000-000000000062'}]){
    const raw=JSON.stringify(invalid);await writeFile(file,raw);
    await assert.rejects(runOnce(cfg),/conversation_identity_mismatch/);assert.equal(await readFile(file,'utf8'),raw);
  }
});
