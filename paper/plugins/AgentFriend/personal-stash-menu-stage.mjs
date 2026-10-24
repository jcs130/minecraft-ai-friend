// Real protocol regression; refuses every server except the explicit loopback
// fixture. Inventory clicks are serialized and verified before the next action.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';

const stage=path.resolve(process.env.MC_STASH_STAGE??'');
const properties=path.join(stage,'server.properties');
const text=fs.readFileSync(properties,'utf8');
assert(/^motd=STASH_MENU_ISOLATED_20261024$/m.test(text),'Explicit isolated fixture required');
assert(/^server-ip=127\.0\.0\.1$/m.test(text));
assert(/^server-port=38680$/m.test(text)&&/^rcon.port=38681$/m.test(text));
assert(process.env.MC_TEST_DEPENDENCIES&&process.env.MC_TEST_RCON,'Pass local test dependency and RCON modules');
const req=createRequire(path.resolve(process.env.MC_TEST_DEPENDENCIES));
const mineflayer=req('mineflayer');
const {command}=await import(pathToFileURL(path.resolve(process.env.MC_TEST_RCON)));
const rc=q=>command(q,20000,{port:38681,properties});
const clients=[];
const report={passed:false,resume:process.argv.includes('--resume'),checks:[]};
const check=(name,value)=>{assert(value,name);report.checks.push(name);};
const until=async(fn,label,timeout=16000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(fn())return;await sleep(80);}throw Error('Timed out: '+label);};
const title=b=>JSON.stringify(b.currentWindow?.title??'');
const count=(slots,name)=>slots.filter(i=>i?.name===name).reduce((sum,i)=>sum+i.count,0);
const cursorClear=b=>b.currentWindow?.selectedItem==null&&b.inventory.selectedItem==null;

async function join(username){
 const b=mineflayer.createBot({host:'127.0.0.1',port:38680,username,version:'1.21.1',auth:'offline',hideErrors:true,defaultChatPatterns:false});
 const c={b,states:[],messages:[],errors:[]};clients.push(c);
 b.on('messagestr',m=>c.messages.push(m));b.on('error',e=>c.errors.push(e.message));b.on('kicked',e=>c.errors.push(JSON.stringify(e)));
 b._client.on('custom_payload',p=>{if(p.channel==='mcviewer:state')try{c.states.push(JSON.parse(Buffer.from(p.data).toString('utf8')));}catch{}});
 await new Promise((resolve,reject)=>{b.once('spawn',resolve);b.once('error',reject);b.once('kicked',reject);});
 b._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcviewer:state')});
 await rc(`minecraft:gamemode survival ${username}`);
 await rc(`minecraft:tp ${username} 2000.5 91 2000.5`);
 await until(()=>c.states.at(-1)?.mana,'native mana state');
 await sleep(2200);
 b.chat('/mycli skills learn travel');
 await sleep(600);
 return c;
}
async function root(b){
 if(b.currentWindow)b.closeWindow(b.currentWindow);
 await sleep(250);b.chat('/mycli menu');
 await until(()=>b.currentWindow?.inventoryStart===45&&title(b).includes('技能罗盘'),'root compass');
}
async function open(c,right=false){
 await root(c.b);await c.b.clickWindow(8,right?1:0,0);
 await until(()=>right?title(c.b).includes('个人箱分页'):title(c.b).includes('个人试炼箱'),'direct stash menu');
 await sleep(250);
}

try{
 await rc('minecraft:forceload add 1992 1992 2008 2008');
 await rc('minecraft:fill 1997 90 1997 2004 90 2004 minecraft:stone');
 const actor=await join('ag_StashMenuQA'),b=actor.b;
 await root(b);
 check('45-slot compass retained',b.currentWindow.inventoryStart===45);
 check('personal stash is first-level slot 8',b.currentWindow.slots[8]?.name==='chest'&&JSON.stringify(b.currentWindow.slots[8]).includes('个人试炼箱'));
 check('stash help distinguishes photos and backpack',/照片/.test(JSON.stringify(b.currentWindow.slots[8]))&&/大背包独立/.test(JSON.stringify(b.currentWindow.slots[8])));
 check('close moved to separator row slot 35',b.currentWindow.slots[35]?.name==='barrier');
 check('all nine quick casts retained',b.currentWindow.slots.slice(36,45).every(Boolean));
 check('photo remains first-level slot 17',b.currentWindow.slots[17]?.name==='spyglass'&&JSON.stringify(b.currentWindow.slots[17]).includes('个人奖励箱'));
 await b.clickWindow(35,0,0);await until(()=>!b.currentWindow,'close from new slot');check('new close button actually closes',!b.currentWindow);
 await open(actor);
 check('left click directly opens original page 1',b.currentWindow.inventoryStart===54&&title(b).includes('1/10'));
 if(report.resume){
  check('stash item survives normal server restart',count(b.currentWindow.slots.slice(0,54),'quartz')===2);
  check('withdrawn item survives normal server restart',count(b.inventory.slots,'quartz')===3);
 }else{
  check('new account stash is empty',count(b.currentWindow.slots.slice(0,54),'quartz')===0);
  b.closeWindow(b.currentWindow);await sleep(250);
  await rc('minecraft:clear ag_StashMenuQA minecraft:quartz');
  await until(()=>count(b.inventory.slots,'quartz')===0,'reset isolated fixture item');
  await rc('minecraft:give ag_StashMenuQA minecraft:quartz 5');
  await until(()=>count(b.inventory.slots,'quartz')===5,'five actual inventory items');
  await open(actor);await b.transfer({window:b.currentWindow,itemType:req('minecraft-data')('1.21.1').itemsByName.quartz.id,metadata:null,count:3,sourceStart:54,sourceEnd:90,destStart:0,destEnd:54});
  await until(()=>count(b.currentWindow.slots.slice(0,54),'quartz')===3&&cursorClear(b),'deposit slot and cursor acknowledgement');
  check('deposit reaches server slots with empty cursor',count(b.currentWindow.slots.slice(54),'quartz')===2&&cursorClear(b));
  b.closeWindow(b.currentWindow);await sleep(300);await open(actor);
  check('close and reopen retains deposited items',count(b.currentWindow.slots.slice(0,54),'quartz')===3);
  await b.transfer({window:b.currentWindow,itemType:req('minecraft-data')('1.21.1').itemsByName.quartz.id,metadata:null,count:1,sourceStart:0,sourceEnd:54,destStart:54,destEnd:90});
  await until(()=>count(b.currentWindow.slots.slice(0,54),'quartz')===2&&cursorClear(b),'withdraw acknowledgement');
  b.closeWindow(b.currentWindow);await until(()=>count(b.inventory.slots,'quartz')===3,'withdrawn inventory');
  check('round trip conserves five items with no cursor residue',count(b.inventory.slots,'quartz')===3&&cursorClear(b));
  const native=await rc('minecraft:data get entity ag_StashMenuQA Inventory[{id:"minecraft:quartz"}].count');
  check('native saved inventory confirms three items',/entity data: 3\b/.test(native));
 }
 const manaBefore=actor.states.at(-1).mana.current;
 await open(actor,true);
 check('right click shows ten pages',b.currentWindow.inventoryStart===27&&b.currentWindow.slots.slice(0,10).every(i=>i?.name==='chest'));
 check('selector shows full 540-slot capacity',title(b).includes('540'));
 check('page selector does not spend mana',actor.states.at(-1).mana.current>=manaBefore-0.05);
 await b.clickWindow(1,0,0);await until(()=>title(b).includes('2/10'),'select second original page');
 check('page 2 opens through existing storage',b.currentWindow.inventoryStart===54&&count(b.currentWindow.slots.slice(0,54),'quartz')===0);
 b.closeWindow(b.currentWindow);
 const peer=await join('StashPeerQA');await open(peer);
 check('ordinary Java player can use first-level stash',peer.b.currentWindow.inventoryStart===54);
 check('different accounts never share stash contents',count(peer.b.currentWindow.slots.slice(0,54),'quartz')===0);
 check('no network client errors',clients.every(c=>c.errors.length===0));
 report.passed=true;
}catch(e){report.error=e.stack;report.clients=clients.map(c=>({name:c.b.username,title:title(c.b),position:c.b.entity?.position,mana:c.states.at(-1)?.mana,lastMessages:c.messages.slice(-18),errors:c.errors}));process.exitCode=1;}
finally{
 for(const c of clients)c.b.quit();await sleep(500);
 fs.writeFileSync(path.join(stage,report.resume?'stash-menu-resume.json':'stash-menu-initial.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
