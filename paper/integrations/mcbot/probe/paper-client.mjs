/** Independent protocol driver; uses real server bodies and native game actions. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert(/^[a-z0-9]+$/.test(label));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const properties=stage+'/server.properties',props=await fs.readFile(properties,'utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25928\r?$/m);assert.match(props,/^rcon.port=25929\r?$/m);
const rc=q=>command(q,15000,{properties,port:25929});const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const protocolVersion=process.env.MCBOT_PROTOCOL_VERSION??'1.21.1';assert(['1.21.1','1.21.11'].includes(protocolVersion));
const report={protocolVersion,checks:[],receipts:[],errors:[],passed:false,productionChanged:false},bots=[];let seq=0,task=0,epoch,bodyUuid,bodyName;
const check=(label,ok)=>{assert(ok,label);report.checks.push(label);console.log('PASS '+label);};
async function until(fn,label,ms=30000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(80);}throw Error('Timeout '+label);}
function frame(value){const body=Buffer.from(JSON.stringify(value)),prefix=[];let n=body.length;do{const b=n&127;n>>>=7;prefix.push(b|(n?128:0));}while(n);return Buffer.concat([Buffer.from(prefix),body]);}
function decode(buffer){let n=0,i=0,s=0;for(;i<3;i++,s+=7){const b=buffer[i];n|=(b&127)<<s;if(!(b&128)){i++;break;}}assert.equal(buffer.length-i,n);return JSON.parse(buffer.subarray(i).toString('utf8'));}
function send(bot,packet){bot._client.write('custom_payload',{channel:'mcbot:c2s',data:frame(packet)});}
async function connect(name){const bot=mf.createBot({host:'127.0.0.1',port:25928,username:name,auth:'offline',version:protocolVersion,hideErrors:true,checkTimeoutInterval:60000});bots.push(bot);bot.spawnReady=false;bot.once('spawn',()=>bot.spawnReady=true);installRecipePacketBypass(bot._client);bot.messages=[];bot.packets=[];bot.on('messagestr',s=>bot.messages.push(s));bot.on('error',e=>report.errors.push(e.message));bot.on('kicked',e=>report.errors.push(JSON.stringify(e)));bot._client.on('custom_payload',p=>{if(p.channel==='mcbot:s2c'){const v=decode(p.data);bot.packets.push(v);report.receipts.push(v);}});await until(()=>bot.spawnReady&&bot.entity&&bot.world.getColumnAt(bot.entity.position),'spawn and actual current column',45000);await sleep(350);bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcbot:s2c')});await sleep(500);return bot;}
async function call(bot,tool,args={},override={}){const id=++seq,p={kind:'tool_call',seq:id,task_id:task,tool,args,...(epoch?{body_id:epoch}:{}),...override},at=bot.packets.length;send(bot,p);const reply=await until(()=>bot.packets.slice(at).find(v=>v.seq===id&&v.kind==='tool_result'),'tool '+tool,80000);return {reply,packet:p};}
async function begin(bot,id,readOnly=false){task=id;send(bot,{kind:'task_begin',task_id:id,read_only:readOnly,autonomous:true,body_id:epoch});await sleep(80);}
function inventoryCount(result,id){return result.data.slots.filter(s=>s.item==='minecraft:'+id).reduce((n,s)=>n+s.count,0);}
async function fixtureBlock(bot,type,at){
 await rc(`minecraft:setblock ${at.x} ${at.y} ${at.z} air`);
 await rc(`minecraft:tp ${bot.username} ${at.x+2.5} ${at.y} ${at.z+.5}`);await sleep(700);
 await rc('minecraft:item replace entity '+bot.username+' hotbar.0 with '+type+' 1');
 await until(()=>bot.inventory.slots[36]?.name===type,'owner fixture item');bot.setQuickBarSlot(0);
 const support=bot.blockAt(bot.entity.position.offset(0,0,0).set(at.x,at.y-1,at.z));
 const Vec3=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('vec3').Vec3;
 await bot.placeBlock(support,new Vec3(0,1,0));await sleep(400);
 check('fixture '+type+' placed by actual owner connection',bot.blockAt(new Vec3(at.x,at.y,at.z))?.name===type);
}
try{
 await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule keepInventory true');await rc('minecraft:forceload add 194 194 220 218');await sleep(600);await rc('minecraft:fill 194 80 194 220 80 218 stone');await rc('minecraft:fill 194 81 194 220 87 218 air');
 const owner=await connect('MB'+label.slice(-12));await rc('minecraft:gamemode creative '+owner.username);await sleep(1500);await rc('minecraft:tp '+owner.username+' 200.5 81 200.5');await sleep(1000);await until(()=>owner.entity.position.x>199&&owner.entity.position.y>=80,'stable owner fixture');
 const reservedAt=owner.packets.length;send(owner,{kind:'summon',name:'Goddess'});const reserved=await until(()=>owner.packets.slice(reservedAt).find(p=>p.kind==='summon_result'),'reserved name denial');check('reserved administrator cannot become a client-created body',!reserved.companion_uuid&&reserved.text.includes('DENIED'));
 const requested='ag_Body'+label.slice(-8);send(owner,{kind:'summon',name:requested});
 const born=await until(()=>owner.packets.find(p=>p.kind==='summon_result'&&p.companion_uuid),'native summon',45000);bodyUuid=born.companion_uuid;bodyName=born.companion;epoch=born.body_id;check('real owned native body admitted',!!bodyUuid&&!!epoch);
 const state=(await call(owner,'status',{details:true})).reply;check('live native body and inventory snapshot',state.ok&&state.data.companion_uuid===bodyUuid&&state.data.inventory.storage_size===36);
 await begin(owner,1,true);const denied=(await call(owner,'equip',{slot:0})).reply;check('read-only task rejects equipment mutation',!denied.ok&&denied.feedback.includes('READ_ONLY'));
 send(owner,{kind:'task_begin',task_id:1,read_only:false,autonomous:true,body_id:epoch});await sleep(100);
 const escalated=(await call(owner,'equip',{slot:0})).reply;check('reused task ID cannot escalate its original read-only permission',!escalated.ok&&escalated.feedback.includes('READ_ONLY'));
 send(owner,{kind:'task_end',task_id:1});await begin(owner,2);
 await rc('minecraft:clear '+bodyName);await rc('minecraft:item replace entity '+bodyName+' hotbar.0 with oak_log 1');
 let equipped=(await call(owner,'equip',{slot:0})).reply;check('exact source slot reaches main hand',equipped.ok&&equipped.data.selected_slot===0);
 const craft=(await call(owner,'craft',{item:'oak_planks',count:4}));check('native crafting returns successful terminal result',craft.reply.ok);
 const inv=(await call(owner,'inventory')).reply;check('real recipe consumed one log and produced four planks',inventoryCount(inv,'oak_log')===0&&inventoryCount(inv,'oak_planks')===4);
 const offset=owner.packets.length;send(owner,craft.packet);await until(()=>owner.packets.slice(offset).some(p=>p.seq===craft.packet.seq),'cached duplicate');
 const after=(await call(owner,'inventory')).reply;check('duplicate request does not repeat native craft',inventoryCount(after,'oak_planks')===4);
 const conflicting={...craft.packet,args:{item:'stick',count:4}};const off=owner.packets.length;send(owner,conflicting);const collision=await until(()=>owner.packets.slice(off).find(p=>p.seq===craft.packet.seq),'conflict');check('same request identity with different content is rejected',!collision.ok&&collision.feedback.includes('CONFLICT'));
 const at=(await call(owner,'status')).reply.data;const moved=(await call(owner,'move_to',{x:at.x+2,y:at.y,z:at.z})).reply;check('native movement reaches actual new position',moved.ok&&moved.data.native);
 const newAt=(await call(owner,'status')).reply.data;check('movement outcome agrees with fresh position',newAt.x!==at.x);
 const malformed=(await call(owner,'move_to',{x:newAt.x+1,y:newAt.y,z:newAt.z},{accept:'yes'})).reply;
 check('invalid acceptance flag cannot poison the native execution lane',!malformed.ok&&malformed.feedback.includes('accept')&&(await call(owner,'status')).reply.ok);
 check('native RPG class/mana state is readable',newAt.rpg?.available===true&&newAt.rpg.backend==='vortex'&&typeof newAt.rpg.mana.current==='number');
 const base={x:newAt.x+1,y:newAt.y,z:newAt.z};
 await rc(`minecraft:setblock ${base.x} ${base.y} ${base.z} crafting_table`);
 const materials=(await call(owner,'craft',{item:'chest',query:true})).reply;check('3x3 recipe preview is read-only and identifies a workbench',materials.ok&&materials.data.query&&materials.data.workbench_available);
 await rc('minecraft:clear '+bodyName);await rc('minecraft:give '+bodyName+' oak_planks 8');
 const chest=(await call(owner,'craft',{item:'chest',count:1})).reply;check('native workbench actually crafts a 3x3 recipe',chest.ok&&inventoryCount((await call(owner,'inventory')).reply,'chest')===1);
 await fixtureBlock(owner,'chest',base);
 const put=(await call(owner,'transfer',{...base,dir:'in',item:'chest'})).reply;check('real container deposit ends with empty cursor',put.ok&&put.data.moved===1&&put.data.cursor_empty);
 check('deposited item is absent from player inventory',inventoryCount((await call(owner,'inventory')).reply,'chest')===0);
 const peek=(await call(owner,'inspect_block',base)).reply;check('read-only container snapshot confirms actual stored item',peek.ok&&peek.data.slots.some(s=>s.item==='minecraft:chest'&&s.count===1));
 const take=(await call(owner,'transfer',{...base,dir:'out',item:'chest'})).reply;check('close/reopen retrieves exact real item',take.ok&&take.data.moved===1&&inventoryCount((await call(owner,'inventory')).reply,'chest')===1);
 await fixtureBlock(owner,'furnace',base);
 await rc(`minecraft:data merge block ${base.x} ${base.y} ${base.z} {Items:[{Slot:1b,id:"minecraft:charcoal",count:7},{Slot:2b,id:"minecraft:charcoal",count:3}]}`);
 const taken=(await call(owner,'smelt',{...base,action:'take',slot:'output',count:2})).reply;
 check('machine take uses requested slot when fuel and output share item ID',taken.ok&&taken.data.taken_count===2&&taken.data.output.count===1&&taken.data.fuel.count===7);
 await rc('minecraft:item replace entity '+bodyName+' hotbar.3 with raw_iron 1');await rc('minecraft:item replace entity '+bodyName+' hotbar.4 with coal 1');
 await rc(`minecraft:data merge block ${base.x} ${base.y} ${base.z} {Items:[],BurnTime:0s,CookTime:0s}`);
 const loaded=(await call(owner,'smelt',{...base,action:'load',input_slot:3,input_count:1,fuel_slot:4,fuel_count:1})).reply;
 check('native furnace receives source-slot material and fuel',loaded.ok&&loaded.data.loaded_input_count===1&&loaded.data.loaded_fuel_count===1);
 const scanning=(await call(owner,'scan_area',{r:6})).reply;check('real area scan includes entities, workstations and terrain',scanning.ok&&scanning.data.terrain&&scanning.data.special_blocks.some(b=>b.block==='minecraft:furnace'));
 const found=(await call(owner,'find_resource',{targets:['furnace'],r:6})).reply;check('visible resource position returned without claiming work success',found.ok&&found.data.targets.some(b=>b.x===base.x&&b.z===base.z)&&found.data.work_checked===false);
 owner.chat('/numen permission rules add allow command(mycli) @'+bodyName);await sleep(500);
 const command=(await call(owner,'command',{command:'mycli status'})).reply;check('owner-approved RPG command returns dispatch receipt rather than invented success',command.ok&&command.data.command_dispatched&&command.data.gameplay_verified===false);
 const chosen=(await call(owner,'command',{command:'mycli profession choose knight'})).reply;
 check('existing RPG CLI selects native class without a second profile',chosen.ok&&(await call(owner,'status')).reply.data.rpg.combat==='knight');
 const bad=(await call(owner,'command',{command:'op Other'})).reply;check('administrative command cannot escape gameplay scope',!bad.ok);
 const waited=(await call(owner,'wait',{seconds:11})).reply;check('native wait terminates',waited.ok);
 const cooked=(await call(owner,'smelt',{...base,action:'query'})).reply;check('real furnace cooks actual material over ticks',cooked.ok&&cooked.data.output.item==='minecraft:iron_ingot'&&cooked.data.output.count===1);
 const out=(await call(owner,'smelt',{...base,action:'take',slot:'output',count:1})).reply;check('actual cooked output is taken once',out.ok&&out.data.taken_count===1&&inventoryCount((await call(owner,'inventory')).reply,'iron_ingot')===1);
 // Native body remains survival; real damage/food rules are not bypassed.
 await rc('minecraft:item replace entity '+bodyName+' hotbar.5 with bread 1');await rc('minecraft:effect give '+bodyName+' hunger 2 255 true');await sleep(2200);
 const ate=(await call(owner,'consume',{slot:5})).reply;check('native eating consumes held food',ate.ok&&inventoryCount((await call(owner,'inventory')).reply,'bread')===0);
 const live=(await call(owner,'status')).reply.data,cell={x:live.x,y:live.y,z:live.z+1};
 await rc('minecraft:item replace entity '+bodyName+' hotbar.6 with cobblestone 1');
 const placed=(await call(owner,'place_block',{...cell,item:'cobblestone'})).reply;
 check('native placement consumes a real carried block',placed.ok&&inventoryCount((await call(owner,'inventory')).reply,'cobblestone')===0);
 const withoutTool=(await call(owner,'break_block',cell)).reply;check('missing mining tool returns a useful refusal',!withoutTool.ok&&withoutTool.feedback.includes('tool'));
 await rc('minecraft:item replace entity '+bodyName+' hotbar.6 with iron_pickaxe 1');await call(owner,'equip',{slot:6});
 const mined=(await call(owner,'break_block',cell)).reply;check('native digging finishes on its own previously placed block',mined.ok);
 const pos=(await call(owner,'status')).reply.data;
 const mob='[I;1024,2048,4096,8192]',mobUuid='00000400-0000-0800-0000-100000002000';
 await rc(`minecraft:summon husk ${pos.x+2.5} ${pos.y} ${pos.z+.5} {UUID:${mob},NoAI:1b,Silent:1b}`);
 await rc('minecraft:item replace entity '+bodyName+' hotbar.7 with iron_sword 1');await call(owner,'equip',{slot:7});
 const monsters=(await call(owner,'scan_area',{r:6})).reply.data.entities;const victim=monsters.find(e=>e.target_uuid===mobUuid);check('hostile scan exposes actual runtime entity identity',!!victim);
 const attack=(await call(owner,'attack',{entity_id:victim.entity_id,target_uuid:mobUuid,max_hits:1})).reply;check('native attack changes real target health',attack.ok&&attack.data.health_after<attack.data.health_before);
 await rc('minecraft:kill '+mobUuid);
 const here=(await call(owner,'status')).reply.data;
 await rc(`minecraft:summon item ${here.x+.5} ${here.y} ${here.z+1.5} {Item:{id:"minecraft:diamond",count:1},PickupDelay:0s}`);
 const collect=(await call(owner,'collect',{r:3})).reply;check('native collection obtains an actual dropped item',collect.ok&&inventoryCount((await call(owner,'inventory')).reply,'diamond')===1);
 const followed=(await call(owner,'follow',{target_uuid:owner.player.uuid,distance:2,seconds:1})).reply;check('bounded native follow ends through the same executor',followed.ok);
 const jobSeq=++seq,jobStart=owner.packets.length;send(owner,{kind:'tool_call',seq:jobSeq,task_id:task,tool:'wait',args:{seconds:20},body_id:epoch,accept:true});
 const ack=await until(()=>owner.packets.slice(jobStart).find(p=>p.kind==='job_ack'&&p.seq===jobSeq),'async acceptance');check('accepted job has explicit bounded identity',!!ack.job_id&&ack.text.startsWith('ACCEPTED:'));
 send(owner,{kind:'cancel',task_id:task});const terminal=await until(()=>owner.packets.slice(jobStart).find(p=>p.kind==='job_event'&&p.seq===jobSeq),'cancel terminal');check('cancel reaches real terminal instead of replaying work',terminal.phase==='cancelled');
 await begin(owner,3);const resumed=(await call(owner,'status')).reply;check('cancel releases native program lane for subsequent tasks',resumed.ok);
 send(owner,{kind:'task_end',task_id:task});await sleep(120);const again=owner.packets.length;send(owner,{kind:'summon',name:requested.toUpperCase()});const reused=await until(()=>owner.packets.slice(again).find(p=>p.kind==='summon_result'&&p.companion_uuid),'same-name reuse');check('case variant summon preserves original native identity',reused.companion_uuid===bodyUuid);
 const final=(await call(owner,'inventory')).reply;check('identity reuse preserves actual items',inventoryCount(final,'iron_ingot')===1&&inventoryCount(final,'chest')===1);
 const other=await connect('ag_Other'+label.slice(-7));const ownAt=other.packets.length;send(other,{kind:'summon',name:requested});await sleep(1200);check('another owner cannot adopt existing body',!other.packets.slice(ownAt).some(p=>p.companion_uuid===bodyUuid));
 owner._client.write('custom_payload',{channel:'mcbot:c2s',data:Buffer.from([0xff,0xff,0xff,0xff])});await sleep(200);check('malformed custom payload does not disconnect player',(await call(owner,'status')).reply.ok);
 if(process.env.MCBOT_TEST_MCP==='1'){
  let bearer;
  const nbt=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('prismarine-nbt');
  const secrets=node=>{if(!node||typeof node!=='object')return;if(node.type&&node.value!==undefined){try{node=nbt.simplify(node);}catch{}if(!node||typeof node!=='object')return;}if(node.action==='copy_to_clipboard')bearer=node.value??node.contents;for(const value of Object.values(node))if(typeof value==='object')secrets(value);};
  const capture=message=>secrets(message.json??message);owner.on('message',capture);
  owner.chat('/numen token create brain '+bodyName+' 1');await until(()=>bearer,'private scoped MCP token');owner.removeListener('message',capture);
  await begin(owner,90);const pendingSeq=++seq,pendingStart=owner.packets.length;
  send(owner,{kind:'tool_call',seq:pendingSeq,task_id:task,tool:'wait',args:{seconds:30},body_id:epoch,accept:true});
  await until(()=>owner.packets.slice(pendingStart).some(p=>p.kind==='job_ack'&&p.seq===pendingSeq),'work before MCP priority');
  const headers={authorization:'Bearer '+bearer,'content-type':'application/json',accept:'application/json, text/event-stream'};
  const initialized=await fetch('http://127.0.0.1:25934/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'mcbot-qa',version:'0.1'}}})});
  assert(initialized.ok,'real MCP initialization');const session=initialized.headers.get('mcp-session-id');assert(session,'actual scoped MCP session');await initialized.text();headers['mcp-session-id']=session;
  await fetch('http://127.0.0.1:25934/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
  const cancelled=await until(()=>owner.packets.slice(pendingStart).find(p=>p.kind==='job_event'&&p.seq===pendingSeq),'MCP priority cancels prior native job');
  check('real authenticated MCP takeover cancels only mcbot work',cancelled.phase==='cancelled');
  const busyAt=owner.packets.length;send(owner,{kind:'summon',name:requested});const busy=await until(()=>owner.packets.slice(busyAt).find(p=>p.kind==='summon_result'),'MCP ownership refusal');
  check('game-client cannot steal native MCP driver',!busy.companion_uuid&&busy.text.includes('DRIVER_BUSY'));
  const dismissAt=owner.packets.length;send(owner,{kind:'dismiss',name:requested});const dismissBusy=await until(()=>owner.packets.slice(dismissAt).find(p=>p.kind==='dismiss_result'),'MCP dismissal refusal');
  check('game-client cannot put the MCP-controlled body to sleep',dismissBusy.text.includes('DRIVER_BUSY'));
  const deleted=await fetch('http://127.0.0.1:25934/mcp',{method:'DELETE',headers});assert(deleted.ok,'close actual MCP session');bearer=undefined;delete headers.authorization;
  await sleep(300);const resumeAt=owner.packets.length;send(owner,{kind:'summon',name:requested});const resume=await until(()=>owner.packets.slice(resumeAt).find(p=>p.kind==='summon_result'&&p.companion_uuid),'explicit recall after MCP');
  check('explicit recall after MCP preserves native identity',resume.companion_uuid===bodyUuid);epoch=resume.body_id;
 }
 await begin(owner,4);const disconnectSeq=++seq,start=owner.packets.length;
 send(owner,{kind:'tool_call',seq:disconnectSeq,task_id:task,tool:'wait',args:{seconds:30},body_id:epoch,accept:true});
 await until(()=>owner.packets.slice(start).some(p=>p.kind==='job_ack'&&p.seq===disconnectSeq),'work before disconnect');
 await sleep(350);await rc('minecraft:save-all flush');
 const registryNbt=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('prismarine-nbt');
 const savedRegistry=registryNbt.simplify((await registryNbt.parse(await fs.readFile(stage+'/world/data/numen_companions.dat'))).parsed).data;
 check('running remote job stores no automatic restart replay',!savedRegistry.companions[bodyUuid].taskLua&&!savedRegistry.companions[bodyUuid].taskOld);
 owner.quit('QA disconnect cancels work');await sleep(1000);
 const reconnected=await connect(owner.username);send(reconnected,{kind:'summon',name:requested});
 const returned=await until(()=>reconnected.packets.find(p=>p.kind==='summon_result'&&p.companion_uuid),'same owner reconnect');
 check('reconnect recalls same durable identity',returned.companion_uuid===bodyUuid);epoch=returned.body_id;task=0;
 const restored=(await call(reconnected,'inventory')).reply;check('disconnect preserves real items without replay',inventoryCount(restored,'diamond')===1&&inventoryCount(restored,'iron_ingot')===1);
 const oldAt=reconnected.packets.length;send(reconnected,craft.packet);const stale=await until(()=>reconnected.packets.slice(oldAt).find(p=>p.seq===craft.packet.seq),'stale disconnected action');check('old connection action cannot resume against replacement body',!stale.ok);
 report.identity={owner:owner.username,body:bodyName,uuid:bodyUuid,inventory:restored.data.slots.filter(s=>s.count>0)};report.passed=true;
}finally{for(const b of bots)if(!b._client.ended)b.quit();await fs.writeFile(stage+'/mcbot-'+label+'.json',JSON.stringify(report,null,2));}
