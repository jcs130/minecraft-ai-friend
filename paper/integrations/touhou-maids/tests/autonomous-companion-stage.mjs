import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { command } from '../../../ops/rcon-client.mjs';

const stage=process.cwd();
assert.equal(await readFile('.companion-autonomy-qa','utf8'),'SYNTHETIC_COMPANION_AUTONOMY_ONLY');
const props=await readFile('server.properties','utf8');
for(const line of ['server-ip=127.0.0.1','server-port=26446','rcon.port=26447'])assert.ok(props.split(/\r?\n/).includes(line));
const fixture=JSON.parse(await readFile('fixture.json','utf8'));
assert.ok(fixture.synthetic&&fixture.username==='MaidBrainQA');
const baseline=process.argv.includes('--baseline');
const realModel=process.argv.includes('--real-model');
const liveModel=realModel?JSON.parse(await readFile(process.env.MAID_ACTION_QA_MODEL_CONFIG,'utf8')).qiandengji_cormy_codingplan:null;
if(realModel)assert.ok(liveModel.enabled&&liveModel.url==='http://127.0.0.1:4000/v1/chat/completions'
    &&liveModel.models.includes('codingplan-qwen3.7-plus'));
const {createBot}=createRequire(process.env.MAID_ACTION_QA_CLIENT_ANCHOR)('mineflayer');
const rc=text=>command(text,16000,{port:26447,properties:stage+'/server.properties'});
const mc=text=>rc('minecraft:'+text);
const uuidNbt=id=>[0,8,16,24].map(i=>parseInt(id.replaceAll('-','').slice(i,i+8),16)|0).join(',');
const requests=[],modelCalls=[],checks=[];
let owner,model,seq=0;
const check=(label,value)=>{checks.push({label,passed:!!value});assert.ok(value,label);console.log('PASS '+label);};
async function until(fn,label,ms=20000){
    for(let end=Date.now()+ms;Date.now()<end;){const value=await fn();if(value)return value;await delay(180);}
    throw Error('Timed out: '+label);
}
async function ask(action,value=''){
    const index=owner.replies.length;
    const id='autqa_'+Date.now()+'_'+(++seq);
    await delay(300);
    owner.chat(action==='receipt'?'/qdmaid receipt '+fixture.maid+' '+value+' '+id:
        '/qdmaid '+action+' '+fixture.maid+' '+id+(value?' '+value:''));
    return until(()=>owner.replies.slice(index).find(row=>row.requestId===id),action);
}
const context=async()=>{const row=await ask('context');assert.ok(row.ok);return row.data;};
const health=async()=>Number((await mc('data get entity @e[tag=AutoCombatQa,limit=1] Health')).match(/: ([\d.]+)f/)?.[1]);
try {
    model=http.createServer(async(req,res)=>{
        try{
            let raw='';for await(const part of req)raw+=part;
            const body=JSON.parse(raw);requests.push(body);
            let json;
            if(realModel&&body.messages.at(-1)?.content?.includes('身体实测：')){
                const upstream=await fetch(liveModel.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+liveModel.secret_key},
                    body:JSON.stringify({...body,model:'codingplan-qwen3.7-plus'}),signal:AbortSignal.timeout(55000)});
                if(!upstream.ok){res.writeHead(upstream.status);res.end();return;}
                json=await upstream.json();
                modelCalls.push({id:json.id,model:json.model,choices:json.choices.map(row=>row.message?.tool_calls??[])});
            }else{
                const offered=body.tools?.find(tool=>tool.function?.name==='set_companion_mode');
                const message=offered?{role:'assistant',content:null,tool_calls:[{id:'qa_mode_'+requests.length,type:'function',
                    function:{name:'set_companion_mode',arguments:JSON.stringify({mode:'wait'})}}]}:
                    {role:'assistant',content:'[[结束]]'};
                json={id:'qa-companion-'+requests.length,object:'chat.completion',model:'qa-native',choices:[{index:0,message,
                    finish_reason:offered?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
            }
            res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(json));
        }catch{res.writeHead(502);res.end();}
    });
    await new Promise((resolve,reject)=>{model.once('error',reject);model.listen(26448,'127.0.0.1',resolve);});
    owner=createBot({host:'127.0.0.1',port:26446,version:'1.21.1',username:fixture.username,auth:'offline',hideErrors:true,physicsEnabled:false});
    owner.on('error',()=>{});owner.replies=[];
    owner._client.on('custom_payload',p=>{if(p.channel==='qiandengji:maids')try{owner.replies.push(JSON.parse(p.data.toString()));}catch{}});
    await until(()=>owner.entity&&owner.player?.uuid,'original synthetic owner');
    assert.equal(owner.player.uuid,fixture.owner);
    owner._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:maids')});
    for(const text of ['gamerule doMobSpawning false','gamerule doDaylightCycle false','time set 16000','weather clear',
        'forceload add 295 295 312 312','fill 295 89 295 312 89 312 stone','fill 295 90 295 312 92 312 air',
        'gamemode survival '+fixture.username,'effect give '+fixture.username+' resistance 60 4 true',
        'tp '+fixture.username+' 300.5 90 300.5'])await mc(text);
    if(!(await mc('data get entity '+fixture.maid+' Pos')).includes('entity data:')){
        await mc('summon touhou_little_maid:maid 302.5 90 300.5 {UUID:[I;'+uuidNbt(fixture.maid)+'],Owner:[I;'
            +uuidNbt(fixture.owner)+'],CustomName:\'"AutonomyQA"\',PersistenceRequired:1b,Invulnerable:1b}');
    }else{
        await mc('tp '+fixture.maid+' 302.5 90 300.5');
        await mc('data modify entity '+fixture.maid+' CustomName set value \'"AutonomyQA"\'');
    }
    await until(async()=>(await mc('data get entity '+fixture.maid+' Health')).includes('entity data:'),'maid loaded');
    await mc('data modify entity '+fixture.maid+' NeoForgeData.qiandengji_follow set value {schemaVersion:1,walkDistance:32,stopDistance:16,returnDistance:64}');
    assert.match(await rc('qdmaid guard-starter '+fixture.maid+' '+fixture.owner),/mage_apprentice_staff/);
    await ask('brain','native');
    await ask('follow');
    // A real prior model tool establishes the temporary wait. No player command
    // changes companion mode between the hostile spawn and the autonomous result.
    const beforeWait=owner.replies.length;
    owner.chat('AutonomyQA，先在这里歇一会儿。');
    const wait=await until(()=>owner.replies.slice(beforeWait).find(row=>row.action==='chat-result'
        &&row.data?.observation?.appliedMode==='wait'),'initial model wait');
    check('initial temporary wait is an actual action',wait.data.observation.actions[0].status==='applied'&&(await context()).sitting);
    await mc('summon minecraft:zombie 305.5 90 300.5 {Tags:["AutoCombatQa","MaidMagicTargetQA"],PersistenceRequired:1b,Silent:1b,CanPickUpLoot:0b}');
    await rc('maidvortexqa target '+fixture.maid);
    check('real native hostile starts with full health',await health()===80);
    if(baseline){
        await delay(11500);
        check('baseline does not request an autonomous decision or attack while waiting',
            !requests.some(row=>row.messages.at(-1)?.content?.includes('身体实测：'))&&(await context()).sitting&&await health()===80);
    }else{
        await until(()=>requests.find(row=>row.messages.at(-1)?.content?.includes('身体实测：')),'unsolicited model turn',22000);
        const decision=await until(async()=>{
            const log=await readFile('logs/latest.log','utf8');
            return log.match(/Companion decision maid=[^ ]+ request=(autonomy_[\w-]+) mode=guard result=applied/)?.[1];
        },'model applies autonomous guard',65000);
        check('configured real model selects guard through the action tool',realModel&&modelCalls.some(row=>
            row.choices.some(calls=>calls.some(call=>call.function?.name==='set_companion_mode'&&JSON.parse(call.function.arguments).mode==='guard'))));
        const receipt=await ask('receipt',decision);
        check('original autonomous receipt binds the action and exact body',receipt.ok&&receipt.data.maidId===fixture.maid
            &&receipt.data.observation.initiatedBy==='maid'&&receipt.data.observation.actions[0].mode==='guard'
            &&receipt.data.observation.actions[0].status==='applied');
        const state=await context();
        check('native body exits wait and activates explicit guard',state.maidId===fixture.maid&&!state.sitting&&!state.homeMode&&state.companion.explicitGuard);
        const hit=await until(async()=>{
            const observed=await context();
            return observed.companion.rpg?.lastHitSpellId==='arcane_bolt'&&observed;
        },'same companion casts Vortex spell');
        check('the same maid actually hits the hostile with Vortex magic',hit.maidId===fixture.maid&&await health()<80);
        await delay(500);
        check('autonomous action uses one inference and does not post a conversation',
            modelCalls.length===1&&!owner.replies.some(row=>row.requestId===decision&&row.action==='chat-result'));
    }
    await writeFile('autonomous-companion.proof.json',JSON.stringify({checks,baseline,realModel,modelCalls},null,2));
}finally{
    owner?.quit();
    model?.close();
}
