/** QA-only shared-core goal projection. No model calls or game actions. */
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {GoalCheckpointBook} from '../../../../../packages/agent-mc-world/core/goal-checkpoint.ts';
import {parseGoalPlan} from '../../../../../packages/agent-mc-world/core/goal-plan.ts';
import {runOnce} from '../companion-memory.mjs';

const [stageArg,actor,goalFile,mode]=process.argv.slice(2);
if(!stageArg||!/^10000000-0000-0000-0000-00000000001[123]$/.test(actor??'')||!goalFile)throw Error('synthetic stage, actor and goal text file required');
if(mode!==undefined&&mode!=='--resume')throw Error('unsupported fixture mode');
const stage=resolve(stageArg);
if((await readFile(join(stage,'.resident-hybrid-qa'),'utf8')).trim()!=='SYNTHETIC_RESIDENT_HYBRID_ONLY')throw Error('synthetic marker required');
const props=Object.fromEntries((await readFile(join(stage,'server.properties'),'utf8')).split(/\r?\n/).filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
if(props['server-ip']!=='127.0.0.1'||!props['rcon.port']||props['rcon.port']==='25575')throw Error('isolated loopback server required');
const text=(await readFile(resolve(goalFile),'utf8')).trim();if(!text||text.length>2048)throw Error('bounded scenario text required');
const cfg={schema:1,coreRoot:fileURLToPath(new URL('../../../../../packages/agent-mc-world',import.meta.url)),source:true,
  journalRoot:join(stage,'world/data/tlm-companion-memory'),dataDir:join(stage,'qa-core-memory'),goalsDirectory:join(stage,'qa-core-goals'),
  realm:'synthetic-resident-goals',npcs:[{maidId:actor,memory:{mode:'local'}}]};
const plan=parseGoalPlan([{do:'完成约定的目标',judgment:'以本人真实业务回执及当前背包核验；计划本身不是完成证据'}]);
if(plan.error)throw Error(plan.error);
const book=new GoalCheckpointBook(cfg.goalsDirectory),scope={realm:cfg.realm,account:`npc:${actor}`,agent:actor};
await mkdir(cfg.goalsDirectory,{recursive:true});
const previous=book.load(scope);
if(mode==='--resume'){
  if(previous.length!==1||previous[0].text!==text)throw Error('resume requires the original scoped goal; never overwrite it');
}else{
  if(previous.length)throw Error('fresh QA goal scope required; do not overwrite an existing intention');
  book.save(scope,[{slot:1,revision:1,text,plan,blueprint:null,day:null,realTime:new Date().toISOString(),at:Date.now()}]);
}
let stopping=false;process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{if(s.trim()==='stop')stopping=true;});process.stdin.on('end',()=>{stopping=true;});
await runOnce(cfg);process.stdout.write('core_goal_projection_ready\n');
while(!stopping){for(let i=0;i<5&&!stopping;i++)await sleep(1000);if(!stopping)await runOnce(cfg);}
await runOnce(cfg);
process.stdout.write('core_goal_projection_stopped\n');
process.stdin.destroy();
