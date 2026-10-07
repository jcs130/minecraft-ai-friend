import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
// World modifications and operator teleports in this fixture are restricted to isolated ports.
const stage='E:/MC/staging/life-buildings-20261003';
const roots=['E:/MC/ops/repairs/exploration-contracts-20261007','F:/MC-backups/repairs/exploration-contracts-20261007'];
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const rcon=q=>command(q,20000,{port:25587,properties:stage+'/server.properties'});
const dimKey=d=>d==='nether'?'the_nether':d==='end'?'the_end':d;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const resume=process.argv[2]==='resume';
const previous=resume?JSON.parse(readFileSync(roots[0]+'/exploration-result.json','utf8')):null;
const candidateSha256=createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.88.jar')).digest('hex').toUpperCase();
const report={passed:false,checks:[],started:new Date().toISOString(),messages:{},packets:{},candidateSha256};
const bots=[];
const check=(name,ok,detail='')=>{assert.ok(ok,name+': '+detail);report.checks.push(name);};
const make=async name=>{
 const b=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'});bots.push(b);
 report.messages[name]=[];report.packets[name]=[];
 b.on('messagestr',s=>report.messages[name].push(s));b.on('error',e=>{report.errors??=[];report.errors.push(String(e));});
 b._client.on('custom_payload',p=>{if(p.channel==='mcagent:market')report.packets[name].push(JSON.parse(p.data.toString('utf8')));});
 await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j);});return b;
};
const ask=async(b,q,delay=1100)=>{const n=report.messages[b.username].length;b.chat(q);await sleep(delay);return report.messages[b.username].slice(n).join('\n');};
const verify=async b=>{const n=report.packets[b.username].length;const text=await ask(b,'/mycli guild verify');
 const p=report.packets[b.username].slice(n).find(p=>p.type==='MC_MARKET_CHECK');assert.ok(p,text);return p;};
const tp=async(b,dim,x,y,z)=>{
 // Isolated fixture refill: exercise survival teleport events without failing setup due to the existing mana gate.
 await rcon('surveyqa mana '+b.username);
 await rcon(`execute in minecraft:${dimKey(dim)} run minecraft:tp ${b.username} ${x} ${y} ${z}`);await sleep(950);
 const p=JSON.parse(await rcon('surveyqa position '+b.username));
 const world=dimKey(dim)==='the_nether'?'world_nether':dimKey(dim)==='the_end'?'world_the_end':'world';
 assert.equal(p.world,world,'fixture teleport must actually change dimension');
};
const walk=async(b,x,z)=>{
 const start=Date.now();await b.lookAt(new Vec3(x,b.entity.position.y+1.62,z),true);b.setControlState('forward',true);
 try{while(Math.hypot(b.entity.position.x-x,b.entity.position.z-z)>.9){
  if(Date.now()-start>25000)throw new Error('walk stuck '+JSON.stringify(b.entity.position)+' to '+x+','+z);
  await b.lookAt(new Vec3(x,b.entity.position.y+1.62,z),true);await sleep(80);
 }}finally{b.setControlState('forward',false);}await sleep(350);
};
const route=async(b,points)=>{for(const [x,z]of points)await walk(b,x,z);};
const accept=async(b,key)=>check('accept '+key,/已接公会委托/.test(await ask(b,'/mycli guild accept tm_'+key)));
const abandon=async b=>ask(b,'/mycli guild abandon');
const reward={fame:8,emeralds:3,bonus:'BREAD','bonus-count':2};
const step=(goal,dimension,extra={})=>({title:'隔离探索验收',description:'真实服务器观察的探索路线',goal,dimension,target:4,'zone-size':4,'min-distance':16,'min-seconds':5,...extra});
const task=steps=>({scope:'personal',repeat:'once',title:'隔离探索履历',description:'测试实际探索，不以到访或模型宣称作为完成',icon:'MAP',reward,steps});
const cfg={'schema-version':1,sites:{},tasks:{
 qa_dim:task([step('dimension','nether',{'min-biomes':2}),step('return','overworld',{target:1})]),
 qa_end:task([step('dimension','end')]),
 qa_biome:task([step('biome','overworld',{biome:'minecraft:plains'})]),
 qa_pyramid:task([step('structure','overworld',{structure:'minecraft:desert_pyramid','min-sections':1})]),
 qa_height:task([step('structure','overworld',{structure:'minecraft:desert_pyramid','min-height-span':4})]),
 qa_parts:task([step('structure','nether',{structure:'minecraft:fortress','min-sections':2})]),
 qa_loop:task([step('dimension','overworld',{'min-distance':60,'min-seconds':30})]),
 qa_survey_resume:task([step('dimension','overworld',{target:10,'min-distance':48,'min-seconds':12})]),
}};
const cfgPath=stage+'/plugins/AgentFriend/task-market.yml';
const write=async c=>{writeFileSync(cfgPath,JSON.stringify(c,null,2));return rcon('mycli admin market reload');};
const flat=async(dim,x,y,z,xx,zz)=>{
 dim=dimKey(dim);
 await rcon(`execute in minecraft:${dim} run minecraft:forceload add ${x} ${z} ${xx} ${zz}`);
 // Isolated survey floor: contain falling sand/gravel from the natural terrain above the fixture.
 await rcon(`execute in minecraft:${dim} run minecraft:fill ${x} ${y+4} ${z} ${xx} ${y+4} ${zz} minecraft:glass`);
 await rcon(`execute in minecraft:${dim} run minecraft:fill ${x} ${y-1} ${z} ${xx} ${y-1} ${zz} minecraft:stone`);
 await rcon(`execute in minecraft:${dim} run minecraft:fill ${x} ${y} ${z} ${xx} ${y+3} ${zz} minecraft:air`);
};
const locate=async(dim,key,b)=>{
 dim=dimKey(dim);
 const text=await rcon(`execute in minecraft:${dim} positioned 0 70 0 run minecraft:locate structure minecraft:${key}`);
 report['locate_'+key]=text;const coords=text.match(/\[(-?\d+), ~, (-?\d+)\]/);assert.ok(coords,text);
 const x=Number(coords[1]),z=Number(coords[2]);await tp(b,dim,x+.5,150,z+.5);await sleep(2500);
 const world=dim==='the_nether'?'world_nether':'world';
 const data=JSON.parse(await rcon(`surveyqa pieces ${world} minecraft:${key} ${x} ${z}`));
 assert.ok(data.starts?.[0]?.pieces?.length,JSON.stringify(data));report['metadata_'+key]=data;return data.starts[0].pieces;
};
try{
 check('isolated version 0.3.88',/0\.3\.88/.test(await rcon('version AgentFriend')));
 if(resume){
  const a=await make(previous.restart.player);await sleep(1200);
  let p=await verify(a);const before=previous.restart.evidence;
  check('restart keeps distinct coverage',p.evidence.distinctZones===before.distinctZones);
  check('restart keeps distance and moving time',p.evidence.distance===before.distance&&p.evidence.movingSeconds===before.movingSeconds);
  check('offline and standing do not add evidence',!p.ready);
  await route(a,[[1434.5,1042.5],[1434.5,1054.5],[1402.5,1054.5],[1402.5,1062.5]]);
  p=await verify(a);check('new route after restart completes survey',p.ready,JSON.stringify(p));
  check('restarted survey rewards once',/委托交付成功/.test(await ask(a,'/mycli guild claim')));
  check('permanent once ledger survives restart',/每人仅结算一次/.test(await ask(a,'/mycli guild accept tm_qa_dim')));
  check('own assessment includes exploration evidence',/dimension/.test(await ask(a,'/mycli guild assessment')));
 }else{
  check('isolated read helper available',JSON.parse(await rcon('surveyqa chunks')).world>0);
  check('exploration config hot reload',/已热加载/.test(await write(cfg)));
  const a=await make('SvA'+String(Date.now()).slice(-6)),b=await make('SvB'+String(Date.now()).slice(-6));
  for(const bot of bots){await rcon('minecraft:effect give '+bot.username+' minecraft:resistance 1800 4 true');await rcon('minecraft:effect give '+bot.username+' minecraft:fire_resistance 1800 0 true');}
  await flat('overworld',1398,101,998,1442,1065);await flat('nether',1398,101,998,1442,1034);await flat('the_end',1398,101,998,1442,1034);
  await rcon('execute in minecraft:overworld run minecraft:fillbiome 1398 100 998 1442 104 1065 minecraft:plains');
  await rcon('execute in minecraft:the_nether run minecraft:fillbiome 1398 100 998 1415 104 1034 minecraft:crimson_forest');
  await rcon('execute in minecraft:the_nether run minecraft:fillbiome 1416 100 998 1442 104 1034 minecraft:warped_forest');
  await tp(a,'overworld',1401.5,101,1001.5);await accept(a,'qa_dim');
  check('wrong dimension refused',!(await verify(a)).ready);
  await tp(a,'the_nether',1401.5,101,1001.5);let p=await verify(a);
  check('arrival is not exploration',!p.ready&&p.evidence.distinctZones===0);
  await sleep(5200);p=await verify(a);check('standing earns no time or distance',p.evidence.movingSeconds===0&&p.evidence.distance===0);
  for(const x of [1410.5,1420.5,1401.5])await tp(a,'the_nether',x,101,1001.5);
  p=await verify(a);check('teleport hopping earns no exploration',p.evidence.distinctZones===0&&p.evidence.distance===0);
  await rcon('minecraft:gamemode spectator '+a.username);await tp(a,'the_nether',1412.5,101,1010.5);await sleep(1800);
  await rcon('minecraft:gamemode survival '+a.username);await sleep(700);
  p=await verify(a);check('spectator movement excluded',p.evidence.distance===0);
  await tp(a,'the_nether',1401.5,101,1001.5);
  await route(a,[[1412.5,1001.5],[1412.5,1012.5]]);p=await verify(a);
  check('one biome cannot finish two-biome survey',!p.ready&&p.evidence.biomes.length===1);
  const changed=structuredClone(cfg);changed.tasks.qa_dim.steps[0].target=100;changed.tasks.qa_dim.steps[0]['min-distance']=800;
  check('in-flight definition hot reload',/已热加载/.test(await write(changed)));
  await route(a,[[1424.5,1012.5],[1424.5,1023.5]]);p=await verify(a);
  check('real new route and two biomes accepted',p.ready&&p.evidence.biomes.length===2,JSON.stringify(p));
  check('accepted exploration terms remain frozen',p.target===4&&p.evidence.requirements.minDistance===16);
  check('survey evidence includes world and coordinates',p.evidence.lastSurveyPosition.world==='world_nether'&&Number.isFinite(p.evidence.lastSurveyPosition.x));
  check('survey private to actor',!report.packets[b.username].some(p=>p.type==='MC_MARKET_SURVEY'));
  check('first stage advances without payout',/阶段已交付/.test(await ask(a,'/mycli guild claim')));
  check('return cannot be claimed in nether',!(await verify(a)).ready);
  await tp(a,'overworld',1401.5,101,1001.5);check('return final payout',/委托交付成功/.test(await ask(a,'/mycli guild claim')));
  check('personal once blocks reaccept',/每人仅结算一次/.test(await ask(a,'/mycli guild accept tm_qa_dim')));
  await write(cfg);await accept(b,'qa_dim');check('another player has own adventure ledger',/隔离探索履历/.test(await ask(b,'/mycli guild status')));await abandon(b);
  for(const bad of [c=>c.tasks.qa_pyramid.steps[0].structure='minecraft:fake_mansion',c=>c.tasks.qa_end.steps[0].target=1,c=>c.tasks.qa_end.repeat='forever',c=>c.tasks.qa_end.steps=[step('return','overworld',{target:1})]]){
   const invalid=structuredClone(cfg);bad(invalid);check('invalid exploration definition retained previous board',/校验失败/.test(await write(invalid)));
  }await write(cfg);
  await accept(a,'qa_end');check('End task refuses overworld',!(await verify(a)).ready);
  await tp(a,'the_end',1401.5,101,1001.5);check('End spawn alone refused',!(await verify(a)).ready);
  await route(a,[[1414.5,1001.5],[1414.5,1014.5]]);check('actual End route accepted',(await verify(a)).ready);await abandon(a);
  await tp(a,'overworld',1401.5,101,1001.5);await accept(a,'qa_biome');
  await route(a,[[1414.5,1001.5],[1414.5,1014.5]]);p=await verify(a);check('actual biome survey accepted',p.ready&&p.evidence.biomes.includes('minecraft:plains'));await abandon(a);
  await accept(a,'qa_loop');await tp(a,'overworld',1401.5,101,1001.5);a.setControlState('sneak',true);
  await walk(a,1412.5,1001.5);const once=(await verify(a)).evidence;
  await walk(a,1401.5,1001.5);const twice=(await verify(a)).evidence;a.setControlState('sneak',false);
  check('old route does not add spatial coverage',twice.distinctZones===once.distinctZones);
  check('repeated observed route cannot farm distance',twice.distance-once.distance<=2,JSON.stringify({once,twice}));await abandon(a);
  await accept(a,'qa_pyramid');await tp(a,'overworld',1401.5,101,1001.5);
  await route(a,[[1414.5,1001.5],[1414.5,1014.5]]);p=await verify(a);
  check('player built platform is not a natural structure',!p.ready&&p.evidence.distinctZones===0);
  const boxes=await locate('overworld','desert_pyramid',a),box=boxes[0];const [x,y,z,xx,yy,zz]=box;
  report.pyramidBox=box;const floor=y+2;
  await flat('overworld',x+1,floor,z+1,xx-1,zz-1);
  await rcon(`minecraft:setblock ${x+2} ${yy+19} ${z+2} minecraft:stone`);
  await tp(a,'overworld',x+2.5,yy+20,z+2.5);
  check('same XZ above structure is refused',!(await verify(a)).ready);
  await tp(a,'overworld',x+2.5,floor,z+2.5);await route(a,[[xx-2.5,z+2.5],[xx-2.5,zz-2.5],[x+2.5,zz-2.5]]);p=await verify(a);
  check('natural structure interior route accepted',p.ready&&p.evidence.structure==='minecraft:desert_pyramid'&&p.evidence.distinctSections===1,JSON.stringify(p));await abandon(a);
  await accept(a,'qa_height');await route(a,[[x+2.5,z+2.5],[xx-2.5,z+2.5],[xx-2.5,zz-2.5]]);p=await verify(a);
  check('one floor cannot satisfy height exploration',!p.ready&&p.evidence.heightSpan===0,JSON.stringify(p));
  await flat('overworld',x+1,floor+5,z+1,xx-1,zz-1);await tp(a,'overworld',x+2.5,floor+5,z+2.5);
  check('height teleport alone earns no height',!(await verify(a)).ready);
  await walk(a,xx-2.5,z+2.5);p=await verify(a);check('exploration on another height completes evidence',p.ready&&p.evidence.heightSpan>=4,JSON.stringify(p));await abandon(a);
  const fortress=await locate('the_nether','fortress',a);let pair;
  for(let i=0;i<fortress.length&&!pair;i++)for(let j=i+1;j<fortress.length;j++){
   const q=fortress[i],r=fortress[j],fy=Math.max(q[1],r[1])+1;
   if(fy+2<=Math.min(q[4],r[4])&&Math.max(q[3],r[3])-Math.min(q[0],r[0])<40&&Math.max(q[5],r[5])-Math.min(q[2],r[2])<40&&q[3]-q[0]>=4&&q[5]-q[2]>=4&&r[3]-r[0]>=4&&r[5]-r[2]>=4){pair=[q,r,fy];break;}
  }assert.ok(pair,'two neighboring fortress pieces');report.fortressPair=pair;const [q,r,fy]=pair;
  await flat('the_nether',Math.min(q[0],r[0]),fy,Math.min(q[2],r[2]),Math.max(q[3],r[3]),Math.max(q[5],r[5]));
  await accept(a,'qa_parts');await tp(a,'the_nether',q[0]+1.5,fy,q[2]+1.5);
  for(const t of [q,r]){await route(a,[[t[3]-.5,t[2]+1.5],[t[3]-.5,t[5]-.5],[t[0]+1.5,t[5]-.5],[t[0]+1.5,t[2]+1.5]]);}
  p=await verify(a);check('distinct real generated sections recorded',p.ready&&p.evidence.distinctSections>=2,JSON.stringify(p));await abandon(a);
  await tp(a,'overworld',1401.5,101,1040.5);await accept(a,'qa_survey_resume');await walk(a,1412.5,1040.5);p=await verify(a);
  check('partial survey remains incomplete',!p.ready&&p.evidence.distinctZones>0);
  report.restart={player:a.username,evidence:p.evidence};
  await rcon('minecraft:save-all flush');
 }
 report.passed=true;
}catch(e){report.error=String(e.stack??e);process.exitCode=1;}
finally{
 for(const b of bots)b.quit();await sleep(250);report.finished=new Date().toISOString();
 for(const root of roots){
  const path=root+(resume?'/exploration-restart-result.json':'/exploration-result.json');
  if(existsSync(path))copyFileSync(path,path+'.attempt-'+Date.now());
  writeFileSync(path,JSON.stringify(report,null,2)+'\n');
 }
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,lastMessages:Object.fromEntries(Object.entries(report.messages).map(([k,v])=>[k,v.slice(-5)]))}));
}
