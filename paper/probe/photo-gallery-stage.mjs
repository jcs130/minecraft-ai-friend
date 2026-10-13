import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
import {startGoddessPhotoCamera} from '../ops/goddess-photo-camera.mjs';
const stage='E:/MC/staging/exploration-gallery-20261014/paper',root='E:/MC/ops/repairs/exploration-gallery-20261014';
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');fix1206PotionProtocol(req);
const mf=req('mineflayer'),{Vec3}=req('vec3'),yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const report={started:new Date().toISOString(),checks:[],messages:{},logs:[],passed:false};
const bots=[];let adapter;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rc=q=>command(q,25000,{port:25675,properties:stage+'/server.properties'});
const check=(label,ok)=>{assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);};
async function until(fn,ms=30000){for(let end=Date.now()+ms;Date.now()<end;){if(await fn())return;await sleep(200);}throw Error('Condition timeout');}
async function join(name){const b=mf.createBot({host:'127.0.0.1',port:25674,username:name,auth:'offline',version:'1.20.6',viewDistance:'far',checkTimeoutInterval:60000});bots.push(b);report.messages[name]=[];
 installRecipePacketBypass(b._client,{enabled:true});b.on('messagestr',s=>report.messages[name].push(s));b.on('error',e=>report.logs.push(e.message));
 await new Promise((resolve,reject)=>{b.once('spawn',resolve);b.once('kicked',k=>reject(Error(JSON.stringify(k))));b.once('error',reject);setTimeout(()=>reject(Error('join timeout')),25000).unref();});return b;}
async function ask(b,q,delay=700){const n=report.messages[b.username].length;b.chat(q);await sleep(delay);return report.messages[b.username].slice(n).join('\n');}
const journal=()=>JSON.parse(readFileSync(stage+'/plugins/AgentFriend/photo-journal.json'));
try {
 check('isolated target identified',(await rc('version AgentFriend')).includes('0.4.37')&&readFileSync(stage+'/server.properties','utf8').includes('server-ip=127.0.0.1'));
 // Reruns retain all previous evidence. Withdraw only this test's fictional
 // authors through their normal command, so an older submission cannot occupy
 // the slot being verified for a new author.
 let earlier;try{earlier=journal();}catch{}
 for(const profile of Object.values(earlier?.players??{})){
  const rows=Object.values(profile.photos??{}).filter(r=>r.published&&/^(ag_Photo37|ag_P\d{9})$/.test(r.author));
  if(!rows.length)continue;const author=await join(rows[0].author);
  for(const r of rows)await ask(author,'/mycli photo withdraw '+r.name);
  author.quit('Previous isolated submissions retained and withdrawn');await sleep(500);
 }
 const y=yaml.load(readFileSync(stage+'/plugins/AgentFriend/task-market.yml','utf8'));
 y.tasks.photo_qa={scope:'personal',repeat:'once',title:'摄影隔离考题',description:'真实走查后实地拍摄，再交付。',beneficiary:'隔离考官',icon:'FILLED_MAP',reward:{fame:1,emeralds:1,bonus:'BREAD','bonus-count':1},steps:[{title:'实地走查',description:'实测新路线和照片',goal:'dimension',dimension:'overworld',target:2,'zone-size':4,'min-distance':8,'min-seconds':5}]};
 writeFileSync(stage+'/plugins/AgentFriend/task-market.yml',yaml.dump(y,{lineWidth:-1}));check('isolated course loaded',(await rc('mycli admin market reload')).includes('loaded')||(await rc('mycli admin market audit')).length>0);
 await rc('minecraft:fill -609 68 -396 -589 68 -362 minecraft:stone');await rc('minecraft:fill -609 69 -396 -589 75 -362 minecraft:air');await rc('minecraft:time set day');
 const p=await join('ag_P'+String(Date.now()).slice(-9)),other=await join('PhotoGuest37');report.owner=p.username;await rc('minecraft:tp '+p.username+' -600.5 69 -394.5 0 0');await rc('minecraft:tp PhotoGuest37 -598.5 69 -391.5');await sleep(1000);
 check('ordinary guild registration',(await ask(p,'/mycli guild join')).length>0);
 await ask(p,'/mycli guild exam cancel');await ask(p,'/mycli guild abandon');
 check('survey exam starts',(await ask(p,'/mycli guild exam start survey_basic')).includes('考试已开始'));
 check('matching contract accepted',(await ask(p,'/mycli guild accept tm_photo_qa')).includes('摄影隔离考题'));
 await p.lookAt(new Vec3(-600.5,70.62,-361),true);p.setControlState('forward',true);await sleep(5700);p.clearControlStates();await sleep(600);
 const denied=await ask(p,'/mycli guild verify',1300);check('actual route cannot pass without photograph',denied.includes('exploration_photo_required'));
 const goddess=await join('Goddess');goddess.physicsEnabled=false;
 const settings=JSON.parse(readFileSync('E:/MC/ops/goddess-photo-camera.json','utf8'));
 // The isolated server sends radius 4, production sends 8. Keep the test
 // camera within the actual server limit instead of awaiting unsent columns.
 settings.renderDistance=4;
 adapter=startGoddessPhotoCamera(goddess,{settings,log:s=>report.logs.push(s),onCapture:async info=>{writeFileSync(root+'/gallery-real-photo.png',info.png);report.capture={bytes:info.png.length,mode:info.mode,diagnostics:info.diagnostics};},onRenderFailure:async info=>{writeFileSync(root+'/gallery-render-failure.png',info.png);report.renderFailure={diagnostics:info.diagnostics,pageErrors:info.pageErrors};}});
 await until(async()=>JSON.parse((await rc('mycli admin photo status')).split('MC_PHOTO_ADMIN ')[1]).ready,40000);check('real Goddess camera ready',true);
 await rc('minecraft:give '+p.username+' minecraft:map 5');await p.lookAt(new Vec3(-627,73,-379),true);await sleep(600);
 const name='旅行纪念_'+Date.now();report.photoName=name;await ask(p,'/mycli photo take '+name+' first',100);
 await until(()=>{try{return Object.values(journal().players).some(v=>Object.values(v.photos??{}).some(r=>r.name===name));}catch{return false;}},110000);
 const photo=Object.values(journal().players[p.player.uuid].photos).find(r=>r.name===name);report.photo=photo;
 check('real PNG has trusted hash and actual map delivery',photo.image?.sha256.length===64&&p.inventory.items().some(i=>i.name==='filled_map'));
 check('photograph includes region and current exam',photo.context?.examRun&&photo.context?.marketRun&&photo.qualified);
 check('exploration plus photo passes',(await ask(p,'/mycli guild verify',1300)).includes('验收通过'));
 await ask(p,'/mycli guild claim',1500);const exam=await ask(p,'/mycli guild exam submit');check('survey certificate requires both native proofs',exam.includes('取得能力证书'));
 check('story required before publishing',(await ask(p,'/mycli photo exhibit '+name)).includes('先写作品故事'));
 await ask(p,'/mycli photo title '+name+' 河畔的千灯记忆');await ask(p,'/mycli photo story '+name+' 我沿河走到村外，看到图书馆改成的新艺术厅。这是这次旅行留下的第一张照片。');
 check('other player cannot edit author record',(await ask(other,'/mycli photo title '+name+' 冒名')).includes('没有这份可读作品'));
 const beforeGuest=report.messages[other.username].length;await ask(p,'/mycli photo exhibit '+name);check('metadata not broadcast',!report.messages[other.username].slice(beforeGuest).some(s=>s.includes('MC_PHOTO')||s.includes('河畔的千灯')));
 check('publication explicitly recorded',journal().players[p.player.uuid].photos[photo.id].published);
 await ask(other,'/mycli photo gallery');check('native gallery opens for ordinary player',JSON.stringify(other.currentWindow?.title??'').includes('艺术厅'));
 if(other.currentWindow)other.closeWindow(other.currentWindow);check('public record readable',(await ask(other,'/mycli photo info '+photo.id)).includes('河畔的千灯记忆'));
 let frame=journal().photoSlots?.test_wall?.frames?.[0];
 if(!frame){
  await rc('minecraft:setblock -593 70 -371 minecraft:stone');await rc('minecraft:summon minecraft:item_frame -593.5 70.5 -370.96875 {Facing:3b,Tags:["PhotoGalleryQA"]}');
  const raw=await rc('minecraft:data get entity @e[type=minecraft:item_frame,tag=PhotoGalleryQA,limit=1] UUID');const nums=raw.match(/\[I;\s*([^\]]+)/)?.[1].split(',').map(Number);assert.equal(nums?.length,4);
  const hex=nums.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');frame=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  check('empty native frame registered',(await rc('mycli admin photo gallery-slot test_wall '+frame)).includes('已登记'));
 }else check('existing exhibition slot safely reused',journal().photoSlots.test_wall.work===photo.id);
 report.frame=frame;
 check('actual frame displays the map',(await rc('minecraft:data get entity '+frame+' Item')).includes('filled_map'));
 check('frame labelled with author',(await rc('minecraft:data get entity '+frame+' CustomName')).includes(p.username));
 check('occupied frame cannot be reassigned',(await rc('mycli admin photo gallery-slot other_wall '+frame)).includes('已使用'));
 check('recorded source cannot be overwritten',(await ask(p,'/imageframe refresh '+name+' upload')).includes('不能覆盖'));
 await ask(p,'/mycli photo withdraw '+name);check('withdraw clears only exhibition frame',!(await rc('minecraft:data get entity '+frame+' Item')).includes('filled_map'));
 check('withdraw retains personal original',journal().players[p.player.uuid].photos[photo.id]&&!journal().players[p.player.uuid].photos[photo.id].published&&p.inventory.items().some(i=>i.name==='filled_map'));
 await ask(p,'/mycli photo exhibit '+name);report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}finally{adapter?.close();for(const b of bots)b.quit('Isolated photography test completed');await sleep(1200);mkdirSync(root,{recursive:true});writeFileSync(root+'/photo-stage-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));process.exit(report.passed?0:1);}
