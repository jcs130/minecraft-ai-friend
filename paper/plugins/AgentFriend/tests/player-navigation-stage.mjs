import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const require=createRequire(process.env.MINEFLAYER_PACKAGE);
const {createBot}=require('mineflayer');
const stage=process.env.PLAYER_NAVIGATION_STAGE,phase=process.env.QA_PHASE;
assert(stage&&['baseline','candidate','restart'].includes(phase));
assert.equal(await readFile(stage+'/.player-navigation-qa','utf8'),'SYNTHETIC_PLAYER_NAVIGATION_ONLY');
const settings=await readFile(stage+'/server.properties','utf8');for(const line of ['server-ip=127.0.0.1','server-port=26461','rcon.port=26462'])assert(settings.split(/\r?\n/).includes(line));
const rc=text=>command(text,20000,{port:26462,properties:stage+'/server.properties'});
const qa=async text=>{const line=await rc('navqa '+text);const m=line.match(/NAV_STATE (\{[^\r\n]+\})/);assert(m,line);return {raw:line,...JSON.parse(m[1])}};
const report={phase,synthetic:true,checks:[]},bots=[];
function check(name,passed){report.checks.push({name,passed:!!passed});console.log(passed?'PASS':'FAIL',name);assert(passed,name)}
async function until(f,name,ms=18000){for(let end=Date.now()+ms;Date.now()<end;){const v=f();if(v)return v;await wait(100)}throw Error('timeout '+name)}
async function spawn(name){const b=createBot({host:'127.0.0.1',port:26461,username:name,auth:'offline',version:'1.21.1',physicsEnabled:false,hideErrors:true});bots.push(b);b.lines=[];b.particles=0;b.on('messagestr',line=>b.lines.push(line));b.on('error',e=>report.errors??=[]);b._client.on('world_particles',p=>{if(p.particle?.type==='end_rod'||JSON.stringify(p).includes('end_rod'))b.particles++});installRecipePacketBypass(b._client);await until(()=>b.entity&&b.player?.uuid,name,45000);return b}
try{
 const actor=await spawn('NavActorQA'),target=await spawn('NavTargetQA');
 const attempt=async()=>{const at=actor.lines.length;actor.chat('/mycli locate tp NavTargetQA');await until(()=>actor.lines.slice(at).some(l=>/已安全抵达|未耗魔|队友附近|传送冷却|传送被/.test(l)),'teleport response');const result=await qa('status');return {...result,lines:actor.lines.slice(at)}};
 for(const kind of ['lobby','trial','site']){
  const before=await qa('setup '+kind);await wait(500);const after=await attempt();report[kind]={before,after};
  if(phase==='baseline'){check(kind+' existing rejection reproduced',after.targetDistance>20&&JSON.stringify(before.position)===JSON.stringify(after.position));continue}
  check(kind+' native CLI arrives by teammate',after.targetDistance>=0&&after.targetDistance<=3);
  check(kind+' mana charged once',before.mana.current-after.mana.current>=7.5&&before.mana.current-after.mana.current<=8.1);
  check(kind+' inventory unchanged',before.inventoryItems===after.inventoryItems);
  if(kind!=='lobby'){
   check(kind+' durable participant',kind==='trial'?after.trial&&after.trialCommitted:after.site);
   const hit=await qa('attack');check(kind+' reinforcement can damage encounter monster',Number(hit.raw.match(/NAV_DAMAGE ([\d.]+)/)?.[1])>0);
  }
  const repeated=await attempt();check(kind+' cooldown prevents duplicate charge',repeated.mana.current>=after.mana.current&&repeated.lines.some(l=>l.includes('冷却')));
 }
 if(phase!=='baseline'){
  await qa('setup trial');await qa('nogear');const before=await qa('status'),denied=await attempt();
  check('missing equipment names the requirements',denied.lines.some(l=>l.includes('equipment_required'))&&denied.lines.some(l=>l.includes('补齐')));
  check('gear rejection has no movement, charge or registration',JSON.stringify(before.position)===JSON.stringify(denied.position)&&denied.mana.current>=before.mana.current&&!denied.trial);
  await qa('setup trial');await qa('cancel true');const b=await qa('status'),c=await attempt();await qa('cancel false');
  check('other-plugin cancellation leaves no participant or charge',JSON.stringify(b.position)===JSON.stringify(c.position)&&c.mana.current>=b.mana.current&&!c.trial);
  await qa('setup site');const storageBefore=await qa('status');await qa('failcommit true');const storageAfter=await attempt();await qa('failcommit false');
  check('uncommitted admission returns to departure without charge or membership',JSON.stringify(storageBefore.position)===JSON.stringify(storageAfter.position)&&storageAfter.mana.current>=storageBefore.mana.current&&!storageAfter.site&&storageAfter.lines.some(l=>l.includes('team_admission_unconfirmed')));
  await qa('setup lobby');await qa('menu');await until(()=>actor.currentWindow,'home menu');
  check('home has directly visible teleport button',actor.currentWindow.slots[28]?.name==='ender_pearl');
  await actor.clickWindow(28,0,0);await wait(900);
  check('travel menu has public, personal, teammate and home entries',[10,13,16,22].every(i=>actor.currentWindow.slots[i]));
  const menu=(await qa('status'));check('browsing teleport menu does not move or spend',menu.position[0]===.5&&menu.mana.current>=19);actor.closeWindow(actor.currentWindow);
  const visitor=await spawn('NavViewerQA'),eye=await spawn('NavEyeQA');
  const p=await qa('particles');check('actual spectator attachment recognized',p.raw.includes('NAV_EYES 1'));
  await wait(1500);check('owner and attached Eye receive guidance',actor.particles>0&&eye.particles>0);check('unrelated player does not receive private guidance',visitor.particles===0);
 }
 report.success=true;
}catch(e){report.error=String(e.stack||e);report.lastLines=bots[0]?.lines.slice(-18);console.error(report.error);process.exitCode=1}
finally{for(const b of bots)b.quit();await writeFile(stage+'/navigation-'+phase+'.json',JSON.stringify(report,null,2));}
