import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
// Destructive fixtures: isolated native Paper only. Never point at a live server.
const root=process.env.MC_PHOTO_TEST_OUTPUT,server=process.env.MC_PHOTO_TEST_SERVER;
assert(root&&server&&server.replaceAll('\\','/').includes('/staging/'),'Set isolated MC_PHOTO_TEST_SERVER under /staging/ and MC_PHOTO_TEST_OUTPUT');
fs.mkdirSync(root,{recursive:true});
const properties=fs.readFileSync(server+'/server.properties','utf8');
assert(/^server-ip=127\.0\.0\.1$/m.test(properties)&&/^server-port=25914$/m.test(properties)&&/^rcon.port=25915$/m.test(properties),'Dedicated loopback fixture ports required');

assert(server.startsWith('E:/MC/staging/'));
const req=createRequire(process.env.MC_MINEFLAYER_PACKAGE??'E:/MC/research/mineflayer-client-fixes-20261011/package.json'),yaml=createRequire(process.env.MC_YAML_PACKAGE??'E:/MC/ops/yaml-check/package.json')('js-yaml');
const id='ec68989c-7b3e-3b65-96e2-37a1d989e9c3',report={at:new Date().toISOString(),scope:'Isolated normal cold restart, native private photo delivery, no production edits',checks:[],messages:[]};
const expected=JSON.parse(fs.readFileSync(root+'/native-test.json'));assert(expected.passed);
report.candidateSha256=createHash('sha256').update(fs.readFileSync(server+'/plugins/AgentFriend-'+(process.env.MC_PHOTO_EXPECTED_VERSION??'0.4.47')+'.jar')).digest('hex');
assert.equal(report.candidateSha256,expected.candidateSha256,'Cold restart must use the exact tested artifact');
const read=()=>yaml.load(fs.readFileSync(server+'/plugins/AgentFriend/config.yml','utf8'));
const rc=q=>command(q,25000,{port:25915,properties:server+'/server.properties'});
function check(name,ok){assert(ok,name);report.checks.push(name);console.log('PASS '+name);}
async function until(fn,name,ms=18000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Timeout '+name);}
let bot;
try{
  check('native candidate survives normal cold startup',(await rc('version AgentFriend')).includes(process.env.MC_PHOTO_EXPECTED_VERSION??'0.4.47'));
  const rewards=read()['photo-rewards'][id];check('both receipts survive restart',Object.keys(rewards).length===2);
  const pending=Object.values(rewards).flatMap(r=>r.pending??[]);check('all exact pending tiles survive restart',JSON.stringify(pending)===JSON.stringify(expected.pending));
  bot=req('mineflayer').createBot({host:'127.0.0.1',port:25914,username:'ag_AuthQA',version:'1.21.1',auth:'offline',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});
  installRecipePacketBypass(bot._client);bot.physicsEnabled=false;bot.on('messagestr',s=>report.messages.push(s));
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',r=>reject(Error(JSON.stringify(r))));});
  check('ordinary non-operator account',!JSON.parse(fs.readFileSync(server+'/ops.json')).some(p=>p.name.toLowerCase()==='ag_authqa'));
  await rc('minecraft:gamemode survival ag_AuthQA');await rc('minecraft:tp ag_AuthQA -594.5 91 -313.5');await rc('auraskills:mana add ag_AuthQA 20 false true');await sleep(900);
  await rc('ex run photo_free_fixture');await until(()=>Object.keys(read()['dungeon-personal-stash'][id]).length===536,'free four QA fixture slots');
  const open=async()=>{bot.chat('/mycli arena stash page 1');await until(()=>bot.currentWindow&&JSON.stringify(bot.currentWindow.title).includes('个人试炼箱'),'personal chest');return bot.currentWindow;};
  const first=await open();await until(()=>first.slots.slice(0,54).filter(i=>i?.name==='filled_map').length===4,'four actual native map items');
  report.nativeItems=first.slots.slice(0,54).filter(i=>i?.name==='filled_map').map(i=>({name:i.name,count:i.count,components:i.components}));
  check('ordinary client receives four original maps',report.nativeItems.length===4&&report.nativeItems.every(i=>i.count===1));
  await bot.closeWindow(first);await sleep(500);
  const after=read(),mapIds=Object.values(after['dungeon-personal-stash'][id]).filter(i=>i.type==='FILLED_MAP').map(i=>i.meta['map-id']).sort((a,b)=>a-b);
  check('delivered native map ids match all four queued originals',JSON.stringify(mapIds)===JSON.stringify(pending.map(i=>i.meta['map-id']).sort((a,b)=>a-b)));
  check('private queue consumed durably',Object.values(after['photo-rewards'][id]).flatMap(r=>r.pending??[]).length===0);
  const second=await open();await sleep(300);check('closing and reopening does not duplicate maps',second.slots.slice(0,54).filter(i=>i?.name==='filled_map').length===4);await bot.closeWindow(second);
  check('delivery receipt count remains unchanged',Object.keys(read()['photo-rewards'][id]).length===2);
  report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;console.log(report.error);}finally{bot?.quit();await sleep(500);fs.writeFileSync(root+'/cold-recovery.json',JSON.stringify(report,(_k,v)=>typeof v==='bigint'?String(v):v,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
