import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage=process.env.TRIAL_PLATFORM_STAGE, phase=process.env.QA_PHASE;
assert(stage&&['baseline','candidate','seed','restart'].includes(phase));
assert.equal(await readFile(stage+'/.trial-platform-qa','utf8'),'SYNTHETIC_TRIAL_PLATFORM_ONLY');
const properties=await readFile(stage+'/server.properties','utf8');
for(const line of ['server-ip=127.0.0.1','server-port=26461','rcon.port=26462'])assert(properties.split(/\r?\n/).includes(line));
const {createBot}=createRequire(process.env.MINEFLAYER_PACKAGE)('mineflayer');
const report={phase,synthetic:true,checks:[],cases:[]}, bots=[];
function check(name,passed){report.checks.push({name,passed:!!passed});console.log(passed?'PASS':'FAIL',name);if(phase!=='baseline')assert(passed,name)}
async function until(f,name,ms=15000){for(let end=Date.now()+ms;Date.now()<end;){const value=f();if(value)return value;await wait(100)}throw Error('timeout '+name)}
const rc=text=>command(text,20000,{port:26462,properties:stage+'/server.properties'});
async function qa(action){const text=await rc('platformqa '+action);const m=text.match(/PLATFORM_QA (\{[^\r\n]+\})/);assert(m,text);return JSON.parse(m[1])}
async function spawn(username){const b=createBot({host:'127.0.0.1',port:26461,username,auth:'offline',version:'1.21.1',physicsEnabled:false,hideErrors:true});bots.push(b);b.lines=[];b.on('messagestr',l=>b.lines.push(l));b.on('error',()=>{});installRecipePacketBypass(b._client);await until(()=>b.entity&&b.player?.uuid,username,45000);return b}
try {
 const host=await spawn('PlatformHostQA');await spawn('PlatformMateQA');await spawn('PlatformAwayQA');await wait(3000);
 async function currentRun(){const n=host.lines.length;host.chat('/mycli arena status --json');await until(()=>host.lines.slice(n).some(l=>l.startsWith('MC_TRIAL_STATE ')),'run state');return JSON.parse(host.lines.slice(n).find(l=>l.startsWith('MC_TRIAL_STATE ')).slice('MC_TRIAL_STATE '.length))}
 if(phase==='seed'){
  await qa('near');host.chat('/mycli arena start');await wait(750);
  const state=await qa('status'),run=await currentRun();
  check('normal stop starts with two actual participants',state.active&&state.players.filter(p=>p.participant).length===2&&!!run.run);
  await writeFile(stage+'/trial-platform-restart-expected.json',JSON.stringify({state,run:run.run}));
  await rc('stop');
 }else if(phase==='restart'){
  const expected=JSON.parse(await readFile(stage+'/trial-platform-restart-expected.json','utf8'));
  const state=await qa('status'),run=await currentRun();
  report.restart={expected,actual:state,run:run.run};
  check('same persisted run resumes without another start',state.active&&run.run===expected.run);
  for(const [i,p]of state.players.entries()){
   check(p.name+' original participation preserved',p.participant===expected.state.players[i].participant);
   check(p.name+' original inventory preserved',p.inventory===expected.state.players[i].inventory);
   const original=expected.state.players[i];
   check(p.name+' stays on original floor',p.world===original.world&&Math.abs(p.y-original.y)<1
    &&Math.abs(p.x-original.x)<1&&Math.abs(p.z-original.z)<1);
  }
 }else{
 for(const scenario of phase==='baseline'?['far','missing','redirect']:['far','near','missing','starter-missing','cancel','redirect','all-cancel','other-world','above','outside','spectator','creative','bridge']){
  const before=await qa(scenario);await wait(250);const start=host.lines.length;
  if(scenario==='far'&&phase!=='baseline'){
   host.chat('/mycli arena status --json');await until(()=>host.lines.slice(start).some(l=>l.startsWith('MC_TRIAL_STATE ')),'roster');
   const status=JSON.parse(host.lines.slice(start).find(l=>l.startsWith('MC_TRIAL_STATE ')).slice('MC_TRIAL_STATE '.length));
   check('read-only status includes far platform companion',status.assembly?.members?.some(m=>m.name==='PlatformMateQA'&&m.status==='ready'));
   check('roster query does not start or move players',JSON.stringify(await qa('status'))===JSON.stringify(before));
   await qa('menu');await until(()=>host.currentWindow,'trial menu');
   check('native menu exposes the actual start button',host.currentWindow.slots[16]?.name==='lime_concrete');
   await host.clickWindow(16,0,0);
  }else if(phase==='candidate' && scenario==='starter-missing'){
   await qa('menu');await until(()=>host.currentWindow,'initial menu');await host.clickWindow(16,0,0);
  }else host.chat('/mycli arena start');
  if(phase==='candidate' && ['missing','starter-missing','creative'].includes(scenario)){
   const pending=await until(()=>host.lines.slice(start).find(l=>l.startsWith('MC_TRIAL_ASSEMBLY ')),'entry preview');
   const preview=JSON.parse(pending.slice('MC_TRIAL_ASSEMBLY '.length));
   check(scenario+' first warning leaves everyone and their items in place',!preview.runStarted&&preview.phase==='confirmation_required'
     && JSON.stringify(await qa('status'))===JSON.stringify(before));
   check(scenario+' names the actual member and reason',preview.members.some(m=>m.name===(scenario==='starter-missing'?'PlatformHostQA':'PlatformMateQA')
     && (scenario==='creative'?!m.canEnterOnConfirmation:m.reason==='equipment_missing'&&m.missingEquipment.length>0&&m.canEnterOnConfirmation)));
   if(scenario==='starter-missing'){
    await until(()=>host.currentWindow?.slots[16]?.name==='orange_concrete','controller-accessible confirmation');
    await host.clickWindow(16,0,0);
   }else{
    host.chat('/mycli arena start');await wait(300);
    check(scenario+' repeated unconfirmed command is read-only',!(await qa('status')).active);
    host.chat(preview.nextCommand);
   }
  }
  await wait(1100);const after=await qa('status'),lines=host.lines.slice(start);report.cases.push({scenario,before,after,lines});
  const [a,b,c]=after.players;
  if(['far','near'].includes(scenario)||phase==='candidate'&&['missing','starter-missing'].includes(scenario))check(scenario+' both platform players really join floor one',a.participant&&b.participant&&a.y===69&&b.y===69);
  else if(['starter-missing','all-cancel','bridge'].includes(scenario))check(scenario+' does not start or pull companions',!after.active&&!a.participant&&!b.participant);
  else check(scenario+' rejected or excluded companion is not enrolled',a.participant&&!b.participant&&b.y===before.players[1].y);
  check(scenario+' bridge passerby stays outside',!c.participant&&c.y===before.players[2].y);
  check(scenario+' inventories preserved',after.players.every((p,i)=>p.inventory===before.players[i].inventory));
  if(scenario==='missing')check('initiator sees companion name and concrete missing equipment',lines.some(l=>l.includes('PlatformMateQA')&&l.includes('头盔')&&l.includes('远程')));
  if(scenario==='bridge')check('arrival bridge guidance asks to walk inside, not repeatedly teleport',lines.some(l=>l.includes('穿过入口门')&&l.includes('-590,91,-313')&&!l.includes('/mycli goto arena')));
  if(['cancel','redirect','all-cancel'].includes(scenario))check('initiator receives named transfer failure',lines.some(l=>l.includes('PlatformMateQA')&&l.includes('传送未成功')));
  if(phase!=='baseline'&&['far','near','missing','cancel','redirect','all-cancel'].includes(scenario)){
   const receipt=lines.findLast(l=>l.startsWith('MC_TRIAL_ASSEMBLY '));check('structured assembly outcome returned for '+scenario,!!receipt);
   const parsed=JSON.parse(receipt.slice('MC_TRIAL_ASSEMBLY '.length));check('receipt counts actual arrivals for '+scenario,parsed.enteredCount===after.players.filter(p=>p.participant).length);
  }
  if(scenario==='near'){
   host.chat('/mycli arena start');await wait(350);const again=await qa('status');
   check('repeated start neither moves nor duplicates participants',JSON.stringify(again)===JSON.stringify(after));
  }
 }
 if(phase==='candidate'){
  await qa('missing');
  async function preview(player,cmd){
   const at=player.lines.length;player.chat(cmd);
   const s=await until(()=>player.lines.slice(at).find(l=>l.startsWith('MC_TRIAL_ASSEMBLY ')),'additional preflight');
   return JSON.parse(s.slice('MC_TRIAL_ASSEMBLY '.length));
  }
  const original=await preview(host,'/mycli arena start');
  const outsider=await preview(bots[1],original.nextCommand);
  check('another teammate cannot consume the initiator confirmation',!outsider.runStarted&&outsider.confirmationId!==original.confirmationId);
  await qa('outside');
  const revised=await preview(host,original.nextCommand);
  check('changed party gets fresh confirmation and no teleport',!revised.runStarted&&original.confirmationId!==revised.confirmationId
     &&!revised.members.some(m=>m.name==='PlatformMateQA')&&!(await qa('status')).active);
  const finish=await preview(host,revised.nextCommand);
  check('revised roster admits only players still on the platform',finish.runStarted&&finish.enteredCount===1&&(await qa('status')).players[0].participant);
 }
 }
} finally {
 if(phase!=='seed')try{await qa('cleanup')}catch{}
 for(const bot of bots)bot.quit();
 await writeFile(stage+'/trial-platform-'+phase+'.json',JSON.stringify(report,null,2));
}
