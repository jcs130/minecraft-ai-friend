import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';
const root=process.env.MC_EXAM_QA_ROOT?.replaceAll('\\','/');
assert(root,'Set MC_EXAM_QA_ROOT to the explicitly prepared private test fixture');
const stage=root+'/lab';
const props=fs.readFileSync(stage+'/server.properties','utf8');
assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25830$/m.test(props)&&/^rcon.port=25831$/m.test(props));
const mode=process.argv[2]??'final';assert(['final','final-v2','checkout','resume'].includes(mode));
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const setup=JSON.parse(fs.readFileSync(root+'/setup.json'));const bots=[],messages=new Map(),packets=new Map();
const out={at:new Date().toISOString(),mode,checks:[],queries:[],errors:[],productionModified:false,jarSha256:crypto.createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.44.jar')).digest('hex')};
const check=(name,pass)=>{out.checks.push({name,pass:!!pass});assert(pass,name);console.log('PASS',name);};
const rcon=q=>command(q,20000,{properties:stage+'/server.properties',port:25831});
const cfg=()=>yaml.load(fs.readFileSync(stage+'/plugins/AgentFriend/config.yml','utf8'));
const academy=()=>JSON.parse(fs.readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8')).players[setup.qaUuid].academy;
async function make(name){
 const b=req('mineflayer').createBot({host:'127.0.0.1',port:25830,username:name,version:'1.21.1',auth:'offline',hideErrors:true,plugins:{physics:false}});installRecipePacketBypass(b._client);
 bots.push(b);messages.set(name,[]);packets.set(name,[]);
 b.on('messagestr',s=>messages.get(name).push(s));b.on('error',e=>out.errors.push(String(e)));b.on('kicked',e=>out.errors.push(JSON.stringify(e)));
 b._client.on('login',()=>b._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:exam\0mcagent:market\0mcagent:tasks')}));
 b._client.on('custom_payload',p=>{if(['mcagent:exam','mcagent:market','mcagent:tasks'].includes(p.channel))try{packets.get(name).push({channel:p.channel,bytes:p.data.length,data:JSON.parse(p.data.toString('utf8'))});}catch(e){out.errors.push(String(e));}});
 await new Promise((res,rej)=>{b.once('spawn',res);b.once('error',rej);b.once('kicked',rej)});await sleep(2200);return b;
}
async function ask(b,q,wait=750){const n=messages.get(b.username).length,k=packets.get(b.username).length;b.chat(q);await sleep(wait);const row={query:q,messages:messages.get(b.username).slice(n),packets:packets.get(b.username).slice(k)};out.queries.push(row);return row;}
const exam=q=>q.packets.filter(p=>p.channel==='mcagent:exam').at(-1)?.data;
async function mapClaim(b){const q=await ask(b,'/mycli guild exam supplies claim map --json',1000);for(let i=0;i<60;i++){const done=packets.get(b.username).filter(p=>p.channel==='mcagent:exam'&&p.data.action==='claim'&&p.data.id==='map'&&p.data.status!=='pending').at(-1);if(done)return done.data;await sleep(500);}throw Error('Map claim did not finish');}
try {
 await rcon('difficulty peaceful');const qa=await make(setup.qaName),human=await make('ExamHuman16');await rcon('gamemode survival '+setup.qaName);
 if(mode==='resume') {
  const before=JSON.parse(fs.readFileSync(root+'/resume-expected-checkout.json','utf8'));
  const state=exam(await ask(qa,'/mycli guild exam status --json'));
  check('cold restart retains the exact exam and current desert contract',state.runId===before.runId&&state.state==='active'&&state.guide.currentContract.id==='tm_desert_pyramid_archive');
  const map=exam(await ask(qa,'/mycli guild exam supplies info map --json'));
  check('map allocation can be reconciled after disconnect with its original map ID',map.status==='already_issued'&&map.map.mapId===before.mapId);
  const again=exam(await ask(qa,'/mycli guild exam supplies claim map --json'));
  check('reconnected repeated claim does not issue a second destination',again.reason==='already_issued'&&again.map.mapId===before.mapId);
  check('restart preserves original fame, completion count and certificates',cfg()['guild-players'][setup.qaUuid].fame===before.fame&&cfg()['guild-players'][setup.qaUuid].completed===before.completed&&Object.keys(academy().certificates).join()===before.certificates.join());
  check('original main-hand native map is still a genuine target-bearing item',qa.inventory.items().some(i=>i.name==='filled_map'&&JSON.stringify(i.components).includes('map_decorations')));
 } else {
  await rcon('minecraft:clear '+setup.qaName);
  let state=exam(await ask(qa,'/mycli guild exam status --json'));const original={fame:cfg()['guild-players'][setup.qaUuid].fame,completed:cfg()['guild-players'][setup.qaUuid].completed,certificates:Object.keys(academy().certificates)};
  check('old active survey retains its original run and has ordered instructions',state.state==='active'&&state.guide.steps.length===6&&state.guide.steps.map(s=>s.id).join()==='prepare,contract,survey,photograph,return,submit');
  check('ordinary survey explicitly says no treasure map is required',state.guide.steps[0].instruction.includes('普通走查不用藏宝图'));
  const oldRun=state.runId;
  const before=JSON.stringify(cfg()['exam-supplies-issued']??{});
  await ask(qa,'/mycli guild exam supplies list --json');await ask(qa,'/mycli guild exam supplies info photo --json');await ask(qa,'/mycli guild exam guide --json');
  check('guide/list/info are private reads and do not issue any item',JSON.stringify(cfg()['exam-supplies-issued']??{})===before);
  const photo=exam(await ask(qa,'/mycli guild exam supplies claim photo --json'));
  check('old exam can receive real photo prerequisites without resetting',photo.ok&&photo.saved&&photo.allocation.items[0].item==='minecraft:map'&&photo.allocation.items[0].count===8);
  check('photo kit contains an exact chest page and normal global slot',photo.allocation.items[0].page===1&&photo.allocation.items[0].slot>=1);
  const repeat=exam(await ask(qa,'/mycli guild exam supplies claim photo --json'));
  check('repeat photo claim reports the same saved allocation',repeat.reason==='already_issued'&&repeat.allocation.issuedAt===photo.allocation.issuedAt);
  await ask(qa,'/mycli guild accept tm_desert_pyramid_archive');state=exam(await ask(qa,'/mycli guild exam status --json'));
  check('existing target-specific contract stays attached to the same exam',state.runId===oldRun&&state.guide.currentContract.id==='tm_desert_pyramid_archive');
  check('guide reads frozen numerical criteria rather than a generic label',state.guide.currentContract.exploration.minHeightSpan===6&&state.guide.currentContract.target===4&&state.guide.currentContract.exploration.minDistance===24);
  const map=await mapClaim(qa);check('supplied map matches the already accepted natural desert temple',map.ok&&map.saved&&map.map.structure==='minecraft:desert_pyramid'&&map.map.x===-1926&&map.map.z===-966);out.mapAllocation=map;
  const same=exam(await ask(qa,'/mycli guild exam supplies claim map --json'));
  check('duplicate map claim is stable and does not select the next ruin',same.reason==='already_issued'&&same.map.mapId===map.map.mapId);
  await ask(qa,'/mycli arena stash page 1',1000);
  check('supplies are in a real ordinary 54-slot personal chest',qa.currentWindow?.slots.length>=54&&JSON.stringify(qa.currentWindow.title).includes('个人试炼箱'));
  const mapItem=qa.currentWindow.slots.slice(0,54).find(i=>i?.name==='filled_map');
  check('clientbound ItemStack contains native map ID, target decoration and custom name',mapItem&&JSON.stringify(mapItem.components).includes('map_id')&&JSON.stringify(mapItem.components).includes('map_decorations')&&JSON.stringify(mapItem.components).includes('公会探险图'));
  check('the same native chest really contains eight usable empty maps',qa.currentWindow.slots.slice(0,54).filter(i=>i?.name==='map').reduce((n,i)=>n+i.count,0)===8);
  out.rawMapComponents=mapItem.components;
  const mapSlot=qa.currentWindow.slots.indexOf(mapItem),destination=qa.currentWindow.slots.findIndex((item,index)=>index>=54&&!item);
  assert(destination>=54);await qa.clickWindow(mapSlot,0,0);await qa.clickWindow(destination,0,0);qa.closeWindow(qa.currentWindow);await sleep(500);
  const held=qa.inventory.items().find(i=>i.name==='filled_map');await qa.equip(held,'hand');await sleep(400);
  const target=(await ask(qa,'/mycli guild map')).packets.find(p=>p.data.map&&p.channel==='mcagent:market')?.data;
  check('the original map reader accepts the supplied item as genuine',target?.success&&target.map.source==='item_map_decoration'&&target.map.x===-1926&&target.map.z===-966);
  check('map allocation did not abandon or advance the current contract',cfg()['guild-players'][setup.qaUuid].active.id==='tm_desert_pyramid_archive'&&cfg()['guild-players'][setup.qaUuid].active.market.step===0&&academy().active.runId===oldRun);
  for(const leaf of ['status','list','info photo','claim photo'])check('new CLI help advertises JSON: '+leaf,(await ask(qa,'/mycli guild exam supplies '+leaf+' --help --json')).messages.some(s=>s.includes('"jsonSupported":true')));
  const invalid=exam(await ask(qa,'/mycli guild exam supplies claim map extra --json'));check('invalid arguments fail before material allocation',invalid.reason==='invalid_arguments');
  await ask(human,'/mycli guild join');await ask(human,'/mycli guild exam start survey_basic');await ask(human,'/mycli guild exam guide');
  check('controller-friendly guide is a native 45-slot menu with materials/camera/task actions',human.currentWindow&&JSON.stringify(human.currentWindow.title).includes('考试指引')&&[20,21,22,23,24,30,31,32].every(s=>!!human.currentWindow.slots[s]));
  check('native guide lore contains complete ordered instructions',JSON.stringify(human.currentWindow.slots.slice(0,6)).includes('亲自走过不同地点')&&JSON.stringify(human.currentWindow.slots.slice(0,6)).includes('16格内'));
  await human.clickWindow(20,0,0);await sleep(700);check('controller click uses the same deduplicated supply operation',messages.get(human.username).some(s=>s.includes('already_issued')));
  check('new exam automatically received its photo kit once',!!cfg()['exam-supplies-issued']?.[human.player.uuid]?.photo_survey_basic);
  const humanMap=await mapClaim(human);check('another player receives their own native explorer map allocation',humanMap.ok&&humanMap.subjectUuid===human.player.uuid);
  const take=exam(await ask(human,'/mycli guild exam supplies take all --json'));
  check('new player can directly take exam materials without learning remote chest magic',take.ok&&take.reason==='taken_into_inventory'&&take.free&&human.inventory.items().some(i=>i.name==='filled_map')&&human.inventory.items().filter(i=>i.name==='map').reduce((n,i)=>n+i.count,0)===8);
  const takenAgain=exam(await ask(human,'/mycli guild exam supplies take all --json'));check('repeating checkout is a successful no-op rather than duplication',takenAgain.ok&&takenAgain.reason==='already_taken'&&human.inventory.items().filter(i=>i.name==='map').reduce((n,i)=>n+i.count,0)===8);
  await human.equip(human.inventory.items().find(item=>item.name==='filled_map'),'hand');await ask(human,'/mycli guild accept tm_map_hunt');
  const humanActive=cfg()['guild-players'][human.player.uuid].active;
  check('the exam-provided explorer map really starts the existing original-map quest',humanActive?.id==='tm_map_hunt'&&JSON.parse(humanActive.market['map-hunt']).map.x===-1926);
  const full=await make('ExamFull16');await rcon('examsupplyqa fill ExamFull16');await ask(full,'/mycli guild join');await ask(full,'/mycli guild exam start survey_basic');
  const fullState=cfg();check('full personal chest places supplies safely in existing pending queue',fullState['dungeon-bonus-items']?.[full.player.uuid]?.length===1&&!!fullState['exam-supplies-issued']?.[full.player.uuid]?.photo_survey_basic);
  await rcon('examsupplyqa fillinventory ExamFull16');const blocked=exam(await ask(full,'/mycli guild exam supplies take photo --json'));
  check('full main inventory refuses checkout and retains the exact queued kit',blocked.reason==='inventory_full'&&cfg()['dungeon-bonus-items'][full.player.uuid].length===1);
  await rcon('examsupplyqa clearinventoryslot ExamFull16 0');const queuedTaken=exam(await ask(full,'/mycli guild exam supplies take photo --json'));
  check('pending kit can be taken directly after one inventory slot becomes free',queuedTaken.ok&&full.inventory.items().filter(i=>i.name==='map').reduce((n,i)=>n+i.count,0)===8&&cfg()['dungeon-bonus-items'][full.player.uuid].length===0);
  const fail=await make('ExamFail16');await ask(fail,'/mycli guild join');const temp=stage+'/plugins/AgentFriend/config.yml.exam-supplies.tmp';assert(!fs.existsSync(temp));fs.mkdirSync(temp);
  try {const response=await ask(fail,'/mycli guild exam start survey_basic');check('real filesystem write failure is reported without claiming allocation succeeded',response.packets.some(p=>p.data.reason==='supply_save_failed'&&p.data.ok===false));check('failed supply write did not retain an issue receipt',!(cfg()['exam-supplies-issued']?.[fail.player.uuid]?.photo_survey_basic));}
  finally{fs.rmdirSync(temp);}
  const recovered=exam(await ask(fail,'/mycli guild exam supplies claim photo --json'));check('after storage recovers the same exam can safely claim once',recovered.ok&&recovered.saved&&recovered.allocation.items[0].count===8);
  fs.mkdirSync(temp);try{const failedTake=exam(await ask(fail,'/mycli guild exam supplies take photo --json'));check('checkout write failure rolls back both source and destination inventories',failedTake.reason==='supply_save_failed'&&fail.inventory.items().every(i=>i.name!=='map'));}finally{fs.rmdirSync(temp);}
  const checkout=exam(await ask(fail,'/mycli guild exam supplies take photo --json'));check('checkout recovers safely without creating duplicate supplies',checkout.ok&&fail.inventory.items().filter(i=>i.name==='map').reduce((n,i)=>n+i.count,0)===8);
  check('supply delivery did not grant fame, task completion or certificates',cfg()['guild-players'][setup.qaUuid].fame===original.fame&&cfg()['guild-players'][setup.qaUuid].completed===original.completed&&Object.keys(academy().certificates).join()===original.certificates.join());
  check('ordinary player receives none of QA account private exam data',!packets.get(human.username).some(p=>p.data.subjectUuid===setup.qaUuid));
  fs.writeFileSync(root+'/resume-expected-'+mode+'.json',JSON.stringify({runId:oldRun,mapId:map.map.mapId,...original},null,2),{flag:'wx'});
 }
 check('every native exam response fits 16 KiB',Array.from(packets.values()).flat().filter(p=>p.channel==='mcagent:exam').every(p=>p.bytes<=16384));
 check('no native protocol errors occurred',out.errors.length===0);out.passed=true;
}catch(e){out.failure=e.stack;process.exitCode=1;console.error(e.stack);}
finally{for(const b of bots)b.quit();await sleep(500);out.messages=Object.fromEntries(messages);out.packets=Object.fromEntries(packets);fs.writeFileSync(root+'/wire-'+mode+'.json',JSON.stringify(out,null,2),{flag:'wx'});console.log(JSON.stringify({passed:out.passed,checks:out.checks.length,error:out.failure,jarSha256:out.jarSha256}));}
