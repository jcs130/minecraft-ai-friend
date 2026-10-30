// Bounded, marked local QA only. Route walking uses normal client physics.
// Fixture clearing/recovery validates mechanics and is explicitly not combat balance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';
const stage=process.env.QD_ARCH_QA_STAGE??'E:/MC/staging/communication-contract-20261030',output=process.argv[2];
const port=new Map([['E:/MC/staging/communication-contract-20261030',29395],['E:/MC/staging/aincrad-architecture-youer-20261030',29397]]).get(stage);
assert(port,'marked local QA stage required');
assert(output?.startsWith('E:/MC/ops/repairs/aincrad-architecture-20261030-r1/run-'));
assert.equal((await fs.readFile(stage+'/.communication-qa','utf8')).trim(),`127.0.0.1:${port} 20261030`);
const require=createRequire('E:/MC/integrations/qiandengji-harness-20261022/body/package.json');
const mineflayer=require('mineflayer'),{pathfinder,Movements,goals}=require('mineflayer-pathfinder');
const result={passed:false,checks:[],receipts:[],walked:[],rooms:[],combatBalanceVerified:false,fixtureClearingAndRecovery:true,productionConnected:false};
let bot;
function check(value,name){assert(value,name);result.checks.push(name);console.log('PASS '+name);}
async function until(fn,name,timeout=20000){for(const end=Date.now()+timeout;Date.now()<end;){const value=await fn();if(value)return value;await pause(150);}throw Error('timeout '+name);}
async function rc(text){const reply=await command(text,20000,{properties:stage+'/server.properties',port:port+1});result.receipts.push({command:text,reply});assert(!reply.includes('ARCH_QA_ERROR'),reply);return reply;}
async function fixture(action,extra=''){return rc('qd_arch_fixture '+action+' ag_ArchAlice'+(extra?' '+extra:''));}
async function snapshot(){const text=await fixture('snapshot');return JSON.parse(text.slice(text.indexOf('ARCH_QA_STATE ')+14));}
async function ask(text,prefix){await pause(Math.max(0,1300-(Date.now()-(bot.lastCall??0))));const index=bot.messages.length;bot.lastCall=Date.now();bot.chat(text);const row=await until(()=>bot.messages.slice(index).find(s=>s.startsWith(prefix)),text);const data=JSON.parse(row.slice(prefix.length));result.receipts.push({player:bot.username,command:text,data});return data;}
const status=()=>ask('/mycli dungeon status aincrad_01 --json','MC_SITE_DUNGEON_STATE ');
async function walkLeg(leg){
 const points=leg.path.filter((point,index)=>index===leg.path.length-1||index%8===0);
 console.log('WALK leg '+leg.leg+' '+leg.steps+' blocks; waypoints '+points.length);
 for(const point of points){
  if(bot.entity.position.distanceTo({x:point[0]+.5,y:point[1],z:point[2]+.5})<.9)continue;
  let timer;
  try{
   await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(...point)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('waypoint timeout '+JSON.stringify(point)+' at '+bot.entity.position)),25000);})]);
  }finally{clearTimeout(timer);}
  result.walked.push({leg:leg.leg,target:point,actual:bot.entity.position.toArray()});
 }
 check(Math.abs(bot.entity.position.y-leg.end[1])<1.2&&Math.hypot(bot.entity.position.x-(leg.end[0]+.5),bot.entity.position.z-(leg.end[2]+.5))<1.5,'walked actual route leg '+leg.leg);
}
try{
 check((await rc('qd_arch_fixture unit')).includes('checks=9 passed=true'),'nine real Paper registry and checkpoint tests');
 const text=await rc('qd_arch_fixture map');const map=JSON.parse(text.slice(text.indexOf('ARCH_QA_MAP ')+12));
 check(map.length===6,'six original-map combat areas loaded');
 for(const room of map)check(room.safeSpots>=room.required,'real safe spawn positions '+room.name);
 result.map=map;
 check(map[4].floors.includes('minecraft:smooth_sandstone'),'authored upper grandstand has full smooth sandstone after legacy conversion');
 check(map.filter(room=>Number.isInteger(room.roofY)).length>=4,'four encounters occupy covered original architecture');
 bot=mineflayer.createBot({host:'127.0.0.1',port,username:'ag_ArchAlice',auth:'offline',version:'1.21.1',checkTimeoutInterval:60000,hideErrors:true});
 bot.messages=[];bot.on('messagestr',text=>bot.messages.push(text));bot.on('error',error=>result.receipts.push({clientError:String(error)}));
 await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position),'native client spawn',30000);
 bot.loadPlugin(pathfinder);const movement=new Movements(bot);movement.canDig=false;movement.allow1by1towers=false;movement.allowParkour=false;movement.maxDropDown=1;bot.pathfinder.setMovements(movement);
 await fixture('prepare');await pause(1800);
 bot.chat('/mycli profession choose knight');await pause(2000);
 const info=await ask('/mycli dungeon info aincrad_01 --json','MC_SITE_DUNGEON_INFO ');
 check(info.rooms.length===6&&info.start.join(',')==='844,69,-1210','client receives actual first room and six stages');
 const quest=await ask('/mycli tasks info qd_floor_clear --json','MC_RPG ');
 check(JSON.stringify(quest).includes('六段原图路线'),'native Vortex quest describes six current architecture stages');
 const chapter=await ask('/mycli world story info aincrad_departure --json','MC_PAGE ');
 check(JSON.stringify(chapter).includes('844,69,-1210')&&JSON.stringify(chapter).includes('上层看台'),'story chapter explains the actual first room and upper route');
 const before=await status();
 if(before.pendingRewards?.includes('aincrad_01')){
  const claimed=await ask('/mycli dungeon claim aincrad_01 --json','MC_SITE_DUNGEON_RESULT ');
  check(claimed.success,'disposable actor claims its previous real reward before a new run');
 }
 const routes=JSON.parse(await fs.readFile('E:/MC/ops/repairs/aincrad-architecture-20261030-r1/route-legs.json','utf8')).legs;
 for(const leg of routes)await walkLeg(leg);
 bot.pathfinder.setGoal(null);
 const started=await ask('/mycli dungeon start aincrad_01 normal --json','MC_SITE_DUNGEON_RESULT ');check(started.success,'ordinary non-OP client starts from the real covered first room');
 await pause(11500);
 for(let index=0;index<6;index++){
  if(index>0)await fixture('position',String(index));
  await until(async()=>{const current=await snapshot();return current.phase==='fighting'&&current.stage===index?current:false;},'real encounter '+index);
  await pause(1200);const current=await snapshot();result.rooms.push(current);
  check(current.mobs.length===4,'four tracked enemies in stage '+(index+1));
  check(current.mobs.every(mob=>mob.ai),'native AI enabled stage '+(index+1));
  const weapons={HUSK:'IRON_SWORD',SKELETON:'BOW',VINDICATOR:'IRON_AXE'};
  check(current.mobs.every(mob=>!weapons[mob.type]||mob.weapon===weapons[mob.type]),'weapons survive native Mythic initialization stage '+(index+1));
  if([1,4].includes(index))check(current.mobs.filter(mob=>mob.type==='SKELETON').every(mob=>mob.helmet==='IRON_HELMET'&&mob.fireTicks<=0),'daylight archers protected from sun stage '+(index+1));
  if(index===1){
   const shots=await until(async()=>{await fixture('recover');const state=await snapshot();return state.mobs.some(mob=>mob.type==='SKELETON'&&mob.bowShots>0)?state:false;},'native archers actually fire arrows',12000);
   result.archerAttack=shots;check(true,'native archer AI actually shoots at the ordinary survival actor');
  }
  const value=await status();check(value.guidance.routeHint&&value.guidance.nextAction.includes(value.guidance.routeHint),'private status supplies current-stage wayfinding '+(index+1));
  if(index===4){
   await pause(1300);const at=bot.messages.length;bot.chat('/mycli dungeon status aincrad_01');bot.lastCall=Date.now();
   await until(()=>bot.messages.slice(at).some(line=>line.includes(value.guidance.routeHint)),'concise text has current route');
   check(!bot.messages.slice(at).some(line=>line.startsWith('MC_SITE_DUNGEON_STATE ')),'ordinary CLI status supplies wayfinding without a JSON dump');
  }
  if(index===5){
   check(current.mobs.some(mob=>mob.type==='VINDICATOR'&&mob.health>=300),'boss has full native 320 HP');
   for(let strike=0;strike<10;strike++){
    await fixture('position','5');await fixture('recover');await fixture('strike');await pause(650);const changed=await snapshot();
    if(changed.mobs.some(mob=>mob.type==='VINDICATOR'&&mob.weapon==='IRON_SWORD')){result.bossPhase=changed;break;}
   }
   check(!!result.bossPhase,'native Mythic low-health weapon phase runs');
  }
  await fixture('clear');await fixture('recover');await pause(2300);
 }
 await fixture('position','0');await pause(2300);
 const final=await status();check(final.lifecycle==='ended'&&final.lastOutcome.reason==='completed','six-stage return produces real saved completion');
 check(final.lastOutcome.requiredRooms===6,'new run requires all six attendance records');
 result.final=final;result.passed=true;
}catch(error){result.error=String(error.stack||error);if(bot?.entity)result.failedPosition=bot.entity.position.toArray();throw error;}
finally{
 bot?.pathfinder?.setGoal(null);if(bot?.entity)bot.quit('Bounded architecture QA complete');
 await fs.writeFile(output+'/result.json',JSON.stringify(result,null,2)+'\n');
}
