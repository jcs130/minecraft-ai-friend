/** Real offline Mineflayer clients; official EssentialsXChat only, on marked QA. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const out='E:/MC/ops/repairs/proximity-chat-20261029',qa=out+'/qa';
assert.equal(await fs.readFile(qa+'/.qa-only','utf8'),'QIANDENGJI_CHAT_QA_ONLY');
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const bots=[],report={passed:false,checks:[],receipts:[],productionChanged:false,plugin:'official EssentialsXChat 2.22.0',ports:[29086,29087]};
const rc=q=>command(q,12000,{port:29087,properties:qa+'/server.properties'});
const until=async(fn,label,ms=25000)=>{for(const end=Date.now()+ms;Date.now()<end;){const x=await fn();if(x)return x;await sleep(100);}throw Error('timeout '+label);};
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS '+name);};
async function connect(username){
  const b=mf.createBot({host:'127.0.0.1',port:29086,username,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.messages=[];b.packets=[];
  // Native player_chat keeps the signed body and the server's decorated
  // unsigned component separately. Check what Java displays, not just the
  // messagestr signed body (which deliberately omits server decoration).
  b.on('message',m=>b.messages.push((m.unsigned??m).toString()));b.on('error',()=>{});installRecipePacketBypass(b._client);
  for(const type of ['player_chat','profileless_chat','system_chat'])b._client.on(type,p=>b.packets.push({type,chatType:p.type,sender:p.senderUuid??p.sender??null,decorated:!!p.unsignedChatContent}));
  await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'spawn '+username);b.physicsEnabled=false;
  // QA positions are exclusively controlled by the guarded server fixture.
  // Do not let Mineflayer's stale physics position undo a cross-world test TP;
  // teleport_confirm and all chat packets still use the real protocol.
  const write=b._client.write.bind(b._client);
  b._client.write=(name,data)=>['position','position_look','look','flying'].includes(name)?undefined:write(name,data);
  return b;
}
async function at(b,world,x,y,z){assert((await rc(`chatqa at ${b.username} ${world} ${x} ${y} ${z}`)).includes('CHAT_QA_OK'));await sleep(250);if(b.entity)b.entity.position.set(x,y,z);assert((await rc(`chatqa where ${b.username}`)).includes(`minecraft:${world==='world'?'overworld':world} ${x},${y},${z}`));}
async function permission(b,node,value){
  // Essentials uses the installed LuckPerms provider, not a transient Bukkit
  // PermissionAttachment. Exercise the production permission route in QA.
  await rc(`lp user ${b.username} permission set ${node} ${value}`);
  // LuckPerms completes console commands asynchronously; an empty RCON
  // response is not success evidence. The real delivery checks below are.
  await sleep(180);
}
async function speak(b,text){await sleep(Math.max(0,1200-(Date.now()-(b.lastChat??0))));b.lastChat=Date.now();const marks=bots.map(x=>x.messages.length);b.chat(text);await sleep(850);const rows=bots.map((x,i)=>x.messages.slice(marks[i]));report.receipts.push({sender:b.username,text,heard:bots.filter((x,i)=>rows[i].some(s=>s.includes(text.replace(/^!\s*/,'')))).map(x=>x.username),qaMessages:rows});return rows;}
try{
  check('matching official chat version enabled',(await rc('version EssentialsChat')).includes('2.22.0'));
  const a=await connect('ChatQAA'),b=await connect('ChatQAB'),c=await connect('ChatQAC');
  for(const bot of bots){for(const node of ['local','shout','receive.local','receive.shout'])await permission(bot,'essentials.chat.'+node,true);await permission(bot,'essentials.chat.spy',false);await permission(bot,'essentials.toggleshout',false);await permission(bot,'essentials.chat.question',false);}
  await at(a,'world',0,70,0);await at(b,'world',2,70,0);await at(c,'aincrad',0,70,0);
  let rows=await speak(a,'chatqa-near-001');
  check('same-world nearby client receives ordinary chat',rows[1].some(s=>s.includes('chatqa-near-001')));
  check('same XYZ in another world does not receive ordinary chat',!rows[2].some(s=>s.includes('chatqa-near-001')));
  check('nearby prefix includes the actual sender world',rows[1].some(s=>s.includes('附近')&&s.includes('主世界')));
  check('nearby chat retains a native player packet and its real sender UUID',b.packets.some(p=>p.type==='player_chat'&&p.sender===a.player.uuid&&p.decorated));
  await at(b,'world',49,70,0);rows=await speak(a,'chatqa-far-002');check('49 blocks is outside the configured 48-block range',!rows[1].some(s=>s.includes('chatqa-far-002')));
  check('speaker is told when no nearby players can hear them',rows[0].some(s=>s.includes('没有其他听众')&&s.includes('/msg')));
  await at(b,'world',48,70,0);rows=await speak(a,'chatqa-edge-003');check('48-block boundary behavior recorded',rows[1].some(s=>s.includes('chatqa-edge-003')));
  await at(b,'world',0,119,0);rows=await speak(a,'chatqa-height-004');check('range is spatial rather than XZ-only',!rows[1].some(s=>s.includes('chatqa-height-004')));
  await at(b,'world',100,70,0);rows=await speak(a,'! chatqa-shout-005');
  check('explicit shout reaches far same-world client',rows[1].some(s=>s.includes('chatqa-shout-005')));
  check('explicit shout reaches another world',rows[2].some(s=>s.includes('chatqa-shout-005')));
  check('shout is visibly marked with its origin world',rows[2].some(s=>s.includes('大喇叭')&&s.includes('主世界')));
  rows=await speak(a,'chatqa-local-again-006');check('one shout does not switch later ordinary messages to global',!rows[1].some(s=>s.includes('chatqa-local-again-006'))&&!rows[2].some(s=>s.includes('chatqa-local-again-006')));
  const marks=bots.map(x=>x.messages.length);a.chat('/msg ChatQAC chatqa-private-007');await until(()=>c.messages.slice(marks[2]).some(s=>s.includes('chatqa-private-007')),'native private message');
  check('vanilla whisper still crosses worlds deliberately',c.messages.slice(marks[2]).some(s=>s.includes('whispers to you')&&s.includes('chatqa-private-007')));
  check('private message is not delivered to unrelated nearby/far player',!b.messages.slice(marks[1]).some(s=>s.includes('chatqa-private-007')));
  await at(b,'world',2,70,0);const mark=b.messages.length;await rc('chatqa speak ChatQAA chatqa-bukkit-008');await until(()=>b.messages.slice(mark).some(s=>s.includes('chatqa-bukkit-008')),'Bukkit player.chat route');
  check('server-side Player.chat route uses the same nearby policy',!c.messages.slice(marks[2]).some(s=>s.includes('chatqa-bukkit-008')));
  await at(b,'aincrad',0,70,0);await rc('chatqa op ChatQAB true');await permission(b,'essentials.chat.spy',false);rows=await speak(a,'chatqa-op-deny-009');
  check('explicit chat spy denial applies to an OP body',!rows[1].some(s=>s.includes('chatqa-op-deny-009')));
  await permission(b,'essentials.chat.spy',true);rows=await speak(a,'chatqa-director-spy-010');check('explicit director spy can monitor across worlds',rows[1].some(s=>s.includes('chatqa-director-spy-010')));
  await permission(b,'essentials.chat.spy',false);await rc('chatqa op ChatQAB false');
  if(process.argv.includes('--rpg')){
    check('world-aware bridge candidate is actually enabled',(await rc('version QiandengjiRpg')).includes('0.2.10'));
    await at(a,'world',0,70,0);await at(b,'world',3,70,0);await at(c,'aincrad',0,70,0);
    const jsonReceipt=async(bot,run,prefix='MC_RPG ')=>{
      const mark=bot.messages.length;await run();
      await until(()=>bot.messages.slice(mark).some(s=>s.startsWith(prefix)),'JSON query for '+bot.username);
      return JSON.parse(bot.messages.slice(mark).find(s=>s.startsWith(prefix)).slice(prefix.length));
    };
    const status=async bot=>jsonReceipt(bot,()=>{bot.chat('/qdrpg status --json');});
    const sa=await status(a),sc=await status(c);
    check('self status returns the real world key and Bukkit UUID',sa.location.world.key==='minecraft:overworld'&&/^[a-f0-9-]{36}$/.test(sa.location.world.uuid)&&sa.location.world.name==='world');
    check('equal XYZ in different NORMAL worlds retain distinct instance identities',sc.location.world.key==='minecraft:aincrad'&&sc.location.world.uuid!==sa.location.world.uuid&&JSON.stringify(sc.location.position)===JSON.stringify(sa.location.position));
    const intro=await jsonReceipt(a,()=>rc('chatqa intro ChatQAA'),'MC_INTRO ');
    check('intro contains the same authoritative current world',intro.location.world.uuid===sa.location.world.uuid);
    const mark=a.messages.length;a.chat('/qdrpg status');await until(()=>a.messages.slice(mark).some(s=>s.includes('[状态]')),'text location');
    check('concise text status names the world as well as XYZ',a.messages.slice(mark).some(s=>s.includes('主世界 (minecraft:overworld) 0,70,0')));
    for(const bot of bots){await rc('gamemode survival '+bot.username);for(const node of ['info','create','invite','accept'])await permission(bot,'vortex.player.party.'+node,true);}
    const party=async(bot,args)=>jsonReceipt(bot,()=>rc('chatqa party '+bot.username+' '+args+' --json'));
    check('unpartied status still exposes current world',(await party(a,'status')).location.world.uuid===sa.location.world.uuid);
    check('native party creation completes',(await party(a,'create')).success===true);
    for(const bot of [b,c]){check('native invitation '+bot.username,(await party(a,'invite '+bot.username)).success===true);check('native acceptance '+bot.username,(await party(bot,'accept')).success===true);}
    let team=await party(a,'status'),near=team.members.find(x=>x.uuid===b.player.uuid),other=team.members.find(x=>x.uuid===c.player.uuid);
    check('same-world member distance is measured from live state',near.online&&near.sameWorld&&near.distance===3);
    check('cross-world party never reports a false small distance',other.online&&other.sameWorld===false&&!('distance'in other)&&other.distanceUnavailableReason==='different_world'&&other.location.world.uuid===sc.location.world.uuid);
    const before=a.messages.length;await rc('chatqa party ChatQAA status');await until(()=>a.messages.slice(before).some(s=>s.includes('不能比较距离')),'text party worlds');
    check('text party status explicitly explains different-world separation',a.messages.slice(before).some(s=>s.includes('艾恩葛朗特')&&s.includes('不能比较距离')));
    await at(c,'world',0,70,0);team=await party(a,'status');other=team.members.find(x=>x.uuid===c.player.uuid);
    check('a real world change is reflected without stale cached location',other.sameWorld&&other.distance===0&&other.location.world.uuid===sa.location.world.uuid);
    c.quit('QA offline member check');await until(async()=>!(await rc('minecraft:list')).includes('ChatQAC'),'member disconnected');
    team=await party(a,'status');other=team.members.find(x=>x.uuid===c.player.uuid);
    check('offline member position is omitted rather than reused',!other||other.online===false&&!('location'in other)&&!('distance'in other));
  }
  report.packetKinds=Object.fromEntries(bots.map(x=>[x.username,[...new Set(x.packets.map(p=>p.type))]]));report.passed=true;
}catch(error){report.error=String(error.message);console.error(report.error);process.exitCode=1;}
finally{
  for(const b of bots)try{b.quit('Marked chat QA complete');}catch{}
  await fs.writeFile(out+'/result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));
}
