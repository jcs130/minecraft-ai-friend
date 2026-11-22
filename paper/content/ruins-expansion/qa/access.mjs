// Native-client entrance acceptance in the existing marked 1.21.1 fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setTimeout as wait} from 'node:timers/promises';
const stage='E:/MC/staging/dungeon-integration-20261109-r1';
const root='E:/MC/staging/grounded-ruins-20261122';
const props=stage+'/server.properties';
assert.equal((await fs.readFile(stage+'/.dungeon-integration-qa','utf8')).trim(),'FRESH_DUNGEON_INTEGRATION_NO_PLAYER_INVENTORIES');
for(const pat of [/^server-ip=127\.0\.0\.1\r?$/m,/^server-port=25960\r?$/m,/^rcon.port=25961\r?$/m])
  assert.match(await fs.readFile(props,'utf8'),pat);
const {command}=await import('file:///E:/MC/ops/rcon-client.mjs');
const rc=q=>command(q,12000,{port:25961,properties:props});
const require=createRequire('E:/MC/probe/package.json');
const mf=require('mineflayer');
const {Vec3}=require('vec3');
const {pathfinder,Movements,goals}=createRequire('E:/MC/ops/repairs/dungeon-network-20261008/routes-runtime/package.json')('mineflayer-pathfinder');
const {sites}=JSON.parse(await fs.readFile(root+'/plan/geometry.json','utf8'));
let bot;
let error,forced=0;
const messages=[];
const testTag=Date.now().toString(36).slice(-3);
const result={isolated:true,passed:false,locations:[]};
async function until(fn,name,ms=9000){
  for(let end=Date.now()+ms;Date.now()<end;){
    if(error)throw error;
    const v=await fn();
    if(v)return v;
    await wait(120);
  }
  throw Error('Timed out: '+name);
}
function near([x,y,z]){
  const p=bot.entity.position;
  return Math.abs(p.y-y)<=.2&&Math.hypot(p.x-x-.5,p.z-z-.5)<3.5;
}
async function request(action,id,more=''){
  const start=messages.length;
  bot.chat('/mycli dungeon '+action+(id?' '+id:'')+more+' --json');
  const prefix=action==='info'?'MC_SITE_DUNGEON_INFO':'MC_SITE_DUNGEON_RESULT';
  return until(()=>messages.slice(start).map(s=>{
    if(!s.startsWith(prefix+' '))return null;
    try{return JSON.parse(s.slice(prefix.length+1));}catch{return null;}
  }).find(j=>j&&(action==='info'||j.action===action)&&(action==='leave'||j.id===id)),action+' '+id);
}
async function place(at){
  await rc('minecraft:execute in minecraft:aincrad run minecraft:tp '+bot.username+' '+[at[0]+.5,at[1],at[2]+.5].join(' '));
  await until(()=>near(at),'fixture ground placement');
  await bot.waitForChunksToLoad();
}
async function walk(at){
  const n=forced,health=bot.health;
  let timer;
  try{
    await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(...at)),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('Walk failed: '+at)),14000);
    })]);
  }finally{clearTimeout(timer);bot.pathfinder.setGoal(null);bot.clearControlStates();}
  assert.equal(forced,n);
  assert.equal(bot.health,health);
}
async function connect(index){
  if(bot){bot.quit();await wait(350);}
  error=null;messages.length=0;forced=0;
  bot=mf.createBot({username:'ag_QARuin'+testTag+index.toString(36),host:'127.0.0.1',port:25960,auth:'offline',
                    version:'1.21.1',hideErrors:true});
  bot.loadPlugin(pathfinder);
  bot.on('error',e=>error=e);
  bot.on('forcedMove',()=>forced++);
  bot.on('messagestr',s=>messages.push(s));
  await until(()=>bot.entity?.position,'synthetic spawn',65000);
  const moves=new Movements(bot);
  moves.canDig=false;moves.allow1by1towers=false;moves.allowParkour=false;moves.scafoldingBlocks=[];
  moves.allowSprinting=false;moves.maxDropDown=2;
  bot.pathfinder.setMovements(moves);
}
try{
  await connect(0);
  assert.match(await rc('version AgentFriend'),/0\.4\.63-ruins-access/);
  assert.match(await rc('mycli admin dungeons audit'),/ready=true sites=15/);
  for(const [slot,item] of Object.entries({head:'helmet',chest:'chestplate',legs:'leggings',feet:'boots'}))
    await rc('minecraft:item replace entity '+bot.username+' armor.'+slot+' with minecraft:iron_'+item);
  await rc('minecraft:item replace entity '+bot.username+' hotbar.0 with minecraft:iron_sword');
  await rc('minecraft:item replace entity '+bot.username+' hotbar.1 with minecraft:bow');
  await rc('minecraft:item replace entity '+bot.username+' hotbar.2 with minecraft:arrow 32');
  await place([8211,72,8201]);
  assert.equal((await request('start','corsair_cove',' normal')).reason,'walk_to_first_room');
  assert.equal((await request('enter','corsair_cove')).reason,'walk_to_station');
  assert.equal((await request('info','corsair_cove')).guidance.reason,'WALK_TO_TRAILHEAD');
  result.lowerBeachCannotStart=true;
  for(const [index,site] of sites.entries()){
    if(index>0) await connect(index);
    const id=site.id;
    const info=await request('info',id);
    assert.deepEqual(info.arrival.station.landing,site.landing);
    assert.deepEqual(info.arrival.station.board,site.station.board);
    assert.deepEqual(info.arrival.station.button,site.station.button);
    assert.deepEqual(info.arrival.station.upperLanding,site.upperLanding);
    const travel=await request('travel',id);
    assert.equal(travel.success,true,JSON.stringify({reason:travel.reason,next:travel.nextAction}));
    assert.ok(travel.position);
    await until(()=>near(site.landing),'real paid travel to trailhead');
    await bot.waitForChunksToLoad();
    const buttonPos=new Vec3(...site.station.button);
    const sign=bot.blockAt(new Vec3(...site.station.board));
    assert.equal(sign?.name,'oak_sign');
    assert.match(await rc('minecraft:execute in minecraft:aincrad run minecraft:data get block '+site.station.board.join(' ')+' front_text.messages[1]'),new RegExp(site.title));
    await walk([site.landing[0],site.landing[1],site.station.button[2]-2]);
    const guide=await request('info',id);
    assert.deepEqual(guide.arrival.station.button,site.station.button);
    assert.equal(bot.blockAt(buttonPos)?.name,'stone_button');
    if(index%2===0){
      await bot.activateBlock(bot.blockAt(buttonPos));
      await until(()=>near(site.upperLanding)&&bot.currentWindow,'native use button and menu');
      bot.closeWindow(bot.currentWindow);
    }else{
      const receipt=await request('enter',id);
      assert.equal(receipt.success,true,JSON.stringify({id,reason:receipt.reason}));
      assert.ok(receipt.position);
      await until(()=>near(site.upperLanding),'CLI entered actual first room');
    }
    if(index===0){
      const started=await request('start',id,' normal');
      assert.equal(started.success,true,JSON.stringify({reason:started.reason}));
      assert.equal((await request('exit',id)).success,false);
      assert.equal((await request('leave')).success,true);
      result.ordinaryStartAndActivityGuard=true;
    }
    const returned=await request('exit',id);
    assert.equal(returned.success,true,JSON.stringify({id,reason:returned.reason}));
    await until(()=>near(site.landing),'return to ground station');
    result.locations.push({id,landing:site.landing,threshold:site.station.button,entered:site.upperLanding,travel:true,returned:true,
                           physicalButton:index%2===0});
    console.log('PASS '+id);
  }
  result.passed=result.locations.length===10&&result.lowerBeachCannotStart&&result.ordinaryStartAndActivityGuard;
}catch(e){
  result.error=String(e);
  console.error(e);
  process.exitCode=1;
}finally{
  await fs.writeFile(root+'/access-play-results.json',JSON.stringify(result,null,2)+'\n','utf8');
  if(bot){bot.clearControlStates();bot.quit();}
}
