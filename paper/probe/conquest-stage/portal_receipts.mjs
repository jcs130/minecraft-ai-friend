// Read saved QA receipts through the real portal collector. Never publish them.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Store} from '../../integrations/agent-portal/src/store.mjs';
import {SavedChallenges} from '../../integrations/agent-portal/src/challenges.mjs';
const require=createRequire(new URL('../../integrations/agent-portal/package.json',import.meta.url));
const yaml=require('yaml');
const stage='E:/MC/staging/aincrad-conquest-20261027';
assert.match(await fs.readFile(path.join(stage,'server.properties'),'utf8'),/^motd=QD_AINCRAD_CONQUEST_QA_ONLY$/m);
const expectedSolo=process.argv[2]||'';
if(expectedSolo)assert.match(expectedSolo,/^ag_UseSolo[0-9]+$/);
const out=expectedSolo?'E:/MC/ops/repairs/rpg-usage-20261027/portal-receipts-final':'E:/MC/ops/repairs/conquest-rpg-20261027/portal-receipts';
const cache=JSON.parse(await fs.readFile(path.join(stage,'usercache.json'),'utf8'));
const game={config:{hiddenPlayers:[]},roster:async()=>cache.map(r=>({name:r.name,playerUuid:r.uuid,available:true,kind:'agent'})),
 plugin:async file=>{assert.ok(['config.yml','dungeons.yml'].includes(file));const p=path.join(stage,'plugins/AgentFriend',file);return{data:yaml.parse(await fs.readFile(p,'utf8')),savedAt:(await fs.stat(p)).mtime.toISOString()};}};
const store=new Store(out);
try{
 const reader=new SavedChallenges({serverDir:stage,hiddenPlayers:[]},game,store);
 const result=await reader.query({activity:'aincrad_01'});
 assert.equal(result.activity.name,'艾恩葛朗特·第一层攻略');assert.equal(result.activity.totalUnits,3);assert.equal(result.activity.unit,'室');
 assert.ok(result.runs.some(r=>r.state==='completed'&&r.party.includes('ag_ConquestQA')&&r.clearedUnits===3));
 assert.ok(result.runs.some(r=>r.state==='completed'&&r.party.some(n=>n.startsWith('ag_TankQA'))&&r.party.some(n=>n.startsWith('ag_HealQA'))));
 assert.ok(result.runs.every(r=>r.activityId==='aincrad_01'));
 const second=await reader.query({activity:'aincrad_01'});assert.equal(second.summary.records,result.summary.records);
 if(expectedSolo){const completed=result.runs.find(r=>r.state==='completed'&&r.party.includes(expectedSolo));assert.ok(completed);assert.equal(completed.clearedUnits,3);assert.equal(completed.score,800);}
 const report={checks:expectedSolo?8:6,source:result.source,summary:result.summary,activity:result.activity,
   runs:result.runs.map(({state,party,clearedUnits,score})=>({state,party,clearedUnits,score})),productionUploaded:false};
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{store.close();}
