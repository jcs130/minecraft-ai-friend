// Ordinary Mineflayer combat on the imported map. solo* uses only an initial
// iron kit/mana; party* is a separate mechanics test with explicit QA recovery.
// Neither path grants a clear proof. These scripts do not test an LLM's tactics.
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {command} from '../../ops/rcon-client.mjs';
const require=createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json');
const mf=require('mineflayer');
const navigation=createRequire(new URL('../../../packages/agent-mc-world/package.json',import.meta.url));
const {pathfinder,Movements,goals}=navigation('mineflayer-pathfinder');
const label=process.argv[2]||'first',cold=label.startsWith('cold'),party=label.startsWith('party'),unaided=label.startsWith('solo')||label.startsWith('coldsolo');
const stage='E:/MC/staging/aincrad-conquest-20261027';
const rcon=async q=>{const text=await command(q,12000,{properties:stage+'/server.properties',port:25925});if(q.startsWith('qdqa ')&&!text.includes('QDQA_OK'))throw Error('fixture did not complete: '+text);return text;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const result={checks:[],messages:[],errors:[],moves:[],combatHits:0,scoreboards:[],bossSwordSeen:false,unaided,adminRecoveries:0,legitimateHeals:0,skillAttacks:0,successfulSkillAttacks:0};let bot,healer,died=false,shielding=false;const healerMessages=[];
const scoreboardRows=new Map();
const check=(v,t)=>{assert.ok(v,t);result.checks.push(t);};
async function walk(b,goal){
 for(let attempt=0;attempt<3;attempt++)try{await b.pathfinder.goto(goal);return;}
 catch(e){result.moves.push({retry:attempt+1,position:b.entity.position,error:e.name});
  if(attempt===2||!['NoPath','PathStopped','GoalChanged'].includes(e.name))throw e;
  b.pathfinder.setGoal(null);b.clearControlStates();await sleep(700);
 }
}
try{
 bot=mf.createBot({host:'127.0.0.1',port:25924,username:party?'ag_TankQA'+label.replace(/\D/g,''):unaided?'ag_UseSolo'+label.replace(/\D/g,''):'ag_ConquestQA',version:'1.21.1',auth:'offline',checkTimeoutInterval:60000});
 bot.loadPlugin(pathfinder);bot.on('messagestr',t=>{if(result.messages.length<600)result.messages.push(t);});bot.on('error',e=>result.errors.push(e.message));
 bot.on('death',()=>{died=true;});
 bot._client.on('scoreboard_objective',p=>result.scoreboards.push(p));
 const team=p=>{if(p.mode===1||p.mode==='remove')scoreboardRows.delete(p.team);else if([0,2,'add','change'].includes(p.mode))scoreboardRows.set(p.team,p);};
 bot._client.on('teams',team);bot._client.on('scoreboard_team',team);
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
  await sleep(4000);await rcon('qdqa kit '+bot.username);await rcon('qdqa castle '+bot.username);result.difficulty=await rcon('qdqa difficulty '+(label.startsWith('soloeasy')?'easy':'normal'));await sleep(1200);
  check(bot.entity.position.distanceTo(new (require('vec3').Vec3)(856.5,69,-1143.5))<2,'actual arrival on original map');
  const opening=party?'tank_taunt':'sword_thrust';
  await chat('/mycli world story cancel');await chat('/mycli skills unprepare '+opening);
  await chat('/mycli profession choose '+(party?'tank':'warrior'));await chat('/mycli world story start aincrad_departure');
  const story=await chat('/mycli world story status');
  check(/战斗技能|准备/.test(story),'choosing a role leaves a real learning and preparation step');
  const help=await chat('/mycli guide magic');check(help.includes('①选职业')&&help.includes('②学习')&&help.includes('③准备')&&help.includes('④施放'),'existing magic guide explains the full sequence');
  await chat('/mycli skills learn '+opening);await chat('/mycli skills unprepare '+opening);
  check((await chat('/mycli world story status')).includes('战斗技能'),'learned but unprepared does not satisfy combat preparation');
  await chat('/mycli skills prepare '+opening);
  check(/前线|briefing|gufeng|顾风/.test(await chat('/mycli world story status')),'actual prepared skill advances to briefing');
  if(unaided)await chat('/mycli skills learn selfheal');
  if(party){
    await rcon('qdqa guide '+bot.username);await sleep(1600);await chat('/mycli world story talk gufeng aincrad');
    const briefing=await chat('/mycli world story status --json');check(/"stage":"aincrad_clear_one"/.test(briefing),'nearby NPC briefing advances exactly one stage');
    await rcon('qdqa castle '+bot.username);await sleep(900);
    const protection=await rcon('qdqa protection '+bot.username);check(protection.includes('inside=true outside=true fluid=true explosionPreserved=true explosionOutside=false'),'whole authored map stays protected with combat enabled');
  }
  if(unaided){
    await rcon('qdqa guide '+bot.username);await chat('/mycli world story talk gufeng aincrad');
    await rcon('qdqa mana '+bot.username); // Initial test resources only, before entry/combat.
    await chat('/mycli skills learn travel');
    const sent=await chat('/mycli dungeon travel aincrad_01');await sleep(2200);
    check(bot.entity.position.distanceTo(new (require('vec3').Vec3)(856.5,69,-1143.5))<5,'paid player travel reaches actual challenge entry');
    result.travelReply=sent;
  }
  const info=await chat('/mycli dungeon info aincrad_01');check(/正式|第一层|aincrad_01/.test(info),'first formal floor discoverable');
  const trusted=await rcon('qdqa trusted '+bot.username);check(trusted.includes('trustedBreak=true trustedPlace=true'),'original trusted builder policy remains usable inside the encounter');
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
  const movement=new Movements(bot);movement.canDig=false;movement.allow1by1towers=false;movement.allowParkour=unaided;movement.canOpenDoors=true;movement.scafoldingBlocks=[];bot.pathfinder.setMovements(movement);
  if(healer){const m=new Movements(healer);m.canDig=false;m.allow1by1towers=false;m.allowParkour=false;m.scafoldingBlocks=[];healer.pathfinder.setMovements(m);}
  for(const [index,point] of [[856,69,-1144],[844,69,-1160],[832,69,-1176]].entries()){
    await Promise.all([walk(bot,new goals.GoalNear(point[0],point[1],point[2],1)),...(healer?[walk(healer,new goals.GoalNear(point[0]+1,point[1],point[2],2))]:[])]);result.moves.push({stage:index+1,position:bot.entity.position});
    const deadline=Date.now()+120000;let spawned=false,finished=false;let recoveryAt=0,castAt=0,healAt=0,retreatUntil=0,warningCursor=result.messages.length,manaAt=0,mana=0;
    while(Date.now()<deadline){
      if(bot.health<=0||died)throw Error('QA body died');
      if(unaided&&Date.now()>manaAt){const own=await rcon('qdqa metrics '+bot.username);mana=Number(own.match(/mana=([0-9.]+)/)?.[1]||0);manaAt=Date.now()+5000;}
      // Expected nearby native types are candidates. Never infer a room clear
      // from this list alone: require the actual server stage and final proof.
      const mobs=Object.values(bot.entities).filter(e=>['husk','skeleton','vindicator'].includes(e.name)&&e.position.distanceTo(bot.entity.position)<26);
      if(mobs.length){spawned=true;const enemy=mobs.sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];
        if(mobs.some(e=>e.name==='vindicator'&&e.equipment?.some(i=>i?.name==='iron_sword')))result.bossSwordSeen=true;
        if(unaided&&result.messages.slice(warningCursor).some(t=>t.includes('[首领] 近身蓄力'))){retreatUntil=Date.now()+1800;warningCursor=result.messages.length;}
        if(unaided&&Date.now()<retreatUntil){
          if(shielding){bot.deactivateItem();shielding=false;}
          const delta=bot.entity.position.minus(enemy.position);if(delta.norm()>0.1){const factor=5/delta.norm();const dest=enemy.position.offset(delta.x*factor,0,delta.z*factor);bot.pathfinder.setGoal(new goals.GoalNear(dest.x,point[1],dest.z,1));}
        }else if(enemy.position.distanceTo(bot.entity.position)>2.9)bot.pathfinder.setGoal(new goals.GoalFollow(enemy,2),true);
        // stop() is deferred until a path node and can cancel the next goto.
        // Clear the combat goal immediately before aiming or changing stages.
        else{bot.pathfinder.setGoal(null);bot.clearControlStates();await bot.lookAt(enemy.position.offset(0,1.2,0));
          if(shielding){bot.deactivateItem();shielding=false;}
          if(unaided&&mana>=10&&Date.now()>castAt){
            const cursor=result.messages.length;await sleep(150);bot.chat('/mycli cast sword_thrust');result.skillAttacks++;castAt=Date.now()+9000;
            await sleep(650);if(result.messages.slice(cursor).some(t=>t.startsWith('MC_PROFESSION_RESULT ')&&(()=>{const j=JSON.parse(t.slice(21));return j.action==='cast'&&j.skill==='sword_thrust'&&j.success===true;})())){result.successfulSkillAttacks++;mana-=4;}
          }else{bot.attack(enemy);result.combatHits++;}
          if(unaided){await sleep(100);bot.activateItem(true);shielding=true;}
        }
      }
      if(unaided&&bot.health<=12&&mana>=6&&Date.now()>healAt){bot.chat('/mycli cast selfheal');result.legitimateHeals++;mana-=6;healAt=Date.now()+16000;}
      if(Date.now()>recoveryAt){
        if(healer&&mobs.length&&Date.now()>castAt){healer.chat('/mycli cast healer_mend');bot.chat('/mycli cast tank_taunt');await sleep(750);castAt=Date.now()+13000;}
        if(!unaided){await rcon('qdqa recover '+bot.username);if(healer)await rcon('qdqa recover '+healer.username);result.adminRecoveries++;}
        recoveryAt=Date.now()+4000;
      }
      if(spawned&&!mobs.length){await sleep(1200);const status=await chat('/mycli dungeon status aincrad_01');
        if(/moving|return|前进|返回|下一|已清|结算/.test(status)){finished=true;break;}}
      await sleep(650);
    }
    bot.pathfinder.setGoal(null);bot.clearControlStates();if(shielding){bot.deactivateItem();shielding=false;}check(spawned,'stage '+(index+1)+' spawned');check(finished,'stage '+(index+1)+' cleared by actual attacks');
    if(unaided&&index<2){
      // Rest in the genuinely cleared room. Use ordinary food and Aura's
      // natural regeneration instead of console recovery or rushing half-dead.
      const restUntil=Date.now()+45000;let lastMana=0;
      while(Date.now()<restUntil){
        if(bot.food<20){const beef=bot.inventory.items().find(i=>i.name==='cooked_beef');if(beef){await bot.equip(beef,'hand');await bot.consume();await bot.equip(bot.inventory.items().find(i=>i.name==='iron_sword'),'hand');}}
        const own=await rcon('qdqa metrics '+bot.username);lastMana=Number(own.match(/mana=([0-9.]+)/)?.[1]||0);
        if(bot.health>=18&&lastMana>=12)break;await sleep(2500);
      }
      (result.rests??=[]).push({afterStage:index+1,health:bot.health,food:bot.food,mana:lastMana});
    }
  }
  await Promise.all([walk(bot,new goals.GoalNear(856,69,-1144,1)),...(healer?[walk(healer,new goals.GoalNear(857,69,-1144,2))]:[])]);await sleep(3000);
  result.receipt=await rcon('qdqa receipt '+bot.username);check(result.receipt.includes('receipt=true')&&result.receipt.includes('floorProof=true'),'durable receipt requires return');
  await chat('/mycli dungeon claim aincrad_01');const stash=await rewards();result.stash=stash;check(/绿宝石|EMERALD|emerald|铁锭|IRON_INGOT/i.test(stash),'reward reaches durable personal reward queue');
  const before=stash;await chat('/mycli dungeon claim aincrad_01');check((await rewards())===before,'repeat claim cannot duplicate rewards');
  result.state=await rcon('qdqa state '+bot.username);check(result.combatHits>10,'real combat packets used');
  check(result.messages.some(t=>t.includes('[首领] 近身蓄力')),'actual boss telegraph reaches client');
  check(result.bossSwordSeen,'actual boss changes weapon at low health');
  if(unaided){check(result.adminRecoveries===0,'no console health or mana recovery during combat');check(result.successfulSkillAttacks>0,'offensive skill has actual successful server receipts');result.finalHealth=bot.health;check(bot.health>0&&!died,'solo survivor completes all three encounters');}
  if(healer){result.partnerReceipt=await rcon('qdqa receipt '+healer.username);check(result.partnerReceipt.includes('receipt=true')&&result.partnerReceipt.includes('floorProof=true'),'both participants have independent durable rewards');result.partnerState=await rcon('qdqa state '+healer.username);result.healerMessages=healerMessages;
    check(healerMessages.some(t=>t.startsWith('MC_PROFESSION_RESULT ')&&(()=>{const j=JSON.parse(t.slice(21));return j.skill==='healer_mend'&&j.success===true;})()),'healing skill actually succeeds');
    check(result.messages.some(t=>t.startsWith('MC_PROFESSION_RESULT ')&&(()=>{const j=JSON.parse(t.slice(21));return j.skill==='tank_taunt'&&j.success===true;})()),'tank taunt actually succeeds');
    const finalStory=(await chat('/mycli world story status --json')).split('\n').find(t=>t.startsWith('MC_STORY '));
    check(finalStory&&JSON.parse(finalStory.slice(9)).completedChapters.includes('aincrad_departure'),'formal clear durably completes chapter');}
 }
 check(result.scoreboards.some(p=>p.name==='TAB-Scoreboard'&&JSON.stringify(p).includes('攻略纪行')),'actual RPG scoreboard objective received');
 result.scoreboardRows=[...scoreboardRows.values()];
 const boardText=JSON.stringify(result.scoreboardRows).replace(/§[0-9a-fk-orx]/gi,'');
 check(boardText.includes('战斗')&&boardText.includes('正式攻略')&&!boardText.includes('%qd_'),'RPG sidebar has resolved combat and formal floor values');
}catch(e){result.errors.push(e.stack||String(e));result.failurePosition=bot?.entity?.position;result.failureHealth=bot?.health;}
finally{for(const b of [bot,healer])if(b){b.pathfinder?.setGoal(null);if(result.errors.length){b.chat('/mycli dungeon leave');await sleep(900);}b.quit('conquest QA finished');}await sleep(500);await writeFile(stage+'/client-'+label+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks,errors:result.errors,hits:result.combatHits,state:result.state,receipt:result.receipt}));process.exitCode=result.errors.length?1:0;}
