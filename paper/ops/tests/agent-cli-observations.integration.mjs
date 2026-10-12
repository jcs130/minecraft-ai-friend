// Real Paper/Mineflayer observations and native Minepacks. Auth file rows are explicit
// operator fixtures, not claims that this test performed official premium login.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../rcon-client.mjs';
import {fix1206PotionProtocol} from '../minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../mineflayer-client-compat.mjs';
import {installInventorySession} from '../mineflayer-inventory-session.mjs';
const stage=process.env.MC_STAGE_PAPER,root=process.env.MC_TEST_REPORT_DIR;
assert(stage&&root&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
const port=Number(props.match(/^server-port=(\d+)/m)?.[1]);assert.equal(port,25660);
const rcon=q=>command(q,15000,{properties:stage+'/server.properties',port:Number(props.match(/^rcon.port=(\d+)/m)?.[1])});
const require=createRequire(process.env.MF_REQUIRE_FROM??'E:/MC/research/mineflayer-client-fixes-20261011/package.json');
fix1206PotionProtocol(require);const mf=require('mineflayer');
const label=process.argv[2]??'a';assert.match(label,/^[a-z0-9]{1,4}$/);
const version=process.env.MC_TEST_AGENTFRIEND_VERSION??'0.4.31';assert.match(version,/^0\.4\.\d+$/);
const report={at:new Date().toISOString(),scope:'isolated real Paper '+version+', MF 4.39; auth file fixtures; no LLM/device acceptance',checks:[],receipts:[],errors:[]};
report.candidateSha256=createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-'+version+'.jar')).digest('hex');
const clients=[];let closing=false;
const check=(name,value)=>{report.checks.push({name,pass:!!value});assert(value,name);console.log('PASS '+name);};
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function until(fn,name,ms=15000){const end=Date.now()+ms;while(Date.now()<end){const v=fn();if(v)return v;await sleep(40);}throw Error('Timeout '+name);}
async function join(name){const bot=mf.createBot({host:'127.0.0.1',port,username:name,version:'1.20.6',auth:'offline',defaultChatPatterns:false,logErrors:false});installRecipePacketBypass(bot._client);
  const c={name,bot,lines:[]};clients.push(c);bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>{if(!closing)report.errors.push(e.stack);});
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('spawn '+name)),30000);bot.once('spawn',()=>{clearTimeout(t);bot.physicsEnabled=false;resolve();});bot.once('error',reject);bot.once('kicked',p=>reject(Error(JSON.stringify(p))));});
  await sleep(3800);return c;
}
async function ask(c,q,prefix,test=()=>true){await sleep(1100);const at=c.lines.length;c.bot.chat(q);
  return until(()=>c.lines.slice(at).filter(s=>s.startsWith(prefix+' ')).map(s=>JSON.parse(s.slice(prefix.length+1))).find(test),q);}
const paged=async(c,q)=>{let page=await ask(c,q,'MC_PAGE');const pages=[page],id=page.snapshotId;
  while(page.nextCommand){page=await ask(c,page.nextCommand,'MC_PAGE');assert.equal(page.snapshotId,id);pages.push(page);}
  const rows=[],fragments=new Map();
  for(const p of pages)for(const row of p.items){if(row.encoding==='summary')continue;if(row.encoding==='json_fragment'){
    const parts=fragments.get(row.itemIndex)??[];assert.equal(row.part,parts.length+1);parts.push(row.data);fragments.set(row.itemIndex,parts);
    if(parts.length===row.parts)rows.push(JSON.parse(parts.join('')));
  }else rows.push(row);}
  check('paged '+q+' has complete totals and stable snapshot',rows.length===pages[0].total&&pages.length===pages[0].pages);return {rows,pages};
};
try{
  check('candidate version active only in isolated server',(await rcon('version AgentFriend')).includes(version));
  const c=await join('ag_Cli29'+label.toUpperCase());await rcon('minecraft:effect give '+c.name+' minecraft:regeneration 120 10 true');
  check('automatic guidance is one short guide plus one current state',c.lines.filter(s=>s.startsWith('MC_GUIDE ')).length===1&&c.lines.filter(s=>s.startsWith('MC_STATUS ')).length===1&&!c.lines.some(s=>/^MC_INTRO |^MC_COACH .*"type":"welcome"/.test(s)));
  const state=await ask(c,'/mycli status','MC_STATUS');report.sessionId=state.sessionId;
  check('universal status is current private read-only observation',state.readOnly&&state.playerUuid===c.bot.player.uuid&&state.observedAt<=Date.now()&&state.sessionId&&state.profession.available&&state.maxHealth>0&&state.progressCommand==='/mycli progress all 1');
  check('missing auth producer is unknown, not denied or allowed',state.authentication.status==='unknown'&&state.authentication.authorized===null);
  const json=await ask(c,'/mycli status --json','MC_STATUS');check('json status keeps session and increases sequence',json.sessionId===state.sessionId&&json.sequence>state.sequence);
  const detail=await ask(c,'/mycli skills learn fireworks --help','MC_CLI_DETAIL');check('standard help exposes intended action without performing it',detail.id==='skills.learn'&&detail.discoveryReadOnly);
  const invalid=await ask(c,'/mycli cast fireworks --json','MC_QUERY_ERROR');check('unsupported json format never silently dispatches action',invalid.errorCode==='UNSUPPORTED_FORMAT'&&!invalid.retryable);
  const unknownCooldown=await paged(c,'/mycli skills status give');
  check('unselected give recipe preserves unknown cooldown without unboxing null',unknownCooldown.rows.length===1&&unknownCooldown.rows[0].id==='give'&&unknownCooldown.rows[0].cooldownRemainingMs===null);
  const allSkills=await paged(c,'/mycli skills status all 1');
  check('all-skills pagination includes nullable base cooldown and profession skills',allSkills.rows.some(s=>s.id==='give'&&s.cooldownRemainingMs===null)&&allSkills.rows.some(s=>s.id==='sword_thrust')&&allSkills.pages.every(p=>p.readOnly));
  const skill=await paged(c,'/mycli skills status fireworks');check('supported unlocked and learned are distinct',skill.rows[0].supported&&skill.rows[0].unlocked&&!skill.rows[0].learned&&skill.rows[0].canUseNow===false);
  const pdc=await rcon('minecraft:data get entity '+c.name+' BukkitValues');
  const ledgers=['config.yml','profession-ledger.json','world-life-ledger.yml'];const before=ledgers.map(n=>hash(stage+'/plugins/AgentFriend/'+n));
  await ask(c,'/mycli status','MC_STATUS');const progress=await paged(c,'/mycli progress all 1');await paged(c,'/mycli skills status fireworks');
  check('all three progress domains and mainline graduation distinct',new Set(progress.rows.map(r=>r.section)).size===3&&progress.rows.find(r=>r.section==='main').graduated===false);
  check('status, progress and skill observations leave PDC and ledgers unchanged',pdc===await rcon('minecraft:data get entity '+c.name+' BukkitValues')&&ledgers.every((n,i)=>before[i]===hash(stage+'/plugins/AgentFriend/'+n)));
  const stranger=await join('ag_CliOther'+label.toUpperCase());const foreign=await ask(stranger,'/mycli page '+progress.pages[0].snapshotId+' 1','MC_QUERY_ERROR');check('another connection cannot read private cached detail',foreign.errorCode==='SNAPSHOT_EXPIRED');
  const eye=await join(c.name+'_eye');await until(()=>eye.bot.game.gameMode==='spectator','attached Eye');const eyeAt=eye.lines.length,strangerAt=stranger.lines.length;
  await ask(c,'/mycli status','MC_STATUS');await until(()=>eye.lines.slice(eyeAt).some(s=>s.startsWith('MC_STATUS ')&&JSON.parse(s.slice(10)).playerUuid===c.bot.player.uuid),'body status mirrored only to attached Eye');
  check('status reaches actual attached Eye but not strangers',!stranger.lines.slice(strangerAt).some(s=>s.startsWith('MC_STATUS ')&&JSON.parse(s.slice(10)).playerUuid===c.bot.player.uuid));
  const authPath=path.resolve(stage,'../ops/auth-observations.json');const now=Date.now();
  const observation={schemaVersion:1,source:'login_guard',playerUuid:c.bot.player.uuid,authSessionId:randomUUID(),observedAt:now,status:'authenticated',authorized:true,passwordSet:true,method:'login',readOnly:true};
  fs.writeFileSync(authPath,JSON.stringify({ready:true,at:now,sessionStates:[observation]}));
  check('current trusted local auth fixture is observed',(await ask(c,'/mycli status','MC_STATUS')).authentication.authorized===true);
  fs.writeFileSync(authPath,JSON.stringify({ready:true,at:Date.now(),sessionStates:[{...observation,observedAt:now-60000}]}));
  const stale=await ask(c,'/mycli status','MC_STATUS');check('old-session authentication cannot override current connection',stale.authentication.authorized===null&&stale.authentication.status==='unknown');
  c.bot._client.write('custom_payload',{channel:'mcagent:auth',data:Buffer.from(JSON.stringify({...observation,observedAt:Date.now()}))});
  check('client plugin-message claims cannot forge authentication',(await ask(c,'/mycli status','MC_STATUS')).authentication.authorized===null);
  const enrolled=await ask(c,'/mycli coach enroll','MC_COACH',r=>r.type==='feature_enrollment');check('explicit enrollment still works',enrolled.enrolled&&enrolled.status==='success');
  const enrolledPdc=await rcon('minecraft:data get entity '+c.name+' BukkitValues');await ask(c,'/mycli status','MC_STATUS');
  check('ordinary status does not secretly complete enrolled practice',enrolledPdc===await rcon('minecraft:data get entity '+c.name+' BukkitValues'));
  const proof=await ask(c,'/mycli coach practice status','MC_COACH',r=>r.type==='feature_proof');check('explicit status practice records real separate proof',proof.lesson==='cli_status');
  const bought=await ask(c,'/mycli skills learn fireworks','MC_PROFESSION_RESULT');check('explicit skill learning succeeds through original gate',bought.success);
  const learnt=(await paged(c,'/mycli skills status fireworks')).rows[0];check('learned cosmetic shows actual cost and known readiness',learnt.learned&&learnt.manaCost===1&&learnt.canUseNow===true&&learnt.cooldownRemainingMs===0);
  c.bot.chat('/mycli cast fireworks');await sleep(200);const cooling=(await paged(c,'/mycli skills status fireworks')).rows[0];check('successful cast shows real positive cooldown',cooling.cooldownRemainingMs>0&&cooling.canUseNow===false&&cooling.reason==='cooldown');
  await rcon('minecraft:give '+c.name+' paper 8');const inventory=installInventorySession(c.bot,{Item:require('prismarine-item')(c.bot.registry),timeoutMs:5000,quietMs:100,onReceipt:r=>report.receipts.push(r)});
  const opened=await inventory.open();check('own 54-slot Minepacks still opens',opened.status==='opened'&&opened.snapshot.inventoryStart===54);
  const source=opened.snapshot.slots.findIndex((item,n)=>n>=54&&item?.name==='paper');assert(source>=54);
  const put=await inventory.transfer({operationId:'put-'+label,direction:'deposit',slot:source,count:8});check('deposit confirmed by actual server slots with empty cursor',put.status==='confirmed'&&put.after.cursor===null);await inventory.close();
  const reopened=await inventory.open();const slot=reopened.snapshot.slots.findIndex((item,n)=>n<54&&item?.name==='paper');assert(slot>=0);
  const take=await inventory.transfer({operationId:'take-'+label,direction:'withdraw',slot,count:8});check('reopen and withdraw confirmed without item loss',take.status==='confirmed'&&take.after.cursor===null);await inventory.close();
  check('native client inventory has exactly eight returned paper',c.bot.inventory.items().filter(i=>i.name==='paper').reduce((n,i)=>n+i.count,0)===8);
  const old=await ask(c,'/mycli progress','MC_PROGRESS');check('legacy progress stream remains available',old.readOnly&&old.progress&&old.pages>1);
  const snap=await ask(c,'/mycli progress main 1','MC_PAGE');const oldSession=(await ask(c,'/mycli status','MC_STATUS')).sessionId;
  c.bot.quit();await sleep(1200);const reconnected=await join(c.name);const next=await ask(reconnected,'/mycli status','MC_STATUS');
  check('reconnect starts a new server observation session',next.sessionId!==oldSession);const expired=await ask(reconnected,'/mycli page '+snap.snapshotId+' 1','MC_QUERY_ERROR');check('old cache is never reused after reconnect',expired.errorCode==='SNAPSHOT_EXPIRED'&&expired.nextCommand==='/mycli status');
  check('all structured replies fit messagestr limit',clients.every(c=>c.lines.filter(s=>/^MC_(STATUS|GUIDE|PAGE|QUERY_ERROR|CLI_)/.test(s)).every(s=>s.length<4000)));
  check('native protocol has no errors',report.errors.length===0);
}catch(error){report.errors.push(error.stack??String(error));}
finally{closing=true;for(const c of clients){report[c.name]={uuid:c.bot.player?.uuid,lines:c.lines};c.bot.quit();}await sleep(500);
  report.passed=report.errors.length===0&&report.checks.every(r=>r.pass);fs.writeFileSync(root+'/observations-'+label+'.json',JSON.stringify(report,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));process.exit(report.passed?0:1);}
