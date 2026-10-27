/** Native Multiverse + unchanged Mineflayer acceptance; loopback QA only. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/aincrad-conquest-20261027',label=process.argv[2];
assert(/^[a-z0-9]+$/.test(label));
const props=await fs.readFile(stage+'/server.properties','utf8');
assert.match(props,/^server-port=25924\r?$/m);assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/QD_AINCRAD_CONQUEST_QA_ONLY/);
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),bots=[],report={checks:[],errors:[],receipts:[],productionModified:false};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const rc=async q=>{const t=await command(q,15000,{properties:stage+'/server.properties',port:25925});report.receipts.push({q,t});return t;};
const dimension=async b=>rc('minecraft:data get entity '+b.username+' Dimension');
// /data get Inventory truncates a large NBT tree. Query small scalar fields
// instead; restored starter tools must not be mistaken for lost test items.
const inventory=async b=>{
 const values=[];
 for(const path of ['Inventory[{Slot:0b}].id','Inventory[{Slot:0b}].count','Inventory[{Slot:-106b}].id','Inventory[{Slot:-106b}].count','Inventory[{id:"minecraft:cobblestone"}].count'])
  values.push(await rc('minecraft:data get entity '+b.username+' '+path));
 assert(values.every(s=>s.includes('entity data:')&&!s.includes('...')),'untruncated seeded-item evidence required');return values.join('\n');
};
async function bot(username){
 const b=mf.createBot({host:'127.0.0.1',port:25924,version:'1.21.1',auth:'offline',username,defaultChatPatterns:false,checkTimeoutInterval:60000});
 bots.push(b);b.messages=[];b.on('messagestr',s=>b.messages.push(s));b.on('error',e=>report.errors.push(e.message));b.on('kicked',e=>report.errors.push(JSON.stringify(e)));installRecipePacketBypass(b._client);
 await Promise.race([new Promise(r=>b.once('spawn',r)),sleep(30000).then(()=>{throw Error('join timeout');})]);
 if(username==='MVEyeQA')await rc('minecraft:gamemode spectator '+username);
 await sleep(1800);return b;
}
async function chat(b,q){await sleep(1150);const start=b.messages.length;b.chat(q);await sleep(650);return b.messages.slice(start);}
async function profession(b){const rows=await chat(b,'/mycli profession');const row=rows.find(s=>s.startsWith('MC_PROFESSION '));assert(row,rows.join('\n'));return JSON.parse(row.slice('MC_PROFESSION '.length));}
async function transfer(b,destination){await rc('mv tp '+b.username+' '+destination);await sleep(1200);}
try{
 // Keep natural monsters out of the QA inventory checkpoint. Earlier evidence
 // correctly showed a zombie kill and dropped items, rather than an MV loss.
 await rc('minecraft:execute in minecraft:overworld run minecraft:gamerule doMobSpawning false');
 for(const type of ['zombie','creeper','skeleton','spider','husk','stray','drowned','witch'])
  await rc('minecraft:execute in minecraft:overworld positioned 0 64 0 run minecraft:kill @e[type=minecraft:'+type+',distance=..96]');
 const a=await bot('ag_ACMage'),eye=await bot('MVEyeQA');
 check('official Multiverse enabled',(await rc('version Multiverse-Core')).includes('5.8.1'));
 if(!label.startsWith('cold')){
  await rc('qdqa setup '+a.username);
  await rc('minecraft:give '+a.username+' minecraft:cobblestone 17');
  for(const q of ['/mycli profession choose mage','/mycli skills learn mage_soar','/mycli skills prepare mage_soar'])await chat(a,q);
  await rc('mv import aincrad normal');
  const existing=await rc('minecraft:execute in minecraft:qd_floor_qa run minecraft:worldborder get');
  if(!/block\(s\) wide/.test(existing)){
   await rc('mv create qd_floor_qa normal --world-type flat --seed 1027 --no-structures');
   for(let i=0;i<30;i++){if(/block\(s\) wide/.test(await rc('minecraft:execute in minecraft:qd_floor_qa run minecraft:worldborder get')))break;await sleep(500);}
  }
  check('native MV creates a real separate world',/block\(s\) wide/.test(await rc('minecraft:execute in minecraft:qd_floor_qa run minecraft:worldborder get')));
  await rc('minecraft:execute in minecraft:qd_floor_qa run minecraft:gamerule doMobSpawning false');
  await rc('minecraft:execute in minecraft:qd_floor_qa run minecraft:setblock 14 64 14 minecraft:emerald_block');
  const before=await inventory(a);report.originalInventory=before;report.originalProfession=await profession(a);
  check('real mage and prepared soar exist',report.originalProfession.combat==='mage'&&report.originalProfession.prepared.includes('mage_soar'));
  check('seeded stack really contains seventeen blocks',before.includes('entity data: 17'));
  await rc('qdqa mana '+a.username);report.soar=await chat(a,'/mycli cast mage_soar');await sleep(1500);
  check('MV does not erase a real paid flight lease',(await rc('acqa inspect '+a.username)).includes('allow=true'));
  await transfer(a,'w:qd_floor_qa');check('native MV teleport reaches a separate world',(await dimension(a)).includes('qd_floor_qa'));
  check('seeded sword shield and block count preserved across transfer',before===await inventory(a));
  const after=await profession(a);check('profession and prepared skill preserved',after.combat===report.originalProfession.combat&&JSON.stringify(after.prepared)===JSON.stringify(report.originalProfession.prepared));
  check('server-owned flight is safely revoked on world change',(await rc('acqa inspect '+a.username)).includes('allow=false'));
  await rc('minecraft:gamemode spectator '+eye.username);await transfer(eye,'w:qd_floor_qa');
  check('spectator mode is not changed to survival',eye.game.gameMode==='spectator');
  await transfer(a,'e:aincrad:-582.5,69,934.5');check('existing city can be explicitly imported without replacing it',(await dimension(a)).includes('aincrad'));
  check('Aincrad transfer retains seeded items',before===await inventory(a));
  check('city entrance chunks reach unmodified Mineflayer',a.blockAt(a.entity.position.offset(0,-1,0).floored())!==null);
  check('city world has no restrictive exploration border',Number((await rc('minecraft:execute in minecraft:aincrad run minecraft:worldborder get')).match(/currently (\d+)/)?.[1])>10000000);
  await transfer(a,'w:world');check('return transfer reaches original world',(await dimension(a)).includes('overworld'));
  check('round trip retains seeded items and exact counts',before===await inventory(a));
  await chat(a,'/mv create qd_forbidden normal');
  check('ordinary Agent cannot create arbitrary worlds',!/block\(s\) wide/.test(await rc('minecraft:execute in minecraft:qd_forbidden run minecraft:worldborder get')));
  const reference=JSON.stringify({inventory:before,profession:report.originalProfession},null,2);
  await fs.writeFile(stage+'/mv-inventory-reference-'+label+'.json',reference,{flag:'wx'});
  await fs.writeFile(stage+'/mv-inventory-reference.json',reference);
 }else{
  const saved=JSON.parse(await fs.readFile(stage+'/mv-inventory-reference.json','utf8'));
  check('normal restart preserves seeded items and exact counts',saved.inventory===await inventory(a));
  const state=await profession(a);check('normal restart preserves profession and preparation',state.combat===saved.profession.combat&&JSON.stringify(state.prepared)===JSON.stringify(saved.profession.prepared));
  check('MV world is automatically loaded after normal restart',/block\(s\) wide/.test(await rc('minecraft:execute in minecraft:qd_floor_qa run minecraft:worldborder get')));
  check('new world block is persisted',/Test passed/.test(await rc('minecraft:execute in minecraft:qd_floor_qa if block 14 64 14 minecraft:emerald_block')));
  await transfer(a,'w:qd_floor_qa');check('persisted world remains reachable by ordinary client',(await dimension(a)).includes('qd_floor_qa'));
  check('cold transfer preserves inventory',saved.inventory===await inventory(a));
  await transfer(a,'w:world');check('cold return to home succeeds',(await dimension(a)).includes('overworld'));
 }
 check('all standard clients remain connected',bots.every(b=>b._client.state==='play'));
}catch(e){report.errors.push(e.stack||String(e));report.messages=bots.map(b=>({name:b.username,last:b.messages.slice(-10)}));}
finally{for(const b of bots)b.quit('multiverse QA complete');await sleep(300);await fs.writeFile(stage+'/client-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));process.exit(report.errors.length?1:0);}
