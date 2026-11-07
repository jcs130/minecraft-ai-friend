// Fresh synthetic loopback world only. Never controls a production player or maid.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';
const stage=process.env.MAID_FOLLOW_QA_STAGE,anchor=process.env.MAID_FOLLOW_QA_CLIENT_ANCHOR;
assert(stage&&anchor&&process.env.MAID_FOLLOW_QA_RCON&&process.env.MAID_FOLLOW_QA_REPORT);
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25938$/m.test(props)&&/^rcon.port=25939$/m.test(props));
const {command}=await import(pathToFileURL(process.env.MAID_FOLLOW_QA_RCON));const rc=q=>command(q,15000,{port:25939,properties:stage+'/server.properties'});
const mode=process.argv[2];assert(['baseline','candidate'].includes(mode));
const report={mode,checks:[],productionChanged:false},responses=[],id=randomUUID();let bot,seq=0;
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log(`${ok?'PASS':'FAIL'} ${name}`);};
const until=async(fn,label,ms=25000)=>{for(let end=Date.now()+ms;Date.now()<end;){const x=await fn();if(x)return x;await delay(200);}throw Error('timeout '+label);};
const ints=s=>s.replaceAll('-','').match(/.{8}/g).map(x=>parseInt(x,16)|0).join(',');
async function ask(action,value=''){
 await delay(1100);const request='follow_'+Date.now()+'_'+(++seq),start=responses.length;
 bot.chat(`/qdmaid ${action} ${id} ${request}${value?' '+value:''}`);
 const r=await until(()=>responses.slice(start).find(r=>r.action===action&&r.requestId===request),action);assert(r.ok,'QA command rejected: '+r.error);return r.data;
}
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
try{
 await until(async()=>{try{return (await rc('version QiandengjiMaidBridge')).includes(mode==='baseline'?'0.1.8-life':'0.1.9-follow');}catch{return false;}},'reviewed QA bridge',150000);
 bot=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username:'MaidFollowQA',auth:'offline',hideErrors:true});
 bot.on('error',()=>{});bot.on('messagestr',(s,p)=>{if(p==='system'&&s.startsWith('QD_MAID '))try{responses.push(JSON.parse(s.slice(8)));}catch{}});
 await until(()=>bot.entity,'QA owner');await rc('minecraft:gamemode creative MaidFollowQA');await rc('minecraft:time set 1000');
 await rc('minecraft:forceload add 200 0');await rc('minecraft:fill 194 89 -8 214 96 8 minecraft:air');await rc('minecraft:fill 194 89 -8 214 89 8 minecraft:stone');
 await rc('minecraft:fill 202 92 -3 208 92 3 minecraft:stone');
 for(const [a,b] of [[[199,90,-1],[199,92,1]],[[201,90,-1],[201,92,1]],[[199,90,-1],[201,92,-1]],[[199,90,1],[201,92,1]]])await rc(`minecraft:fill ${a.join(' ')} ${b.join(' ')} minecraft:glass`);
 await rc('minecraft:tp MaidFollowQA 204.5 93 0.5');
 await rc(`minecraft:summon touhou_little_maid:maid 200.5 90 0.5 {UUID:[I;${ints(id)}],Owner:[I;${ints(bot.player.uuid)}],Invulnerable:1b,PersistenceRequired:1b,CustomName:'"SyntheticFollow"'}`);
 await until(()=>Object.values(bot.entities).find(e=>e.uuid===id),'synthetic native maid');await ask('follow');
 await delay(14000);let context=await ask('context');report.pit=context;
 check('follow mode is applied to the original entity',context.sitting===false&&context.homeMode===false&&context.canMove===true);
 check('nearby lower-floor trap recovers using native safe landing',context.position[1]>=93&&context.ownerDistance<4);
 if(mode==='candidate'){
  check('follow context reports the real close-companion policy',context.follow?.policy==='close_idle_companion'&&context.follow?.active===true&&context.follow?.walkBeyond===3);
  await rc('minecraft:fill 194 90 -8 214 96 8 minecraft:air');await rc('minecraft:tp MaidFollowQA 205 90 0.5');await rc(`minecraft:tp ${id} 200.5 90 0.5`);
  const samples=[];await until(async()=>{const c=await ask('context');samples.push(c.position);return c.ownerDistance<3.4;},'native short-distance walking',9000);
  check('native navigation closes a gap smaller than six blocks',samples.at(-1)[0]>201.2);
  check('short-distance walking does not require a teleport',samples.every((p,i)=>i===0||distance(p,samples[i-1])<3));
  await ask('stay');const stopped=await ask('context');await rc('minecraft:tp MaidFollowQA 208 90 0.5');await delay(9500);const stayed=await ask('context');
  check('stay still wins over close following',stayed.sitting===true&&stayed.homeMode===true&&stayed.follow?.active===false&&distance(stopped.position,stayed.position)<.5);
  await ask('follow');await until(async()=>{context=await ask('context');return context.ownerDistance<3.4;},'follow resumes after stay',10000);
  check('a new follow resumes actual original movement',context.sitting===false&&context.follow.active);
  await rc(`minecraft:item replace entity ${id} weapon.mainhand with minecraft:iron_sword`);const catalog=await ask('tasks');
  const work=catalog.tasks.find(t=>t.enabled&&t.id.includes('attack'));assert(work,'Need an observed original attack task');await ask('task',work.id);const working=await ask('context');
  check('native work and combat are not overridden',working.follow?.active===false&&working.follow?.state==='native_work_or_combat');
  await ask('task','touhou_little_maid:idle');await rc(`minecraft:data merge entity ${id} {NoAI:1b}`);await delay(1500);const disabled=await ask('context');
  check('explicitly disabled native AI is respected',disabled.follow?.active===false&&disabled.follow?.state==='movement_paused');await rc(`minecraft:data merge entity ${id} {NoAI:0b}`);
  await rc('minecraft:execute in minecraft:the_nether run minecraft:tp MaidFollowQA 0.5 100 0.5');await delay(1500);const apart=await ask('context');
  check('different dimensions produce guidance without forced cross-world teleport',apart.follow?.active===false&&apart.follow?.state==='different_dimension'&&apart.dimension==='minecraft:overworld'&&!!apart.follow.nextStep);
  report.final=apart;
 }
}catch(e){report.failure=String(e);console.log(report.failure);}
finally{
 if(bot?.entity)try{await rc('minecraft:execute in minecraft:overworld run minecraft:tp MaidFollowQA 205 90 0.5');await rc(`minecraft:kill ${id}`);}catch{}
 try{await rc('minecraft:forceload remove 200 0')}catch{}
 bot?.quit();report.responses=responses;report.pass=!report.failure&&report.checks.every(c=>c.ok);await fs.writeFile(process.env.MAID_FOLLOW_QA_REPORT,JSON.stringify(report,null,2));
 console.log(JSON.stringify({pass:report.pass,checks:report.checks,failure:report.failure}));if(!report.pass)process.exitCode=1;
}
