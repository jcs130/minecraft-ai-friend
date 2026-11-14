import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rmdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage=resolve(process.env.TRAVEL_POINT_STAGE), properties=resolve(stage,'server.properties');
assert.equal(await readFile(resolve(stage,'.travel-point-qa'),'utf8'),'SYNTHETIC_TRAVEL_POINT_ONLY');
const settings=await readFile(properties,'utf8');for(const v of ['server-ip=127.0.0.1','server-port=26461','rcon.port=26462'])assert(settings.includes(v));
const {createBot}=createRequire(process.env.MINEFLAYER_PACKAGE)('mineflayer');
const rc=t=>command(t,25000,{port:26462,properties});
const qa=async t=>JSON.parse((await rc('travelpointqa '+t)).split('TRAVEL_POINT_QA ')[1]);
const report={synthetic:true,checks:[]};let bot;
const check=(label,value)=>{report.checks.push({label,passed:!!value});console.log((value?'PASS ':'FAIL ')+label);assert(value,label);};
async function until(f,label,ms=180000){for(const end=Date.now()+ms;Date.now()<end;){let v=await f();if(v)return v;await delay(250);}throw Error('Timeout: '+label);}
const path=resolve(stage,'plugins/AgentFriend/travel-markers-plan.json');
let plan=JSON.parse(await readFile(path,'utf8'));
async function freeze(p){const bytes=JSON.stringify(p);await writeFile(path,bytes);return createHash('sha256').update(bytes).digest('hex');}
async function run(action,hash){const result=await rc(`aftravelmarkers ${action} ${hash}`);assert(result.includes('accepted=true'),result);
 return until(async()=>{const out=await rc(`aftravelmarkers status ${hash}`);const start=out.indexOf('MC_TRAVEL_MARKERS {');if(start<0)return false;
 const data=JSON.parse(out.slice(start+'MC_TRAVEL_MARKERS '.length).split('\n')[0]);return data.finished?data:false;},action);}
try{
 bot=createBot({host:'127.0.0.1',port:26461,username:'TravelPointQA',auth:'offline',version:'1.21.1',physicsEnabled:false,hideErrors:true});
 bot.on('error',error=>report.clientError=error.message);installRecipePacketBypass(bot._client);
 await until(()=>bot.entity&&bot.player?.uuid,'synthetic client',45000);await rc('minecraft:gamemode survival TravelPointQA');
 let hash=await freeze(plan);
 if(process.env.MARKER_RESTART_PLAN){
  const existing=await qa('markerinspect '+plan.markers[0].id);
  if(process.env.MARKER_PARTIAL_RECOVERY==='1')check('normal restart retains a partially restored journal safely',existing.allBefore&&existing.breakProtected);
  else check('normal restart preserves native geometry and protections',existing.allAfter&&existing.waxed&&existing.breakProtected&&existing.explosionProtected);
  const cleaned=await run('rollback',hash);check('restart journal restores exact originals',cleaned.blocked.length===0);
  plan=JSON.parse(await readFile(process.env.MARKER_RESTART_PLAN,'utf8'));hash=await freeze(plan);
 }
 report.audit=await run('audit',hash);await writeFile(resolve(stage,'..','marker-native-audit.json'),JSON.stringify(report.audit,null,2));
 check('every planned marker receives a native safety result',report.audit.checked+report.audit.blocked.length===plan.markers.length);
 // Only the isolated stage may select an accepted subset. Production requires
 // a separately frozen reviewed plan; this script cannot target its ports.
 const rejected=new Set(report.audit.blocked.map(v=>v.id));plan={...plan,markers:plan.markers.filter(m=>!rejected.has(m.id))};
 check('safe marker set is nonempty',plan.markers.length>0);hash=await freeze(plan);
 check('wrong plan digest is refused',(await rc('aftravelmarkers apply '+'0'.repeat(64))).includes('plan_hash_mismatch'));
 const journal=resolve(stage,'plugins/AgentFriend/travel-markers-installed.json');
 // An empty directory occupying the journal path injects a real write failure.
 // Save the empty post-rollback journal elsewhere only inside this synthetic stage.
 const {rename}=await import('node:fs/promises');let oldJournal=false;
 try{await rename(journal,journal+'.fixture-empty');oldJournal=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(journal);const writeFailure=await run('apply',hash);
 check('journal failure prevents any block mutation',writeFailure.checked===0&&writeFailure.blocked.length===1&&(await qa('markerinspect '+plan.markers[0].id)).allBefore);
 await rmdir(journal);if(oldJournal)await rename(journal+'.fixture-empty',journal);
 await rc('minecraft:gamemode creative TravelPointQA');await qa('markeroccupy '+plan.markers[0].id);
 const occupied=await run('apply',hash);
 check('living entity occupancy prevents suffocation and any marker mutation',occupied.checked===0&&occupied.blocked.some(v=>v.reason==='occupied_by_living_entity')&&(await qa('markerinspect '+plan.markers[0].id)).allBefore);
 await qa('markerarrive '+plan.markers[0].id);await rc('minecraft:gamemode survival TravelPointQA');
 if(plan.markers.length>1){
  await rc('minecraft:gamemode creative TravelPointQA');await qa('markeroccupy '+plan.markers[1].id);
  const partial=await run('apply',hash);
  check('later occupied marker stops a partial batch at its durable boundary',partial.checked===1&&partial.blocked.some(v=>v.id===plan.markers[1].id&&v.reason==='occupied_by_living_entity')&&(await qa('markerinspect '+plan.markers[0].id)).allAfter);
  await qa('markerarrive '+plan.markers[0].id);await rc('minecraft:gamemode survival TravelPointQA');
  const restored=await run('rollback',hash);
  check('partial batch rollback skips never-installed markers and restores originals',restored.blocked.length===0&&(await qa('markerinspect '+plan.markers[0].id)).allBefore);
  const replay=await run('rollback',hash);check('completed rollback can be queried or repeated without editing blocks',replay.blocked.length===0&&replay.skipped.length===plan.markers.length);
 }
 report.applied=await run('apply',hash);check('all accepted markers installed',report.applied.blocked.length===0&&report.applied.checked===plan.markers.length);
 const repeated=await run('apply',hash);check('repeat installation is idempotent',repeated.blocked.length===0&&repeated.checked===plan.markers.length);
 const selected=plan.markers.find(m=>m.id==='yellowstone')||plan.markers[0];let observed=await qa('markerarrive '+selected.id);await delay(1000);
 check('native beacon and waxed sign exist',observed.beacon==='BEACON'&&observed.sign==='OAK_WALL_SIGN'&&observed.waxed&&observed.allAfter);
 check('sign contains the actual destination and world',JSON.stringify(observed.signLines)===JSON.stringify(selected.signLines));
 check('break and explosion cannot harvest marker materials',observed.breakProtected&&observed.explosionProtected);
 const Vec3=createRequire(process.env.MINEFLAYER_PACKAGE)('vec3').Vec3;
 await until(()=>bot.blockAt(new Vec3(...observed.signPosition))?.name==='oak_wall_sign','client receives native sign',30000);
 await bot.activateBlock(bot.blockAt(new Vec3(...observed.signPosition)));
 await until(()=>bot.currentWindow,'right click opens existing travel menu',10000);
 check('native interaction opens a menu rather than teleporting',bot.currentWindow.slots[27]?.name==='ender_eye');bot.closeWindow(bot.currentWindow);
 const first=plan.markers[0];await qa('markeralter '+first.id);
 const refused=await run('rollback',hash);check('later construction stops rollback',refused.blocked.some(v=>v.id===first.id&&v.reason==='before_image_changed'));
 await qa('markerunalter '+first.id);
 const rollback=await run('rollback',hash);check('exact rollback completes',rollback.blocked.length===0&&rollback.checked===plan.markers.length);
 check('original blocks restored exactly',(await qa('markerinspect '+selected.id)).allBefore);
 const final=await run('apply',hash);check('clean reinstallation works',!final.uncertain&&final.blocked.length===0);
 report.frozenPlanHash=hash;report.markerCount=plan.markers.length;
}catch(error){report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;}
finally{bot?.quit();await writeFile(resolve(stage,'..','marker-proof.json'),JSON.stringify(report,null,2));}
