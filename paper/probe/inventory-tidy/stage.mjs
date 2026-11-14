/** Real original commands, synthetic accounts, existing marked flat-world stage only. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire}from'node:module';import{setTimeout as delay}from'node:timers/promises';import{pathToFileURL}from'node:url';
const stage=process.env.STASH_QA_STAGE,root=process.env.STASH_QA_REPORT_ROOT,anchor=process.env.STASH_QA_CLIENT_ANCHOR,bridge=process.env.STASH_QA_RCON;
assert(stage&&root&&anchor&&bridge);assert.equal(await fs.readFile(stage+'/.shop-qa','utf8'),'FRESH_RPG_SHOP_QA_NO_PLAYER_DATA');
const properties=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(properties)&&/^server-port=25928$/m.test(properties)&&/^rcon.port=25929$/m.test(properties));
const {command}=await import(pathToFileURL(bridge)),mf=createRequire(anchor)('mineflayer');const rc=s=>command(s,15000,{port:25929,properties:stage+'/server.properties'});
const baseline=process.argv.includes('--baseline'),restart=process.argv.includes('--restart'),faults=process.argv.includes('--faults'),overview=process.argv.includes('--overview'),out={at:new Date().toISOString(),baseline,restart,faults,overview,checks:[],productionChanged:false,syntheticAccountsOnly:true},bots=[];
const check=(label,ok)=>{out.checks.push({label,passed:!!ok});console.log((ok?'PASS ':'FAIL ')+label);if(!ok&&!baseline)throw Error(label);};
const until=async(f,label,ms=20000)=>{for(let end=Date.now()+ms;Date.now()<end;){const r=await f();if(r)return r;await delay(80);}throw Error('Timed out: '+label);};
let last=0;async function ask(p,s,prefix){await delay(Math.max(0,1100-(Date.now()-last)));last=Date.now();const at=p.lines.length;p.chat(s);await until(()=>p.lines.length>at,s);await delay(350);const lines=p.lines.slice(at);if(!prefix)return lines.join('\n');const line=lines.find(l=>l.startsWith(prefix+' '));assert(line,'No '+prefix+' receipt for '+s+'; '+lines.join('\n'));return JSON.parse(line.slice(prefix.length+1));}
async function connect(suffix){
 const player=mf.createBot({host:'127.0.0.1',port:25928,version:'1.21.1',
  username:'ag_RUStash'+suffix,auth:'offline',hideErrors:true,
  plugins:{physics:false},
 });
 bots.push(player);player.lines=[];
 player.on('messagestr',text=>player.lines.push(text));
 player.on('error',error=>out.clientError=String(error));
 player.on('kicked',reason=>out.clientError=JSON.stringify(reason));
 player.once('login',()=>player._client.write('custom_payload',{
  channel:'minecraft:register',data:Buffer.from(['mcagent:board','mcagent:market'].join(String.fromCharCode(0))),
 }));
 // These cases never drive the player. Acknowledge the server's teleport without sending movement.
 player._client.on('position',packet=>player._client.write('teleport_confirm',{teleportId:packet.teleportId}));
 await until(()=>player.entity&&player.player?.uuid,'QA login',90000);
 assert.match(await rc('qdstash place '+player.username),/STASH_QA placed/);
 await rc('minecraft:gamemode survival '+player.username);
 await rc('qdstash mana '+player.username);
 return player;
}
const setup=(p,mode='full')=>rc('qdstash reset '+p.username+' '+mode);
async function fixtureRead(player, action) {
 const response=await rc('qdstash '+action+' '+player.username);
 const json=response.split('STASH_QA ')[1];
 assert(json,'Fixture '+action+' failed for '+player.username+': '+response);
 return JSON.parse(json.trim());
}
const read=player=>fixtureRead(player,'read');
const row=(v,n)=>v.bag.find(r=>r.slot===n);
const summaryCommand='/mycli arena stash summary';
const summaryPrefix='MC_STASH_OVERVIEW';
const overviewState=player=>fixtureRead(player,'overview-state');
const nearFull=(p,free)=>rc('qdstash near-full '+p.username+' '+free);
const inventoryEvent=async p=>assert.match(await rc('qdstash held-event '+p.username),/STASH_QA held-event/);
const nearHint=line=>line.includes('【背包快满】');
async function verifyOverview() {
 const a=await connect('n');
 await nearFull(a,36);
 const other=await connect('o');
 await nearFull(other,36);
 // Let normal join-time provision checks finish before making a controlled bag.
 await delay(4500);
 const empty=await ask(other,summaryCommand+' --json',summaryPrefix);
 check('separate synthetic owner has all 540 slots free',empty.totalItems===0&&empty.occupiedSlots===0&&empty.freeSlots===540);
 await rc('qdstash overview '+a.username);
 const otherMessages=other.lines.length;
 const before=await overviewState(a);
 const summary=await ask(a,summaryCommand+' --json',summaryPrefix);
 assert.deepEqual(summary.categories,{
  weapons:{items:2,occupiedSlots:2,pages:[10]},
  armor:{items:1,occupiedSlots:1,pages:[1]},
  consumables:{items:36,occupiedSlots:2,pages:[10]},
  other:{items:51,occupiedSlots:2,pages:[10]},
 });
 check('exact category quantities, distinct occupied slots, and page indexes',
  summary.pageCount===10&&summary.pageSize===54&&summary.totalItems===90&&summary.occupiedSlots===7&&summary.freeSlots===533);
 check('pending rewards have their own counter and usable next command',
  summary.pendingRewardEntries===1&&summary.nextCommand==='/mycli arena rewards list');
 const plain=await ask(a,summaryCommand);
 check('plain results display actual pieces and capacity in one private message',
  plain.includes('7/540')&&plain.includes('90 件')&&plain.includes('武器及法器 2')&&plain.includes('消耗品 36'));
 const error=await ask(a,summaryCommand+' '+other.username+' --json','MC_QUERY_ERROR');
 check('no target argument or cross-player inventory access',error.errorCode==='INVALID_ARGUMENT');
 const after=await overviewState(a);
 assert.deepEqual(after,before);
 check('summary leaves saved data, live page, inventory, mana and reward queue unchanged',
  !before.lastPageLoaded&&after.pending===14&&!a.currentWindow);
 check('another connection never receives the owner inventory summary',
  !other.lines.slice(otherMessages).some(line=>line.startsWith(summaryPrefix)||line.includes('个人箱 7/540')));

 let cursor=a.lines.length;
 await nearFull(a,4);
 await inventoryEvent(a);await delay(750);
 check('four vacancies do not trigger a warning',!a.lines.slice(cursor).some(nearHint));
 await nearFull(a,3);
 await inventoryEvent(a);
 const hint=await until(()=>a.lines.slice(cursor).find(nearHint),'personal stash warning with three free slots',4500)
  .catch(async error=>{out.adviceState=await fixtureRead(a,'advice-state');out.lastMessages=a.lines.slice(-9);throw error;});
 check('registered agent receives exact private pressure, category and deposit guidance',
  hint.includes('只剩 3 格')&&hint.includes('533 格')&&hint.includes('putslot 9 6')&&hint.includes('消耗品 36'));
 check('advice sends no automatic deposit', (await read(a)).bag.find(item=>item.slot===9)?.count===6);
 cursor=a.lines.length;
 await inventoryEvent(a);await delay(750);
 check('near-full notifications are rate-limited',!a.lines.slice(cursor).some(nearHint));
 cursor=other.lines.length;
 await nearFull(other,3);
 await inventoryEvent(other);await delay(750);
 check('unregistered player does not receive the agent reminder',!other.lines.slice(cursor).some(nearHint));
 cursor=a.lines.length;
 await nearFull(a,0);
 await rc('qdstash drop '+a.username);
 const full=await until(()=>a.lines.slice(cursor).find(line=>line.includes('【inventory_full】')),'full inventory event bypasses a recent near-full reminder');
 check('the first blocked pickup escalates without moving anything',full.includes('物品未全部装入背包')&&full.includes('putslot 9 6'));
 a.quit();
 await delay(900);
 const same=await connect('n');
 await nearFull(same,0);
 await rc('qdstash drop '+same.username);
 await delay(4400);
 check('reconnecting does not bypass the warning interval',
  !same.lines.some(line=>line.includes('【inventory_full】')));
}
try{
 await until(async()=>{try{return(await rc('version StashGuidanceQA')).includes('version');}catch{return false;}},'isolated startup',180000);
 if(overview) await verifyOverview();
 else {
 const a=await connect(faults?'c':restart?'b':'a');
 if(faults){
 await setup(a);const before=await read(a);await rc('qdstash saveblock '+a.username+' on');
 try{
 const result=await ask(a,'/mycli inventory tidy --discard-common --json','MC_INVENTORY_TIDY');out.faultReceipt=result;const after=await read(a);
 check('native player-save failure reports unknown instead of success',!result.success&&result.reason==='save_unverified'&&result.outcomeUnknown&&result.changed===null&&result.retrySameAction===false);
 check('failed save restores the original runtime inventory',before.bagHash===after.bagHash&&before.stashHash===after.stashHash);
 const again=await ask(a,'/mycli inventory tidy --discard-common --json','MC_INVENTORY_TIDY');check('unverified persistence blocks repeat mutations',!again.success&&again.previousOutcomeUnknown&&again.changed===false);
 }finally{await rc('qdstash saveblock '+a.username+' off');}
 }else if(restart){const status=await ask(a,'/mycli inventory tidy auto status --json','MC_INVENTORY_TIDY');check('auto preference persists normal game restart',status.enabled&&status.discardCommon);const state=await read(a);check('original synthetic named/enchanted items survive restart',[11,12,13,14].every(n=>row(state,n)?.meta));await ask(a,'/mycli inventory tidy auto off --json','MC_INVENTORY_TIDY');}
 else{
 await setup(a);let text=await ask(a,'/mycli arena stash putslot 9 21');check('full stash putslot names stash_full and a usable query',text.includes('moved=0')&&text.includes('reason=stash_full')&&text.includes('/mycli trade recycle list'));
 text=await ask(a,'/mycli inventory');check('full inventory hint never repeats an impossible deposit',!text.includes('putslot 9 21')&&text.includes('540/540'));
 text=await ask(a,'/mycli trade recycle quote --help');check('trade quote help matches 300-second server expiry',text.includes('300秒')&&text.includes('expiresAt'));
 if(!baseline){
 const before=await read(a);let result=await ask(a,'/mycli inventory tidy --dry-run --discard-common --json','MC_INVENTORY_TIDY');let after=await read(a);
 check('preview is read only',result.dryRun&&result.changed===false&&before.bagHash===after.bagHash&&before.stashOccupied===after.stashOccupied);
 check('preview reports bounded common disposal',result.freedSlots===3&&result.discarded.reduce((n,r)=>n+r.count,0)===73);
 result=await ask(a,'/mycli inventory tidy --json','MC_INVENTORY_TIDY');after=await read(a);
 check('default merges ordinary duplicates without discarding',result.freedSlots===1&&result.discarded.length===0&&row(after,9).count===21&&row(after,10).count===52&&row(after,16).count===48);
 result=await ask(a,'/mycli inventory tidy --discard-common --json','MC_INVENTORY_TIDY');after=await read(a);
 check('explicit tidy discards only plain main-bag whitelist',result.freedSlots===2&&!row(after,9)&&!row(after,10));
 check('hotbar, named, enchanted and tagged items survive',before.protectedHash===after.protectedHash);
 check('armor and offhand remain exact',before.armorHash===after.armorHash&&before.offhandHash===after.offhandHash);
 check('tidy never changes the personal stash',before.stashOccupied===after.stashOccupied);
 const once=after.bagHash;result=await ask(a,'/mycli inventory tidy --discard-common --json','MC_INVENTORY_TIDY');after=await read(a);check('repeated tidy is idempotent',!result.changed&&result.discarded.length===0&&after.bagHash===once);
 await setup(a,'partial');text=await ask(a,'/mycli inventory');check('occupied stash with compatible space recommends only what fits',text.includes('putslot 9 4')&&!text.includes('putslot 9 21'));
 text=await ask(a,'/mycli arena stash putslot 9 21');after=await read(a);check('partial storage reports actual movement and remaining item',text.includes('moved=4')&&text.includes('reason=partial')&&row(after,9).count===17);
 await setup(a,'space');text=await ask(a,'/mycli arena stash putslot 9 21');after=await read(a);check('normal storage remains usable',text.includes('moved=21')&&!row(after,9));
 await setup(a);const locked=await read(a);await rc('qdstash pvp '+a.username+' on');text=await ask(a,'/mycli inventory tidy --discard-common --json');after=await read(a);check('PvP recovery retains the existing native command lock',text.includes('PvP原物品正在恢复')&&locked.bagHash===after.bagHash);
 result=JSON.parse((await rc('mycli admin inventorytidy '+a.player.uuid+' --discard-common --json')).split('MC_INVENTORY_TIDY ')[1].trim());check('console maintenance cannot bypass PvP recovery',!result.success&&result.reason==='pvp_inventory_locked');await rc('qdstash pvp '+a.username+' off');
 await ask(a,'/mycli arena stash page 1');await until(()=>a.currentWindow,'native chest');result=await ask(a,'/mycli inventory tidy --discard-common --json','MC_INVENTORY_TIDY');after=await read(a);check('open container blocks tidying',!result.success&&result.reason==='close_container_first'&&locked.bagHash===after.bagHash);a.closeWindow(a.currentWindow);await delay(300);
 await setup(a,'tidystash');const stashBefore=await read(a);result=await ask(a,'/mycli inventory tidy stash --dry-run --discard-common --json','MC_INVENTORY_TIDY');after=await read(a);
 check('all ten stash pages preview without changing either inventory',result.dryRun&&result.scope==='personal_stash_all_10_pages'&&after.stashHash===stashBefore.stashHash&&after.bagHash===stashBefore.bagHash);
 check('stash preview distinguishes exact equipment duplicates from trash',result.recyclableDuplicatesBeyondTwo===1&&result.discarded.reduce((n,r)=>n+r.count,0)===47);
 result=await ask(a,'/mycli inventory tidy stash --json','MC_INVENTORY_TIDY');after=await read(a);check('stash default merges across distant pages without discarding',result.freedSlots===2&&result.discarded.length===0&&after.stashProtectedHash===stashBefore.stashProtectedHash&&after.bagHash===stashBefore.bagHash);
 check('merged stash places armor and weapons ahead of materials',after.firstStashItem==='IRON_HELMET'&&result.sortOrder==='equipment_first_common_last');
 text=await ask(a,'/mycli admin inventorytidy '+a.player.uuid+' stash --discard-common');after=await read(a);check('ordinary role cannot use console maintenance',text.includes('仅服务器控制台')&&after.stashOccupied===stashBefore.stashOccupied-2);
 result=JSON.parse((await rc('mycli admin inventorytidy '+a.player.uuid+' stash --discard-common --json')).split('MC_INVENTORY_TIDY ')[1].trim());after=await read(a);
 check('console cleanup uses the original online UUID and own stash',result.success&&result.serverOperator&&result.playerUuid===a.player.uuid&&result.freedSlots===3&&after.bagHash===stashBefore.bagHash);
 check('named enchanted tagged stash items and all equipment remain exact',after.stashProtectedHash===stashBefore.stashProtectedHash);
 result=await ask(a,'/mycli inventory tidy stash --discard-common --json','MC_INVENTORY_TIDY');check('stash disposal is idempotent',!result.changed&&result.freedSlots===0&&result.discarded.length===0);
 await setup(a,'tidystash');const unsorted=await read(a);
 let stashAuto=await ask(a,'/mycli inventory tidy stash auto status --json','MC_INVENTORY_TIDY');check('personal stash automatic ordering defaults off',!stashAuto.enabled&&stashAuto.action==='stash_auto');
 stashAuto=await ask(a,'/mycli inventory tidy stash auto on --json','MC_INVENTORY_TIDY');check('automatic ordering preserves all materials',stashAuto.enabled&&!stashAuto.discardCommon);
 await ask(a,'/mycli arena stash page 1');await until(()=>a.currentWindow,'automatically sorted real chest');
 after=await read(a);check('opening the stash displays equipment first and only consolidates stacks',a.currentWindow.slots[0]?.name==='iron_helmet'&&after.stashOccupied===unsorted.stashOccupied-2&&after.stashProtectedHash===unsorted.stashProtectedHash);
 a.closeWindow(a.currentWindow);await delay(300);
 await ask(a,'/mycli inventory tidy stash auto off --json','MC_INVENTORY_TIDY');
 text=await rc('mycli admin inventorytidy 00000000-0000-0000-0000-000000000001 stash --discard-common');check('offline UUID never creates a replacement body',text.includes('player_unavailable'));
 await rc('essentials:sudo '+a.username+' mycli inventory');await delay(400);check('existing administrative player dispatch reaches the original role',a.lines.slice(-20).some(l=>l.startsWith('MC_INVENTORY ')));
 await setup(a);let status=await ask(a,'/mycli inventory tidy auto on --json','MC_INVENTORY_TIDY');check('default auto opt-in is non-destructive',status.enabled&&!status.discardCommon);let at=a.lines.length;await rc('qdstash drop '+a.username);await until(()=>a.lines.slice(at).some(l=>l.startsWith('MC_INVENTORY_TIDY ')),'automatic merge');after=await read(a);check('automatic default mode keeps plain materials',!!row(after,9)&&!!row(after,10));
 const b=await connect('b');await setup(b);const bBefore=await read(b);status=await ask(b,'/mycli inventory tidy auto on --discard-common --json','MC_INVENTORY_TIDY');check('destructive auto requires explicit own opt-in',status.enabled&&status.discardCommon&&status.discardWhitelist.includes('minecraft:clay_ball'));at=b.lines.length;await rc('qdstash drop '+b.username);await until(()=>b.lines.slice(at).some(l=>l.startsWith('MC_INVENTORY_TIDY ')),'automatic common cleanup');after=await read(b);
 const bTidy=b.lines.slice(at).filter(line=>line.startsWith('MC_INVENTORY_TIDY ')).map(line=>JSON.parse(line.slice('MC_INVENTORY_TIDY '.length))).find(row=>row.automatic);
 check('blocked pickup triggers real automatic cleanup',bTidy?.success&&bTidy.discarded.some(item=>item.id==='minecraft:clay_ball'&&item.count===52)
   &&[9,10].every(slot=>!row(after,slot)||row(after,slot).id==='DIAMOND')&&after.protectedHash===bBefore.protectedHash);
 const untouched=await read(a);check('one role auto setting cannot discard another role materials',!!row(untouched,9)&&!!row(untouched,10));
 await setup(b);await ask(b,'/mycli inventory tidy auto on --discard-common --json','MC_INVENTORY_TIDY');at=b.lines.length;await rc('qdstash drop '+b.username);await delay(2500);after=await read(b);check('automatic tidying has a per-role cooldown',!b.lines.slice(at).some(l=>l.startsWith('MC_INVENTORY_TIDY '))&&!!row(after,9));
 b.quit();await delay(600);const rejoined=await connect('b');at=rejoined.lines.length;await delay(4500);after=await read(rejoined);check('quick reconnect cannot bypass the automatic cooldown',!rejoined.lines.slice(at).some(l=>l.startsWith('MC_INVENTORY_TIDY '))&&!!row(after,9));
 await ask(a,'/mycli inventory tidy auto off --json','MC_INVENTORY_TIDY');
 }
 }
 }
 await rc('minecraft:save-all flush');
}catch(error){out.error=String(error);console.log(out.error);}
finally{for(const p of bots)p.quit();out.passed=!out.error&&out.checks.every(c=>c.passed);await fs.mkdir(root,{recursive:true});await fs.writeFile(root+'/stash-'+(overview?(baseline?'overview-baseline':'overview'):baseline?'baseline':faults?'faults':restart?'restart':'candidate')+'.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));if(!out.passed)process.exitCode=1;}
