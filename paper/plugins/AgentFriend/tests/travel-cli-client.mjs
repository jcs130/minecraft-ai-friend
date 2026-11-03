import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';

const [stage,out,phase,modules,sdkModule]=process.argv.slice(2);
assert(['baseline','candidate','restart','paper'].includes(phase));
assert.equal(await fs.readFile(stage+'/.travel-cli-qa','utf8'),'TRAVEL_CLI_QA_ONLY');
const properties=await fs.readFile(stage+'/server.properties','utf8');
assert.match(properties,/^server-ip=127\.0\.0\.1$/m);
const port=Number(properties.match(/^server-port=(\d+)$/m)?.[1]);
const rcon=Number(properties.match(/^rcon.port=(\d+)$/m)?.[1]);
assert([25988,25990].includes(port)&&rcon===port+1);
const mineflayer=createRequire(modules)('mineflayer');
const bots=[],checks=[],receipts=[];
const rc=text=>command(text,15000,{properties:stage+'/server.properties',port:rcon});
const check=(name,value)=>{assert(value,name);checks.push(name);console.log('PASS '+name);};
async function until(read,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){const value=await read();if(value)return value;await sleep(80);}throw Error('Timeout: '+label);}
async function connect(username){
  const bot=mineflayer.createBot({host:'127.0.0.1',port,username,version:'1.21.1',auth:'offline',hideErrors:true});
  bots.push(bot);bot.lines=[];let spawned=false;
  bot.on('messagestr',text=>bot.lines.push(text));bot.on('spawn',()=>{spawned=true;bot.physicsEnabled=false;});
  bot.on('error',error=>receipts.push({clientError:error.message}));
  installRecipePacketBypass(bot._client);
  await until(()=>spawned,'ordinary client spawn');return bot;
}
async function qa(op,actor='ag_TCA'){
  const text=await rc('travelqa '+op.split(' ')[0]+' '+actor+(op.includes(' ')?' '+op.split(' ').slice(1).join(' '):''));
  const start=text.indexOf('TRAVEL_QA ');assert(start>=0,'fixture reply: '+op);return JSON.parse(text.slice(start+10));
}
let last=0,actor,witness,passed=false;
async function ask(text,prefix,predicate=()=>true){
  await sleep(Math.max(0,1150-(Date.now()-last)));last=Date.now();const start=actor.lines.length,at=Date.now();
  actor.chat(text);
  const result=await until(()=>{
    for(const line of actor.lines.slice(start))if(line.startsWith(prefix)){
      const value=line.slice(prefix.length).trim().startsWith('{')?JSON.parse(line.slice(prefix.length)):line;
      if(predicate(value))return {value,line};
    }
  },text);
  receipts.push({command:text,reply:result.line,elapsedMs:Date.now()-at});return result.value;
}
async function cold(x,z){
  await qa('origin');await sleep(400);await qa('cold '+x+' '+z);
  const state=await until(async()=>{const data=await qa('status');return data.coldProbe.phase==='complete'?data:null;},'real async chunk probe');
  if(phase!=='paper')check('native unloaded async path returns null '+x+','+z,state.coldProbe.returnedNull&&state.coldProbe.error==='');
  else {
    check('Paper async path reads an existing cold chunk '+x+','+z,!state.coldProbe.returnedNull&&state.coldProbe.error==='');
    await until(async()=>{const row=await qa('unload '+x+' '+z);return row.coldProbe.unloaded;},'Paper asynchronous chunk unload',10000);
  }
  return state;
}
const bag=()=>JSON.stringify(actor.inventory.items().map(item=>[item.slot,item.name,item.count,item.nbt??null]));
async function assertNoMove(before,label){const after=await qa('status');check(label+' did not move',JSON.stringify(before.position)===JSON.stringify(after.position));check(label+' did not charge mana',after.mana>=before.mana-.01);}
try{
  actor=await connect('ag_TCA');witness=await connect('ag_TCB');
  await until(async()=>!(await qa('status')).loading,'RPG profile');await qa('setup');await qa('origin','ag_TCB');
  check('ordinary caller is not OP',!(await qa('status')).op);
  if(phase==='baseline'){
    await qa('waypoint');await ask('/mycli waypoint add qa_cold','MC_WAYPOINT_RESULT ',row=>row.action==='add');
    await cold(12,12);let before=await qa('status');
    const point=await ask('/mycli goto personal:qa_cold','MC_WAYPOINT_RESULT ',row=>row.reason!=='loading');
    check('baseline personal cold point reproduces failure',!point.success&&point.reason==='chunk_unavailable');await assertNoMove(before,'baseline personal failure');
    await cold(68,14);before=await qa('status');
    const raw=await ask('/mycli dungeon travel creeping_crypt','遗迹附近地形暂时');
    check('baseline legacy cold approach reproduces failure',raw.includes('无法加载'));await assertNoMove(before,'baseline legacy failure');
    const json=await ask('/mycli dungeon travel creeping_crypt --json','MC_SITE_DUNGEON_RESULT ');
    check('baseline structured legacy travel reproduces rejection',!json.success&&json.reason==='legacy_travel_format_unavailable');
  }else{
    const saved=await ask('/mycli waypoint list','MC_WAYPOINT_LIST ');
    if(phase==='restart')check('personal point survived a normal restart',saved.points.some(point=>point.name==='qa_cold'&&point.available));
    if(!saved.points.some(point=>point.name==='qa_cold')){
      await qa('waypoint');const added=await ask('/mycli waypoint add qa_cold','MC_WAYPOINT_RESULT ',row=>row.action==='add');
      check('fresh comparison world records its own point',added.success);await qa('origin');
    }
    // Starting gifts and the deliberate waypoint setup are not effects of advice.
    await sleep(6000);const initialBag=bag();
    for(const query of ['/mycli teleport ag_TCB --json','/mycli 传送 墓穴 creeping_crypt --json','/mycli waypont list --json','/mycli cast dungeon info creeping_crypt --json']){
      const before=await qa('status');const result=await ask(query,'MC_CLI_ERROR ');
      check('current catalog supplies suggestions: '+query,result.suggestions.length>0&&result.autoExecute===false&&result.changed===false);
      if(query.includes('ag_TCB'))check('real online target retained',result.nextCommand==='/mycli locate tp ag_TCB');
      if(query.includes('墓穴'))check('confirmed dungeon target retained',result.nextCommand==='/mycli dungeon travel creeping_crypt');
      if(query.includes('cast dungeon'))check('cast namespace corrected',result.nextCommand==='/mycli dungeon info creeping_crypt');
      await assertNoMove(before,'advice '+query);
    }
    check('advice kept inventory',bag()===initialBag);
    check('advice was private',!witness.lines.some(line=>line.startsWith('MC_CLI_ERROR ')));
    if(sdkModule){
      const {ServerQueryLane}=await import(sdkModule);const terminals=[];
      const lane=new ServerQueryLane({onTerminal:outcome=>terminals.push(outcome)});
      const generation='isolated-travel-'+phase;let sequence=0,sends=0;
      const listener=text=>lane.receive(text,generation,actor.username,++sequence);
      actor.on('messagestr',listener);
      const definitions=[{id:'known_read_with_wrong_prefix',description:'Isolated negative read-route fixture',
        command:args=>args.length===0?'/mycli cast dungeon info creeping_crypt --json':null,
        matchReply:text=>{
          if(!text.startsWith('MC_CLI_ERROR '))return null;
          const value=JSON.parse(text.slice('MC_CLI_ERROR '.length));
          return value.playerUuid===actor._client.uuid&&value.errorCode==='COMMAND_ROUTE_MISMATCH'?{ok:false,data:value}:null;
        }},{id:'verified_dungeon_info',description:'Read the known fixture dungeon',
        command:args=>args.length===0?'/mycli dungeon info creeping_crypt --json':null,
        matchReply:text=>{
          if(!text.startsWith('MC_SITE_DUNGEON_INFO '))return null;
          const value=JSON.parse(text.slice('MC_SITE_DUNGEON_INFO '.length));
          return value.recipient===actor.username&&value.id==='creeping_crypt'?{ok:true,data:value}:null;
        }}];
      const context=()=>({generation,username:actor.username,afterSequence:sequence,send:text=>{sends++;actor.chat(text);}});
      async function query(id){
        await sleep(Math.max(0,1150-(Date.now()-last)));last=Date.now();
        const sent=lane.call({query:id},definitions,context());
        assert(sent.data.requestId);const result=await until(()=>{
          const found=lane.call({requestId:sent.data.requestId},definitions,context());
          return found.data.phase==='replied'?found:null;
        },'SDK terminal server feedback',4900);
        receipts.push({sdkQuery:id,data:result.data,failed:result.failed??false});return result;
      }
      try{
        const rejected=await query('known_read_with_wrong_prefix');
        check('actual SDK treats matching rejection as terminal failure',rejected.failed===true&&rejected.data.phase==='replied'&&rejected.data.outcomeUnknown===false);
        check('SDK rejection retains the exact corrective command',rejected.data.reply.data.nextCommand==='/mycli dungeon info creeping_crypt');
        check('SDK did not retry or follow the suggested command',sends===1);
        const resolved=await query('verified_dungeon_info');
        check('next deliberate read is accepted after failure',!resolved.failed&&resolved.data.reply.ok===true&&sends===2);
        check('terminal feedback is delivered once per request',terminals.length===2&&terminals.every(value=>value.data.goal_completed===false));
      }finally{actor.off('messagestr',listener);lane.reset('Own isolated test completed');}
    }
    const claim=await ask('/mycli dungeon claim creeping_crypt --json','MC_SITE_DUNGEON_RESULT ');
    check('correct claim reaches business validator, not argument failure',claim.reason==='no_pending_reward');
    await cold(68,14);const before=await qa('status');
    const travel=await ask('/mycli dungeon travel creeping_crypt --json','MC_SITE_DUNGEON_RESULT ');
    check('cold legacy approach supplies final successful receipt',travel.success&&travel.action==='travel');
    let at=await qa('status');check('legacy landing is the actual approach',Math.abs(at.position[1]-1096.5)<=4&&at.position[2]>=90&&Math.abs(at.position[3]-232.5)<=4);
    check('legacy travel charges 8 once',before.mana-at.mana>6.8&&before.mana-at.mana<=8.1);
    await cold(12,12);const wpBefore=await qa('status');
    const wp=await ask('/mycli goto personal:qa_cold','MC_WAYPOINT_RESULT ',row=>row.reason!=='loading');
    check('personal cold point succeeds',wp.success);at=await qa('status');
    check('personal point keeps exact recorded landing',JSON.stringify(at.position)===JSON.stringify(['world',204.5,81,204.5]));
    check('personal point charges 6 once',wpBefore.mana-at.mana>4.8&&wpBefore.mana-at.mana<=6.1);
    await qa('origin');await qa('block yes');let failedBefore=await qa('status');
    const blocked=await ask('/mycli goto personal:qa_cold','MC_WAYPOINT_RESULT ',row=>row.reason!=='loading');
    check('blocked saved point is refused',!blocked.success&&blocked.reason==='unsafe_landing');await assertNoMove(failedBefore,'blocked point');await qa('block no');
    await qa('mana 0');failedBefore=await qa('status');
    const poor=await ask('/mycli dungeon travel creeping_crypt --json','MC_SITE_DUNGEON_RESULT ');
    check('insufficient mana has explicit reason and guidance',!poor.success&&poor.reason==='not_enough_mana'&&poor.errorMessage.includes('8'));
    await assertNoMove(failedBefore,'insufficient mana');
    await qa('origin');
    const formal=await ask('/mycli dungeon travel undead_crypt --json','MC_SITE_DUNGEON_RESULT ');
    check('explicit-entry dungeon travel still works',formal.success);
    await qa('mana 20');const homeBefore=await qa('status');
    await ask('/mycli cast home','MC_TRAVEL id=home');at=await qa('status');
    check('home still reaches the configured safe warp',at.position[0]==='world'&&Math.abs(at.position[1]-48.5)<3&&Math.abs(at.position[3]-48.5)<3);
    check('home charges 6 once',homeBefore.mana-at.mana>4.8&&homeBefore.mana-at.mana<=6.1);
    await qa('waypoint','ag_TCB');await qa('origin');const teamBefore=await qa('status');
    await ask('/mycli locate tp ag_TCB','已安全抵达 ag_TCB');at=await qa('status');
    check('teammate teleport reaches the actual partner',at.position[0]==='world'&&Math.abs(at.position[1]-204.5)<4&&Math.abs(at.position[3]-204.5)<4);
    check('teammate teleport charges 8 once',teamBefore.mana-at.mana>6.8&&teamBefore.mana-at.mana<=8.1);
    check('travel and advice did not modify inventory',bag()===initialBag);
  }
  passed=true;
}finally{
  for(const bot of bots)try{bot.quit();}catch{}
  await sleep(300);try{await rc('minecraft:stop');}catch{}
  await fs.writeFile(out,JSON.stringify({passed,phase,checks,receipts,messages:actor?.lines??[],productionChanged:false,ordinaryClients:bots.length},null,2)+'\n');
}
if(!passed)process.exitCode=1;
