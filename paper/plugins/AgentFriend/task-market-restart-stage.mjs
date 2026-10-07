import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer');
const stage='E:/MC/staging/life-buildings-20261003';
const roots=['E:/MC/ops/repairs/task-market-20261007','F:/MC-backups/repairs/task-market-20261007'];
const rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={passed:false,checks:[],time:new Date().toISOString(),messages:{},packets:{}};
const bots=[];
const check=(name,ok,details)=>{assert.ok(ok,name+': '+(details??''));report.checks.push(name);};
const make=async name=>{
 const bot=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,version:'1.20.6',auth:'offline'});
 bots.push(bot);report.messages[name]=[];report.packets[name]=[];
 bot.on('messagestr',s=>report.messages[name].push(s));
 bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:market')report.packets[name].push(JSON.parse(p.data.toString()));});
 await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);});return bot;
};
const ask=async(bot,q,delay=1250)=>{report.messages[bot.username].length=0;bot.chat(q);await sleep(delay);return report.messages[bot.username].join('\n');};
const until=async(f,label)=>{for(let i=0;i<80;i++){if(await f())return;await sleep(120);}throw new Error('timeout '+label);};
try{
 const a=await make('MarketA87'),b=await make('MarketB87');
 check('restart preserved active step',/重启在途工程.*\[2\/2\]/.test(await ask(a,'/mycli guild status')));
 const cfgPath=stage+'/plugins/AgentFriend/task-market.yml',cfg=JSON.parse(readFileSync(cfgPath,'utf8'));
 cfg.tasks.qa_resume.steps[0].target=40;cfg.tasks.qa_resume.reward.fame=99;
 writeFileSync(cfgPath,JSON.stringify(cfg,null,2));check('post-restart reload',/已热加载/.test(await rcon('mycli admin market reload')));
 check('restart retained frozen terms',/\[2\/2\]/.test(await ask(a,'/mycli guild status')));
 check('restart retained original baseline and payout',/委托交付成功.*声望 \+18/.test(await ask(a,'/mycli guild claim')));
 check('restart retained global completion',/project_completed/.test(await ask(b,'/mycli guild accept tm_qa_build')));
 check('reward cannot be claimed twice',/当前没有可交付/.test(await ask(a,'/mycli guild claim')));
 await ask(a,'/mycli guild assessment');const assessment=report.packets[a.username].findLast(p=>p.type==='MC_MARKET_ASSESSMENT');
 check('restart retained evidence history',assessment?.goals.build.verifiedSteps===3&&assessment.recent.length===7);
 const actor=await make('CortiLan'),eye=await make('CortiEye');await sleep(2200);
 report.eyeStatus=await rcon('cortieye');check('real spectator connection attached',/camera=online/.test(report.eyeStatus)&&/attached=true/.test(report.eyeStatus));
 report.messages[eye.username].length=0;await ask(actor,'/mycli guild engineering');
 check('eye receives owner market short receipt',report.messages[eye.username].some(s=>s.includes('MC_MARKET_BOARD')));
 const opening=new Promise(r=>actor.once('windowOpen',r));actor.chat('/mycli guild engineering menu');const menu=await opening;
 check('registered agent native menu',menu.slots[38]?.name==='emerald');actor.closeWindow(menu);
 await rcon('minecraft:forceload add 1100 1008 1117 1025');
 await rcon('minecraft:fill 1100 99 1008 1117 99 1025 minecraft:stone');
 await rcon('minecraft:fill 1100 100 1008 1117 104 1025 minecraft:air');
 for(let i=0;i<16;i++){
  const id='qa_load_'+String(i).padStart(2,'0'),x=1100+i%4*4,z=1008+Math.floor(i/4)*4;
  cfg.sites[id]={world:'world',min:[x,100,z],max:[x+1,101,z+1],'deck-y':100,materials:['STONE_BRICKS']};
  cfg.tasks[id]={title:'并发工程 '+i,description:'隔离服有界并发验收',scope:'project',icon:'BRICKS',
   reward:{fame:5,emeralds:2,bonus:'BREAD','bonus-count':1},
   steps:[{title:'验收',description:'新增一格石砖',goal:'build',site:id,target:1}]};
 }
 writeFileSync(cfgPath,JSON.stringify(cfg,null,2));check('16-project config',/已热加载/.test(await rcon('mycli admin market reload')));
 for(let i=0;i<16;i++){
  const id='qa_load_'+String(i).padStart(2,'0');await rcon('mycli admin market register '+id);
  await until(async()=>(await rcon('mycli admin market list')).includes('site='+id+' registered=true'),id);
 }
 const clients=await Promise.all(Array.from({length:16},(_,i)=>make('MkLoad'+String(i).padStart(2,'0'))));
 for(let i=0;i<16;i++){
  const x=1100+i%4*4,z=1008+Math.floor(i/4)*4;
  await rcon(`minecraft:tp ${clients[i].username} ${x+2.5} 100 ${z+2.5}`);
  await rcon(`minecraft:setblock ${x} 100 ${z} minecraft:stone_bricks`);
 }
 await Promise.all(clients.map((bot,i)=>ask(bot,'/mycli guild accept tm_qa_load_'+String(i).padStart(2,'0'),500)));
 const start=Date.now();let busy=0;
 await Promise.all(clients.map(async(bot,i)=>{
  for(let attempt=0;attempt<24;attempt++){
   const n=report.packets[bot.username].length;await ask(bot,'/mycli guild verify',1100+i*7);
   const p=report.packets[bot.username].slice(n).find(x=>x.type==='MC_MARKET_CHECK');
   if(p?.ready)return;
   if(p?.reason==='scan_busy')busy++;
   else if(!p||!['scan_busy','site_changed_during_scan'].includes(p.reason))throw new Error(bot.username+': '+JSON.stringify(p));
  }
  throw new Error('concurrent verification exhausted '+bot.username);
 }));
 check('all 16 independent projects verified',clients.every(bot=>report.packets[bot.username].some(p=>p.type==='MC_MARKET_CHECK'&&p.ready)));
 check('global scan budget returns retry instead of parallel scans',busy>0);
 report.load={connections:16,elapsedMs:Date.now()-start,busyResponses:busy,mspt:await rcon('mspt'),tps:await rcon('tps')};
 await Promise.all(clients.map(bot=>ask(bot,'/mycli guild abandon',300)));
 report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{
 for(const bot of bots)bot.quit();await sleep(300);report.finished=new Date().toISOString();
 for(const root of roots)writeFileSync(root+'/restart-load-result.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,load:report.load,error:report.error,last:report.error?Object.fromEntries(Object.entries(report.messages).map(([n,m])=>[n,m.slice(-3)])):undefined}));
}
