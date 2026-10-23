import {readFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
const [directory,from='0001-01-01T00:00:00Z',to='9999-12-31T23:59:59Z']=process.argv.slice(2);
if(!directory||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(from)>Date.parse(to))
  throw new Error('Usage: node summarize-experiences.mjs <one explicit scope directory> [from ISO] [to ISO]');
const root=resolve(directory),scope=basename(root);
if(!/^[a-f0-9]{64}$/.test(scope))throw new Error('Pass exactly one hashed operation scope directory; parent/account scanning is not supported');
const counts=Object.create(null),controllers=Object.create(null),operations=Object.create(null);let rows=0,measured=0,healthPairs=0,healthChange=0,first=null,last=null;
for(const name of readdirSync(root)){
  if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
  const path=join(root,name);if(statSync(path).size>256000)throw new Error('Oversized record');
  const r=JSON.parse(readFileSync(path,'utf8'));
  if(r.schema!=='agent-mc-experience/v1'||r.scopeKey!==scope||r.id!==name.slice(0,-5))throw new Error('Evidence identity mismatch');
  if(!Number.isFinite(Date.parse(r.at)))throw new Error('Invalid evidence timestamp');
  if(Date.parse(r.at)<Date.parse(from)||Date.parse(r.at)>Date.parse(to))continue;
  rows++;first=!first||r.at<first?r.at:first;last=!last||r.at>last?r.at:last;
  const key=r.kind==='decision'?`decision:${r.decision?.status??'unknown'}`:`operation:${r.execution?.phase??r.dispatch}`;
  counts[key]=(counts[key]??0)+1;const controller=r.attribution?.controller??'unknown';controllers[controller]=(controllers[controller]??0)+1;
  for(const op of r.operations??[])operations[op]=(operations[op]??0)+1;
  if(r.kind==='operation'&&r.before&&r.after){measured++;if(Number.isFinite(r.before.health)&&Number.isFinite(r.after.health)){
    healthPairs++;healthChange+=r.after.health-r.before.health;
  }}
}
console.log(JSON.stringify({schema:'agent-mc-experience-summary/v1',requestedWindow:{from,to},observedWindow:{from:first,to:last},sampleSize:rows,
  counts,controllers,operations,measuredPairs:measured,healthPairs,meanHealthChange:healthPairs?healthChange/healthPairs:null,
  modelAccuracy:null,goalSuccessRate:null,causalImprovementVerified:false},null,2));
