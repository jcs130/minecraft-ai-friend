// Actual NPCSpeak and built-in NPC delivery over vanilla protocol. Isolated QA identities only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const stage=process.argv[2],root=process.argv[3];
assert.equal(stage,'E:/MC/staging/npc-text-bubbles-20261010');
assert.equal(root,'E:/MC/ops/repairs/npc-text-bubbles-20261010');
const req=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(req);
const mf=req('mineflayer'),bots=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rc=q=>command(q,15000,{port:25595,properties:stage+'/server.properties'});
const report={passed:false,checks:[],startedAt:new Date().toISOString(),packets:{},messages:{},
 sha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.4.9.jar')).digest('hex').toUpperCase()};
const check=(n,ok)=>{assert.ok(ok,n);report.checks.push(n);console.log('PASS '+n)};
async function until(fn,n,ms=9000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error(n+' timeout')}
async function state(){return JSON.parse((await rc('bubbleqa state')).split('BQ_JSON ')[1])}
async function audit(){return JSON.parse((await rc('mycli admin bubbles audit')).split('MC_BUBBLES ')[1])}
async function make(username){
 const b=mf.createBot({host:'127.0.0.1',port:25594,username,version:'1.20.6',auth:'offline'});bots.push(b);
 b.texts=report.messages[username]=[];const packets=report.packets[username]=[];b.on('messagestr',s=>b.texts.push(s));b.on('error',()=>{});
 b._client.on('packet',(p,m)=>{if(['spawn_entity','entity_metadata','entity_destroy'].includes(m.name))packets.push({name:m.name,...p,at:Date.now()})});
 await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j)});b.physicsEnabled=false;
 await rc('minecraft:gamemode creative '+username);return b;
}
async function tp(b,n,dx=2){await rc(`minecraft:tp ${b.username} ${n.x+dx} ${n.y} ${n.z}`);await sleep(400)}
const mark=b=>report.packets[b.username].length;
const meta=(b,t,m=0)=>report.packets[b.username].slice(m).some(p=>p.name==='entity_metadata'&&JSON.stringify(p.metadata).includes(t));
const config=stage+'/plugins/AgentFriend/text-bubbles.yml';let settings;
try {
 const qa=await make('BubbleQA10'),peer=await make('BubblePeer10'),eye=await make('BubbleEye10');
 settings=readFileSync(config,'utf8');await rc('mycli admin bubbles reload');
 check('native NPCSpeak delivery hook registered',(await audit()).npcSpeakHook===true);
 const npcUUID=readFileSync(stage+'/plugins/NPCSpeak/npcs/botanist.yml','utf8').match(/^entity-uuid: ['"]?([a-f0-9-]{36})/m)?.[1];
 const n=(await state()).npcs.find(n=>n.uuid===npcUUID);assert.ok(n,'registered botanist UUID, never select by name');
 await rc('minecraft:clear BubbleQA10');await rc('minecraft:clear BubblePeer10');
 qa.setQuickBarSlot(8);peer.setQuickBarSlot(8);
 await tp(qa,n);await tp(peer,n,2);await tp(eye,n);await rc('minecraft:gamemode spectator BubbleEye10');await sleep(1800);
 check('real registered Eye attached',/attached=true/.test(await rc('cortieye status')));
 await until(()=>!!qa.entities[n.id],'botanist entity');qa.activateEntity(qa.entities[n.id]);
 await until(()=>meta(qa,'今天要不要一起照顾田地'),'actual NPC greeting');
 check('real right click displays NPC greeting without typing or status text',!meta(peer,'今天要不要一起照顾田地'));
 await rc('bubbleqa backend stub');
 qa.chat('/mycli world talk botanist PRIVATE_QA_NPC_ONE');
 await until(()=>meta(qa,'PRIVATE_QA_NPC_ONE'),'NPC actual reply');
 await until(()=>meta(eye,'PRIVATE_QA_NPC_ONE'),'attached Eye private NPC caption');
 check('NPC actual reply reaches unchanged client and attached Eye',qa.texts.some(s=>s.includes('村民实际答复：')&&s.includes('PRIVATE_QA_NPC_ONE')));
 check('nearby bystander receives neither private bubble nor answer',!meta(peer,'PRIVATE_QA_NPC_ONE')&&!peer.texts.some(s=>s.includes('PRIVATE_QA_NPC_ONE')));
 let shown=(await state()).entities.filter(e=>e.text.includes('PRIVATE_QA_NPC_ONE'));
 check('private display anchors above actual NPC and is ephemeral',shown.length===1&&Math.abs(shown[0].x-n.x)<.01&&shown[0].y>n.y+1&&!shown[0].persistent&&!shown[0].visibleByDefault);
 peer.chat('/mycli world talk botanist PRIVATE_PEER_NPC_TWO');await until(()=>meta(peer,'PRIVATE_PEER_NPC_TWO'),'concurrent NPC reply');
 check('same NPC holds independent private conversations',(await audit()).npcActive===2&&(await state()).entities.some(e=>e.text.includes('PRIVATE_QA_NPC_ONE')));
 check('concurrent answers do not cross audiences',!meta(qa,'PRIVATE_PEER_NPC_TWO')&&!meta(eye,'PRIVATE_PEER_NPC_TWO')&&!meta(peer,'PRIVATE_QA_NPC_ONE'));
 await sleep(3200);const peerMark=mark(peer);qa.chat('NPC_NORMAL_CHAT_SECRET');
 await until(()=>meta(qa,'NPC_NORMAL_CHAT_SECRET'),'normal private conversation input');
 check('ordinary NPC conversation input stays off public player bubbles',!meta(peer,'NPC_NORMAL_CHAT_SECRET',peerMark)&&!peer.texts.some(s=>s.includes('NPC_NORMAL_CHAT_SECRET')));
 const eyeMark=mark(eye);await rc('bubbleqa eye-target BubbleEye10 none');await sleep(400);await sleep(3200);
 qa.chat('/mycli world talk botanist DETACHED_EYE_SECRET');await until(()=>meta(qa,'DETACHED_EYE_SECRET'),'detached reply');
 check('detached Eye loses private caption access',!meta(eye,'DETACHED_EYE_SECRET',eyeMark));
 await rc('mycli admin bubbles reload');qa.chat('/mycli world end');peer.chat('/mycli world end');await sleep(400);
 const spoofMark=mark(peer);await rc('minecraft:tellraw BubblePeer10 {"text":"[田野学者·青禾]SPOOF_NPC_PREFIX"}');await sleep(600);
 check('ordinary system messages cannot impersonate NPC speech',peer.texts.some(s=>s.includes('SPOOF_NPC_PREFIX'))&&!meta(peer,'SPOOF_NPC_PREFIX',spoofMark)&&(await audit()).npcActive===0);
 await tp(qa,{x:-494,y:67,z:-497.5},1.5);await sleep(600);
 const targets=(await state()).npcs;const reception=targets.find(n=>n.reception),mentor=targets.find(n=>n.life);assert.ok(reception&&mentor,'existing service NPCs');
 await tp(qa,reception,1.5);await until(()=>Object.values(qa.entities).some(e=>e.id===reception.id),'reception entity');
 qa.activateEntity(qa.entities[reception.id]);await until(()=>meta(qa,'欢迎来到冒险者公会'),'reception caption');
 check('actual receptionist interaction preserves menu and chat guidance',JSON.stringify(qa.currentWindow?.title).includes('接待员')&&qa.texts.some(t=>t.includes('门口公共箱')));
 qa.closeWindow(qa.currentWindow);await tp(qa,{...mentor,z:mentor.z+2},0);await until(()=>!!qa.entities[mentor.id],'mentor entity');
 qa.activateEntity(qa.entities[mentor.id]);await until(()=>meta(qa,'欢迎来实习'),'mentor caption');
 check('actual life mentor interaction preserves menu and exact contract',qa.currentWindow?.slots.length>9&&qa.texts.some(t=>t.includes(mentor.life)));
 qa.closeWindow(qa.currentWindow);await rc('mycli admin bubbles reload');await tp(qa,n);
 await sleep(3200);qa.chat('/mycli world talk botanist HIDDEN_NPC_SECRET');await until(()=>meta(qa,'HIDDEN_NPC_SECRET'),'visibility baseline');
 await rc(`bubbleqa npc-hidden ${n.uuid} yes`);await until(async()=>!(await audit()).npcActive,'invisible NPC cleanup');
 check('hidden NPC removes its captions',true);await rc(`bubbleqa npc-hidden ${n.uuid} no`);
 qa.chat('/mycli world end');await sleep(3200);qa.chat('/mycli world talk botanist WORLD_NPC_SECRET');await until(()=>meta(qa,'WORLD_NPC_SECRET'),'world baseline');
 await rc('bubbleqa warp BubbleQA10 world_nether');await until(async()=>!(await audit()).npcActive,'recipient world cleanup');
 check('recipient dimension change invalidates private NPC caption',true);await rc('bubbleqa warp BubbleQA10 world');await tp(qa,n);
 writeFileSync(config,settings.replace('npc-enabled: true','npc-enabled: false'));await rc('mycli admin bubbles reload');
 await sleep(3200);const disableMark=mark(qa);qa.chat('/mycli world talk botanist DISABLED_NPC_SECRET');
 await until(()=>qa.texts.some(t=>t.includes('DISABLED_NPC_SECRET')&&t.includes('村民实际答复')),'disabled dialogue still delivered');
 check('NPC hot disable keeps dialogue working without captions',qa.texts.some(t=>t.includes('DISABLED_NPC_SECRET'))&&!meta(qa,'DISABLED_NPC_SECRET',disableMark)&&(await audit()).npcActive===0);
 writeFileSync(config,settings);await rc('mycli admin bubbles reload');
 qa.chat('/mycli world end');await sleep(3200);qa.chat('/mycli world talk botanist REMOVED_NPC_SECRET');await until(()=>meta(qa,'REMOVED_NPC_SECRET'),'remove baseline');
 await rc(`bubbleqa npc-remove ${n.uuid}`);await until(async()=>!(await audit()).npcActive,'NPC removal');check('removed NPC leaves no caption entity',true);
 report.audit=await audit();check('shared budgets stay bounded with zero renderer errors',report.audit.active<=32&&report.audit.pending<=64&&report.audit.errors===0);
 report.passed=true;
}catch(e){report.error=e.stack;console.error(e.stack);process.exitCode=1}
finally {
 if(settings){writeFileSync(config,settings);try{await rc('mycli admin bubbles reload');await rc('bubbleqa backend real')}catch{}}
 for(const b of bots)if(b._client.state==='play')b.quit();await sleep(300);
 writeFileSync(root+'/npc-native-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error?.split('\n')[0]}));
}
