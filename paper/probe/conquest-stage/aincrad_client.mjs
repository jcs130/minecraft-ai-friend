// Ordinary Mineflayer combat on the imported map. Fixture only supplies initial
// position/iron kit and recovery; it never kills enemies or grants clear proofs.
// This verifies mechanics/receipts, not autonomous LLM tactics or combat balance.
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {command} from '../../ops/rcon-client.mjs';
const require=createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json');
const mf=require('mineflayer');
const navigation=createRequire(new URL('../../../packages/agent-mc-world/package.json',import.meta.url));
const {pathfinder,Movements,goals}=navigation('mineflayer-pathfinder');
const label=process.argv[2]||'first',cold=label.startsWith('cold'),party=label.startsWith('party');
const stage='E:/MC/staging/aincrad-conquest-20261027';
const rcon=async q=>{const text=await command(q,12000,{properties:stage+'/server.properties',port:25925});if(q.startsWith('qdqa ')&&!text.includes('QDQA_OK'))throw Error('fixture did not complete: '+text);return text;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const result={checks:[],messages:[],errors:[],moves:[],combatHits:0,scoreboards:[],bossSwordSeen:false};let bot,healer;const healerMessages=[];
const check=(v,t)=>{assert.ok(v,t);result.checks.push(t);};
try{
 bot=mf.createBot({host:'127.0.0.1',port:25924,username:party?'ag_TankQA'+label.replace(/\D/g,''):'ag_ConquestQA',version:'1.21.1',auth:'offline',checkTimeoutInterval:60000});
 bot.loadPlugin(pathfinder);bot.on('messagestr',t=>{if(result.messages.length<600)result.messages.push(t);});bot.on('error',e=>result.errors.push(e.message));
 bot._client.on('scoreboard_objective',p=>result.scoreboards.push(p));
 await Promise.race([new Promise((r,j)=>{bot.once('spawn',r);bot.once('end',x=>j(Error(x)));}),sleep(25000).then(()=>{throw Error('join timeout')})]);await sleep(1600);
 const chat=async q=>{const start=result.messages.length;bot.chat(q);await sleep(700);return result.messages.slice(start).join('\n');};
 const rewards=async()=> (await chat('/mycli arena rewards list'))+'\n'+(await chat('/mycli arena stash list'));
 if(cold){
  const state=await rcon('qdqa state '+bot.username);check(/"conquestFloor":1/.test(state),'durable floor after restart');
  result.receipt=await rcon('qdqa receipt '+bot.username);check(result.receipt.includes('floorProof=true'),'original run proof retained');
  const before=await rewards();await chat('/mycli dungeon claim aincrad_01');const after=await rewards();
  result.stash={before,after};check(before===after,'claim after restart cannot duplicate rewards');
  check(/emerald.*count=12|count=12.*emerald/i.test(before)&&/iron_ingot.*count=6|count=6.*iron_ingot/i.test(before),'exact queued or stored reward survives restart');
  await chat('/mycli skills learn travel');await rcon('qdqa mana '+bot.username);await chat('/mycli arena stash');await sleep(500);
  const chest=bot.currentWindow?.slots.slice(0,54)||[];
  const amount=name=>chest.filter(i=>i?.name===name).reduce((sum,i)=>sum+i.count,0);
  check(amount('emerald')===12&&amount('iron_ingot')===6,'opening materializes exact reward in real window');
  bot.closeWindow(bot.currentWindow);await sleep(500);
  const story=await chat('/mycli world story status');check(!story.includes('MC_STORY'),'story defaults to concise text for Agent');
  check((await chat('/mycli world story status --json')).includes('MC_STORY'),'explicit story JSON stays compatible');
 }else{
  // A previous interrupted QA run is durably paused. Leave through the normal
  // player command rather than overwriting that run or inventing clear proofs.
  await chat('/mycli dungeon leave');await rcon('qdqa cooldown '+bot.username);
  await sleep(4000);await rcon('qdqa kit '+bot.username);await rcon('qdqa castle '+bot.username);await sleep(1200);
  check(bot.entity.position.distanceTo(new (require('vec3').Vec3)(856.5,69,-1143.5))<2,'actual arrival on original map');
  await chat('/mycli profession choose '+(party?'tank':'warrior'));await chat('/mycli world story start aincrad_departure');
  const story=await chat('/mycli world story status');check(/前线|briefing|gufeng|顾风/.test(story),'story points to combat briefing');
  if(party){
    await rcon('qdqa guide '+bot.username);await sleep(1600);await chat('/mycli world story talk gufeng aincrad');
    const briefing=await chat('/mycli world story status --json');check(/"stage":"aincrad_clear_one"/.test(briefing),'nearby NPC briefing advances exactly one stage');
    await rcon('qdqa castle '+bot.username);await sleep(900);
    const protection=await rcon('qdqa protection '+bot.username);check(protection.includes('inside=true outside=false fluid=true explosionPreserved=true explosionOutside=true'),'encounter protection is local and resists fluids/explosions');
  }
  const info=await chat('/mycli dungeon info aincrad_01');check(/正式|第一层|aincrad_01/.test(info),'first formal floor discoverable');
  check(!bot.player?.gamemode||bot.player.gamemode===0,'survival player');
  if(party){
    healer=mf.createBot({host:'127.0.0.1',port:25924,username:'ag_HealQA'+label.replace(/\D/g,''),version:'1.21.1',auth:'offline',checkTimeoutInterval:60000});healer.loadPlugin(pathfinder);
    healer.on('messagestr',t=>healerMessages.push(t));healer.on('error',e=>result.errors.push(e.message));
    await Promise.race([new Promise((r,j)=>{healer.once('spawn',r);healer.once('end',x=>j(Error(x)));}),sleep(25000).then(()=>{throw Error('healer join timeout')})]);await sleep(4500);
    healer.chat('/mycli dungeon leave');await sleep(700);await rcon('qdqa kit '+healer.username);await rcon('qdqa castle '+healer.username);
    for(const q of ['/mycli profession choose priest','/mycli skills learn healer_mend','/mycli skills prepare healer_mend']){healer.chat(q);await sleep(700);}
    for(const q of ['/mycli skills learn tank_taunt','/mycli skills prepare tank_taunt','/mycli skills learn tank_bastion','/mycli skills prepare tank_bastion'])await chat(q);
  }
  const started=await chat('/mycli dungeon start aincrad_01');check(/"success":true|集结10秒/.test(started),'ordinary player can start');
  if(party){healer.chat('/mycli dungeon join aincrad_01');await sleep(800);check(healerMessages.some(t=>/"action":"join".*"success":true/.test(t)),'second player joins actual muster');}
  check((await chat('/mycli dungeon start aincrad_01')).includes('already_in_site_dungeon'),'duplicate start explains existing run');
  const movement=new Movements(bot);movement.canDig=false;movement.allow1by1towers=false;movement.allowParkour=false;movement.canOpenDoors=true;movement.scafoldingBlocks=[];bot.pathfinder.setMovements(movement);
  if(healer){const m=new Movements(healer);m.canDig=false;m.allow1by1towers=false;m.allowParkour=false;m.scafoldingBlocks=[];healer.pathfinder.setMovements(m);}
  for(const [index,point] of [[856,69,-1144],[844,69,-1160],[832,69,-1176]].entries()){
    await Promise.all([bot.pathfinder.goto(new goals.GoalNear(point[0],point[1],point[2],1)),...(healer?[healer.pathfinder.goto(new goals.GoalNear(point[0]+1,point[1],point[2],2))]:[])]);result.moves.push({stage:index+1,position:bot.entity.position});
    const deadline=Date.now()+90000;let spawned=false,finished=false;let recoveryAt=0,castAt=0;
    while(Date.now()<deadline){
      if(bot.health<=0)throw Error('QA body died');
      // Account only tagged encounter enemies of the expected native types.
      const mobs=Object.values(bot.entities).filter(e=>['husk','skeleton','vindicator'].includes(e.name)&&e.position.distanceTo(bot.entity.position)<26);
      if(mobs.length){spawned=true;const enemy=mobs.sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];
        if(mobs.some(e=>e.name==='vindicator'&&e.equipment?.some(i=>i?.name==='iron_sword')))result.bossSwordSeen=true;
        if(enemy.position.distanceTo(bot.entity.position)>2.9)bot.pathfinder.setGoal(new goals.GoalFollow(enemy,2),true);
        // stop() is deferred until a path node and can cancel the next goto.
        // Clear the combat goal immediately before aiming or changing stages.
        else{bot.pathfinder.setGoal(null);bot.clearControlStates();await bot.lookAt(enemy.position.offset(0,1.2,0));bot.attack(enemy);result.combatHits++;}
      }
      if(Date.now()>recoveryAt){
        if(healer&&mobs.length&&Date.now()>castAt){healer.chat('/mycli cast healer_mend');bot.chat('/mycli cast tank_taunt');await sleep(750);castAt=Date.now()+13000;}
        await rcon('qdqa recover '+bot.username);if(healer)await rcon('qdqa recover '+healer.username);recoveryAt=Date.now()+4000;
      }
      if(spawned&&!mobs.length){await sleep(1200);const status=await chat('/mycli dungeon status aincrad_01');
        if(/moving|return|前进|返回|下一|已清|结算/.test(status)){finished=true;break;}}
      await sleep(650);
    }
    bot.pathfinder.setGoal(null);bot.clearControlStates();check(spawned,'stage '+(index+1)+' spawned');check(finished,'stage '+(index+1)+' cleared by actual attacks');
  }
  await Promise.all([bot.pathfinder.goto(new goals.GoalNear(856,69,-1144,1)),...(healer?[healer.pathfinder.goto(new goals.GoalNear(857,69,-1144,2))]:[])]);await sleep(3000);
  result.receipt=await rcon('qdqa receipt '+bot.username);check(result.receipt.includes('receipt=true')&&result.receipt.includes('floorProof=true'),'durable receipt requires return');
  await chat('/mycli dungeon claim aincrad_01');const stash=await rewards();result.stash=stash;check(/绿宝石|EMERALD|emerald|铁锭|IRON_INGOT/i.test(stash),'reward reaches durable personal reward queue');
  const before=stash;await chat('/mycli dungeon claim aincrad_01');check((await rewards())===before,'repeat claim cannot duplicate rewards');
  result.state=await rcon('qdqa state '+bot.username);check(result.combatHits>10,'real combat packets used');
  check(result.messages.some(t=>t.includes('[首领] 近身蓄力')),'actual boss telegraph reaches client');
  check(result.bossSwordSeen,'actual boss changes weapon at low health');
  if(healer){result.partnerReceipt=await rcon('qdqa receipt '+healer.username);check(result.partnerReceipt.includes('receipt=true')&&result.partnerReceipt.includes('floorProof=true'),'both participants have independent durable rewards');result.partnerState=await rcon('qdqa state '+healer.username);result.healerMessages=healerMessages;
    check(healerMessages.some(t=>t.startsWith('MC_PROFESSION_RESULT ')&&(()=>{const j=JSON.parse(t.slice(21));return j.skill==='healer_mend'&&j.success===true;})()),'healing skill actually succeeds');
    check(result.messages.some(t=>t.startsWith('MC_PROFESSION_RESULT ')&&(()=>{const j=JSON.parse(t.slice(21));return j.skill==='tank_taunt'&&j.success===true;})()),'tank taunt actually succeeds');
    const finalStory=(await chat('/mycli world story status --json')).split('\n').find(t=>t.startsWith('MC_STORY '));
    check(finalStory&&JSON.parse(finalStory.slice(9)).completedChapters.includes('aincrad_departure'),'formal clear durably completes chapter');}
 }
 check(result.scoreboards.length>0,'native scoreboard packets received');
}catch(e){result.errors.push(e.stack||String(e));}
finally{for(const b of [bot,healer])if(b){b.pathfinder?.setGoal(null);b.quit('conquest QA finished');}await sleep(500);await writeFile(stage+'/client-'+label+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks,errors:result.errors,hits:result.combatHits,state:result.state,receipt:result.receipt}));process.exitCode=result.errors.length?1:0;}
