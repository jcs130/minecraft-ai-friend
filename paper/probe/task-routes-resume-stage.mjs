// Read-only cold-start verification; the corresponding main probe must have passed.
import fs from 'node:fs';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{createHash}from'node:crypto';import{setTimeout as sleep}from'node:timers/promises';
const root='E:/MC/research/paper-task-routes-20261015',stage=root+'/stage',attempt=process.argv[2]??'J';assert.match(attempt,/^[A-Z][0-9]?$/);
const original=JSON.parse(fs.readFileSync(root+'/task-routes-'+attempt+'.json','utf8'));assert(original.passed&&original.resume);
const output=root+'/resume-'+attempt+'.json';assert(!fs.existsSync(output));
const props=fs.readFileSync(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25840\r?$/m);assert.match(props,/^motd=TASK_ROUTES_ISOLATED_20261015\r?$/m);
const req=createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json'),y=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const report={at:new Date().toISOString(),checks:[],errors:[],productionModified:false,candidateSha256:createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.42.jar')).digest('hex')},bots=[];let closing=false;
const check=(name,value)=>{assert(value,name);report.checks.push(name);console.log('PASS '+name)};
async function until(fn,label,timeout=40000){for(const end=Date.now()+timeout;Date.now()<end;){const v=await fn();if(v)return v;await sleep(100)}throw Error('Timeout '+label)}
async function make(name){const b=req('mineflayer').createBot({host:'127.0.0.1',port:25840,username:name,version:'1.21.1',auth:'offline',hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.lines=[];b.on('messagestr',s=>b.lines.push(s));b.on('error',e=>{if(!closing)report.errors.push(e.message)});await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'spawn '+name);return b}
async function cli(b,q,prefix='MC_TASKS'){const from=b.lines.length;b.chat('/mycli '+q);const value=await until(()=>{const line=b.lines.slice(from).find(s=>s.startsWith(prefix+' '));return line?JSON.parse(line.slice(prefix.length+1)):null},q);await sleep(1200);return value}
try {
 check('same final jar after normal cold start',report.candidateSha256===original.candidateSha256);
 const a=await make(original.resume.name),state=await cli(a,'tasks status');
 check('in-flight typed combat survives restart',state.adventure.activeId===original.resume.activeId&&state.adventure.progress===original.resume.progress&&state.adventure.progress===1);
 check('final reward count is not duplicated',state.adventure.completed===original.resume.completed);
 const detail=await cli(a,'tasks info '+original.resume.activeId);check('frozen monster and weapon rules survive restart',detail.steps[0].combat.mobs.includes('SPIDER')&&detail.steps[0].combat.weapons.includes('SWORD'));
 const main=await cli(a,'status --json','MC_STATUS');check('actual combat graduation survives restart',main.mainlineGraduated===true);
 const ledger=y.load(fs.readFileSync(stage+'/plugins/AgentFriend/world-life-ledger.yml','utf8'));
 const uuid=original.resume.uuid??original.samples.mainBefore.playerUuid;
 check('actual completion retains legacy life storage key',ledger.players[uuid].proof.life===true);
 const legacy=JSON.parse(fs.readFileSync(root+'/legacy-cold-fixture.json','utf8')),b=await make(legacy.name),old=await cli(b,'tasks status');
 check('pre-feature frozen task still parses',old.adventure.activeId===legacy.oldTask&&old.adventure.progress===legacy.oldProgress);
 const oldInfo=await cli(b,'tasks info '+legacy.oldTask);check('legacy task gains classification without new combat restrictions',oldInfo.task.route==='crafting'&&!oldInfo.steps[0].combat);
 const oldMain=await cli(b,'status --json','MC_STATUS');check('old saved life proof graduates without mandatory extra adventure',oldMain.mainlineGraduated===true&&old.adventure.completed===0);
 check('no fixture error',report.errors.length===0);report.passed=true;
}catch(error){report.failure=error.stack;console.error(error.stack);process.exitCode=1}
finally{closing=true;for(const b of bots)b.quit();await sleep(400);fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({passed:report.passed??false,checks:report.checks.length}));process.exit(process.exitCode??0)}
