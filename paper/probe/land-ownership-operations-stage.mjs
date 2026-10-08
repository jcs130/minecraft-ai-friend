// Stage only: hot configuration, 16 independent protocol clients and restart readback.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';

const stage='E:/MC/staging/life-buildings-20261003';
const roots=['E:/MC/ops/repairs/land-ownership-20261008','F:/MC-backups/repairs/land-ownership-20261008'];
const phase=process.argv[2]||'load';
assert.ok(['load','restart'].includes(phase));
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer');
const rcon=text=>command(text,15000,{port:25587,properties:stage+'/server.properties'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const json=text=>JSON.parse(text.slice(text.indexOf('{')));
const strip=text=>text.replace(/§./g,'');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();
const candidateSha256=sha(stage+'/plugins/AgentFriend-0.3.90.jar');
const ids=JSON.parse(readFileSync(roots[0]+'/test-identities.json','utf8'));
const clients=[];
const report={passed:false,phase,candidateSha256,checks:[],startedAt:new Date().toISOString()};
function check(name,ok,detail){report.checks.push({name,ok:!!ok,detail});assert.ok(ok,name);console.log('PASS '+name);}
async function until(test,label){for(let i=0;i<125;i++){if(test())return;await sleep(80);}throw new Error('Timeout: '+label);}
async function join(name){
  const bot=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'});
  const client={name,bot,packets:[],messages:[]};clients.push(client);
  bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:land')client.packets.push(JSON.parse(p.data.toString()));});
  bot.on('messagestr',s=>client.messages.push(s));
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',r=>reject(new Error(name+': '+JSON.stringify(r))));});
  return client;
}
async function ask(c,id,type='MC_LAND_PERMISSIONS'){
  const start=c.packets.length;c.bot.chat('/mycli land info '+id);
  await until(()=>c.packets.slice(start).some(p=>p.type===type),'land info '+id);
  return c.packets.slice(start).find(p=>p.type===type);
}
const chunks=async()=>strip(await rcon('paper chunkinfo'));
const totals=text=>[...text.matchAll(/Total: (\d+)/g)].map(m=>Number(m[1]));
try{
  let version='';const deadline=Date.now()+60000;
  while(Date.now()<deadline){try{version=await rcon('version AgentFriend');if(version.includes('0.3.90'))break;}catch{}await sleep(1000);}
  assert.match(version,/0\.3\.90/);
  const previous=JSON.parse(readFileSync(roots[0]+'/stage-result.json','utf8'));
  assert.ok(previous.passed&&previous.candidateSha256===candidateSha256);
  if(phase==='load'){
    const config=readFileSync(stage+'/plugins/AgentFriend/lands.yml','utf8');
    assert.ok(!config.includes('nether_camp:'));
    const before=await chunks();
    const additions=`\n  nether_camp:\n    title: 下界营地\n    world: world_nether\n    min: [250000, 80, 250000]\n    max: [250007, 95, 250007]\n    owner-uuid: '${ids.LandOwner90}'\n    members: []\n    visitor-use: false\n  end_camp:\n    title: 末地营地\n    world: world_the_end\n    min: [250000, 80, 250000]\n    max: [250007, 95, 250007]\n    owner-uuid: '${ids.LandOther90}'\n    members: []\n    visitor-use: false\n`;
    writeFileSync(stage+'/plugins/AgentFriend/lands.yml',config+additions);
    check('new territories added online in both dimensions',json(await rcon('mycli admin land reload')).count===5);
    const after=await chunks();
    check('adding distant claims does not load their chunks',totals(after).every((n,i)=>n<=totals(before)[i]),{before,after});
    const expanded=readFileSync(stage+'/plugins/AgentFriend/lands.yml','utf8');
    writeFileSync(stage+'/plugins/AgentFriend/lands.yml',config);
    const omitted=json(await rcon('mycli admin land reload'));
    check('omitted existing claims cannot accidentally unclaim',omitted.status==='denied'&&omitted.retainedPrevious);
    writeFileSync(stage+'/plugins/AgentFriend/lands.yml',expanded.replace('  end_camp:\n','  end_camp:\n    enabled: false\n'));
    const disabled=json(await rcon('mycli admin land reload'));
    check('explicit disable removes only selected claim',disabled.status==='success'&&disabled.count===4);
    writeFileSync(stage+'/plugins/AgentFriend/lands.yml',expanded);
    check('disabled claim may be restored online',json(await rcon('mycli admin land reload')).count===5);
    const owner=await join('LandOwner90'),other=await join('LandOther90');
    const netherOwner=await ask(owner,'nether_camp'),netherGuest=await ask(other,'nether_camp');
    check('Nether ownership follows correct player',netherOwner.break&&netherOwner.container&&!netherGuest.break&&!netherGuest.use&&netherOwner.world==='minecraft:the_nether');
    const endOwner=await ask(other,'end_camp'),endGuest=await ask(owner,'end_camp');
    check('End ownership is independent',endOwner.break&&!endGuest.container&&endOwner.world==='minecraft:the_end');
    owner.bot.quit();other.bot.quit();await sleep(800);
    for(let i=0;i<16;i++){
      const c=await join('LandLoad90_'+String(i).padStart(2,'0'));
      await rcon(`minecraft:tp ${c.name} 1210.5 150 1210.5`);
      await rcon(`minecraft:gamemode survival ${c.name}`);
    }
    await sleep(3500);
    check('16 separate players are actually online',strip(await rcon('minecraft:list')).includes('16 of'));
    const beforeQueries=await chunks(),started=Date.now();
    const load=clients.filter(c=>c.name.startsWith('LandLoad90_'));
    for(let round=0;round<5;round++){
      const results=await Promise.all(load.map(c=>ask(c,round%2?'adventurers_guild':'cottage_a')));
      assert.ok(results.every(p=>!p.break&&!p.container&&(round%2?p.use:!p.use)),'visitor roles remain separate');
      await sleep(450);
    }
    check('80 concurrent land queries preserve all roles',true,{clients:16,queries:80,elapsedMs:Date.now()-started});
    const afterQueries=await chunks();
    check('repeated queries do not activate distant chunks',totals(afterQueries).every((n,i)=>n<=totals(beforeQueries)[i]),{before:beforeQueries,after:afterQueries});
    report.mspt=strip(await rcon('mspt'));
    const audit=json(await rcon('mycli admin land audit'));
    for(const root of roots){writeFileSync(root+'/stage-before-restart-audit.json',JSON.stringify(audit,null,2));writeFileSync(root+'/stage-lands-final.yml',readFileSync(stage+'/plugins/AgentFriend/lands.yml'));}
    await rcon('minecraft:save-all flush');
  }else{
    const load=JSON.parse(readFileSync(roots[0]+'/load-result.json','utf8'));
    assert.ok(load.passed&&load.candidateSha256===candidateSha256);
    const before=JSON.parse(readFileSync(roots[0]+'/stage-before-restart-audit.json','utf8'));
    const after=json(await rcon('mycli admin land audit'));
    check('normal JVM restart restores exact territories and UUIDs',JSON.stringify(before)===JSON.stringify(after),after);
    check('lands file is preserved across restart',readFileSync(stage+'/plugins/AgentFriend/lands.yml','utf8')===readFileSync(roots[0]+'/stage-lands-final.yml','utf8'));
    for(const world of ['world','world_nether','world_the_end']){
      const native=readFileSync(stage+'/plugins/WorldGuard/worlds/'+world+'/regions.yml','utf8');
      check(world+' native WorldGuard regions persist',native.includes(world==='world'?'qd_land_cottage_a':world==='world_nether'?'qd_land_nether_camp':'qd_land_end_camp'));
    }
    const oldOwner=await join('LandOwner90'),newOwner=await join('LandOther90');
    const oldRights=await ask(oldOwner,'cottage_a'),newRights=await ask(newOwner,'cottage_a');
    check('transferred owner rights survive restart',!oldRights.break&&!oldRights.container&&newRights.break&&newRights.container);
    const guildRights=await ask(oldOwner,'adventurers_guild');
    check('guild owner and public policy survive restart',guildRights.break&&guildRights.container&&(await ask(newOwner,'adventurers_guild')).use);
  }
  report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
  for(const c of clients)c.bot.quit();report.finishedAt=new Date().toISOString();
  for(const root of roots){writeFileSync(root+'/'+phase+'-result.'+Date.now()+'.json',JSON.stringify(report,null,2));writeFileSync(root+'/'+phase+'-result.json',JSON.stringify(report,null,2));}
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,mspt:report.mspt}));
  setTimeout(()=>process.exit(report.passed?0:1),300);
}
