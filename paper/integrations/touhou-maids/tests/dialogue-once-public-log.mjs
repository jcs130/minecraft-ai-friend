// Read a completed synthetic run through the actual website publication parser.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {parsePublicDialogue} from '../../agent-portal/src/public-dialogue.mjs';
const stage=process.env.MAID_SOCIAL_QA_STAGE,root=process.env.MAID_SOCIAL_QA_REPORT_ROOT;
assert(stage&&root);assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const reportPath=root+'/dialogue-once-candidate.json',report=JSON.parse(await fs.readFile(reportPath,'utf8'));assert(report.passed&&!report.baseline);
const from=parseInt(report.run.slice(2),36),to=(await fs.stat(reportPath)).mtimeMs,receipts=[];
for(const f of await fs.readdir(stage+'/plugins/QiandengjiMaidBridge/native-receipts'))if(f.endsWith('.json')){
 const r=JSON.parse(await fs.readFile(stage+'/plugins/QiandengjiMaidBridge/native-receipts/'+f,'utf8'));
 if(r.action==='chat'&&r.status==='replied'&&Date.parse(r.reservedAt)>=from&&Date.parse(r.reservedAt)<=to)receipts.push(r);
}
const publicReceipts=receipts.filter(r=>r.observation?.textPresentation==='nearby_canonical'),native=receipts.filter(r=>r.observation?.textPresentation==='original_tlm');
assert.equal(publicReceipts.length,3);assert.equal(native.length,1);
const date=new Date(from+8*3600000).toISOString().slice(0,10),events=(await fs.readFile(stage+'/logs/latest.log','utf8')).split(/\r?\n/).map(line=>parsePublicDialogue(line,date)).filter(Boolean);
for(const r of publicReceipts)assert.equal(events.filter(e=>e.eventIdentity===`maid:${r.maidId}:${r.operationId}`).length,1,'one website event per public operation');
for(const r of native)assert.equal(events.filter(e=>e.eventIdentity===`maid:${r.maidId}:${r.operationId}`).length,0,'private native answer is not published');
const proof={passed:true,publicReplies:3,websiteCopiesPerPublicReply:1,privateNativeRepliesPublished:0,readOnly:true,productionChanged:false};
await fs.writeFile(root+'/public-log-proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
