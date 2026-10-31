import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';
const [stage,output]=process.argv.slice(2);
if(!stage||!output||!path.isAbsolute(stage)||!path.isAbsolute(output)||!stage.replaceAll('\\','/').startsWith('E:/MC/staging/')
 ||fs.readFileSync(stage+'/.communication-qa','utf8').trim()!=='127.0.0.1:29397 20261030'||fs.existsSync(output))throw Error('Fresh marked loopback result required');
const require=createRequire('E:/MC/probe/package.json'),bots=[];
const report={passed:false,productionChanged:false,checks:[],samples:{},errors:[]};
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:29398});
const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);console.log('PASS '+name);};
async function until(fn,label,ms=18000){const end=Date.now()+ms;while(Date.now()<end){const r=await fn();if(r)return r;await sleep(90);}throw Error('TIMEOUT '+label);}
async function fixture(bot,action='state',extra='') {const s=await rc('coopqa '+action+' '+bot.username+(extra?' '+extra:''));if(s.includes('COOP_QA loading'))return null;const m=s.match(/COOP_QA (\{[^\r\n]+\})/);if(!m)throw Error('Fixture not applied: '+s.slice(0,300));return JSON.parse(m[1]);}
async function cli(bot,line,predicate){const index=bot.lines.length;await sleep(350);bot.chat('/mycli '+line);return until(()=>bot.lines.slice(index).find(predicate),line);}
const packet=s=>{if(s.startsWith('MC_RPG '))try{return JSON.parse(s.slice(7));}catch{}return null;};
async function json(bot,line,predicate=()=>true){const text=await cli(bot,line+' --json',s=>{const p=packet(s);return p&&predicate(p);});return packet(text);}
async function join(suffix){
 const bot=require('mineflayer').createBot({host:'127.0.0.1',port:29397,version:'1.21.1',username:'ag_CP'+Date.now().toString(36).slice(-7)+suffix,auth:'offline',checkTimeoutInterval:60000});
 installRecipePacketBypass(bot._client,{enabled:true});bot.lines=[];bots.push(bot);bot.on('messagestr',s=>bot.lines.push(s));bot.on('error',e=>report.errors.push(e.name));
 await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);setTimeout(()=>reject(Error('SPAWN_TIMEOUT')),40000).unref();});
 await until(()=>fixture(bot),'native profile');await fixture(bot,'setup');await sleep(800);return bot;
}
async function walk(bot){await bot.look(-Math.PI/2,0,true);bot.setControlState('forward',true);await sleep(420);bot.clearControlStates();await sleep(1800);}
try {
 const a=await join('a'),b=await join('b');let state=await fixture(a);
 check(!state.op&&state.partyPermission,'ordinary actor has the native party permission');
 let v=await json(a,'guild party status');check(v.phase==='not_in_party'&&v.inParty===false&&v.inviteStateKnown,'status distinguishes no party and no invite');
 const help=await cli(a,'help cast.team --json',s=>s.startsWith('MC_CLI_HELP '));check(help.includes('/mycli locate tp'),'common skill help remains queryable after adding rendezvous');
 check((await cli(a,'locate list',s=>s.includes('在线伙伴'))).includes('不等于已组队'),'online player list no longer falsely calls everybody a teammate');
 check((await json(a,'guild party create')).success,'leader creates through existing CLI');
 v=await json(a,'guild party status');check(v.phase==='awaiting_teammates'&&v.memberCount===1,'one-person party is not presented as a formed team');
 check((await json(a,'guild party invite '+b.username)).success,'native invitation sent');
 v=await json(b,'guild party status');check(v.phase==='invited'&&v.pendingInvite.inviter===a.username&&v.nextCommand==='/mycli guild party accept','recipient discovers the actual inviter and exact accept command');
 check((await json(b,'guild party status')).pendingInvite.inviter===a.username,'repeated invitation query does not consume it');
 check((await json(b,'guild party create')).reason==='invite_pending','pending recipient is protected from accidentally forming a separate party');
 check((await json(b,'guild party accept')).success,'recipient explicitly accepts');
 state=await fixture(a);check(state.party.members.length===2&&state.party.inParty,'both actual native UUIDs share one roster');
 await fixture(b,'far');v=await json(b,'guild party status');check(v.phase==='assembling'&&v.nextCommand==='/mycli locate tp '+a.username,'separated member gets the existing rendezvous skill command');
 await fixture(b,'otherworld');v=await json(b,'guild party status');check(v.phase==='assembling'&&v.members.find(m=>m.name===a.username).sameWorld===false,'different dimensions never masquerade as nearby coordinates');
 let info=await json(b,'skills info team');check(info.mana===8&&info.cooldownMs===20000&&info.command==='/mycli locate tp <在线玩家名>','existing team skill exposes its real cost and entry');
 const before=await fixture(b);await cli(b,'locate tp '+a.username,s=>s.includes('已安全抵达'));await sleep(200);const after=await fixture(b);
 check(after.world===state.world&&Math.hypot(after.position[0]-state.position[0],after.position[2]-state.position[2])<4,'native teammate teleport actually reunites the bodies across worlds');
 check(before.mana-after.mana>=7&&before.mana-after.mana<=8.01,'rendezvous charges the original mana pool once');
 info=await json(b,'skills info team');check(info.cooldownRemainingMs>17000&&info.cooldownRemainingMs<=20000,'skill query reads the actual original rendezvous cooldown');
 const repeatBefore=await fixture(b);await cli(b,'locate tp '+a.username,s=>s.includes('传送冷却'));const repeatAfter=await fixture(b);
 check(repeatAfter.mana>=repeatBefore.mana&&JSON.stringify(repeatAfter.position)===JSON.stringify(repeatBefore.position),'cooldown rejection neither moves nor charges');
 v=await json(a,'guild party status');check(v.phase==='assembled','native status confirms actual gathering');
 info=await json(a,'skills info travel');check(info.command==='/mycli waypoint list','travel guide gives a readable CLI instead of an obligatory GUI');
 const denied=await cli(a,'cast travel',s=>s.includes('command_route_mismatch'));check(denied.includes('/mycli waypoint list'),'wrong cast route returns a precise recovery entry without action');
 const obs=await rc('mycli admin observe '+Buffer.from(JSON.stringify({op:'player',player:a.username})).toString('base64url'));
 report.samples.observation=JSON.parse(obs.slice(15));check(report.samples.observation.party.members.length===2&&report.samples.observation.party.phase==='assembled','Goddess reads the same authoritative native team');
 check((await json(a,'guild party disband')).success,'leader disbands explicitly');check((await json(b,'guild party status')).phase==='not_in_party','other actor sees the disbanded native state');
 await cli(a,'guild join',s=>s.includes('公会')||s.includes('冒险者'));
 const route=await cli(a,'guild engineering tm_mountain_outlook',s=>s.includes('山路笔记'));check(route.includes('共2阶段')&&route.includes('绿宝石实物'),'two-stage mountain task exposes private text and the actual existing reward instead of an empty notice');
 await fixture(a,'peak','pillar');await sleep(700);await walk(a);
 state=await fixture(a);check(state.peakProgress===0&&!state.terrain.ready,'real movement on a tall stone pillar does not complete exploration');
 await fixture(a,'peak','thin_roof');await sleep(700);await walk(a);state=await fixture(a);check(state.peakProgress===0&&!state.terrain.ready,'real movement on a broad thin roof does not count as a mountain');
 await fixture(a,'peak','mountain');await sleep(700);check((await fixture(a)).peakProgress===0,'teleport and status query alone do not supply exploration evidence');await walk(a);state=await fixture(a);check(state.peakProgress===1&&state.terrain.ready,'actual movement on a broad mountain records the original quest counter');
 report.samples.final=state;check(report.errors.length===0,'no client protocol error');report.passed=true;
}catch(error){report.error=String(error.stack);process.exitCode=1;console.error(report.error);}
finally{for(const bot of bots)bot.quit('Own cooperation verification complete');await sleep(300);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
