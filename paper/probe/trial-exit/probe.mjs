import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';

const stage=resolve(process.env.TRIAL_EXIT_STAGE), phase=process.argv[2];
assert.equal(await readFile(resolve(stage,'.trial-exit-qa'),'utf8'),'SYNTHETIC_TRIAL_EXIT_ONLY');
const properties=resolve(stage,'server.properties');
const props=await readFile(properties,'utf8');
for(const setting of ['server-ip=127.0.0.1','server-port=26461','rcon.port=26462'])assert(props.includes(setting));
const {createBot}=createRequire(process.env.MINEFLAYER_PACKAGE)('mineflayer');
const bots=[],report={phase,checks:[]};
const rc=text=>command(text,12000,{port:26462,properties});
const qa=async text=>JSON.parse((await rc('trialexitqa '+text)).split('TRIAL_EXIT_QA ')[1]);
const check=(label,value)=>{report.checks.push({label,passed:Boolean(value)});console.log((value?'PASS ':'FAIL ')+label);assert(value,label);};
async function until(fn,label,ms=16000){for(const end=Date.now()+ms;Date.now()<end;){const value=await fn();if(value)return value;await delay(300);}throw Error('Timeout: '+label);}
async function connect(username){
 const bot=createBot({host:'127.0.0.1',port:26461,username,auth:'offline',version:'1.21.1',physicsEnabled:false,hideErrors:true});
 bots.push(bot);bot.lines=[];bot.on('messagestr',line=>bot.lines.push(line));bot.on('error',()=>{});
 installRecipePacketBypass(bot._client);
 await until(()=>bot.entity&&bot.player?.uuid,username,45000);return bot;
}
const nearEntrance=p=>p?.world==='world'&&Math.hypot(p.position[0]+589.5,p.position[1]-91,p.position[2]+321.5)<2;
const arrived=p=>nearEntrance(p)&&p.outcome?.returnPending===false&&p.outcome?.returnStatus==='arrived';
const snapshot=()=>qa('snapshot');
async function pending(name){return until(async()=>{const s=await snapshot();return s.players[name]?.outcome?.returnPending&&s;},'pending '+name);}
async function returned(names){return until(async()=>{const s=await snapshot();return names.every(n=>arrived(s.players[n]))&&s;},'return '+names);}
try {
 if(phase==='final-smoke'){
   await connect('TrialExitQA');
   check('final package loaded',(await rc('version AgentFriend')).includes('0.4.47.76-trial-return'));
   await qa('seed 15 TrialExitQA');await qa('clear');await returned(['TrialExitQA']);
   check('final package returns an actual winner',true);
   const before=(await snapshot()).players.TrialExitQA.rewards;
   await qa('restore-old-clear TrialExitQA');const s=await returned(['TrialExitQA']);
   check('completed final checkpoint survives more than the reconnect grace',arrived(s.players.TrialExitQA));
   check('old completed checkpoint does not replay rewards',JSON.stringify(before)===JSON.stringify(s.players.TrialExitQA.rewards));
 }else if(phase==='restart'){
   const a=await connect('TrialExitQA');
   await qa('unblock');
   const s=await returned(['TrialExitQA']);
   check('pending return survives normal server restart',arrived(s.players.TrialExitQA));
   check('restart preserves the already completed outcome',s.players.TrialExitQA.outcome.status==='completed');
   const seed=JSON.parse(await readFile(resolve(stage,'restart-expected.json'),'utf8'));
   check('restart does not credit rewards again',JSON.stringify(s.players.TrialExitQA.rewards)===JSON.stringify(seed.rewards));
 } else if(phase==='cleared-restart') {
   const a=await connect('TrialExitQA');
   const s=await returned(['TrialExitQA']);
   check('durable final clear resumes as a win and automatically returns',arrived(s.players.TrialExitQA)&&!s.active);
   const seed=JSON.parse(await readFile(resolve(stage,'clear-expected.json'),'utf8'));
   check('durable final clear never replays rewards',JSON.stringify(s.players.TrialExitQA.rewards)===JSON.stringify(seed.rewards));
 } else {
  let a=await connect('TrialExitQA'); const b=await connect('TrialExitQB'), eye=await connect('TrialExitEye');
  await rc('minecraft:gamemode spectator TrialExitEye');
  await rc('minecraft:tp TrialExitEye -349.5 10 -304.5');
  const eyeBefore=(await snapshot()).players.TrialExitEye.position;
  await qa('seed 15 TrialExitQA,TrialExitQB');
  const final=await qa('clear');
  await delay(1300);
  const result=await snapshot();
  if(phase==='baseline'){
   check('baseline reproduces completed party stranded in final room',!result.active&&result.players.TrialExitQA.outcome?.status==='completed'&&!nearEntrance(result.players.TrialExitQA)&&!nearEntrance(result.players.TrialExitQB));
   report.observed=result;
  }else{
   const s=await returned(['TrialExitQA','TrialExitQB']);
   check('every final-floor participant automatically reaches entrance',arrived(s.players.TrialExitQA)&&arrived(s.players.TrialExitQB));
   check('spectator is not teleported',JSON.stringify(s.players.TrialExitEye.position)===JSON.stringify(eyeBefore));
   check('win has individual completed receipts',s.players.TrialExitQA.outcome.status==='completed'&&s.players.TrialExitQB.outcome.status==='completed');
   check('return has native client feedback',a.lines.some(x=>x.startsWith('MC_TRIAL_RETURN ')));
   const rewards=JSON.stringify(s.players.TrialExitQA.rewards);
   await qa('won'); await qa('retry');
   check('duplicate finish/retry never credits again',JSON.stringify((await snapshot()).players.TrialExitQA.rewards)===rewards);

   await qa('seed 14 TrialExitQA');await qa('clear');
   const intermediate=await snapshot();
   check('intermediate clear keeps the player in the tower',intermediate.active&&intermediate.cleared&&!nearEntrance(intermediate.players.TrialExitQA));
   await qa('failed');
   check('failed outcomes do not become wins or pending victory returns',(await snapshot()).players.TrialExitQA.outcome.outcome==='failed');

   await qa('seed 15 TrialExitQA');await qa('hold TrialExitQA');await qa('won');
   const blocked=await pending('TrialExitQA');
   check('cancelled teleport keeps a durable pending return',!nearEntrance(blocked.players.TrialExitQA));
   a.chat('/mycli arena status --json');await delay(1300);
   check('pending return guidance does not tell agents to start again',a.lines.some(x=>x.includes('return_pending')&&x.includes('/mycli arena leave')));
   await qa('release');await returned(['TrialExitQA']);
   check('cancelled teleport retries after the blocker clears',true);

   await qa('seed 15 TrialExitQA');await qa('block');await qa('won');
   check('obstructed entrance is never used',!nearEntrance((await pending('TrialExitQA')).players.TrialExitQA));
   a.quit();await delay(1000);await qa('unblock');a=await connect('TrialExitQA');await returned(['TrialExitQA']);
   check('disconnect and reconnect completes the original return',true);

   await qa('seed 15 TrialExitQA');await qa('hold TrialExitQA');await qa('won');await pending('TrialExitQA');
   const save=await qa('save-failure TrialExitQA');
   check('position-save failure retains durable return marker',nearEntrance(save.players.TrialExitQA)&&save.players.TrialExitQA.outcome.returnPending);
   await returned(['TrialExitQA']);check('position-save retry finishes without another reward',true);

   await qa('seed 15 TrialExitQA');await qa('hold TrialExitQA');await qa('won');await pending('TrialExitQA');
   await rc('minecraft:tp TrialExitQA 30 100 30');await qa('release');
   const left=await until(async()=>{const r=await snapshot();return r.players.TrialExitQA.outcome.returnStatus==='left_independently'&&r;},'independent departure');
   check('does not yank players who already left the tower',Math.abs(left.players.TrialExitQA.position[0]-30)<1&&!nearEntrance(left.players.TrialExitQA));

   const owner=await connect('MaidBrainQA');
   const fixture=JSON.parse(await readFile(resolve(stage,'fixture.json'),'utf8'));
   await qa('seed 15 MaidBrainQA');await qa('hold MaidBrainQA');
   await rc(`minecraft:tp ${fixture.maid} -348.5 9 -304.5`);
   owner.chat('/qdmaid follow '+fixture.maid+' trialExitFollow');await delay(1200);
   await qa('release');await returned(['MaidBrainQA']);
   await until(async()=>{
     const pos=(await rc('minecraft:data get entity '+fixture.maid+' Pos')).match(/-?\d+(?:\.\d+)?(?=d)/g)?.map(Number);
     return pos&&Math.hypot(pos[0]+589.5,pos[1]-91,pos[2]+321.5)<8;
   },'original synthetic native companion return',18000);
   check('original native maid follows the winner to the entrance',true);

   await qa('seed 15 TrialExitQA');await qa('block');await qa('won');
   const beforeRestart=(await pending('TrialExitQA')).players.TrialExitQA;
   await writeFile(resolve(stage,'restart-expected.json'),JSON.stringify(beforeRestart));
   check('return marker ready for a real restart check',true);
  }
 }
 if(phase==='restart'){
   await qa('seed 15 TrialExitQA');await qa('persist-clear');
   await writeFile(resolve(stage,'clear-expected.json'),JSON.stringify((await snapshot()).players.TrialExitQA));
 }
}finally{
 await writeFile(resolve(stage,'trial-exit-'+phase+'.json'),JSON.stringify(report,null,2));
 // Let chunks requested by the last synthetic teleport finish loading before
 // disconnect/stop; otherwise Youer's unload queue can spin during shutdown.
 await delay(4000);
 await rc('minecraft:save-all flush');
 for(const bot of bots)bot.quit();
 await delay(4000);
}
