/** Non-OP discovery, no-side-effect reads, explicit RPG actions and private receipts. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert(/^[a-z0-9]{1,8}$/.test(label));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const properties=stage+'/server.properties',props=await fs.readFile(properties,'utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25928\r?$/m);assert.match(props,/^rcon.port=25929\r?$/m);
const report={checks:[],receipts:[],passed:false,productionChanged:false},bots=[];const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const check=(label,ok)=>{assert(ok,label);report.checks.push(label);console.log('PASS '+label);};
const rc=async q=>{const result=await command(q,15000,{properties,port:25929});report.receipts.push({q,result});return result;};
const until=async(f,label,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await f();if(v)return v;await sleep(100);}throw Error('Timeout '+label);};
async function connect(name){const b=mf.createBot({host:'127.0.0.1',port:25928,username:name,version:'1.21.1',auth:'offline',hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.ready=false;b.messages=[];b.on('spawn',()=>b.ready=true);b.on('messagestr',s=>b.messages.push(s));b.on('error',e=>report.receipts.push({clientError:String(e)}));installRecipePacketBypass(b._client);await until(()=>b.ready&&b.world.getColumnAt(b.entity.position),'spawn');b.physicsEnabled=false;return b;}
let actor,last=0;const inventory=()=>actor.inventory.items().map(i=>[i.slot,i.name,i.count,JSON.stringify(i.nbt??i.components??null)]);
async function ask(q,pattern=/\[RPG\]|MC_RPG|\[技能\]/){await sleep(Math.max(0,1100-(Date.now()-last)));last=Date.now();const at=actor.messages.length;actor.chat(q);await until(()=>actor.messages.slice(at).some(s=>pattern.test(s)),q);await sleep(120);const text=actor.messages.slice(at).join('\n');report.receipts.push({q,text});return text;}
async function json(q,prefix='MC_RPG'){const text=await ask(q,new RegExp(prefix+' '));return JSON.parse(text.split('\n').find(s=>s.startsWith(prefix+' ')).slice(prefix.length+1));}
const state=()=>json('/mycli status --json');
try{
 await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule naturalRegeneration false');
 actor=await connect('ag_CLI'+label);const observer=await connect('ag_CLW'+label);await rc(`minecraft:gamemode survival ${actor.username}`);await rc(`minecraft:tp ${actor.username} 1802.5 81 1802.5`);await sleep(2500);
 const baseline=await state(),bag=JSON.stringify(inventory());check('new account starts unselected',baseline.class==='none');check('status contains live health and hunger',baseline.health>0&&baseline.food>=0&&baseline.queryOnly===true);
 const root=await json('/mycli --help --json','MC_CLI_HELP');check('one seven-item root page',root.commands.length===7&&root.commands[0].name==='status');
 check('bare root equals help',(await json('/mycli --json','MC_CLI_HELP')).commands.map(v=>v.name).join()===root.commands.map(v=>v.name).join());
 check('help alias is the same tree',(await json('/mycli help --json','MC_CLI_HELP')).total===root.total);
 const groups=new Set();for(let page=1;page<=root.pages;page++){const h=page===1?root:await json(`/mycli --help --page ${page} --json`,'MC_CLI_HELP');for(const row of h.commands){check('unique discoverable root '+row.name,!groups.has(row.name));groups.add(row.name);}}
 for(const group of ['rules','dungeon','inventory','guild','arena','archive','photo'])check('existing feature stays discoverable '+group,groups.has(group));
 const invHelp=await ask('/mycli inventory --help',/用法：/);check('inventory explains personal and shared storage',invHelp.includes('/mycli arena stash')&&invHelp.includes('/mycli guild shared'));
 const stash=await ask('/mycli arena stash --help',/用法：/);check('stash help explains default open and real cost',stash.includes('无子命令时')&&stash.includes('2魔力')&&!stash.includes('先学'));
 check('guild supplies on first help page',(await json('/mycli guild --help --json','MC_CLI_HELP')).commands.some(v=>v.name==='shared'));
 for(const q of ['/mycli profession choose knight --help','/mycli skills learn knight_guard --help','/mycli tasks accept qd_first_hunt --help'])check('write help is read-only '+q,(await json(q+' --json','MC_CLI_HELP')).readOnly===true);
 for(const q of ['/mycli profession choose knight extra','/mycli skills learn knight_guard --page 2','/mycli tasks accept qd_first_hunt --page 2','/mycli skills upgrade fortify']){const t=await ask(q);check('invalid action fails with repair path '+q,t.includes('invalid_argument')&&t.includes('下一步：/mycli')&&t.includes('未执行'));}
 const bad=await json('/mycli --json profession choose knight extra');check('leading JSON flag preserves invalid result',bad.success===false&&bad.changed===false&&bad.reason==='invalid_argument');
 const empty=await json('/mycli tasks status --json');check('query did not accept a quest',empty.activeCount===0);
 const first=await json('/mycli --json tasks list --page 1'),second=await json('/mycli tasks list --page 2 --json');
 check('native task pages are bounded and complete',first.quests.length<=7&&second.quests.length<=7&&first.quests.length+second.quests.length===first.total&&second.total===first.total);
 check('copyable next command retains format',first.nextCommand==='/mycli tasks list --page 2 --json');
 check('task page does not repeat rows',new Set([...first.quests,...second.quests].map(v=>v.id)).size===first.total);
 check('out of range is a recoverable read error',(await ask('/mycli tasks list --page 999')).includes('页码范围'));
 check('common skill shows actual target and cost',(await ask('/mycli spells info prospect')).includes('目标：'));
 const common=await json('/mycli skills info prospect --json');check('common query needs no learning',common.available&&common.queryOnly&&common.command.includes('prospect'));
 const training=await ask('/mycli progress training',/我的进度|专项|MC_QUERY_ERROR/);check('training filter is not silently replaced by RPG quests',training.includes('专项')&&!training.includes('当前没有进行中的任务'));
 const unknown=await ask('/mycli progress no_such_section',/MC_QUERY_ERROR|INVALID_ARGUMENT/);check('invalid progress section is rejected',unknown.includes('INVALID_ARGUMENT'));
 check('intro explicit JSON is a compact read',(await json('/mycli intro --json','MC_INTRO')).nextCommand==='/mycli status');
 const classMenu=await json('/mycli profession menu --json');await until(()=>actor.currentWindow,'actual class window');check('class menu is real and does not select',classMenu.selectionConfirmed===false&&(await state()).class==='none');actor.closeWindow(actor.currentWindow);
 check('queries and rejected writes preserve class',(await state()).class==='none');check('queries and rejected writes preserve XP',(await state()).xp===baseline.xp);check('queries and help preserve inventory',JSON.stringify(inventory())===bag);
 const choose=await json('/mycli profession choose knight --json');check('explicit choose saved',choose.success===true&&choose.saved===true);check('native profile really changed',(await state()).class==='knight');
 check('alias class uses same profile',(await json('/mycli class status --json')).class==='knight');
 check('old spell alias discovers current skill',(await json('/mycli spells list --json')).available.includes('fortify'));
 const mana=(await state()).mana;check('cast confirmed by the server',(await json('/mycli cast fortify --json')).success);check('cast spends actual native mana',(await state()).mana<mana);
 const accepted=await json('/mycli tasks accept qd_first_hunt --json');check('explicit task acceptance saved',accepted.success&&accepted.saved&&accepted.saveState==='saved');
 const progress=await json('/mycli tasks status qd_first_hunt --json');check('single-task query gives actual objective progress',progress.id==='qd_first_hunt'&&progress.summary.includes('0/2'));
 check('quest alias returns same focused task',(await json('/mycli quests status qd_first_hunt --json')).id==='qd_first_hunt');
 const failed=await json('/mycli tasks claim qd_first_hunt --json');check('unfinished claim cannot pretend success',failed.success===false);check('failed claim preserves objective',(await json('/mycli tasks status qd_first_hunt --json')).summary.includes('0/2'));
 const skillMenu=await json('/mycli skills menu --json');await until(()=>actor.currentWindow,'actual skill window');check('real skill menu does not claim learning',skillMenu.learningConfirmed===false);actor.closeWindow(actor.currentWindow);
 check('private results never reach nearby player',!observer.messages.some(s=>s.startsWith('MC_RPG ')||s.startsWith('MC_CLI_HELP ')||s.includes('[invalid_argument]')));
 report.identity={name:actor.username,uuid:actor.player.uuid};report.passed=true;
}catch(e){report.error=e.stack;throw e;}finally{await fs.writeFile(stage+'/agent-cli-'+label+'.json',JSON.stringify(report,null,2));for(const b of bots)b.quit();}
