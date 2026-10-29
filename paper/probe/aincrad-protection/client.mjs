import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {command} from '../../ops/rcon-client.mjs';
const require=createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json');
const stage='E:/MC/staging/aincrad-protection-20261027',label=process.argv[2];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const result={checks:[],messages:[],errors:[],receipts:[]};let bot;
const check=(ok,name)=>{assert.ok(ok,name);result.checks.push(name)};
const rcon=async q=>{const t=await command(q,15000,{properties:stage+'/server.properties',port:25929});result.receipts.push({q,t});if(t.includes('QDQA_ERROR'))throw Error(t);return t};
try {
  bot=require('mineflayer').createBot({host:'127.0.0.1',port:25928,username:'ag_MapQA',version:'1.21.1',auth:'offline',checkTimeoutInterval:60000});
  bot.on('messagestr',t=>result.messages.push(t));bot.on('error',e=>result.errors.push(e.message));
  await Promise.race([new Promise((r,j)=>{bot.once('spawn',r);bot.once('end',e=>j(Error(e)))}),sleep(30000).then(()=>{throw Error('join timeout')})]);await sleep(1800);
  const chat=async q=>{let n=result.messages.length;bot.chat(q);await sleep(1100);return result.messages.slice(n).join('\n')};
  await rcon('qdmap prepare '+bot.username);
  check((await chat('/aincrad')).includes('/warp aincrad'),'guide exposes existing warp and return commands');
  if(!label.startsWith('cold')){
    const rejected=await chat('/warp aincrad');check(rejected.includes('/mycli skills learn travel')&&!rejected.includes('data_unavailable'),'missing skill has accurate actionable refusal');
    check((await rcon('qdmap state '+bot.username)).includes('world=world '),'unlearned travel remains rejected');
  }
  result.learn=await chat('/mycli skills learn travel');await rcon('qdmap mana '+bot.username);
  await chat('/warp aincrad');await sleep(2500);
  const arrived=await rcon('qdmap state '+bot.username);check(arrived.includes('world=aincrad '),'ordinary Agent actually reaches map');check(arrived.includes('op=false'),'ordinary account has no op');
  check(Math.abs(bot.entity.position.x+582.5)<2&&Math.abs(bot.entity.position.z-934.5)<2,'actual client receives expected safe entry');
  const events=await rcon('qdmap checks '+bot.username);result.eventChecks=events.split('\n').filter(t=>t.startsWith('PASS '));check(events.includes('checks_completed'),'protection and allowed gameplay event checks complete');
  const protection=await chat('/mycli protect break -585 68 934');check(/拒绝|保护|不可|deny|不允许/.test(protection),'Agent preflight agrees with actual denial');
  const block=bot.blockAt(bot.entity.position.offset(0,-1,0).floored());check(!!block,'entry chunk loaded');
  const before=block.type;await Promise.race([bot.dig(block).catch(()=>{}),sleep(7000)]);await sleep(900);
  check(bot.blockAt(block.position)?.type===before,'real client dig cannot remove entry floor');bot.stopDigging();
  await rcon('qdmap mana '+bot.username);await chat('/warp village');await sleep(1500);
  check((await rcon('qdmap state '+bot.username)).includes('world=world '),'return warp actually reaches home world');
  await rcon('qdmap drain '+bot.username);const noMana=await chat('/warp aincrad');
  check(/魔力|法力/.test(noMana)&&(await rcon('qdmap state '+bot.username)).includes('world=world '),'insufficient mana refuses without teleport');
  const rules=await chat('/mycli rules');check(rules.includes('/warp aincrad')&&rules.includes('/mycli arena stash'),'Agent rules include travel and remote personal box');
  check(result.errors.length===0,'client connection retained');
} catch(e) {result.failure=e.stack;process.exitCode=1;}
finally {if(bot)bot.quit();await writeFile(stage+'/client-'+label+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({label,checks:result.checks,eventChecks:result.eventChecks,failure:result.failure}));}
