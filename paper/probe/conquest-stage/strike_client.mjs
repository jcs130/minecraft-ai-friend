// Verify actual damage and private spell receipts on the protected imported map.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {command} from '../../ops/rcon-client.mjs';
const require=createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json');
const stage='E:/MC/staging/aincrad-conquest-20261027',label=process.argv[2],sleep=ms=>new Promise(r=>setTimeout(r,ms));
const out={checks:[],messages:[],receipts:[],errors:[]};let bot;
const rcon=async q=>{const text=await command(q,15000,{port:25925,properties:stage+'/server.properties'});out.receipts.push({command:q,text});assert.match(text,/QDQA_OK/);return text;};
async function chat(q){const start=out.messages.length;bot.chat(q);await sleep(700);return out.messages.slice(start).join('\n');}
try{
 bot=require('mineflayer').createBot({host:'127.0.0.1',port:25924,version:'1.21.1',auth:'offline',username:'ag_StrikeQA'});
 bot.on('messagestr',t=>out.messages.push(t));bot.on('error',e=>out.errors.push(e.message));
 await Promise.race([new Promise((r,j)=>{bot.once('spawn',r);bot.once('end',j);}),sleep(30000).then(()=>{throw Error('join timeout')})]);await sleep(4000);
 await rcon('qdqa setup '+bot.username);await rcon('qdqa castle '+bot.username);await rcon('qdqa difficulty');await sleep(5000);
 for(const q of ['/mycli profession choose warrior','/mycli skills learn sword_thrust','/mycli skills prepare sword_thrust'])await chat(q);
 await rcon('qdqa spawn '+bot.username);await sleep(500);
 const mob=Object.values(bot.entities).find(e=>e.name==='zombie');assert.ok(mob);
 await bot.lookAt(mob.position.offset(0,1.6,0));bot.setControlState('forward',true);
 const end=Date.now()+2500;while(mob.position.distanceTo(bot.entity.position)>2.2&&Date.now()<end)await sleep(50);
 bot.clearControlStates();await bot.lookAt(mob.position.offset(0,1.6,0));await sleep(350);
 const metrics=await rcon('qdqa metrics '+bot.username),cursor=out.messages.length;
 out.hurt=await rcon('qdqa hurtcast '+bot.username);await sleep(200);
 assert.ok(out.messages.slice(cursor).some(t=>t.includes('"reason":"target_recovering"')));out.checks.push('real native hurt window is timing, not a protection error');
 assert.equal(out.hurt.match(/beforeSpell=([0-9.]+)/)[1],out.hurt.match(/afterSpell=([0-9.]+)/)[1]);out.checks.push('hurt immunity preserved; no extra damage forced');
 assert.equal(await rcon('qdqa metrics '+bot.username),metrics);out.checks.push('timing rejection spends no mana');
 await sleep(700);out.before=await rcon('qdqa mob '+bot.username);out.reply=await chat('/mycli cast sword_thrust');out.after=await rcon('qdqa mob '+bot.username);
 assert.match(out.reply,/"action":"cast".*"skill":"sword_thrust".*"success":true/);out.checks.push('actual offensive spell succeeds on protected map');
 const hp=t=>Number(t.match(/health=([0-9.]+)/)?.[1]);assert.ok(hp(out.after)<hp(out.before));out.checks.push('enemy health actually falls, not just a sent command');
 await sleep(8200);await rcon('qdqa recover '+bot.username);await rcon('qdqa damageveto '+bot.username+' yes');
 const mana=await rcon('qdqa metrics '+bot.username),protectedBefore=await rcon('qdqa mob '+bot.username);
 const denied=await chat('/mycli cast sword_thrust');assert.match(denied,/"reason":"protected_target"/);out.checks.push('real plugin protection remains a separate denial');
 assert.equal(hp(await rcon('qdqa mob '+bot.username)),hp(protectedBefore));assert.equal(await rcon('qdqa metrics '+bot.username),mana);out.checks.push('protection blocks damage and refunds spell cost');
 await rcon('qdqa damageveto '+bot.username+' no');
}catch(e){out.errors.push(e.stack||String(e));}
finally{bot?.clearControlStates();bot?.quit('strike QA finished');await sleep(400);await fs.writeFile(stage+'/client-'+label+'.json',JSON.stringify(out,null,2));console.log(JSON.stringify({checks:out.checks,errors:out.errors,before:out.before,after:out.after,reply:out.reply}));process.exitCode=out.errors.length?1:0;}
