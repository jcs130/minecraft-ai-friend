// Explicit private fixture only. Uses forwarded test identities on loopback,
// modifies fixture blocks, and verifies the server block after each native dig.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import crypto from 'node:crypto';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';
assert(process.env.MC_BLOCK_ACCESS_QA_ROOT,'Explicit private fixture required');
const root=path.resolve(process.env.MC_BLOCK_ACCESS_QA_ROOT).replaceAll('\\','/');
const setup=JSON.parse(fs.readFileSync(root+'/stage.json')),stage=path.resolve(setup.stage).replaceAll('\\','/');
assert.equal(path.dirname(stage),'E:/MC/staging');assert.equal(fs.readFileSync(stage+'/.block-access-stage','utf8').trim(),'block-access-20261017');
const props=fs.readFileSync(stage+'/server.properties','utf8');
for(const s of ['server-ip=127.0.0.1','server-port=25830','rcon.port=25831','motd=BLOCK_ACCESS_ISOLATED_20261017'])assert(props.split(/\r?\n/).includes(s));
const output=root+'/'+(process.env.MC_BLOCK_ACCESS_QA_REPORT??'native-verification')+'.json';assert(!fs.existsSync(output),'Preserve earlier results');
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),{Vec3}=require('vec3');
const yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const ids={'.MicroKQ':'00000000-0000-0000-0009-00000d9f9c7b',LittleFish0510:'9c1cde51-cf76-34a7-8574-19f37b63f50f',BlockGuest47:'b6134f5f-e15f-35ba-8f13-5f1de7c65f52'};
const report={at:new Date().toISOString(),formalChanged:false,checks:[],queries:[],attempts:[],messages:{},commands:[]},bots=[];
const rc=async q=>{const response=await command(q,20000,{properties:stage+'/server.properties',port:25831});report.commands.push({q,response});return response;};
const check=(name,pass)=>{report.checks.push({name,pass:!!pass});if(report.checks.length%10===0)console.log(JSON.stringify({checks:report.checks.length,phase:process.env.MC_BLOCK_ACCESS_QA_PHASE??'full'}));assert(pass,name);};
async function until(fn,label,ms=10000){const start=Date.now();while(Date.now()-start<ms){const x=await fn();if(x)return x;await sleep(100);}throw Error('Timed out: '+label);}
async function connect(username){const bot=require('mineflayer').createBot({host:'127.0.0.1',port:25830,username,version:'1.21.1',auth:'offline',hideErrors:true,checkTimeoutInterval:60000,
 fakeHost:'127.0.0.1\0'+'127.0.0.1\0'+ids[username].replaceAll('-','')+'\0[]'});bots.push(bot);report.messages[username]=[];
 bot.on('messagestr',s=>report.messages[username].push(s));bot.on('error',e=>{report.clientErrors??=[];report.clientErrors.push({username,error:e.message});});
 installRecipePacketBypass(bot._client,{enabled:true});
 // This fixture's old prismarine-item dependency returns a non-array enchants
 // value for 1.21 equipment. Hold the real native mining action for 1.2 seconds
 // instead of consulting that local estimator. Server block checks decide success.
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('spawn timeout '+username)),30000);bot.once('spawn',()=>{clearTimeout(t);resolve();});bot.once('kicked',s=>{clearTimeout(t);reject(Error(String(s)));});});
 bot.digTime=()=>1200;
 check('native forwarded identity '+username,bot._client.uuid===ids[username]);return bot;}
async function move(bot,p){await rc('minecraft:gamemode spectator '+bot.username);await rc('minecraft:execute in minecraft:overworld run minecraft:tp '+bot.username+' '+p.join(' '));await rc('minecraft:gamemode survival '+bot.username);await sleep(550);}
async function fixture(bot,p,type='stone'){await move(bot,[p[0]+.5,p[1],p[2]+2.5]);
 await rc(`minecraft:setblock ${p[0]} ${p[1]-1} ${p[2]+2} minecraft:stone`);await rc(`minecraft:setblock ${p[0]} ${p[1]} ${p[2]+2} minecraft:air`);await rc(`minecraft:setblock ${p[0]} ${p[1]+1} ${p[2]+2} minecraft:air`);
 await rc('minecraft:setblock '+p.join(' ')+' minecraft:'+type);await sleep(250);}
async function blockIs(p,type){return /^The time is /.test(await rc('minecraft:execute if block '+p.join(' ')+' minecraft:'+type+' run minecraft:time query gametime'));}
async function query(bot,action,p,allowed,label){await sleep(140);const n=report.messages[bot.username].length;bot.chat('/mycli protect '+action+' '+p.join(' ')+' --json');
 const row=await until(()=>{const s=report.messages[bot.username].slice(n).find(s=>s.startsWith('MC_PROTECTION ')&&s.includes('{'));return s&&JSON.parse(s.slice(s.indexOf('{')));},label);
 report.queries.push({label,actor:bot.username,action,p,response:row});check(label,row.allowed===allowed);return row;}
async function dig(bot,p,allowed,label,type='stone'){await fixture(bot,p,type);const tool=type==='stone'?'diamond_pickaxe':'diamond_axe';if(!bot.inventory.items().some(i=>i.name===tool))await rc('minecraft:give '+bot.username+' minecraft:'+tool);await until(()=>bot.inventory.items().some(i=>i.name===tool),'fixture tool delivery');await bot.equip(bot.inventory.items().find(i=>i.name===tool),'hand');
 await query(bot,'break',p,allowed,label+' preflight');const block=bot.blockAt(new Vec3(...p));assert.equal(block?.name,type);let error;
 const start=Date.now();await Promise.race([bot.dig(block,true).catch(e=>{error=e.message;}),sleep(3000)]);bot.stopDigging();await sleep(450);
 const serverAir=await blockIs(p,'air'),serverStone=await blockIs(p,type);report.attempts.push({label,actor:bot.username,p,type,error,elapsedMs:Date.now()-start,serverAir,serverStone});
 check(label+' authoritative server block',allowed?serverAir&&!serverStone:serverStone&&!serverAir);}
async function place(bot,p,allowed,label){await fixture(bot,p,'air');await rc(`minecraft:setblock ${p[0]} ${p[1]-1} ${p[2]} minecraft:stone`);await rc('minecraft:give '+bot.username+' minecraft:stone 8');await sleep(250);
 await bot.equip(bot.inventory.items().find(i=>i.name==='stone'),'hand');await query(bot,'place',p,allowed,label+' preflight');let error;
 const pending=bot.placeBlock(bot.blockAt(new Vec3(p[0],p[1]-1,p[2])),new Vec3(0,1,0)).catch(e=>{error=e.message;});await Promise.race([pending,sleep(3500)]);await sleep(300);
 const serverAir=await blockIs(p,'air'),serverStone=await blockIs(p,'stone');report.attempts.push({label,actor:bot.username,p,error,action:'place',serverAir,serverStone});
 check(label+' authoritative server block',allowed?serverStone&&!serverAir:serverAir&&!serverStone);}
const policyFile=stage+'/plugins/AgentFriend/block-access.yml',originalPolicy=fs.readFileSync(policyFile,'utf8');
try{
 check('candidate is based on production release',(await rc('version AgentFriend')).includes('0.4.47.2'));
 check('two protected villages and two exact editors',(await rc('mycli admin blockaccess status --json')).includes('"editors":2,"villages":2'));
 await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule fallDamage false');
 const meng=await connect('.MicroKQ'),fish=await connect('LittleFish0510'),guest=await connect('BlockGuest47');
 // These are copies inside the explicitly marked isolated world, not production
 // player inventories. Start each test run with room for its fixture tools.
 for(const bot of [meng,fish,guest])await rc('minecraft:clear '+bot.username);await sleep(500);
 const retained=[-1087,66,-632],ground=[-1105,65,-600],edge=[-1078,65,-600],outside=[-1077,65,-600];
 const beforeStatus=fs.readFileSync(policyFile,'utf8');await rc('mycli admin blockaccess status --json');
 check('status is read-only',fs.readFileSync(policyFile,'utf8')===beforeStatus);
 check('invalid reload flag is rejected before side effects',(await rc('mycli admin blockaccess reload --bogus')).includes('用法：')&&fs.readFileSync(policyFile,'utf8')===beforeStatus);
 let messageStart=report.messages[guest.username].length;guest.chat('/mycli admin blockaccess reload --json');
 await until(()=>report.messages[guest.username].slice(messageStart).some(s=>s.includes('仅控制台')),'player administrative access denial');
 check('ordinary player cannot change building policy',fs.readFileSync(policyFile,'utf8')===beforeStatus);
 if(process.env.MC_BLOCK_ACCESS_QA_PHASE==='placement'){
  const helpStart=report.messages[guest.username].length;guest.chat('/mycli admin blockaccess status --help --json');
  const help=await until(()=>{const s=report.messages[guest.username].slice(helpStart).find(s=>s.startsWith('MC_CLI_HELP '));return s&&JSON.parse(s.slice(s.indexOf('{')));},'administrative capability metadata');
  check('help advertises supported structured format',help.jsonSupported===true);
  check('help gives the actual result-query command',help.resultQuery==='mycli admin blockaccess status --json');
  check('help is read-only and does not grant permission',fs.readFileSync(policyFile,'utf8')===beforeStatus);
  await place(meng,retained,true,'Mengmeng can place in retained village');
  await place(fish,retained,true,'LittleFish can place in retained village');
  await place(guest,retained,false,'ordinary guest cannot place in retained village');
  await place(guest,outside,true,'ordinary guest can place outside village');
  await dig(fish,ground,true,'exact editor survives cold restart');
  await dig(guest,ground,false,'village ground protection survives cold restart');
  await dig(guest,[-550,40,-450],false,'main village subsoil remains protected after restart');
  await dig(fish,[-550,40,-450],true,'exact editor may mine main village subsoil');
 }else{
 await dig(meng,retained,true,'Mengmeng may edit protected new village land');
 await dig(fish,retained,true,'LittleFish may edit protected new village land');
 await dig(guest,retained,false,'ordinary guest cannot edit retained village land');
 await dig(meng,ground,true,'Mengmeng may edit retained ground guard');
 await dig(fish,ground,true,'LittleFish may edit retained ground guard');
 await dig(guest,ground,false,'ordinary guest cannot dig retained village ground');
 await dig(guest,edge,false,'inclusive new village edge stays protected');
 await dig(guest,outside,true,'one block outside retained village is open');
 await dig(guest,[-458,96,-425],false,'main village original fabric remains protected','spruce_fence');
 await dig(fish,[-458,96,-425],true,'LittleFish may edit main village original fabric','spruce_fence');
 await dig(guest,[-660,69,-483],true,'public mine building outside new village is open');
 await dig(guest,[-489,67,-502],false,'guild building inside main village remains protected');
 await dig(guest,[-480,71,-495],false,'original guild fabric inside main village remains protected','cherry_stairs');
 await dig(guest,[-588,71,-446],false,'original life guild fabric inside main village remains protected','cherry_stairs');
 await dig(guest,[-568,63,-388],false,'original trial road fabric inside main village remains protected','spruce_planks');
 await dig(guest,[-560,80,-575],true,'private tower outside both villages permits block edits');
 // Opening a private inventory is a different action from mining the block.
 const box=[-488,67,-502];await fixture(fish,box,'barrel');await query(fish,'container',box,false,'builder status does not grant private guild contents');
 await fish.activateBlock(fish.blockAt(new Vec3(...box)));await sleep(500);check('native private barrel open denied to non-owner',!fish.currentWindow);
 await move(meng,[box[0]+.5,box[1],box[2]+2.5]);await query(meng,'container',box,true,'guild owner retains container access');
 await meng.activateBlock(meng.blockAt(new Vec3(...box)));await until(()=>meng.currentWindow,'owner private barrel');check('native owner private barrel opens',meng.currentWindow.type==='minecraft:generic_9x3');meng.closeWindow(meng.currentWindow);
 const policy=yaml.load(originalPolicy);policy.editors=policy.editors.filter(id=>id!==ids.LittleFish0510);fs.writeFileSync(policyFile,yaml.dump(policy));
 check('hot revoke commits',(await rc('mycli admin blockaccess reload')).includes('"status":"success"'));
 await dig(fish,ground,false,'revoked editor loses retained village edit');
 fs.writeFileSync(policyFile,originalPolicy);check('hot restore commits',(await rc('mycli admin blockaccess reload')).includes('"status":"success"'));
 await dig(fish,ground,true,'restored exact editor may edit again');
 const bad=yaml.load(originalPolicy);bad.villages=[];fs.writeFileSync(policyFile,yaml.dump(bad));
 check('invalid hot configuration is rejected',(await rc('mycli admin blockaccess reload')).includes('"status":"denied"'));
 await dig(guest,ground,false,'invalid reload retains last valid village protection');
 fs.writeFileSync(policyFile,originalPolicy);check('valid configuration can reload after failure',(await rc('mycli admin blockaccess reload')).includes('"status":"success"'));
 const n=report.messages[guest.username].length;await query(fish,'break',ground,true,'final private permission result');await sleep(200);
 check('permission JSON is not broadcast to other players',!report.messages[guest.username].slice(n).some(s=>s.startsWith('MC_PROTECTION ')));
 }
 await rc('worldguard:region save -w world');report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{fs.writeFileSync(policyFile,originalPolicy);for(const bot of bots)bot.quit();await sleep(300);fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,attempts:report.attempts.length,error:report.error,report:output}));}
