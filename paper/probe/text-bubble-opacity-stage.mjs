// Real native TextDisplay metadata through Mineflayer and the Web content bridge.
// Only the existing loopback laboratory is allowed; production is never touched.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {createViewerContentBridge} from 'file:///E:/mc-visual-console/packages/modern-viewer/renderer-src/host/viewer-content.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';

const stage='E:/MC/staging/ysm-release-20261011/paper',out=process.env.BUBBLE_REPORT;
assert(out&&!existsSync(out),'Set BUBBLE_REPORT to a fresh private result file');
const props=readFileSync(stage+'/server.properties','utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
assert.match(props,/^server-port=25644\r?$/m);
assert.match(props,/^rcon.port=25645\r?$/m);
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
fix1206PotionProtocol(req);
const {createBot}=req('mineflayer'),clients=[];
const report={startedAt:new Date().toISOString(),checks:[],errors:[],samples:{}};
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:25645});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const file=stage+'/plugins/AgentFriend/text-bubbles.yml',original=readFileSync(file,'utf8');
let closing=false;
function check(name,condition){report.checks.push({name,pass:!!condition});assert.ok(condition,name);console.log('PASS '+name);}
async function until(fn,label,ms=12000){
 const end=Date.now()+ms;
 while(Date.now()<end){const value=fn();if(value)return value;await sleep(80);}
 throw Error('Timeout '+label);
}
async function join(name){
 const bot=createBot({host:'127.0.0.1',port:25644,username:name,version:'1.20.6',auth:'offline',hideErrors:true});
 installRecipePacketBypass(bot._client);
 const c={bot,name,text:[],content:[],cameras:[]};clients.push(c);
 bot.on('messagestr',s=>c.text.push(s));
 bot.on('error',e=>{if(!closing)report.errors.push(name+': '+e.message);});
 bot._client.on('camera',p=>c.cameras.push(p));
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('spawn '+name)),30000);
  bot.once('spawn',()=>{clearTimeout(timer);resolve();});bot.once('error',reject);bot.once('kicked',reject);
 });
 bot.physicsEnabled=false;await sleep(1600);
 c.bridge=createViewerContentBridge(bot);c.bridge.subscribe((name,value)=>c.content.push({name,value}));return c;
}
async function tp(c,x=100.5,y=201,z=95.5){await rc(`minecraft:tp ${c.name} ${x} ${y} ${z}`);await sleep(400);}
function bubble(c,text,from=0){return c.content.slice(from).find(e=>e.name==='textDisplay'&&!e.value.delete&&e.value.runs.some(r=>r.text.includes(text)))?.value;}
async function say(c,text){c.bot.chat('/mycli say '+text);await sleep(750);}
function configure(value){
 writeFileSync(file,original.replace(/^background-opacity:.*\r?\n?/gm,'')+'\nbackground-opacity: '+value+'\n');
}
function auditAlpha(raw){const match=raw.match(/MC_BUBBLES\s+(\{[^\r\n]+\})/);return match?JSON.parse(match[1]).backgroundOpacity:null;}
function matches(display,alpha,color){
 return display.background===((alpha*0x1000000+0xffffff)>>>0)&&display.opacity===255&&display.flags===0&&display.runs.some(r=>r.color===color);
}
try{
 check('candidate AgentFriend 0.4.30',(await rc('version AgentFriend')).includes('0.4.30'));
 // A genuinely old configuration must receive the new fallback without migration.
 writeFileSync(file,original.replace(/^background-opacity:.*\r?\n?/gm,''));
 check('legacy configuration reload accepted',(await rc('mycli admin bubbles reload')).includes('status=success'));
 check('audit reports default alpha 180',auditAlpha(await rc('mycli admin bubbles audit'))===180);
 const caster=await join('YsmReleaseQA'),peer=await join('GuideOther'),eye=await join('YsmReleaseQA_eye');
 await rc('minecraft:gamemode creative YsmReleaseQA');await rc('minecraft:gamemode creative GuideOther');
 await tp(caster);await tp(peer,100.5,201,94.5);
 await until(()=>eye.cameras.some(p=>Object.values(p).includes(caster.bot.entity.id)),'actual Eye attachment');
 check('real Eye attaches to the correct player',true);
 const marker='半透明气泡-准备出发';await say(caster,marker);
 const display=await until(()=>bubble(peer,marker),'player bubble');report.samples.player=display;
 check('native player bubble has alpha 180 and opaque dark glyphs',matches(display,180,'#1f2937'));
 check('pointer stays opaque with its own gray color',display.runs.some(r=>r.text==='\n▼'&&r.color==='#64748b'));
 const eyeDisplay=await until(()=>bubble(eye,marker),'Eye bubble');
 check('Eye receives the same native display and alpha',eyeDisplay.id===display.id&&matches(eyeDisplay,180,'#1f2937'));
 for(const alpha of [0,128,255]){
  configure(alpha);check('valid alpha '+alpha+' reload accepted',(await rc('mycli admin bubbles reload')).includes('status=success'));
  const text='透明度验证-'+alpha;await say(caster,text);
  const received=await until(()=>bubble(peer,text),'alpha '+alpha);report.samples['alpha'+alpha]=received;
  check('alpha '+alpha+' reaches Web unchanged while text stays opaque',matches(received,alpha,'#1f2937'));
 }
 configure(180);await rc('mycli admin bubbles reload');
 for(const value of ['-1','256','1.5','"128"']){
  configure(value);check('invalid alpha '+value+' rejects reload',(await rc('mycli admin bubbles reload')).includes('status=rejected'));
  check('invalid alpha '+value+' preserves previous alpha',auditAlpha(await rc('mycli admin bubbles audit'))===180);
 }
 const retained='无效设置后仍清晰';await say(caster,retained);
 check('rejected reload leaves the real appearance unchanged',matches(await until(()=>bubble(peer,retained),'retained alpha'),180,'#1f2937'));
 configure(180);await rc('mycli admin bubbles reload');
 const privateFrom=peer.content.length;caster.bot.chat('/msg GuideOther BUBBLE_PRIVATE_SECRET');await sleep(750);
 check('private player messages do not leak into overhead captions',!bubble(peer,'BUBBLE_PRIVATE_SECRET',privateFrom));
 await tp(caster,-492.5,67,-498.5);await tp(peer,-493.5,67,-498.5);await sleep(900);
 const npc=Object.values(caster.bot.entities).find(e=>e.name==='villager'&&Math.abs(e.position.x+492.5)<2&&Math.abs(e.position.z+497.5)<2);
 check('real guild receptionist loaded',!!npc);
 const peerFrom=peer.content.length,casterFrom=caster.content.length,eyeFrom=eye.content.length;
 await caster.bot.activateEntity(npc);
 const npcDisplay=await until(()=>bubble(caster,'欢迎来到冒险者公会',casterFrom),'NPC bubble');report.samples.npc=npcDisplay;
 check('NPC bubble uses the same translucent background and opaque blue text',matches(npcDisplay,180,'#1d4ed8'));
 const npcEye=await until(()=>bubble(eye,'欢迎来到冒险者公会',eyeFrom),'NPC Eye bubble');
 check('actual attached Eye receives the private NPC appearance',npcEye.id===npcDisplay.id&&matches(npcEye,180,'#1d4ed8'));
 check('nearby unrelated player cannot see private NPC captions',!bubble(peer,'欢迎来到冒险者公会',peerFrom));
 if(caster.bot.currentWindow)caster.bot.closeWindow(caster.bot.currentWindow);
 check('no client transport errors',report.errors.length===0);
 report.passed=report.checks.length;
}catch(error){report.failure=error.stack;console.error(error.stack);process.exitCode=1;}
finally{
 closing=true;writeFileSync(file,original);
 try{await rc('mycli admin bubbles reload');}catch(error){report.cleanupError=String(error);process.exitCode=1;}
 for(const c of clients){c.bridge?.dispose();c.bot.quit('bubble alpha verification finished');}
 report.finishedAt=new Date().toISOString();writeFileSync(out,JSON.stringify(report,null,2)+'\n');await sleep(400);
}
