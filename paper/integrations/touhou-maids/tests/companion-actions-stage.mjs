// Real authenticated chat, model tool-call protocol and native movement in a marked loopback world.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const stage=process.env.MAID_ACTION_QA_STAGE,reportPath=process.env.MAID_ACTION_QA_REPORT;
const fixture=JSON.parse(await fs.readFile(process.env.MAID_ACTION_QA_FIXTURE,'utf8'));
assert(fixture.synthetic&&fixture.username==='MaidBrainQA');
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');
assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25938$/m.test(props)&&/^rcon.port=25939$/m.test(props));
const {command}=await import(pathToFileURL(process.env.MAID_ACTION_QA_RCON));
const rc=q=>command(q,20000,{port:25939,properties:stage+'/server.properties'});
const require=createRequire(process.env.MAID_ACTION_QA_CLIENT_ANCHOR);
const baseline=process.argv.includes('--baseline'),restart=process.argv.includes('--restart'),realModel=process.argv.includes('--real-model');
const run='ca'+Date.now().toString(36),requests=[],bots=[];
const report={baseline,restart,synthetic:true,checks:[],productionChanged:false,actualLlmJudgementVerified:false};
const check=(label,ok)=>{report.checks.push({label,passed:!!ok});console.log((ok?'PASS ':'FAIL ')+label);assert(ok,label);};
async function until(fn,label,ms=20000){for(let end=Date.now()+ms;Date.now()<end;){let value=await fn();if(value)return value;await delay(100);}throw Error('Timeout '+label);}
let requestedMode='follow',forceTool=false,forceSecondTool=false,delayModel=false,releaseModel;
let mockReply='我会根据实际状态跟上，到了再告诉你。';
const liveModel=realModel?JSON.parse(await fs.readFile(process.env.MAID_ACTION_QA_MODEL_CONFIG,'utf8')).qiandengji_cormy_codingplan:null;
if(realModel)assert(liveModel.enabled&&liveModel.url==='http://127.0.0.1:4000/v1/chat/completions'&&liveModel.models.includes('codingplan-qwen3.7-plus'));
const modelResponses=[];
let modelSequence=0;
const model=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;
    const body=JSON.parse(raw);requests.push(body);
    if(realModel){
        try{
            const response=await fetch(liveModel.url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+liveModel.secret_key},body:JSON.stringify({...body,model:'codingplan-qwen3.7-plus'}),signal:AbortSignal.timeout(65000)});
            const raw=await response.text();
            if(response.ok){
                const parsed=JSON.parse(raw);
                modelResponses.push({id:parsed.id,model:parsed.model,choices:parsed.choices.map(choice=>({
                    finishReason:choice.finish_reason,content:choice.message?.content,toolCalls:choice.message?.tool_calls
                }))});
            }
            res.writeHead(response.status,{'content-type':'application/json'});res.end(raw);
        }catch{res.writeHead(502);res.end('{"error":"isolated_real_model_failed"}');}
        return;
    }
    const mode=requestedMode,force=forceTool;
    if(delayModel)await new Promise(resolve=>releaseModel=resolve);
    await delay(100);
    const last=body.messages.at(-1),tools=body.tools?.map(t=>t.function?.name)??[];
    const act=(mode&&tools.includes('set_companion_mode'))||force||(forceSecondTool&&last.content?.startsWith('本轮的服务器动作回执：'));
    const message=act?{role:'assistant',content:null,tool_calls:[{id:'call_qa_'+(++modelSequence),type:'function',function:{name:'set_companion_mode',arguments:JSON.stringify({mode})}}]}:{role:'assistant',content:mockReply};
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({id:'synthetic-companion',object:'chat.completion',model:'qa-native',choices:[{index:0,message,finish_reason:act?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
});
let seq=0;
async function connect(name){
    const bot=require('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username:name,auth:'offline',hideErrors:true});
    bots.push(bot);bot.replies=[];bot.lines=[];bot.on('error',()=>{});
    bot.on('messagestr',line=>{bot.lines.push(line);if(line.startsWith('QD_MAID '))try{bot.replies.push(JSON.parse(line.slice(8)));}catch{}});
    await until(()=>bot.entity&&bot.player?.uuid,name);
    bot._client.on('custom_payload',p=>{if(p.channel==='qiandengji:maids')try{bot.replies.push(JSON.parse(p.data.toString()));}catch{}});
    bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:maids')});
    return bot;
}
async function ask(bot,action,value='',id=run+'_'+(++seq)){
    await delay(500);const from=bot.replies.length;
    bot.chat(action==='receipt'?`/qdmaid receipt ${fixture.maid} ${value} ${id}`:`/qdmaid ${action} ${fixture.maid} ${id}${value?' '+value:''}`);
    return until(()=>bot.replies.slice(from).find(r=>r.requestId===id),action);
}
async function talk(bot,text='隔离肥鱼，跟我走吧。'){
    await delay(600);const from=bot.replies.length;
    bot.chat(text);
    return until(()=>bot.replies.slice(from).find(r=>r.action==='chat-result'||r.error),'nearby conversation receipt',realModel?90000:20000);
}
async function reset(owner){
    requestedMode='follow';forceTool=false;
    await rc(`minecraft:execute in minecraft:overworld run minecraft:tp ${owner.username} 300.5 90 300.5`);
    await rc(`minecraft:execute in minecraft:overworld run minecraft:tp ${fixture.maid} 302.5 90 300.5`);
    await rc(`minecraft:data modify entity ${fixture.maid} NeoForgeData.qiandengji_follow set value {schemaVersion:1,walkDistance:32,stopDistance:16,returnDistance:64}`);
    await ask(owner,'follow');await ask(owner,'stay');
}
async function testDialogueLimit(owner,first){
    requestedMode=null;
    if(!baseline){
        const count=requests.length;
        owner.chat(first.data.observation.reply);await delay(1000);
        check('echo of the delivered maid reply never starts inference',requests.length===count);
    }
    let last=first;
    const count=requests.length;
    for(let i=1;i<=5;i++)last=await talk(owner,(i%2===0?'隔离肥鱼，':'')+`我们再说一遍刚才的钓鱼计划第${i}条。`);
    check('natural and named turns can continue within one conversation',requests.length===count+5&&last.data.status==='replied');
    if(!baseline){
        check('nearby turns retain their own recent exchange',requests[count].messages.some(m=>m.role==='assistant'&&m.content===first.data.observation.reply));
        check('sixth reply closes the conversation',last.data.observation.conversationClosed===true&&last.data.observation.closeReason==='turn_limit');
    }
    await delay(31000);
    const after=requests.length;
    if(baseline){
        const next=await talk(owner,'我们再把钓鱼的计划说一遍。');
        check('BASELINE each reply renews the follow-up window after the short rate limit',requests.length===after+1&&next.data.status==='replied');
    }else{
        owner.chat('我们再把钓鱼的计划说一遍。');await delay(1000);
        owner.chat('隔离肥鱼，再把同一件事讲一遍。');await delay(1500);
        check('natural and named continuations stay stopped after the rate limit resets',requests.length===after);
        check('explicit follow is still usable after nearby dialogue closes',(await ask(owner,'follow')).data.status==='applied');
    }
}
async function fish(owner){
    await reset(owner);
    check('fixture native work schedule configured',(await ask(owner,'schedule','ALL')).data.status==='applied');
    await ask(owner,'follow');
    await rc(`minecraft:item replace entity ${fixture.maid} weapon.mainhand with minecraft:fishing_rod`);
    await rc('minecraft:fill 303 88 297 309 89 304 minecraft:water');
    await rc(`minecraft:tp ${fixture.otherMaid} 330.5 90 309.5`);
    await rc(`minecraft:data merge entity ${fixture.otherMaid} {Sitting:1b,MaidIsHome:1b}`);
    await rc('minecraft:summon touhou_little_maid:chair 302.5 90 300.5 {Tags:["MaidFishingQASeat"]}');
    await rc(`minecraft:ride ${fixture.maid} mount @e[type=touhou_little_maid:chair,tag=MaidFishingQASeat,limit=1,sort=nearest]`);
    const setup=(await ask(owner,'context')).data.fishing;
    check('fixture original maid is on its native fishing seat with a rod',setup.seated&&setup.hasRodInMainHand&&setup.workingNow);
    const original=setup.lastRetrievedAt;
    check('native fishing observer connected',(await rc('maidfishqa clear')).includes('MAID_FISH_QA'));
    requestedMode='fish';
    const reply=await talk(owner,'隔离肥鱼，请现在用主手鱼竿在这片水边钓鱼。');
    check('real model selects native fishing with the equipped rod',reply.data?.observation?.actions?.[0]?.mode==='fish'&&reply.data.observation.actions[0].status==='applied');
    check('selecting the fishing task does not claim a completed catch',reply.data.observation.actions[0].goalCompleted===false);
    try{
        await until(async()=>{
            await delay(650);
            return (await rc('minecraft:execute if entity @e[type=touhou_little_maid:fishing_hook,x=304,y=90,z=301,distance=..12]')).includes('Test passed');
        },'native fishing hook appeared',35000);
    }catch(error){
        const state=(await ask(owner,'context')).data;
        report.fishingDiagnosis={fishing:state.fishing,position:state.position,activity:state.activity,schedule:state.schedule,
            homeMode:state.homeMode,seat:await rc('minecraft:data get entity @e[tag=MaidFishingQASeat,sort=nearest,limit=1] Passengers'),
            restrict:await rc(`minecraft:data get entity ${fixture.maid} RestrictCenter`),
            hook:await rc('minecraft:execute if entity @e[type=touhou_little_maid:fishing_hook]')};
        throw error;
    }
    const hooked=(await ask(owner,'context')).data.fishing;
    check('native body sits and casts a real fishing hook',hooked.seated&&hooked.selected);
    const native=await until(async()=>{
        await delay(900);
        const value=JSON.parse((await rc('maidfishqa')).split('MAID_FISH_QA ')[1]);
        return value.retrievals.length?value:false;
    },'real native fishing retrieval',65000);
    const caught=(await ask(owner,'context')).data.fishing;
    check('native retrieval observed separately from the action receipt',!!caught.lastRetrievedAt&&caught.lastRetrievedAt!==original);
    report.fishingNative=native;
    check('native fishing produces a matching original item drop',native.retrievals.some(result=>result.loot.some(item=>
        native.drops.some(drop=>drop.tick===result.tick&&drop.item===item.item&&drop.count===item.count))));
    const follow=await ask(owner,'follow');
    const state=(await ask(owner,'context')).data;
    check('follow leaves the fishing seat and returns the same native entity to movement',follow.data.status==='applied'&&state.maidId===fixture.maid&&!state.fishing.selected&&!state.fishing.seated&&state.canMove);
    report.fishingRetrievedAt=caught.lastRetrievedAt;
}
try{
    await new Promise(resolve=>model.listen(19088,'127.0.0.1',resolve));
    check('exact candidate or baseline loaded',(await rc('version QiandengjiMaidBridge')).includes(baseline?'0.1.25-native-portal-travel':'0.1.26-companion-actions'));
    const owner=await connect(fixture.username),visitor=await connect('MaidVisitorQA');
    await rc('minecraft:execute in minecraft:overworld run minecraft:kill @e[type=touhou_little_maid:chair,tag=MaidFishingQASeat]');
    await rc('minecraft:fill 288 89 288 375 89 312 minecraft:stone');
    await rc('minecraft:fill 288 90 288 375 94 312 minecraft:air');
    await rc('minecraft:time set 1000');await rc('minecraft:weather clear');
    for(const bot of bots){await rc(`minecraft:gamemode survival ${bot.username}`);await rc(`minecraft:effect give ${bot.username} minecraft:resistance infinite 4 true`);await rc(`minecraft:tp ${bot.username} 300.5 90 301.5`);}
    await rc(`minecraft:execute in minecraft:overworld run minecraft:tp ${fixture.maid} 302.5 90 300.5`);
    await rc(`speechqa quiet ${fixture.maid}`);
    await ask(owner,'brain','native');
    if(restart){
        await delay(1500);
        check('restart does not replay previous model calls',requests.length===0);
        const previous=JSON.parse(await fs.readFile(process.env.MAID_ACTION_QA_PREVIOUS,'utf8'));
        const original=await ask(owner,'receipt',previous.actionId,run+'_old');
        // receipt CLI places the original operation first and the query ID second.
        check('original applied action receipt remains queryable after restart',original.ok&&original.data.operationId===previous.actionId&&original.data.status==='applied');
        const state=(await ask(owner,'context')).data;
        check('restart retains synthetic original UUID and owner',state.maidId===fixture.maid&&state.ownerId===fixture.owner&&state.lifeState==='alive');
        check('restart preserves configured follow distances',state.follow.walkBeyond===32&&state.follow.stopWithin===16&&state.follow.recoveryBeyond===64);
    }else if(realModel){
        await reset(owner);
        const reply=await talk(owner,'隔离肥鱼，我们一起出发吧，别再坐着等我了，跟我走。');
        const state=(await ask(owner,'context')).data;
        check('actual configured codingplan model chooses the real follow tool',modelResponses.some(r=>r.choices.some(c=>c.toolCalls?.some(t=>t.function?.name==='set_companion_mode'&&JSON.parse(t.function.arguments).mode==='follow'))));
        check('actual model tool is applied before its natural response',reply.data?.status==='replied'&&reply.data.observation.actions.some(a=>a.status==='applied'&&a.mode==='follow'));
        check('actual model ends the permanent stay in the original synthetic body',!state.sitting&&!state.homeMode&&state.canMove&&state.ownerId===fixture.owner);
        report.actualLlmJudgementVerified=true;report.model='codingplan-qwen3.7-plus';report.actionId=reply.data.observation.actions[0].operationId;report.reply=reply.data.observation.reply;
        await fish(owner);
        await ask(owner,'stay');
    }else{
        await reset(owner);
        const start=requests.length;
        const reply=await talk(owner);
        const context=(await ask(owner,'context')).data;
        if(baseline){
            check('BASELINE reproduces owner nearby speech without any action tool',requests.length===start+1&&!requests[start].tools?.length);
            check('BASELINE replies but remains sitting and stationed',reply.data?.status==='replied'&&context.sitting&&context.homeMode&&!context.canMove);
            report.reproduced='Owner nearby come/follow request can only produce words; original stay remains active';
            await testDialogueLimit(owner,reply);
        }else{
            check('bound partner receives only the scoped companion mode tool',requests[start].tools.length===1&&requests[start].tools[0].function.name==='set_companion_mode');
            check('model receives actual sitting and follow-distance facts',requests[start].messages.some(m=>m.content?.includes('"sitting":true')&&m.content.includes('"walkBeyond":32')));
            check('verified action result precedes a single speech-only completion',requests.length===start+2&&!requests[start+1].tools?.length&&requests[start+1].messages.some(m=>m.role==='system'&&m.content.startsWith('本轮的服务器动作回执：')&&m.content.includes('"status":"applied"')));
            check('owner words actually clear sitting and home mode',reply.data?.status==='replied'&&!context.sitting&&!context.homeMode&&context.canMove);
            check('action and original conversation are correlated without claiming arrival',reply.data.observation.actions.length===1&&reply.data.observation.actions[0].goalCompleted===false);
            report.actionId=reply.data.observation.actions[0].operationId;
            check('canonical public reply is displayed once',owner.lines.filter(l=>l.startsWith('[附近·女仆] 隔离肥鱼：')).length===1);
            const before=Object.values(owner.entities).find(e=>e.uuid===fixture.maid)?.position.clone();assert(before);
            await rc(`minecraft:tp ${owner.username} 340.5 90 300.5`);
            await until(()=>Object.values(owner.entities).find(e=>e.uuid===fixture.maid)?.position.distanceTo(before)>2,'actual original companion walking',20000);
            check('native maid physically moves after owner goes beyond 32 blocks',Object.values(owner.entities).find(e=>e.uuid===fixture.maid).position.distanceTo(before)>2);
            await reset(owner);requestedMode='guard';
            const guarded=await talk(owner,'隔离肥鱼，跟我出发，留意周围的敌人。');
            let guardState=(await ask(owner,'context')).data;
            check('guard reuses native companion defence and releases permanent stay',guarded.data.observation.actions[0].mode==='guard'&&guarded.data.observation.actions[0].status==='applied'&&!guardState.sitting&&!guardState.homeMode);
            await reset(owner);
            let offset=requests.length;
            const visitorReply=await talk(visitor);
            check('visitor has no action tools',requests.length===offset+1&&!requests[offset].tools?.length);
            let state=(await ask(owner,'context')).data;
            check('visitor follow request cannot move the owner companion',visitorReply.data?.status==='replied'&&state.sitting&&state.homeMode);
            forceTool=true;
            const rogue=await talk(visitor,'隔离肥鱼，请你跟着我。');forceTool=false;
            check('hallucinated visitor tool call is rejected without execution',rogue.data?.status==='unknown'&&rogue.data.observation.reason==='visitor_tools_refused');
            state=(await ask(owner,'context')).data;check('rejected visitor tool leaves original state unchanged',state.sitting&&state.homeMode);
            await delay(1500);
            requestedMode='invented';const invalid=await talk(owner,'隔离肥鱼，请调整状态。');
            check('invalid mode returns useful real-tool usage with no mutation',invalid.data?.observation?.actions?.[0]?.error==='bad_companion_mode');
            state=(await ask(owner,'context')).data;check('invalid mode retains sitting state',state.sitting&&state.homeMode);
            requestedMode='follow';delayModel=true;
            const at=owner.replies.length;owner.chat('隔离肥鱼，过来这边。');
            await until(()=>releaseModel,'held model response');
            await ask(owner,'stay');delayModel=false;releaseModel();releaseModel=undefined;
            const stale=await until(()=>owner.replies.slice(at).find(r=>r.action==='chat-result'),'stale request closed');
            check('later explicit owner arrangement wins over delayed model action',stale.data.observation.actions[0].error==='companion_arrangement_changed');
            state=(await ask(owner,'context')).data;check('late response cannot cancel a new stay',state.sitting&&state.homeMode);
            await reset(owner);requestedMode='wait';
            const waited=await talk(owner,'隔离肥鱼，在这里稍等一会。');
            check('model wait produces an applied action receipt',waited.data.status==='replied'&&waited.data.observation.actions[0].status==='applied');
            state=(await ask(owner,'context')).data;
            check('temporary wait is visible and has a bounded expiration',state.sitting&&state.homeMode&&state.follow.temporaryWait&&state.follow.waitUntilEpochMillis>Date.now()&&state.follow.waitUntilEpochMillis<Date.now()+61000);
            await rc('minecraft:execute in minecraft:the_nether run minecraft:forceload add 80 80');
            await until(async()=>(await rc('minecraft:execute in minecraft:the_nether if loaded 80 90 80')).includes('Test passed'),'isolated landing loaded');
            await rc('minecraft:execute in minecraft:the_nether run minecraft:fill 77 89 77 84 89 84 minecraft:stone');
            await rc('minecraft:execute in minecraft:the_nether run minecraft:fill 77 90 77 84 93 84 minecraft:air');
            await rc(`minecraft:execute in minecraft:the_nether run minecraft:tp ${owner.username} 80.5 90 80.5`);
            await until(async()=>(await rc(`minecraft:execute as ${fixture.maid} at @s if dimension minecraft:the_nether`)).includes('Test passed'),'short waiting companion travels with partner');
            state=(await ask(owner,'context')).data;
            check('short wait travels with the original partner without becoming permanent stationing',state.maidId===fixture.maid&&state.ownerId===fixture.owner&&state.sitting&&state.follow.temporaryWait&&state.dimension==='minecraft:the_nether');
            await reset(owner);await delay(31000);requestedMode='wait';
            const secondWait=await talk(owner,'隔离肥鱼，在这里稍等一下。');
            check('second wait is a fresh applied decision',secondWait.data.status==='replied'&&secondWait.requestId!==waited.requestId);
            await rc(`minecraft:tp ${owner.username} 370.5 90 300.5`);
            await rc(`minecraft:tp ${fixture.maid} 302.5 90 300.5`);
            const beforeExpiry=requests.length;
            await rc(`minecraft:data modify entity ${fixture.maid} NeoForgeData.qiandengji_companion_wait_until set value 1L`);
            await until(async()=>{
                const current=(await ask(owner,'context')).data;
                return !current.sitting&&!current.homeMode&&!current.follow.temporaryWait;
            },'native expiry restores follow beyond 64 blocks');
            check('wait expires to native follow beyond 64 blocks without opening a model turn',requests.length===beforeExpiry);
            await reset(owner);requestedMode='wait';await talk(owner,'隔离肥鱼，稍等一下。');
            await ask(owner,'stay');state=(await ask(owner,'context')).data;
            check('explicit permanent stay cancels the temporary decision lease',state.sitting&&state.homeMode&&!state.follow.temporaryWait);
            await rc(`minecraft:item replace entity ${fixture.maid} weapon.mainhand with minecraft:air`);
            requestedMode='fish';
            const missing=await talk(owner,'隔离肥鱼，请去水边钓鱼。');
            check('missing rod gives concrete equipment guidance without switching tasks',missing.data.observation.actions[0].error==='fishing_rod_required'&&(await ask(owner,'context')).data.sitting);
            await rc(`minecraft:item replace entity ${fixture.maid} weapon.mainhand with minecraft:fishing_rod`);
            const noSeat=await talk(owner,'隔离肥鱼，拿着鱼竿试试钓鱼。');
            check('no fishing seat yields a concrete condition and leaves current mode intact',noSeat.data.observation.actions[0].error==='fishing_seat_required'&&(await ask(owner,'context')).data.sitting);
            requestedMode='follow';forceSecondTool=true;
            const actionStart=requests.length;
            const forced=await talk(owner,'隔离肥鱼，别再等我了，跟我走。');forceSecondTool=false;
            check('model attempting another tool call stops after one applied action',requests.length===actionStart+2&&forced.data.status==='unknown'&&forced.data.observation.actions.length===1&&forced.data.observation.appliedMode==='follow');
            check('empty or unusable speech preserves a human-readable applied action',owner.lines.some(line=>line.includes('[女仆动作] 已切换为跟随')));
            await delay(31000); // Reconnection must not reset the separate rolling player rate limit.
            owner.quit();await until(async()=>!(await rc('list')).includes(fixture.username),'old fixture connection closed');
            const next=await connect(fixture.username);await reset(next);
            requestedMode=null;
            const first=await talk(next,'隔离肥鱼，我们来谈谈刚才的钓鱼计划。');
            await testDialogueLimit(next,first);
            const quiet=await connect('MaidQuietQA');
            await rc(`minecraft:tp ${quiet.username} 300.5 90 300.5`);
            await talk(quiet,'隔离肥鱼，附近有什么风景？');
            const closed=requests.length;
            quiet.chat('谢谢，回头聊。');await delay(1000);
            quiet.chat('隔离肥鱼，再确认一句。');await delay(1200);
            check('farewell closes the exchange without model or speech',requests.length===closed);
            const silent=await connect('MaidSilentQA');
            await rc(`minecraft:tp ${silent.username} 300.5 90 300.5`);
            mockReply='[[结束]]';
            const ending=await talk(silent,'隔离肥鱼，我们这段话先讲到这里。');
            check('model can end quietly with a terminal receipt and no public speech',ending.data.status==='closed'&&!ending.data.observation.reply&&!silent.lines.some(l=>l.includes('[[结束]]')));
            await rc('minecraft:save-all flush');
        }
    }
}catch(error){report.error=String(error);console.log(report.error);process.exitCode=1;}
finally{releaseModel?.();for(const bot of bots)bot.quit();await new Promise(resolve=>model.close(resolve));report.passed=!report.error&&report.checks.every(x=>x.passed);report.modelCalls=requests.length;await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');await fs.writeFile(reportPath.replace('.json','.requests.json'),JSON.stringify(requests,null,2)+'\n');if(realModel)await fs.writeFile(reportPath.replace('.json','.responses.json'),JSON.stringify(modelResponses,null,2)+'\n');}
