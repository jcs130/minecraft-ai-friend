import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const require=createRequire(process.env.MINEFLAYER_PACKAGE),{createBot}=require('mineflayer'),{Vec3}=require('vec3');
const stage=process.env.PLAYER_NAVIGATION_STAGE;
assert.equal(await readFile(stage+'/.player-navigation-qa','utf8'),'SYNTHETIC_PLAYER_NAVIGATION_ONLY');
const settings=await readFile(stage+'/server.properties','utf8');
for(const line of ['server-ip=127.0.0.1','server-port=26461','rcon.port=26462'])assert(settings.split(/\r?\n/).includes(line));
const rc=text=>command(text,20000,{port:26462,properties:stage+'/server.properties'});
const qa=async action=>{const r=await rc('usabilityqa '+action),m=r.match(/USABILITY_QA (\{[^\r\n]+\})/);assert(m,r);return JSON.parse(m[1]);};
const report={synthetic:true,checks:[]},bots=[];
function check(name,v){report.checks.push({name,passed:!!v});console.log(v?'PASS':'FAIL',name);assert(v,name);}
async function until(fn,name,ms=20000){for(let end=Date.now()+ms;Date.now()<end;){let v=await fn();if(v)return v;await wait(100);}throw Error('timeout '+name);}
async function spawn(name){let b=createBot({host:'127.0.0.1',port:26461,username:name,auth:'offline',version:'1.21.1',physicsEnabled:false,hideErrors:true});bots.push(b);b.lines=[];b.raw=[];b.on('messagestr',s=>b.lines.push(s));b.on('message',m=>b.raw.push(JSON.stringify(m.json)));b.on('error',()=>{});installRecipePacketBypass(b._client);await until(()=>b.entity&&b.player?.uuid,name,45000);return b;}
const title=b=>JSON.stringify(b.currentWindow?.title||'');
async function close(b){if(b.currentWindow)b.closeWindow(b.currentWindow);await wait(250);}
async function chat(b,text,pattern){const start=b.lines.length;b.chat(text);await until(()=>b.lines.slice(start).some(l=>pattern.test(l)),text);return b.lines.slice(start);}
try{
 const a=await spawn('NavActorQA'),b=await spawn('NavTargetQA');await wait(3000);
 await rc('navqa setup public');await qa('stash-seed');
 const summaryLines=await chat(a,'/mycli arena stash summary --json',/MC_STASH_OVERVIEW/);
 const summary=JSON.parse(summaryLines.find(l=>l.includes('MC_STASH_OVERVIEW')).split('MC_STASH_OVERVIEW ')[1]);
 check('free CLI summary sees all 540 slots including page ten',summary.capacity===540&&summary.occupiedSlots===1&&summary.freeSlots===539&&summary.totalItems===1);
 check('summary provides categories and a real occupied page command',summary.nextCommand==='/mycli arena stash list 10'&&JSON.stringify(summary).includes('weapons'));
 a.chat('/mycli arena stash pages');await until(()=>title(a).includes('540'),'ten-page directory');
 check('all ten pages are visible to an ordinary client',a.currentWindow.slots.slice(0,10).every(s=>s?.name==='chest')&&!(await qa('status')).actorOp);
 check('directory explains private storage versus backpack and shared chests',JSON.stringify(a.currentWindow.slots[22]).includes('共享'));
 await a.clickWindow(9,0,0);await until(async()=>a.currentWindow?.inventoryStart===54&&(await qa('status')).actorPage===10,'page ten');
 check('tenth page preserves all 54 usable slots and original equipment',a.currentWindow.slots[53]?.name==='diamond_sword');
 check('chat provides a working directory command',a.raw.some(l=>l.includes('/mycli arena stash pages')));
 b.chat('/mycli arena stash pages');await until(()=>title(b).includes('540'),'second private directory');await b.clickWindow(9,0,0);await until(()=>b.currentWindow?.inventoryStart===54,'second private page');
 check('different players retain different private items',b.currentWindow.slots[53]?.name==='apple'&&a.currentWindow.slots[53]?.name==='diamond_sword');
 await close(a);await close(b);await rc('navqa menu');await until(()=>a.currentWindow,'home');
 await a.clickWindow(10,0,0);await wait(200);await a.clickWindow(20,0,0);await until(()=>title(a).includes('通用'),'common skill catalog');
 check('common spells have a second page',a.currentWindow.slots[30]?.name==='arrow');await a.clickWindow(30,0,0);await wait(300);
 check('restored utility spells are reachable without selecting a class',JSON.stringify(a.currentWindow.slots.slice(0,27)).includes('烟花')&&JSON.stringify(a.currentWindow.slots.slice(0,27)).includes('星尘'));
 await close(a);let list=await chat(a,'/mycli skills list common --json',/MC_RPG/);
 check('CLI and GUI include all sixteen common skills',list.some(l=>['leap','fireworks','starlight','team','travel'].every(id=>l.includes(id))));
 const preview=await rc('mycli admin trialsupplies preview');check('shared facilities have an explicit non-mutating preflight',preview.includes('preview=true')||preview.includes('target_not_empty')||preview.includes('previous_install_requires_review')||preview.includes('installed=true'));
 await qa('shared-floor');const installed=await rc('mycli admin trialsupplies install');report.install=installed;check('three physical double chests install empty',installed.includes('installed=true')&&installed.includes('intact=true'));
 await qa('shared-seed');let blocks=await qa('status');check('all three shared chests have 54 slots',blocks.sharedSlots.every(n=>n===54));
 await qa('shared-near');await wait(500);
 await a.activateBlock(a.blockAt(new Vec3(-583,91,-314)));await until(()=>a.currentWindow?.inventoryStart===54,'ordinary player shared open');
 await b.activateBlock(b.blockAt(new Vec3(-583,91,-314)));await until(()=>b.currentWindow?.inventoryStart===54,'second shared open');
 check('both clients see the same shared arrows',a.currentWindow.slots[0]?.count===12&&b.currentWindow.slots[0]?.count===12);
 await a.clickWindow(0,0,1);await until(()=>!b.currentWindow.slots[0],'shared extraction synchronization');
 check('taking shared items changes the single real inventory',a.inventory.items().some(i=>i.name==='arrow'&&i.count>=12)&&!b.currentWindow.slots[0]);
 const second=await rc('mycli admin trialsupplies install');check('repeated installation does not refill taken supplies',second.includes('intact=true')&&!b.currentWindow.slots[0]);
 await qa('shared-break');check('public infrastructure remains protected from breaking',a.lines.some(l=>l.includes('QA_SHARED_BREAK_CANCELLED=true')));
 await close(a);await close(b);let privateState=await qa('status');check('shared use never merges personal warehouses',privateState.actorPage10.includes('DIAMOND_SWORD')&&privateState.targetPage10.includes('APPLE'));
 // The real native quest ledger and real claim command decide completion and rewards.
 const at=a.lines.length;a.chat('/mycli tasks accept first_blood');await until(()=>a.lines.slice(at).some(l=>l.includes('任务已接取')||l.includes('already')||l.includes('已接取')),'native quest acceptance');
 await qa('quest-progress');await until(()=>a.lines.some(l=>l.includes('MC_QUEST_READY id=first_blood')),'native ready notice',25000);
 check('completed objectives explicitly say reward is not yet claimed',a.lines.some(l=>l.includes('MC_QUEST_READY id=first_blood')&&l.includes('rewardClaimed=false')));
 check('ready notice supplies a clickable native claim command',a.raw.some(l=>l.includes('/mycli tasks claim first_blood')));
 check('another account receives no copied ready notice',!b.lines.some(l=>l.includes('MC_QUEST_READY id=first_blood')));
 const beforeCount=a.lines.filter(l=>l.includes('MC_QUEST_READY id=first_blood')).length;await wait(11000);check('polling does not spam duplicate ready notices',a.lines.filter(l=>l.includes('MC_QUEST_READY id=first_blood')).length===beforeCount);
 await chat(a,'/mycli tasks claim first_blood',/任务已交付/);let progress=await chat(a,'/mycli tasks status first_blood --json',/MC_RPG/);check('native claim actually releases the active task',progress.some(l=>l.includes('已交付')));
 report.success=true;
}catch(e){report.error=String(e.stack||e);report.lastLines=bots[0]?.lines.slice(-12);console.error(report.error);process.exitCode=1;}
finally{bots.forEach(b=>b.quit());await writeFile(stage+'/usability-client.json',JSON.stringify(report,null,2));}
