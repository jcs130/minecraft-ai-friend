// Controlled native protocol verification on this disposable loopback copy only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const root='E:/MC/ops/repairs/skill-certifications-20261011',stage='E:/MC/staging/skill-certifications-20261011';
const suffix=process.env.CERT_QA_SUFFIX||'11';assert.match(suffix,/^\d{2}$/);
const req=createRequire('E:/Cortico/package.json');fix1206PotionProtocol(req);
const mfReq=createRequire(req.resolve('mineflayer')),data=mfReq('minecraft-data')('1.20.6');
const food=data.protocol.types.SlotComponent[1].find(f=>f.name==='data').type[1].fields.food[1],later=food.findIndex(f=>f.name==='usingConvertsTo');if(later>=0)food.splice(later,1);
const mf=req('mineflayer'),{Vec3}=mfReq('vec3'),bots=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rc=async q=>{const response=await command(q,15000,{port:25649,properties:stage+'/server.properties'});report.fixtures.push({q,response});return response;};
const report={at:new Date().toISOString(),candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.4.16.jar')).digest('hex'),execution:'controlled_protocol_QA_not_autonomous_Agent',checks:[],messages:{},packets:{},fixtures:[],errors:[],passed:false};
const X=-2200,Y=101,Z=-2200;
const profile=c=>JSON.parse(readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8')).players[c.bot.player.uuid];
function check(name,ok,detail){report.checks.push({name,ok:!!ok,detail});assert.ok(ok,name+' '+JSON.stringify(detail??'',(_,v)=>typeof v==='bigint'?v.toString():v));console.log('PASS '+name);}
async function until(f,label,timeout=15000){for(let end=Date.now()+timeout;Date.now()<end;){if(await f())return;await sleep(70);}throw Error('Timeout '+label);}
const json=s=>JSON.parse(s.slice(s.indexOf('{')));
async function join(name){
 const bot=mf.createBot({host:'127.0.0.1',port:25648,username:name,auth:'offline',version:'1.20.6',viewDistance:'short'}),c={bot,name,lines:[],packets:[],abilities:[],cameras:[]};bots.push(c);report.messages[name]=c.lines;report.packets[name]=c.packets;
 bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>report.errors.push(name+': '+e.message));bot.on('kicked',r=>report.errors.push(name+': kicked '+JSON.stringify(r)));
 bot._client.on('abilities',p=>c.abilities.push(p));
 bot._client.on('camera',p=>c.cameras.push(p.cameraId));
 bot._client.on('custom_payload',p=>{if(p.channel.startsWith('mcagent:')||p.channel==='mcviewer:state')try{c.packets.push({channel:p.channel,bytes:p.data.length,...JSON.parse(p.data.toString())});}catch{}});
 await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);setTimeout(()=>j(Error('join timeout '+name)),18000).unref();});
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:state\0mcviewer:state\0mcagent:exam\0mcagent:market')});await sleep(500);return c;
}
async function chat(c,q){await sleep(Math.max(0,1050-(Date.now()-(c.lastChat||0))));c.lastChat=Date.now();c.bot.chat(q);}
async function ask(c,q,prefix='MC_GUILD_EXAM '){const n=c.lines.length;await chat(c,q);await until(()=>c.lines.slice(n).some(s=>s.startsWith(prefix)),q);await sleep(120);return c.lines.slice(n).filter(s=>s.startsWith(prefix)).map(json).at(-1);}
async function result(c,q,reason='success'){const r=await ask(c,q,'MC_PROFESSION_RESULT ');check(q+' -> '+reason,r.reason===reason,r);return r;}
const state=async c=>json(await rc('academyqa state '+c.name));
async function refill(c){const s=json(await rc('academyqa mana '+c.name));assert.ok(!s.error,JSON.stringify(s));return s;}
async function tp(c,x=X,y=Y,z=Z){
 // Pause local physics only for fixture relocation, never during measured actions.
 c.bot.clearControlStates();c.bot.physicsEnabled=false;
 try {await rc(`minecraft:tp ${c.name} ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`);await until(()=>c.bot.entity.position.distanceTo(new Vec3(x,y,z))<.6,'tp '+c.name);await c.bot.waitForChunksToLoad();await sleep(400);}
 finally {c.bot.physicsEnabled=true;}
 await sleep(400);
}
async function setup(c,role){await tp(c);await rc('minecraft:gamemode survival '+c.name);await chat(c,'/mycli guild join');await sleep(400);await rc('academyqa level '+c.name+' 151');await result(c,'/mycli profession choose '+role);await refill(c);}
async function fly(c,x,y,z){await c.bot.creative.flyTo(new Vec3(x,y,z));}
async function stopFlying(c){c.bot._client.write('abilities',{flags:0});c.bot.creative.stopFlying();await sleep(350);}
async function route(c,backwards=true){
 await c.bot.look(0,0,true);await fly(c,X,Y+4,Z+8);await fly(c,X+8,Y+4,Z+8);await fly(c,X+8,Y+7,Z+16);
 // Mineflayer yaw 0 is -Z; Bukkit yaw 0 is +Z. Looking +Z and moving -Z is backwards.
 await c.bot.look(backwards?Math.PI:0,0,true);await fly(c,X+8,Y+7,Z+11);
 await c.bot.look(Math.PI,0,true);await fly(c,X+8,Y,Z+20);await stopFlying(c);await sleep(2600);
}
async function cancel(c){await ask(c,'/mycli guild exam cancel');}
async function walk(c,x,y,z,timeout=8000,precision=.45){const end=Date.now()+timeout;while(Date.now()<end){const at=c.bot.entity.position;if(Math.hypot(at.x-x,at.z-z)<precision){c.bot.clearControlStates();if(c.bot.entity.onGround)break;}else{await c.bot.lookAt(new Vec3(x,at.y+1.6,z),true);c.bot.setControlState('forward',true);}await sleep(100);}c.bot.clearControlStates();}
export {assert,readFileSync,writeFileSync,root,stage,suffix,bots,sleep,rc,report,X,Y,Z,Vec3,profile,check,until,json,join,chat,ask,result,state,refill,tp,setup,fly,stopFlying,route,cancel,walk};
