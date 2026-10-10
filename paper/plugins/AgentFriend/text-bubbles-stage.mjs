// Native-protocol regression fixture; never connects to production.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const stage=process.argv[2],root=process.argv[3];
assert.equal(stage,'E:/MC/staging/text-bubbles-20261010');
assert.equal(root,'E:/MC/ops/repairs/text-bubbles-20261010');
const req=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(req);
const mf=req('mineflayer'),bots=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rc=q=>command(q,15000,{port:25593,properties:stage+'/server.properties'});
const report={passed:false,checks:[],startedAt:new Date().toISOString(),packets:{}};
report.sha256=createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.4.8.jar')).digest('hex').toUpperCase();
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name)};
async function until(fn,label,ms=8000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error(label+' timeout')}
async function state(){const s=await rc('bubbleqa state');return JSON.parse(s.slice(s.indexOf('BQ_JSON ')+8))}
async function audit(){const s=await rc('mycli admin bubbles audit');return JSON.parse(s.slice(s.indexOf('MC_BUBBLES ')+11))}
async function make(username){
 const b=mf.createBot({host:'127.0.0.1',port:25592,username,version:'1.20.6',auth:'offline'});bots.push(b);
 const packets=report.packets[username]=[];b.texts=[];report.messages??={};report.messages[username]=b.texts;b.on('messagestr',s=>b.texts.push(s));b.on('error',e=>{report.connectionErrors??=[];report.connectionErrors.push(username+': '+e.message)});
 b._client.on('packet',(p,m)=>{if(['spawn_entity','entity_metadata','entity_destroy','entity_teleport','camera'].includes(m.name))packets.push({name:m.name,...p,at:Date.now()})});
 await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j)});b.physicsEnabled=false;await rc('minecraft:gamemode creative '+username);return b;
}
async function tp(b,x=-543.5,y=120,z=-439.5){await rc(`minecraft:tp ${b.username} ${x} ${y} ${z}`);await sleep(350)}
function marks(b){return report.packets[b.username].length}
function since(b,index){return report.packets[b.username].slice(index)}
function contains(b,text,index=0){return since(b,index).some(p=>p.name==='entity_metadata'&&JSON.stringify(p.metadata).includes(text))}
function spawns(b,index=0){return since(b,index).filter(p=>p.name==='spawn_entity'&&p.type===b.registry.entitiesByName.text_display.id)}
const config=stage+'/plugins/AgentFriend/text-bubbles.yml';let settings;
try {
 const qa=await make('BubbleQA10'),peer=await make('BubblePeer10'),far=await make('BubbleFar10'),eye=await make('BubbleEye10');
 await tp(qa);await tp(peer,-540.5);await tp(far,-508.5);await tp(eye);
 await rc('minecraft:gamemode spectator BubbleEye10');await sleep(1800);
 report.cameraStatus=await rc('cortieye status');check('real registered Eye attached to QA Agent',/attached=true/.test(report.cameraStatus));
 settings=readFileSync(config,'utf8');
 const initial={q:marks(qa),p:marks(peer),f:marks(far),e:marks(eye)};
 qa.chat('publicBubble-你好，我在记录今天的冒险。');
 await until(()=>contains(peer,'publicBubble-',initial.p),'public chat metadata');
 let entities=(await state()).entities;check('ordinary chat produces one bounded TextDisplay',entities.length===1);
 check('bubble is ephemeral and hidden before authorized spawn',!entities[0].persistent&&!entities[0].visibleByDefault);
 check('Chinese text and bubble pointer retained',entities[0].text.includes('你好')&&entities[0].text.endsWith('\n▼'));
 check('nearby original Mineflayer receives native display',spawns(peer,initial.p).length===1);
 await until(()=>contains(eye,'publicBubble-',initial.e),'Eye display');check('attached Eye receives one display without duplicate body',spawns(eye,initial.e).length===1);
 check('out of range recipient receives no bubble spawn or text',spawns(far,initial.f).length===0&&!contains(far,'publicBubble-',initial.f));
 const id=entities[0].id;await tp(qa,-545.5,122);
 await until(async()=>{const e=(await state()).entities.find(e=>e.id===id);return e&&Math.abs(e.x+545.5)<.01&&Math.abs(e.y-124.15)<.05},'following head');
 check('same bubble follows real movement and height',true);
 await sleep(700);qa.chat('/mycli say cliBubble-大家准备好了吗');
 await until(()=>contains(peer,'cliBubble-'),'CLI speech');
 entities=(await state()).entities;check('Agent CLI follows ordinary chat pipeline and replaces one bubble',entities.length===1&&entities[0].id===id&&qa.texts.some(s=>s.includes('cliBubble-')));
 await sleep(750);const privateMark=marks(peer);qa.chat('/minecraft:msg BubblePeer10 PRIVATE_BUBBLE_SECRET');await sleep(800);
 check('private message reaches recipient without overhead leak',peer.texts.some(s=>s.includes('PRIVATE_BUBBLE_SECRET'))&&!contains(peer,'PRIVATE_BUBBLE_SECRET',privateMark));
 const cancelMark=marks(peer);qa.chat('cancelBubble-SECRET');await sleep(800);
 check('cancelled public input is never rendered',!contains(peer,'cancelBubble-',cancelMark)&&!(await state()).entities.some(e=>e.text.includes('cancelBubble-')));
 await sleep(750);const restrictedQ=marks(qa),restrictedE=marks(eye),restrictedP=marks(peer);
 qa.chat('restrictedBubble-ONLY_PEER');await until(()=>contains(peer,'restrictedBubble-',restrictedP),'restricted audience');
 check('restricted audience revokes old recipients before changing text',!contains(qa,'restrictedBubble-',restrictedQ)&&!contains(eye,'restrictedBubble-',restrictedE));
 await sleep(750);qa.chat('publicBubble-restored');await until(()=>contains(peer,'publicBubble-restored'),'restored public');
 await rc('bubbleqa hidden BubbleQA10 BubblePeer10 yes');await sleep(450);const hiddenMark=marks(peer);
 qa.chat('publicBubble-HIDDEN_TEXT');await sleep(900);
 check('hidden player does not expose bubble text or spawn',!contains(peer,'HIDDEN_TEXT',hiddenMark)&&spawns(peer,hiddenMark).length===0);
 await rc('bubbleqa hidden BubbleQA10 BubblePeer10 no');await sleep(450);
 await tp(qa);await tp(peer,-537.5);await rc('minecraft:fill -541 118 -442 -541 124 -437 minecraft:stone');await sleep(450);
 const wallMark=marks(peer);qa.chat('publicBubble-BEHIND_WALL');await sleep(900);
 check('line of sight prevents wall captions',!contains(peer,'BEHIND_WALL',wallMark));
 await rc('minecraft:fill -541 118 -442 -541 124 -437 minecraft:air');await sleep(450);
 await tp(peer,-540.5);qa.chat('publicBubble-TTL');await sleep(1000);
 await until(async()=>!(await state()).entities.length,'expiry',10000);check('TTL removes display and native client entity',true);
 const spectatorMark=marks(peer);eye.chat('publicBubble-EYE_SHOULD_NOT_SPEAK');await sleep(750);
 check('observer speech does not create an overlapping role entity',!contains(peer,'EYE_SHOULD_NOT_SPEAK',spectatorMark)&&(await state()).entities.length===0);
 qa.chat('/mycli say /minecraft:give BubbleQA10 diamond 64');await sleep(400);
 check('CLI text cannot execute a command',qa.texts.some(s=>s.includes('请输入公开发言正文'))&&(await state()).entities.length===0);
 qa.chat('/mycli explain say');await sleep(350);qa.chat('/mycli bubbles');await sleep(350);
 check('catalog and status expose new commands to unchanged Agent',qa.texts.some(s=>s.includes('MC_CLI_DETAIL')&&s.includes('"say"'))&&qa.texts.some(s=>s.startsWith('MC_BUBBLES ')));
 writeFileSync(config,settings.replace('max-active: 32','max-active: 999'));
 check('invalid reload rejected and last good budget retained',(await rc('mycli admin bubbles reload')).includes('status=rejected')&&(await audit()).maxActive===32);
 writeFileSync(config,settings.replace('enabled: true','enabled: false'));await rc('mycli admin bubbles reload');qa.chat('publicBubble-DISABLED');await sleep(500);
 check('hot disable clears render and pending work',!(await audit()).enabled&&(await state()).entities.length===0);
 writeFileSync(config,settings);await rc('mycli admin bubbles reload');
 qa.chat('publicBubble-WORLD_CHANGE');await sleep(500);report.dimensionReply=await rc('bubbleqa warp BubbleQA10 world_nether');
 await until(()=>/nether/.test(qa.game.dimension),'actual native dimension change',10000);
 await until(async()=>(await state()).entities.length===0,'world-change cleanup');
 check('dimension change removes old-world bubble instead of transferring text',true);await rc('bubbleqa warp BubbleQA10 world');await until(()=>/overworld/.test(qa.game.dimension),'return to overworld');await sleep(500);
 qa.chat('publicBubble-QUIT');await sleep(600);qa.quit();await sleep(500);check('logout removes display',(await state()).entities.length===0);
 report.msptBefore=(await state()).mspt;
 const loads=[];for(let i=0;i<16;i++){const b=await make(`BubbleLoad${String(i).padStart(2,'0')}`);loads.push(b);await tp(b,-543.5+(i%4)*2,120,-439.5+Math.floor(i/4)*2)}
 for(let round=0;round<4;round++){for(const b of loads)b.chat(`publicBubble-load-${b.username}-round${round}`);await sleep(900)}
 const loadState=await state();report.loadAudit=await audit();report.msptAfter=loadState.mspt;
 check('16 simultaneous speakers stay at one display each',loadState.entities.length===16&&new Set(loadState.entities.map(e=>e.id)).size===16);
 check('load queue and renderer remain bounded with zero errors',report.loadAudit.pending<=64&&report.loadAudit.active<=32&&report.loadAudit.errors===0);
 check('16 speakers do not stall tick loop',report.msptAfter<50);
 await until(async()=>!(await state()).entities.length,'load expiry',10000);check('all load bubbles expire without residue',true);
 report.passed=true;
} catch(e){report.error=e.stack;console.error(e.stack);process.exitCode=1}
finally {
 if(settings){writeFileSync(config,settings);try{await rc('mycli admin bubbles reload')}catch{}}
 for(const b of bots)if(b._client.state==='play')b.quit();await sleep(300);
 report.finishedAt=new Date().toISOString();writeFileSync(root+`/native-${Date.now()}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error?.split('\n')[0],loadAudit:report.loadAudit,msptBefore:report.msptBefore,msptAfter:report.msptAfter}));
}
process.exit(process.exitCode??0);
