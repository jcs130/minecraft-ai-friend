// Native protocol movement in a marked, block-only copy. No production connection or gameplay actions.
import fs from'node:fs/promises';import assert from'node:assert/strict';import{createRequire}from'node:module';import{pathToFileURL}from'node:url';import{setTimeout as delay}from'node:timers/promises';
const stage=process.env.CRYPT_QA_STAGE,root=process.env.CRYPT_QA_REPORT_ROOT,anchor=process.env.CRYPT_QA_CLIENT_ANCHOR,pf=process.env.CRYPT_QA_PATHFINDER,bridge=process.env.CRYPT_QA_RCON;assert(stage&&root&&anchor&&pf&&bridge);
assert.equal(await fs.readFile(stage+'/.shop-qa','utf8'),'FRESH_RPG_SHOP_QA_NO_PLAYER_DATA');const properties=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1\r?$/m.test(properties)&&/^server-port=25928\r?$/m.test(properties)&&/^rcon.port=25929\r?$/m.test(properties));
const {command}=await import(pathToFileURL(bridge)),req=createRequire(anchor),mf=req('mineflayer'),{pathfinder,Movements,goals}=req(pf),{Vec3}=req('vec3');const rc=s=>command(s,20000,{port:25929,properties:stage+'/server.properties'});
const report={at:new Date().toISOString(),productionModified:false,syntheticOnly:true,geometryOnly:true,canDig:false,canBuild:false,waterForbidden:process.argv.includes('--dry'),cases:[]};let bot;
const reportFile=root+'/'+(process.argv.includes('--ground')?'walking-ground-candidate.json':process.argv.includes('--candidate')?'walking-candidate.json':process.argv.includes('--roof')?'walking-roof-original.json':'walking.json');
assert(!await fs.stat(reportFile).catch(()=>null),'Preserve the original receipt; choose a fresh report directory');
assert(!(process.argv.includes('--roof')&&process.argv.includes('--ground')),'Choose one exterior placement');
assert(!process.argv.includes('--ground')||process.argv.includes('--candidate'),'Ground placement is a separate candidate case');
const until=async(f,why,ms=30000)=>{for(let end=Date.now()+ms;Date.now()<end;){const v=await f();if(v)return v;await delay(100);}throw Error('Timed out: '+why);};
const read=async()=>JSON.parse((await rc('qdcrypt read '+bot.username)).split('CRYPT_QA ')[1].trim());
async function walk(label,goal,limit=120000){
 await rc('qdcrypt begin '+bot.username+' '+label);const start=await read(),events=[],positions=[];let last=Date.now(),lastPos=bot.entity.position.clone();
 const onUpdate=r=>events.push({at:Date.now(),status:r.status,nodes:r.path?.length??0,visited:r.visitedNodes});const onPhysics=()=>{if(Date.now()-last>=500){last=Date.now();const p=bot.entity.position;positions.push([Date.now(),p.x,p.y,p.z]);lastPos=p.clone();}};
 bot.on('path_update',onUpdate);bot.on('physicsTick',onPhysics);bot.pathfinder.setGoal(goal);
 let status='timeout';for(const end=Date.now()+limit;Date.now()<end;){await delay(250);if(bot.health<=0){status='died';break;}const p=bot.entity.position;if(goal.isEnd(p.floored())){status='goal';break;}if(events.at(-1)?.status==='noPath'&&!bot.pathfinder.isMoving()){status='noPath';break;}}
 bot.pathfinder.setGoal(null);bot.clearControlStates();await delay(800);bot.off('path_update',onUpdate);bot.off('physicsTick',onPhysics);const end=await read();await rc('qdcrypt finish '+bot.username);
 const row={label,status,start,end,pathEvents:events,clientPositions:positions};report.cases.push(row);await fs.writeFile(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify({label,status,start:start.position,end:end.position,damage:end.damage,waterSamples:end.waterSamples,breaks:end.breakAttempts,places:end.placeAttempts,teleports:end.teleportsWhileWalking}));return row;
}
try{
 await until(async()=>{try{return(await rc('version CryptRouteQA')).includes('version');}catch{return false;}},'isolated server startup',180000);if(!process.argv.includes('--reuse-loaded-geometry'))await rc('qdcrypt load');
 bot=mf.createBot({host:'127.0.0.1',port:25928,version:'1.21.1',username:'ag_RUCrypta',auth:'offline',hideErrors:true});bot.loadPlugin(pathfinder);bot.on('error',e=>report.clientError=String(e));await until(()=>bot.entity&&bot.player?.uuid,'synthetic login',60000);
 await rc('qdcrypt setup '+bot.username+' outside');await bot.waitForChunksToLoad();await delay(1500);
 if(process.argv.includes('--roof')){await rc('minecraft:tp '+bot.username+' 1165.5 94 230.5');await bot.waitForChunksToLoad();await delay(1500);report.initialPlacement='exterior_roof_at_1165_94_230';report.forwardTeleportedToFirstRoom=false;}
 if(process.argv.includes('--ground')){await rc('minecraft:tp '+bot.username+' 1169.5 93 231.5');await bot.waitForChunksToLoad();await delay(1500);report.initialPlacement='natural_grass_ground_at_1169_93_231';report.forwardTeleportedToFirstRoom=false;}
 const movements=new Movements(bot);movements.canDig=false;movements.allow1by1towers=false;movements.scafoldingBlocks=[];movements.allowParkour=false;movements.allowSprinting=false;movements.maxDropDown=3;movements.infiniteLiquidDropdownDistance=false;movements.canOpenDoors=true;movements.exclusionAreasStep.push(b=>!b.position||b.position.x<1061||b.position.x>1229||b.position.z<161||b.position.z>309?100:0);bot.pathfinder.setMovements(movements);bot.pathfinder.thinkTimeout=10000;bot.pathfinder.tickTimeout=20;bot.pathfinder.searchRadius=180;
 const direction=process.argv.includes('--reverse-only')?'reverse':'forward';
 if(process.argv.includes('--dry'))movements.blocksToAvoid.add(bot.registry.blocksByName.water.id);
 if(direction==='reverse'){await rc('qdcrypt setup '+bot.username+' room');await bot.waitForChunksToLoad();await delay(1000);await walk(process.argv.includes('--upper')?'reverse-upper':process.argv.includes('--ladder')?'reverse-ladder':'reverse-only',process.argv.includes('--upper')?new goals.GoalNear(1165,87,230,1):process.argv.includes('--ladder')?new goals.GoalNear(1104,96,171,2):new goals.GoalNear(1096,66,232,2));}
 else{const result=await walk(process.argv.includes('--ground')?'forward-ground-candidate':process.argv.includes('--candidate')?'forward-candidate':process.argv.includes('--roof')?'forward-roof-original':'forward-original',new goals.GoalNear(1159,46,209,2));if(result.end.inFirstRoom)await walk(process.argv.includes('--ground')?'return-ground-candidate':process.argv.includes('--candidate')?'return-candidate':'return-original',process.argv.includes('--ground')?new goals.GoalNear(1169,93,231,1):process.argv.includes('--roof')?new goals.GoalNear(1165,94,230,1):new goals.GoalNear(1096,66,232,2));}
 report.completed=true;
 if(process.argv.includes('--candidate')){
  report.passed=report.cases.length===2&&report.cases[0].end.inFirstRoom&&report.cases.every(c=>c.status==='goal'&&c.end.moves>0&&c.end.health===20&&c.end.damage===0&&c.end.waterSamples===0&&c.end.breakAttempts===0&&c.end.placeAttempts===0&&c.end.digPackets===0&&c.end.teleportsWhileWalking===0&&c.end.mode==='ADVENTURE'&&!c.end.op&&!c.end.flying);
  if(!report.passed)process.exitCode=1;
 }
}catch(error){report.error=String(error);console.log(String(error));process.exitCode=1;}
finally{if(bot){bot.pathfinder?.setGoal(null);bot.clearControlStates();bot.quit();bot._client?.end();}await fs.writeFile(reportFile,JSON.stringify(report,null,2));}
