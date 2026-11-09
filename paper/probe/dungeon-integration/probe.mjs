import fs from 'node:fs/promises';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{setTimeout as wait}from'node:timers/promises';
import{command}from'file:///E:/MC/ops/rcon-client.mjs';
const stage='E:/MC/staging/dungeon-integration-20261109-r1',root=process.env.DUNGEON_INTEGRATION_REPORT_ROOT;assert(root);
assert.equal(await fs.readFile(stage+'/.dungeon-integration-qa','utf8'),'FRESH_DUNGEON_INTEGRATION_NO_PLAYER_INVENTORIES');
const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1\r?$/m.test(props)&&/^server-port=25960\r?$/m.test(props)&&/^rcon.port=25961\r?$/m.test(props));
const baseline=process.argv.includes('--baseline'),reboot=process.argv.includes('--reboot'),entrancesOnly=process.argv.includes('--entrances-only'),actorName=process.env.DUNGEON_QA_ACTOR??'ag_DungeonQA1';assert(/^ag_DungeonQA[1-3]$/.test(actorName));
const rc=s=>command(s,20000,{port:25961,properties:stage+'/server.properties'}),req=createRequire(new URL('../../../packages/agent-mc-world/package.json',import.meta.url)),mf=req('mineflayer'),{pathfinder,Movements,goals}=req('mineflayer-pathfinder');
const report={baseline,reboot,productionChanged:false,syntheticActor:true,checks:[],errors:[],readbacks:[]};let bot;const lines=[];
const until=async(fn,label,ms=30000)=>{for(const end=Date.now()+ms;Date.now()<end;){const x=await fn();if(x)return x;await wait(100);}throw Error('Timeout '+label);};
const check=(name,value)=>{report.checks.push({name,ok:!!value});console.log((value?'PASS ':'FAIL ')+name);};
const qa=async s=>{const raw=await rc('dgi '+s);assert(!raw.includes('DGI_QA_ERROR'),raw);return JSON.parse(raw.split('DGI_QA ')[1]);};
async function query(text,prefix,ms=30000){await wait(1100);const start=lines.length;bot.chat(text);const line=await until(()=>lines.slice(start).find(s=>s.startsWith(prefix+' ')),text,ms);const value=JSON.parse(line.slice(prefix.length+1));report.readbacks.push({command:text,result:value});return value;}
try{
 await until(async()=>{try{return(await rc('version AgentFriend')).includes(baseline?'0.4.47.63':'0.4.47.66');}catch{return false;}},'full stack startup',300000);
 const inspect=await qa('inspect');report.inspect=inspect;check('15 sites load with the original paused checkpoint',inspect.ready&&inspect.sites.length===15&&inspect.blocked.length===0&&inspect.activeRuns.includes('aincrad_01'));
 const required=['WorldGuard','FastAsyncWorldEdit','LightAntiCheat','QiandengjiAntiCheat','LuckPerms','AgentFriend','VortexRPG','QiandengjiRpg','MagicSpells','AuraSkills','MythicMobs','Multiverse-Core'];check('actual protection anti-cheat and RPG plugins enabled',required.every(n=>inspect.enabledPlugins.includes(n)));
 const defs={};for(const id of ['undead_crypt','creeping_crypt','bunker','illager_camp','aincrad_01'])defs[id]=(await qa('inspect '+id)).definition;
 report.legacyDefinitions=defs;if(baseline)await fs.writeFile(root+'/baseline-definitions.json',JSON.stringify(defs,null,2));else check('all five original checkpoint definitions remain byte identical',JSON.stringify(defs)===JSON.stringify(JSON.parse(await fs.readFile(root+'/baseline-definitions.json','utf8'))));
 bot=mf.createBot({host:'127.0.0.1',port:25960,version:'1.21.1',username:actorName,auth:'offline',hideErrors:true});bot.loadPlugin(pathfinder);bot.on('messagestr',s=>lines.push(s));bot.on('error',e=>report.errors.push(String(e)));bot.on('kicked',e=>report.errors.push('kicked '+JSON.stringify(e)));await until(()=>bot.entity&&bot.player?.uuid,'synthetic login',60000);await wait(4000);
 await qa('prepare '+bot.username);const actor=await qa('read '+bot.username);check('ordinary survival actor uses no OP permissions',actor.op===false&&actor.mode==='SURVIVAL');
 const info=await query('/mycli dungeon info creeping_crypt --json','MC_SITE_DUNGEON_INFO');check('CLI identifies protected configured entrance without claiming first-room arrival',info.arrival?.entranceConfigured===true&&info.arrival?.entranceScope==='navigation_only'&&info.arrival?.routeVerified===false&&info.arrival?.startMeaning==='first_room_center');
 const connector=JSON.parse(await fs.readFile(new URL('../crypt-route/connector.json',import.meta.url),'utf8'));
 let protectedCount=0;for(const cell of connector.cells){const row=await qa('break-check '+bot.username+' '+cell.pos.join(' '));if(row.cancelled)protectedCount++;}report.connectorProtectedCells=protectedCount;check('all 34 connector cells have idle native protection',protectedCount===34);
 if(!baseline&&!entrancesOnly&&!reboot){
   await qa('refill '+bot.username);const travel=await query('/mycli dungeon travel creeping_crypt --json','MC_SITE_DUNGEON_RESULT',45000);check('ordinary CLI travel succeeds',travel.success===true);await bot.waitForChunksToLoad();await wait(1200);
   const landing=await qa('read '+bot.username);report.actualLanding=landing;check('travel reaches the surface entrance rather than the first room',landing.world==='world'&&Math.abs(landing.position[0]-1165.5)<=3&&Math.abs(landing.position[2]-230.5)<=3&&landing.position[1]===94&&!landing.inFirstRoom);
   const denied=await query('/mycli dungeon start creeping_crypt --json','MC_SITE_DUNGEON_RESULT');check('starting on the roof still requires walking to the first room',denied.success===false&&denied.reason==='walk_to_first_room');
   const movements=new Movements(bot);movements.canDig=false;movements.allow1by1towers=false;movements.scafoldingBlocks=[];movements.allowParkour=false;movements.allowSprinting=false;movements.maxDropDown=3;movements.canOpenDoors=true;for(const n of ['water','lava'])if(bot.registry.blocksByName[n])movements.blocksToAvoid.add(bot.registry.blocksByName[n].id);
   bot.pathfinder.setMovements(movements);bot.pathfinder.thinkTimeout=10000;bot.pathfinder.tickTimeout=20;bot.pathfinder.searchRadius=180;
   await qa('begin '+bot.username);let pathError;try{await Promise.race([bot.pathfinder.goto(new goals.GoalNear(1159,45,209,2)),wait(150000).then(()=>{throw Error('route timeout');})]);}catch(e){pathError=String(e);}finally{bot.pathfinder.setGoal(null);bot.clearControlStates();}
   report.walk=await qa('finish '+bot.username);report.walkError=pathError;check('walk from the real travel landing reaches the first room',!pathError&&report.walk.inFirstRoom);check('route needs no dig build flight water or further teleport',report.walk.digPackets===0&&report.walk.teleports===0&&report.walk.water===0&&report.walk.damage===0);
   if(!report.walk.inFirstRoom)throw Error('Native route did not reach first room');
   const started=await query('/mycli dungeon start creeping_crypt --json','MC_SITE_DUNGEON_RESULT');check('ordinary equipped player starts the original first room',started.success===true);
   const left=await query('/mycli dungeon leave --json','MC_SITE_DUNGEON_RESULT');check('ordinary participant can leave without losing old checkpoint identities',left.success===true);
 }
   if(!baseline&&!reboot){
     const added=['corsair_cove','tide_sanctum','sunken_dynasty','frost_keep','ember_foundry','jungle_covenant','sky_watch','void_citadel','deep_mineworks','winter_manor'];
     for(const id of added){await qa('refill '+bot.username);const detail=await query('/mycli dungeon info '+id+' --json','MC_SITE_DUNGEON_INFO');const result=await query('/mycli dungeon travel '+id+' --json','MC_SITE_DUNGEON_RESULT',45000);check('new site entrance '+id,result.success===true&&detail.arrival.entranceConfigured===true);await wait(600);}
   }
 check('native client has no protocol or connection errors',report.errors.length===0);
}catch(error){report.error=String(error);console.log(report.error);}
finally{if(bot)bot.quit();report.passed=!report.error&&report.checks.every(c=>c.ok);const name=baseline?'baseline':reboot?'reboot':entrancesOnly?'entrances':'candidate';await fs.writeFile(root+'/integration-'+name+'-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failures:report.checks.filter(c=>!c.ok).map(c=>c.name),error:report.error}));if(!report.passed)process.exitCode=1;}
