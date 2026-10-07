import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';

// Deliberately fixed isolated ports: this fixture must never run on the live world.
const stage = 'E:/MC/staging/life-buildings-20261003';
const roots = ['E:/MC/ops/repairs/exploration-contracts-20261007', 'F:/MC-backups/repairs/exploration-contracts-20261007'];
const require = createRequire('E:/MC/probe/package.json'); fix1206PotionProtocol(require);
const mineflayer = require('mineflayer'), {Vec3} = require('vec3');
const rcon = q => command(q, 15000, {port: 25587, properties: stage + '/server.properties'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, label, timeout = 12000) => {
  const start = Date.now(); while (Date.now() - start < timeout) { if (await f()) return; await sleep(120); }
  throw new Error('Timeout: ' + label);
};
const report = {candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.88.jar')).digest('hex').toUpperCase(),started: new Date().toISOString(), passed: false, checks: [], messages: {}, packets: {}};
const bots = [];
const make = async name => {
  const bot = mineflayer.createBot({host: '127.0.0.1', port: 25567, username: name, version: '1.20.6', auth: 'offline'});
  bots.push(bot); report.messages[name] = []; report.packets[name] = [];
  bot.on('messagestr', text => report.messages[name].push(text));
  bot.on('error', error => { report.errors ??= []; report.errors.push(String(error)); });
  bot._client.on('custom_payload', p => {
    if (p.channel === 'mcagent:market') report.packets[name].push(JSON.parse(p.data.toString('utf8')));
  });
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject); });
  return bot;
};
const ask = async (bot, q, wait = 1250) => {
  report.messages[bot.username].length = 0; bot.chat(q); await sleep(wait);
  return report.messages[bot.username].join('\n');
};
const check = (name, condition, detail) => { assert.ok(condition, name + ': ' + (detail ?? '')); report.checks.push(name); };
const verify = async (bot, ready, reason) => {
  const n = report.packets[bot.username].length; const text = await ask(bot, '/mycli guild verify');
  const p = report.packets[bot.username].slice(n).find(x => x.type === 'MC_MARKET_CHECK');
  check('verify ' + (reason ?? 'ready'), !!p && p.ready === ready && (!reason || p.reason === reason), JSON.stringify(p) + text);
  return p;
};
const itemCount = (bot, name) => bot.inventory.items().filter(x => x.name === name).reduce((n, x) => n + x.count, 0);
const reward = {fame: 18, emeralds: 7, bonus: 'BREAD', 'bonus-count': 2};
const task = (title, steps, scope = 'project') => ({title, description: '隔离服真实动作与增量验收', icon: 'BRICKS', scope, reward, steps});
const step = (goal, site, target) => ({title: '验证 ' + goal, description: '按场地要求真实完成', goal, site, target});
const site = (min, max, materials, extra = {}) => ({world: 'world', min, max, materials, 'deck-y': min[1], ...extra});
const base = {
  'schema-version': 1,
  sites: {
    qa_build: site([1000,100,1000],[1005,103,1003],['STONE_BRICKS','OAK_PLANKS']),
    qa_bridge: site([1010,100,1000],[1016,100,1002],['OAK_PLANKS'],{start:[1010,100,1001],end:[1016,100,1001]}),
    qa_road: site([1020,100,1000],[1024,100,1002],['STONE_BRICKS']),
    qa_machine: site([1030,100,1000],[1036,103,1004],['REDSTONE_LAMP','PISTON','STONE_BRICKS'],{
      components:{REDSTONE_LAMP:1,PISTON:1,LEVER:1,REDSTONE_WIRE:5}, outputs:[{at:[1036,101,1002],material:'REDSTONE_LAMP'}]}),
    qa_combo: site([1040,100,1000],[1046,103,1004],['STONE_BRICKS','OAK_PLANKS'],{
      components:{REDSTONE_LAMP:1,PISTON:1,LEVER:1,REDSTONE_WIRE:5}, outputs:[{at:[1046,101,1002],material:'REDSTONE_LAMP'}]}),
    qa_resume: site([1050,100,1000],[1055,103,1003],['STONE_BRICKS']),
    qa_combo_initial: site([1060,100,1000],[1063,101,1003],['STONE_BRICKS']),
    qa_protected: site([-489,66,-502],[-489,66,-502],['STONE_BRICKS']),
    qa_unloaded: site([5000,100,5000],[5003,100,5003],['STONE_BRICKS']),
  },
  tasks: {
    qa_build: task('建造验收',[step('build','qa_build',6)]),
    qa_bridge: task('架桥验收',[step('bridge','qa_bridge',12)]),
    qa_road: task('铺路验收',[step('road','qa_road',80)]),
    qa_machine: task('机关验收',[step('redstone','qa_machine',1)]),
    qa_combo: task('多阶段工程',[step('build','qa_combo_initial',4),step('redstone','qa_combo',1)]),
    qa_resume: task('重启在途工程',[step('build','qa_resume',2)]),
    qa_life: task('多阶段生活',[
      {title:'制作木板',description:'亲手合成一次橡木板',goal:'craft',item:'OAK_PLANKS',target:1},
      {title:'分享面包',description:'实际向公共箱交付两个面包',goal:'donate',item:'BREAD',chest:'supplies',target:2},
    ],'personal'),
  },
};
const yamlPath = stage + '/plugins/AgentFriend/task-market.yml';
const write = config => writeFileSync(yamlPath, JSON.stringify(config, null, 2) + '\n');
const accept = async (bot, id) => check('accept ' + id, /已接公会委托/.test(await ask(bot, '/mycli guild accept tm_' + id)));
const abandon = async bot => ask(bot, '/mycli guild abandon');
const tp = async (bot, x, y, z) => { await rcon(`minecraft:tp ${bot.username} ${x} ${y} ${z}`); await sleep(700); };
const machine = async x => {
  await rcon(`minecraft:fill ${x} 100 1000 ${x+6} 100 1004 minecraft:stone`);
  await rcon(`minecraft:setblock ${x} 101 1002 minecraft:lever[face=floor,facing=east,powered=false]`);
  await rcon(`minecraft:fill ${x+1} 101 1002 ${x+5} 101 1002 minecraft:redstone_wire`);
  await rcon(`minecraft:setblock ${x+6} 101 1002 minecraft:redstone_lamp`);
  await rcon(`minecraft:setblock ${x+5} 101 1004 minecraft:piston[facing=east]`);
};
const toggle = async (bot, x) => {
  await tp(bot,x+.5,101,1003.5);
  const lever=bot.blockAt(new Vec3(x,101,1002)); check('physical lever present', lever?.name === 'lever');
  bot.setQuickBarSlot(8); await bot.activateBlock(lever, new Vec3(0,1,0)); await sleep(350);
};
try {
  for (const root of roots) mkdirSync(root,{recursive:true});
  check('isolated runtime', /0\.3\.88/.test(await rcon('version AgentFriend')));
  const a=await make('MarketA88'), b=await make('MarketB88');
  check('admin guarded', /只允许控制台/.test(await ask(a,'/mycli admin market reload')));
  const defaults=await rcon('mycli admin market list');
  check('default 28 scenarios loaded', (defaults.match(/^tm_/gm)||[]).length===28&&defaults.includes('tm_woodland_mansion_survey'));
  await rcon('minecraft:forceload add 992 992 1063 1007');
  await rcon('minecraft:fill 997 99 998 1065 99 1006 minecraft:stone');
  await rcon('minecraft:fill 997 100 998 1065 105 1006 minecraft:air');
  await rcon('minecraft:fill 1000 100 1000 1003 100 1000 minecraft:stone_bricks');
  await tp(a,1002.5,100,1003.5); await tp(b,1002.5,100,1005.5);
  for (const bot of bots) await rcon('minecraft:effect give '+bot.username+' minecraft:resistance 600 4 true');
  write(base); check('JSON-compatible YAML reload', /已热加载/.test(await rcon('mycli admin market reload')));
  for (const id of ['qa_build','qa_bridge','qa_road','qa_machine','qa_combo','qa_resume','qa_combo_initial']) {
    await rcon('mycli admin market register '+id);
    await until(async()=> (await rcon('mycli admin market list')).includes('site='+id+' registered=true'),'registered '+id);
  }
  check('baseline cannot be reset', /site_id_already_used/.test(await rcon('mycli admin market register qa_build')));
  await rcon('mycli admin market register qa_protected'); await sleep(500);
  check('private hall site rejected', (await rcon('mycli admin market list')).includes('site=qa_protected registered=false'));
  check('unloaded site refused', /area_unloaded/.test(await rcon('mycli admin market register qa_unloaded')));
  await accept(a,'qa_build');
  check('global site reservation', /project_reserved/.test(await ask(b,'/mycli guild accept tm_qa_build')));
  check('single active task', /先完成/.test(await ask(a,'/mycli guild accept tm_qa_road')));
  const baseline = await verify(a,false,'insufficient_new_blocks'); check('old blocks excluded',baseline.evidence.newBlocks===0);
  await rcon('minecraft:summon minecraft:item 1002 101 1001 {Item:{id:"minecraft:stone_bricks",count:64}}');
  await rcon('minecraft:fill 1000 100 1001 1005 100 1001 minecraft:dirt');
  check('dropped items and dirt excluded',(await verify(a,false,'insufficient_new_blocks')).evidence.newBlocks===0);
  await rcon('minecraft:fill 1000 100 1001 1005 100 1001 minecraft:air');
  await rcon('minecraft:clone 1000 100 1000 1003 100 1000 1000 100 1001 replace move');
  check('moving old material is not new work',(await verify(a,false,'insufficient_new_blocks')).evidence.newBlocks===0);
  await rcon('minecraft:clone 1000 100 1001 1003 100 1001 1000 100 1000 replace move');
  await rcon('minecraft:give '+a.username+' minecraft:stone_bricks 16'); await sleep(300);
  await a.equip(a.inventory.items().find(x=>x.name==='stone_bricks'),'hand');
  for(let x=1000;x<=1005;x++) await a.placeBlock(a.blockAt(new Vec3(x,99,1001)),new Vec3(0,1,0));
  await sleep(300);
  check('ordinary survival block placement',(await verify(a,true)).evidence.newBlocks>=6);
  const changed=structuredClone(base); changed.tasks.qa_build.steps[0].target=60; changed.tasks.qa_build.reward.fame=99;
  write(changed); check('hot reload with active task',/已热加载/.test(await rcon('mycli admin market reload')));
  check('accepted definition frozen',/\[6\/6\]/.test(await ask(a,'/mycli guild status')));
  check('build reward final',/委托交付成功.*声望 \+18/.test(await ask(a,'/mycli guild claim')));
  check('global completion prevents duplicate',/project_completed/.test(await ask(b,'/mycli guild accept tm_qa_build')));
  write(base); await rcon('mycli admin market reload');
  const invalid=structuredClone(base); invalid.sites.qa_build.min=[999,100,1000]; write(invalid);
  check('registered site immutable',/校验失败/.test(await rcon('mycli admin market reload')));
  write(base); await rcon('mycli admin market reload');
  await tp(a,1011.5,100,1004.5); await accept(a,'qa_bridge');
  await rcon('minecraft:fill 1010 100 1000 1016 100 1002 minecraft:oak_planks');
  await rcon('minecraft:fill 1013 100 1000 1013 100 1002 minecraft:air');
  await verify(a,false,'bridge_not_connected');
  await rcon('minecraft:fill 1013 100 1000 1013 100 1002 minecraft:oak_planks');
  await rcon('minecraft:fill 1013 101 1000 1013 102 1002 minecraft:stone');
  await verify(a,false,'bridge_not_connected');
  await rcon('minecraft:fill 1013 101 1000 1013 102 1002 minecraft:air'); await verify(a,true);
  check('bridge reward',/委托交付成功/.test(await ask(a,'/mycli guild claim')));
  await tp(a,1021.5,100,1004.5); await accept(a,'qa_road');
  await rcon('minecraft:fill 1020 100 1000 1022 100 1002 minecraft:stone_bricks');
  await verify(a,false,'insufficient_road_coverage');
  await rcon('minecraft:fill 1023 100 1000 1023 100 1002 minecraft:stone_bricks');
  check('road 12/15 coverage',(await verify(a,true)).evidence.coveragePercent===80);
  check('road reward',/委托交付成功/.test(await ask(a,'/mycli guild claim')));
  await tp(a,1031.5,100,1005.5); await accept(a,'qa_machine');
  const requirements=await ask(a,'/mycli guild engineering tm_qa_machine');
  check('chat-only agent receives mechanical requirements',requirements.includes('PISTON ×1')
    &&requirements.includes('REDSTONE_LAMP @ 1036,101,1002')&&requirements.includes('goal=redstone target=1'));
  await machine(1030);
  await rcon('minecraft:setblock 1035 101 1002 minecraft:air'); await verify(a,false,'missing_components');
  check('chat-only agent receives missing component evidence',report.messages[a.username].some(s=>s.includes('还缺新增构件：REDSTONE_WIRE ×1')));
  await rcon('minecraft:setblock 1035 101 1002 minecraft:redstone_wire'); await verify(a,false,'signal_not_observed');
  await toggle(b,1030); await verify(a,false,'signal_not_observed');
  await toggle(a,1030); await toggle(a,1030); await verify(a,true);
  await rcon('minecraft:give '+a.username+' minecraft:oak_planks 1');await sleep(200);
  await a.equip(a.inventory.items().find(x=>x.name==='oak_planks'),'hand');
  await a.placeBlock(a.blockAt(new Vec3(1032,100,1000)),new Vec3(0,1,0));
  await verify(a,false,'signal_not_observed');await toggle(a,1030);await toggle(a,1030);await verify(a,true);
  check('machine reward',/委托交付成功/.test(await ask(a,'/mycli guild claim')));
  await tp(a,1061.5,100,1005.5); await accept(a,'qa_combo');
  await rcon('minecraft:fill 1060 100 1000 1063 100 1000 minecraft:stone_bricks');
  check('intermediate stage no final payout',/阶段已交付/.test(await ask(a,'/mycli guild claim')));
  await machine(1040);
  await toggle(a,1040); await verify(a,true);
  await rcon('minecraft:fill 1060 100 1000 1063 100 1000 minecraft:stone');
  await verify(a,false,'insufficient_new_blocks');
  await rcon('minecraft:fill 1060 100 1000 1063 100 1000 minecraft:stone_bricks');
  check('composite final reward',/委托交付成功/.test(await ask(a,'/mycli guild claim')));
  await tp(a,1002.5,100,1003.5); await accept(a,'qa_life');
  await rcon('minecraft:give '+a.username+' minecraft:oak_log 1'); await sleep(300);
  const recipe=a.recipesFor(a.registry.itemsByName.oak_planks.id,null,1,null)[0];
  assert.ok(recipe); await a.craft(recipe,1,null); await sleep(200);
  check('real craft stage',/阶段已交付/.test(await ask(a,'/mycli guild claim')));
  await rcon('minecraft:give '+a.username+' minecraft:bread 2'); await sleep(300);
  await rcon('minecraft:forceload add -473 -491');
  const full=Array.from({length:27},(_,Slot)=>({Slot:Slot+'b',id:'minecraft:stone',count:64}));
  const nbt='{Items:['+full.map(x=>'{Slot:'+x.Slot+',id:"'+x.id+'",count:64}').join(',')+']}';
  for(const x of [-473,-472])await rcon('minecraft:data merge block '+x+' 67 -491 '+nbt);
  const breadBefore=itemCount(a,'bread');
  check('full public box refuses delivery',/已满/.test(await ask(a,'/mycli guild claim')));
  check('failed transfer keeps inventory',itemCount(a,'bread')===breadBefore);
  for(const x of [-473,-472])await rcon('minecraft:data merge block '+x+' 67 -491 {Items:[]}');
  check('multi-step life final reward',/委托交付成功/.test(await ask(a,'/mycli guild claim')));
  check('real bread removed',itemCount(a,'bread')===breadBefore-2);
  const n=report.packets[a.username].length;await ask(a,'/mycli guild assessment');
  const assessment=report.packets[a.username].slice(n).find(p=>p.type==='MC_MARKET_ASSESSMENT');
  check('ability evidence recorded',assessment?.goals.build.verifiedSteps===2&&assessment.goals.redstone.verifiedSteps===2
    &&assessment.goals.craft.verifiedSteps===1&&assessment.goals.donate.verifiedSteps===1&&assessment.elapsedIncludesOffline===true);
  check('private assessment not broadcast',!report.packets[b.username].some(p=>p.type==='MC_MARKET_ASSESSMENT'));
  const opening=new Promise(r=>a.once('windowOpen',r));a.chat('/mycli guild menu');const window=await opening;
  check('old static and bottom controls intact',window.slots[10]?.name==='bone'&&window.slots[49]?.name==='emerald');
  const marketOpening=new Promise(r=>a.once('windowOpen',r));await a.clickWindow(8,0,0);const menu=await marketOpening;
  check('native market menu',JSON.stringify(menu.title).includes('任务市场')&&menu.slots[38]?.name==='emerald');a.closeWindow(menu);
  await tp(a,1051.5,100,1004.5);await accept(a,'qa_resume');
  await rcon('minecraft:fill 1050 100 1000 1051 100 1000 minecraft:stone_bricks');await verify(a,true);
  const before=await ask(a,'/mycli guild status');report.restartExpected={player:a.username,status:before};
  await rcon('minecraft:save-all flush');
  report.passed=true;report.errors??=[];assert.deepEqual(report.errors,[]);
} catch(error) { report.error=String(error.stack??error);process.exitCode=1; }
finally {
  for(const bot of bots)bot.quit();await sleep(250);report.finished=new Date().toISOString();
  for(const root of roots)writeFileSync(root+'/stage-result.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,lastMessages:Object.fromEntries(Object.entries(report.messages).map(([k,v])=>[k,v.slice(-8)]))}));
}
