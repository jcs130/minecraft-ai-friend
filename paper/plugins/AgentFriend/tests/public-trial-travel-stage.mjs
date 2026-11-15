import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const {createBot}=createRequire(process.env.MINEFLAYER_PACKAGE)('mineflayer');
const stage=process.env.PLAYER_NAVIGATION_STAGE,phase=process.env.QA_PHASE;
assert(stage&&['baseline','candidate','restart'].includes(phase));
assert.equal(await readFile(stage+'/.player-navigation-qa','utf8'),'SYNTHETIC_PLAYER_NAVIGATION_ONLY');
const settings=await readFile(stage+'/server.properties','utf8');
for(const line of ['server-ip=127.0.0.1','server-port=26461','rcon.port=26462'])assert(settings.split(/\r?\n/).includes(line));
const rc=text=>command(text,20000,{port:26462,properties:stage+'/server.properties'});
const qa=async text=>{const line=await rc('navqa '+text);const m=line.match(/NAV_STATE (\{[^\r\n]+\})/);assert(m,line);return {raw:line,...JSON.parse(m[1])}};
const report={phase,synthetic:true,checks:[]},bots=[];
function check(name,passed){report.checks.push({name,passed:!!passed});console.log(passed?'PASS':'FAIL',name);assert(passed,name)}
async function until(f,name,ms=18000){for(let end=Date.now()+ms;Date.now()<end;){const v=f();if(v)return v;await wait(100)}throw Error('timeout '+name)}
async function spawn(name){const b=createBot({host:'127.0.0.1',port:26461,username:name,auth:'offline',version:'1.21.1',physicsEnabled:false,hideErrors:true});bots.push(b);b.lines=[];b.on('messagestr',l=>b.lines.push(l));b.on('error',()=>{});installRecipePacketBypass(b._client);await until(()=>b.entity&&b.player?.uuid,name,45000);return b}
try{
 const actor=await spawn('NavActorQA');await spawn('NavTargetQA');
 // Starter items arrive 40 ticks after join; let that independent grant finish before snapshotting inventory.
 await wait(3000);
 await qa('freezemana');
 async function attempt(menu=false,double=false){
  const at=actor.lines.length;
  if(menu){
   await qa('menu');await until(()=>actor.currentWindow,'adventure menu');
   await actor.clickWindow(28,0,0);await wait(500);
   await actor.clickWindow(10,0,0);await wait(500);
   check('public menu exposes trial entrance',actor.currentWindow?.slots[13]?.name==='iron_sword');
   await actor.clickWindow(13,0,0);
  }else{actor.chat('/mycli goto arena');if(double)actor.chat('/mycli goto arena')}
  await until(()=>actor.lines.slice(at).some(l=>/MC_TRAVEL target=arena status=(arrived|denied)/.test(l)),'public arrival receipt');
  await wait(300);return {...await qa('status'),lines:actor.lines.slice(at)};
 }
 for(const menu of [false,true]){
  const before=await qa('setup public');await wait(300);const after=await attempt(menu);report[menu?'menu':'command']={before,after};
  if(phase==='baseline'){
   check((menu?'menu':'command')+' reproduces activity_area rejection',after.lines.some(l=>l.includes('reason=activity_area'))&&JSON.stringify(before.position)===JSON.stringify(after.position));
   check('baseline rejection does not spend mana',after.mana.current>=before.mana.current);continue;
  }
  check((menu?'menu':'command')+' physically reaches public platform',after.targetDistance>=0&&after.targetDistance<=3&&after.lines.some(l=>l.includes('status=arrived')));
  check('public arrival charges six mana once',before.mana.current-after.mana.current>=5.5&&before.mana.current-after.mana.current<=6.1);
  check('arrival neither starts nor joins a run',!after.trial&&!after.site);
  check('arrival preserves inventory',before.inventoryItems===after.inventoryItems);
 }
 if(phase!=='baseline'){
  const protection=await qa('entranceprotection');check('building protection remains',protection.raw.includes('NAV_PROTECTED true'));
  const bookmark=await qa('waypointtrial');check('personal bookmarks still cannot bypass combat admission',bookmark.raw.includes('NAV_BOOKMARK activity_area'));
  const bounds=JSON.parse((await qa('entrancebounds')).raw.match(/NAV_BOUNDS (\{[^\r\n]+\})/)[1]);
  check('entrance exception is bounded and excludes personal or shared aliases',bounds.official===false&&['personal','shared','beyondRadius','belowCorridor'].every(k=>bounds[k]===true));
  let before=await qa('setup public');await qa('cancel true');let after=await attempt();await qa('cancel false');
  check('cancelled teleport does not move or charge',JSON.stringify(before.position)===JSON.stringify(after.position)&&after.mana.current>=before.mana.current&&!after.trial);
  before=await qa('setup public');await qa('denyentry true');after=await attempt();await qa('denyentry false');
  check('WorldGuard entry denial remains enforced without charge',after.lines.some(l=>l.includes('reason=protected_entry'))&&JSON.stringify(before.position)===JSON.stringify(after.position)&&after.mana.current>=before.mana.current);
  before=await qa('setup public');after=await attempt(false,true);
  check('in-flight repeated click is busy and charged at most once',after.lines.some(l=>l.includes('reason=busy'))&&before.mana.current-after.mana.current<=6.1&&after.targetDistance<=3);
  before=await qa('setup public');await qa('blockentrance');after=await attempt();
  check('blocked platform is rejected without spending or movement',after.lines.some(l=>l.includes('reason=unsafe_landing'))&&JSON.stringify(before.position)===JSON.stringify(after.position)&&after.mana.current>=before.mana.current);
  await qa('setup public');
 }
 report.success=true;
}catch(e){report.error=String(e.stack||e);report.lastLines=bots[0]?.lines.slice(-20);console.error(report.error);process.exitCode=1}
finally{for(const b of bots)b.quit();await writeFile(stage+'/public-trial-'+phase+'.json',JSON.stringify(report,null,2));}
