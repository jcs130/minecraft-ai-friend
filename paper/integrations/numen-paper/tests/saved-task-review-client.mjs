import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
import {listenPrivateGoddessMessages} from '../../../ops/goddess-chat-identity.mjs';

const [stage,out,phase,modules]=process.argv.slice(2);assert(['candidate','restart'].includes(phase));
assert.equal(await fs.readFile(stage+'/.pr58-qa','utf8'),'PR58_QA_ONLY');
assert.match(await fs.readFile(stage+'/server.properties','utf8'),/^server-ip=127\.0\.0\.1$/m);
const mineflayer=createRequire(modules)('mineflayer'),bots=[],checks=[],receipts=[];
const previousBody=phase==='restart'?(await fs.readFile(stage+'/pr58-body.uuid','utf8')).trim():null;
const rc=t=>command(t,15000,{properties:stage+'/server.properties',port:25989});
const check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('PASS '+name);};
async function until(read,label,ms=20000){for(const end=Date.now()+ms;Date.now()<end;){const v=await read();if(v)return v;await sleep(120);}throw Error('Timeout: '+label);}
async function connect(username){const b=mineflayer.createBot({host:'127.0.0.1',port:25988,username,auth:'offline',version:'1.21.1',hideErrors:true});bots.push(b);b.lines=[];b.private=[];let spawned=false;
 installRecipePacketBypass(b._client);b.on('spawn',()=>{spawned=true;b.physicsEnabled=false;});b.on('messagestr',(text,position,message)=>{b.lines.push(text);if(text.includes('native-private-proof'))receipts.push({actor:username,text,position,component:message?.json});});b.on('error',e=>receipts.push({clientError:e.message}));await until(()=>spawned,'ordinary actor '+username);listenPrivateGoddessMessages(b,p=>b.private.push(p));return b;}
async function qa(op){const text=await rc('reviewqa '+op),i=text.indexOf('REVIEW_QA ');assert(i>=0,text);return JSON.parse(text.slice(i+10));}
let passed=false;
try{
 const a=await connect('ag_P58A'),b=await connect('ag_P58B');
 await sleep(1000);a.chat('/minecraft:msg ag_P58B native-private-proof');
 await until(()=>b.private.some(p=>p.player==='ag_P58A'&&p.message==='native-private-proof'),'actual native private sender');
 check('real native incoming component preserves the actual sender',true);
 const before=b.private.length;a.chat('Victim whispers: [造物申请] public-proof');await sleep(700);
 check('real public text cannot become private-message authority',b.private.length===before);
 a.chat('/numen player summon P58Body');
 let s=await until(async()=>{const v=await qa('status');return v.bodyPresent?v:null;},'owned companion admission',30000);
 check('actual companion belongs to the test owner',s.ownerMatches);check('companion did not acquire OP',!s.op);const uuid=s.uuid;
 if(phase==='restart'){
  await until(async()=>{s=await qa('status');return s.events.some(t=>t.includes('saved_task_requires_review'));},'first-tick restart review event');
  check('normal restart preserved original companion UUID',uuid===previousBody);
  check('first tick preserved saved Lua rather than replaying it',s.taskLua==="error('QA_OLD_LUA_MUST_NOT_RUN')"&&s.taskName==='qa_saved_lua');
  check('first tick reports stopped and review-required',s.events.some(t=>t.includes('saved_task_requires_review')&&t.includes('stopped')));
 }
 for(const op of ['save','malformed','legacy']){
  const before=await qa(op);let after=await qa('replay');await sleep(150);after=await qa('status');
  check(op+' keeps the original saved intent',after.taskName===before.taskName&&after.taskLua===before.taskLua&&after.taskOld===before.taskOld);
  check(op+' supplies an explicit review event',after.events.some(t=>t.includes('saved_task_requires_review')&&t.includes('stopped')));receipts.push({case:op,state:after});
 }
 await qa('save');s=await qa('supersede');check('new explicit intent can replace the old one',s.taskName==='qa_new_explicit_intent'&&s.taskLua==='return 7');
 s=await qa('forget');check('explicit forget still clears the task',s.taskName===''&&s.taskLua===''&&s.taskOld==='');
 if(phase==='candidate'){s=await qa('save');check('saved restart fixture is persisted for the same body',s.uuid===uuid&&s.taskLua==="error('QA_OLD_LUA_MUST_NOT_RUN')");}
 passed=true;
}finally{await fs.writeFile(out,JSON.stringify({phase,passed,checks,receipts,actorMessages:bots.map(b=>({actor:b.username,lines:b.lines})),productionChanged:false},null,2)+'\n');for(const b of bots)b.quit();await sleep(250);}
