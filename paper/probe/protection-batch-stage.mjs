// Native Java/Mineflayer + an actually attached Eye in the loopback QA copy.
// Never use these fixture commands against production.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/life-challenges-20261014/paper', output='E:/MC/ops/repairs/protection-batch-20261014';
const properties=stage+'/server.properties', props=fs.readFileSync(properties,'utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25678\r?$/m);
assert.match(props,/^rcon.port=25679\r?$/m);assert.match(props,/^motd=Life challenges isolated check\r?$/m);
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');fix1206PotionProtocol(req);
const report={at:new Date().toISOString(),checks:[],errors:[],samples:{},fixtures:[],sha256:createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.40.jar')).digest('hex')};
const bots=[];let closing=false;
async function until(fn,label,ms=30000){for(const end=Date.now()+ms;Date.now()<end;){const result=await fn();if(result)return result;await sleep(80);}throw Error('Timeout '+label);}
async function rc(q){const answer=await command(q,15000,{port:25679,properties});report.fixtures.push({q,answer});return answer;}
function check(name,ok){report.checks.push({name,pass:!!ok});assert(ok,name);console.log('PASS '+name);}
async function join(username){
 await rc('minecraft:whitelist add '+username);
 const b=req('mineflayer').createBot({host:'127.0.0.1',port:25678,username,auth:'offline',version:'1.20.6',checkTimeoutInterval:60000});
 bots.push(b);installRecipePacketBypass(b._client);b.lines=[];b.payloads=[];b.cameras=[];
 b.on('messagestr',s=>b.lines.push(s));b.on('error',e=>{if(!closing)report.errors.push(username+': '+e.message);});
 b._client.on('camera',p=>b.cameras.push(p.cameraId));
 b._client.on('custom_payload',p=>{if(p.channel==='mcagent:protection')b.payloads.push(JSON.parse(Buffer.from(p.data).toString('utf8')));});
 await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),username+' world',45000);return b;
}
async function run(b,args,{prefix='MC_PROTECTION ',human=false}={}){
 await sleep(Math.max(0,1100-(Date.now()-(b.lastChat??0))));
 const start=Date.now(),lineAt=b.lines.length,payloadAt=b.payloads.length;b.lastChat=start;b.chat('/mycli '+args);
 const data=await until(()=>human?b.payloads[payloadAt]:b.lines.slice(lineAt).filter(s=>s.startsWith(prefix)).map(s=>JSON.parse(s.slice(prefix.length)))[0],args);
 await sleep(170);return {data,lines:b.lines.slice(lineAt),payloads:b.payloads.slice(payloadAt),elapsed:Date.now()-start};
}
function expanded(data){
 assert.equal(data.complete,true);const result=new Array(data.total);
 for(const group of data.groups)for(const [first,last]of group.indices)for(let index=first;index<=last;index++){
  assert.equal(result[index],undefined,'duplicate index');result[index]=group;
 }
 assert(result.every(Boolean));return result;
}
try{
 await until(async()=>{try{return (await rc('version AgentFriend')).includes('0.4.40');}catch{return false;}},'candidate readiness',90000);
 check('candidate version',(await rc('version AgentFriend')).includes('0.4.40'));
 check('real region fixture',(await rc('protectionqa setup')).includes('PROTECTION_QA_OK'));
 const a=await join('ag_LifeA'),human=await join('LifeVisitor'),eye=await join('ag_LifeA_eye');
 await until(()=>eye.cameras.at(-1)===a.entity.id&&eye.game.gameMode==='spectator','actual Eye attachment');
 for(const b of [a,human]){await rc('minecraft:gamemode survival '+b.username);await rc('minecraft:tp '+b.username+' 2003.5 101 2003.5');}
 await sleep(800);
 const inventory=await rc('lifeqa snapshot ag_LifeA');
 let r=await run(a,'protect batch --help --json',{prefix:'MC_CLI_HELP '});
 check('batch discovered by standard help without inspection',r.data.actionReadOnly&&r.data.jsonSupported&&!r.payloads.length&&r.data.summary.includes('--box'));
 r=await run(a,'protect batch break --box 2000 100 2000 2007 100 2007 --json',{prefix:'MC_PROTECTION_BATCH '});
 const batch=r.data, rows=expanded(batch);report.samples.batch=batch;report.samples.batchElapsedMs=r.elapsed;
 check('64-target batch is one JSON and one payload',r.lines.filter(s=>s.startsWith('MC_PROTECTION')).length===1&&r.payloads.length===1&&JSON.stringify(r.payloads[0])===JSON.stringify(batch));
 check('one request is not rate-limited per block',batch.total===64&&batch.counts.unknown===0);
 check('real mixed permissions are aggregated',batch.counts.deny===32&&batch.counts.allow_likely===32&&batch.groups.length===3&&batch.areas.length===2);
 check('default Agent output has no duplicated prose',!r.lines.some(s=>/【保护查询】|【保护范围】|【正确做法】/.test(s)));
 const rateAt=a.lines.length;a.lastChat=Date.now();a.chat('/mycli protect batch break --box 2000 100 2000 2007 100 2007 --json');
 const rate=JSON.parse((await until(()=>a.lines.slice(rateAt).find(s=>s.startsWith('MC_PROTECTION_BATCH ')),'batch rate limit')).slice(20));
 check('rate limit is one unknown response, not 64 failures',rate.reason==='unknown_rate_limited'&&rate.allowed===null&&rate.retryAfterMs>0&&!rate.complete&&rate.action==='break');
 for(const index of [0,3,4,7,24,31,32,63]){
  const x=2000+index%8,z=2000+Math.floor(index/8);
  r=await run(a,`protect break ${x} 100 ${z}`);
  check('batch matches fresh single target '+index,r.data.status===rows[index].status&&r.data.reason===rows[index].reason&&r.data.allowed===rows[index].allowed);
 }
 r=await run(a,'protect break 2002 100 2002 --json');report.samples.single=r.data;
 check('single is short, native payload retains full boundaries',!r.data.areas&&r.data.detailCommand&&r.payloads[0].areas.length&&r.data.sequence===r.payloads[0].sequence);
 const shortSize=JSON.stringify(r.data).length;
 r=await run(a,'protect break 2002 100 2002 --verbose --json');report.samples.verbose=r.data;
 check('verbose restores detailed legacy JSON without duplicate text',r.data.areas.length&&r.data.nextCommands.length&&r.lines.filter(s=>s.startsWith('MC_PROTECTION ')).length===1&&!r.lines.some(s=>s.includes('【正确做法】')));
 report.samples.singleChars={compact:shortSize,verbose:JSON.stringify(r.data).length};
 r=await run(a,'protect batch break 2002,100,2002 2002,100,2002 2006,100,2006 --json',{prefix:'MC_PROTECTION_BATCH '});
 check('duplicate points checked once and mapping preserved',r.data.requested===3&&r.data.total===2&&r.data.targets.points.length===2&&expanded(r.data)[1].status==='allow_likely');
 r=await run(a,'protect batch break 2002,100,2002 2002,-100,2002 10000,100,10000 --json',{prefix:'MC_PROTECTION_BATCH '});
 const mixed=expanded(r.data);report.samples.unknown=r.data;
 check('partial unknown never means permission',mixed[0].status==='deny'&&mixed[1].allowed===null&&mixed[1].reason==='unknown_invalid_y'&&mixed[2].allowed===null&&mixed[2].reason==='unknown_out_of_range');
 r=await run(a,'protect batch break --box 0 0 0 2147483647 2147483647 2147483647 --json',{prefix:'MC_QUERY_ERROR '});
 check('oversized range rejected before inspecting',r.data.errorCode==='INVALID_ARGUMENT'&&!r.payloads.length);
 await rc('protectionqa allow-b');
 r=await run(a,'protect batch break --box 2000 100 2000 2007 100 2007 --json',{prefix:'MC_PROTECTION_BATCH '});
 check('permission change visible on next fresh query',r.data.counts.deny===16&&r.data.counts.allow_likely===48);
 await rc('protectionqa deny-b');
 r=await run(a,'protect batch place --box 2000 100 2000 2007 100 2007 --json',{prefix:'MC_PROTECTION_BATCH '});
 check('actions are independently evaluated',r.data.counts.allow_likely===64&&r.data.counts.deny===0);
 r=await run(human,'protect break 2002 100 2002',{human:true});
 check('ordinary Java sees Chinese only',r.lines.some(s=>s.includes('【保护查询】'))&&r.lines.some(s=>s.includes('【保护范围】'))&&!r.lines.some(s=>s.startsWith('MC_PROTECTION')));
 r=await run(human,'protect batch break --box 2000 100 2000 2007 100 2007',{human:true});
 check('ordinary Java batch is bounded and readable',r.lines.some(s=>s.includes('共64个目标'))&&r.lines.filter(s=>s.includes('个目标')||s.includes('逐块结果')).length<=5&&!r.lines.some(s=>s.startsWith('MC_PROTECTION')));
 r=await run(human,'protect break 2002 100 2002 --json');
 check('explicit JSON changes format only',r.data.status==='deny'&&!r.lines.some(s=>s.includes('【保护查询】')||s.includes('【正确做法】')));
 r=await run(human,'protect batch break --box 2000 100 2000 2007 100 2007 --verbose',{human:true});
 check('human verbose expands shared boundaries',r.lines.filter(s=>s.includes('【保护范围】')).length===2&&!r.lines.some(s=>s.startsWith('MC_PROTECTION')));

 // Real client digging packets, not synthetic Bukkit events. All blocks must remain.
 // Creative mode makes the attempted break immediate; aborting survival stone
 // digging after 200 ms only exercises damage, before WorldGuard's break check.
 await rc('minecraft:gamemode creative ag_LifeA');await sleep(500);
 const before=a.lines.length, payloadBefore=a.payloads.length, humanBefore=human.lines.length;
 async function hit(x,z){
  const block=a.blockAt(a.entity.position.offset(x-a.entity.position.x,100-a.entity.position.y,z-a.entity.position.z));assert.equal(block?.name,'stone');
  const digging=a.dig(block,true).catch(error=>String(error));await sleep(200);a.stopDigging();await digging;
 }
 for(const [x,z] of [[2002,2002],[2003,2002],[2002,2003],[2003,2003]])await hit(x,z);
 await sleep(300);const notices=a.lines.slice(before).filter(s=>s.startsWith('MC_PROTECTION '));
 report.samples.automatic={lines:a.lines.slice(before),payloads:a.payloads.slice(payloadBefore),position:a.entity.position};
 check('adjacent automatic denials coalesce',notices.length===1&&a.payloads.length-payloadBefore===1);
 check('automatic Agent receipt is short without repeated Chinese',!a.lines.slice(before).some(s=>/【操作未执行】|【保护范围】/.test(s))&&JSON.parse(notices[0].slice(14)).reason==='worldguard');
 await sleep(5100);const after=a.lines.length;await hit(2002,2002);
 const repeated=await until(()=>a.lines.slice(after).find(s=>s.startsWith('MC_PROTECTION ')),'denial after window');
 check('next notice reports suppressed attempts',JSON.parse(repeated.slice(14)).suppressedNotices>=3);
 const serverBlocks=JSON.parse((await rc('protectionqa blocks')).split('PROTECTION_QA_BLOCKS ')[1]);report.samples.serverBlocks=serverBlocks;
 check('protection still cancels every block operation',Object.values(serverBlocks).length===4&&Object.values(serverBlocks).every(type=>type==='STONE'));
 check('outsider receives no protection broadcasts',!human.lines.slice(humanBefore).some(s=>/MC_PROTECTION|【操作未执行】|【保护范围】/.test(s)));
 check('actual Eye receives Chinese but no machine replies',eye.lines.some(s=>s.includes('共64个目标'))&&eye.lines.some(s=>s.includes('【操作未执行】'))&&!eye.lines.some(s=>s.startsWith('MC_PROTECTION'))&&eye.payloads.length===0);
 const invBefore=JSON.parse(inventory.split('LIFE_QA_SNAPSHOT ')[1]),invAfter=JSON.parse((await rc('lifeqa snapshot ag_LifeA')).split('LIFE_QA_SNAPSHOT ')[1]);
 check('read-only queries and denied digs preserve inventory',invBefore.uuid===invAfter.uuid&&invBefore.cursorEmpty===invAfter.cursorEmpty&&JSON.stringify(invBefore.items)===JSON.stringify(invAfter.items));
 await rc('protectionqa many');
 r=await run(a,'protect batch break --box 2000 100 2000 2007 100 2007 --verbose --json',{prefix:'MC_PROTECTION_BATCH '});
 check('large heterogeneous result yields private page link without partial permissions',!r.data.complete&&r.data.detailsPaged&&!r.data.groups&&!r.data.areas&&r.data.counts.deny===64&&r.data.nextCommand.startsWith('/mycli page '));
 const next=r.data.nextCommand;
 r=await run(a,next.slice('/mycli '.length),{prefix:'MC_PAGE '});
 check('large aggregate uses existing bounded page transport',r.data.kind==='protection_batch'&&r.data.items[0].encoding==='summary'&&r.data.items[0].detailEncoding==='json_fragment');
 r=await run(human,next.slice('/mycli '.length),{prefix:'MC_QUERY_ERROR '});
 check('protection pages cannot be read from another connection',r.data.errorCode==='SNAPSHOT_EXPIRED');
 await rc('minecraft:tp ag_LifeA -503.5 69 -434.5');await sleep(1200);
 r=await run(a,'protect break -504 68 -437 --verbose --json');
 check('real village mask still reports envelope-only bounds',r.data.status==='deny'&&r.data.reason==='village_structure'&&r.data.areas.some(a=>a.envelopeOnly));
 check('no native protocol errors',report.errors.length===0);report.passed=true;
}catch(error){report.failure=String(error.stack);process.exitCode=1;}
finally{
 try{await rc('protectionqa clear');}catch(error){report.errors.push('fixture cleanup: '+error.message);}
 closing=true;for(const bot of bots)try{bot.quit('Protection batch QA complete');}catch{}
 await sleep(350);const path=output+'/native-'+Date.now()+'.json';fs.writeFileSync(path,JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:!!report.passed,checks:report.checks.length,failure:report.failure,errors:report.errors,path}));process.exit(process.exitCode??0);
}
