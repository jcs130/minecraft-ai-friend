// Loopback-only regression: native Terralith biomes, a legacy CUSTOM contract,
// real Mineflayer walking, teleport rejection and exactly-once reward claims.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/exploration-gallery-20261014/paper';
const out='E:/MC/ops/repairs/exploration-gallery-20261014';
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');fix1206PotionProtocol(req);
const mf=req('mineflayer'),{Vec3}=req('vec3'),yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const report={started:new Date().toISOString(),checks:[],messages:{},passed:false};const bots=[];
const rc=s=>command(s,20000,{port:25675,properties:stage+'/server.properties'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(label,ok)=>{assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);};
async function join(username){const b=mf.createBot({host:'127.0.0.1',port:25674,username,version:'1.20.6',auth:'offline',checkTimeoutInterval:60000});bots.push(b);report.messages[username]=[];
 installRecipePacketBypass(b._client,{enabled:true});b.on('messagestr',s=>report.messages[username].push(s));b.on('error',e=>{report.errorEvent=e.message;});
 await new Promise((resolve,reject)=>{b.once('spawn',resolve);b.once('kicked',k=>reject(Error(JSON.stringify(k))));b.once('error',reject);setTimeout(()=>reject(Error('join timeout')),25000).unref();});return b;}
const row=p=>yaml.load(readFileSync(stage+'/plugins/AgentFriend/config.yml','utf8'))['guild-players'][p.player.uuid];
async function ask(p,line){const n=report.messages[p.username].length;p.chat(line);await sleep(600);return report.messages[p.username].slice(n).join('\n');}
async function walk(p,x,ms){await p.lookAt(new Vec3(x,p.entity.position.y+1.62,p.entity.position.z),true);p.setControlState('forward',true);try{await sleep(ms);}finally{p.clearControlStates();}await sleep(500);}
try{
 check('isolated server identified',readFileSync(stage+'/server.properties','utf8').includes('server-ip=127.0.0.1')&&(await rc('version AgentFriend')).includes('0.4.37'));
 await rc('minecraft:forceload add -752 -464 -672 -448');
 await rc('minecraft:fill -744 68 -460 -680 68 -456 minecraft:stone');
 await rc('minecraft:fill -744 69 -460 -680 74 -456 minecraft:air');
 report.firstBiome=await rc('minecraft:fillbiome -744 64 -460 -721 76 -456 terralith:shrubland');
 check('first real datapack biome set',/\d+ biome entry\/entries set between/.test(report.firstBiome));
 report.secondBiome=await rc('minecraft:fillbiome -720 64 -460 -680 76 -456 terralith:temperate_highlands');
 check('second distinct datapack biome set',/\d+ biome entry\/entries set between/.test(report.secondBiome));
 const p=await join('ag_Border37'),guest=await join('BorderGuest37');
 await rc('minecraft:tp ag_Border37 -740.5 69 -458.5');await sleep(700);
 check('original legacy in-flight record retained',row(p).active.biome1==='CUSTOM'&&row(p).active.biomeAt==='-500,69,-468'&&row(p).active.progress===0);
 const before=readFileSync(stage+'/plugins/AgentFriend/config.yml','utf8');
 const status=await ask(p,'/mycli guild status');
 check('native current biome visible and actionable',status.includes('terralith:shrubland')&&status.includes('不要求回到接单位置'));
 check('status query does not change stored progress',readFileSync(stage+'/plugins/AgentFriend/config.yml','utf8')===before);
 await walk(p,-730,1600);
 check('same biome movement cannot finish',p.entity.position.x>-739&&row(p).active.progress===0);
 await rc('minecraft:tp ag_Border37 -710.5 69 -458.5');await sleep(700);
 check('teleport across biomes does not finish',row(p).active.progress===0);
 check('other datapack biome resolved', (await ask(p,'/mycli guild status')).includes('terralith:temperate_highlands'));
 await rc('minecraft:tp ag_Border37 -724.5 69 -458.5');await sleep(600);
 const guestStart=report.messages[guest.username].length;
 await walk(p,-700,2200);
 report.position=p.entity.position;report.crossing=row(p).active;
 check('actual custom/custom crossing finishes far from old anchor',p.entity.position.x>-720&&row(p).active.progress===1);
 check('record includes true pair and coordinates',row(p).active.border.fromBiome==='terralith:shrubland'&&row(p).active.border.toBiome==='terralith:temperate_highlands'&&/^[0-9a-f-]{36}$/.test(row(p).active.border.world)&&typeof row(p).active.border.from==='string'&&typeof row(p).active.border.to==='string');
 check('does not automatically give rewards',row(p).fame===0&&row(p).completed===0);
 check('completion messages are private',!report.messages[guest.username].slice(guestStart).some(s=>s.includes('边界巡礼')||s.includes('已实际跨过')));
 const recorded=JSON.stringify(row(p).active);await walk(p,-690,1300);
 check('further walking cannot replace original completion evidence',JSON.stringify(row(p).active)===recorded);
 const claim=await ask(p,'/mycli guild claim');check('original claim path completes contract',!row(p).active&&row(p).completed===1&&row(p).fame>=6);
 const fame=row(p).fame;await ask(p,'/mycli guild claim');check('duplicate claim does not pay twice',row(p).fame===fame&&row(p).completed===1);
 report.claim=claim;report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{for(const p of bots)p.quit('Isolated biome border verification complete');await sleep(1000);writeFileSync(out+'/biome-border-stage-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));process.exit(report.passed?0:1);}
