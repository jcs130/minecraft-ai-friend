// Native acceptance on its isolated stage only. Does not connect to production.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/adventure-first-20261026',root='E:/MC/ops/repairs/public-world-20261026';
const phase=process.argv[2];assert(['before','after','help'].includes(phase));
const props=fs.readFileSync(stage+'/server.properties','utf8');assert.match(props,/server-ip=127\.0\.0\.1/);assert.match(props,/server-port=25914/);assert.match(props,/motd=QD_PUBLIC_ARCHIVES_TEST_ONLY/);
const req=createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json');
const mf=req('mineflayer'),{Vec3}=req('vec3');const checks=[],bots=[];
const rc=s=>command(s,15000,{port:25915,properties:stage+'/server.properties'});
function check(name,value){assert(value,name);checks.push(name);console.log('PASS '+name);}
async function until(fn,name){for(let end=Date.now()+30000;Date.now()<end;){let v=fn();if(v)return v;await sleep(100);}throw Error('Timeout '+name);}
async function make(username){const b=mf.createBot({host:'127.0.0.1',port:25914,version:'1.21.1',username,auth:'offline',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});installRecipePacketBypass(b._client);bots.push(b);b.lines=[];b.payloads=[];b.on('messagestr',s=>b.lines.push(s.replace(/§[0-9a-fk-or]/gi,'')));b._client.on('custom_payload',p=>{if(['mcagent:tasks','mcagent:life'].includes(p.channel))b.payloads.push({channel:p.channel,data:JSON.parse(p.data.toString())});});await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'spawn');b._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:tasks\0mcagent:life')});await sleep(200);return b;}
async function say(b,s){await sleep(Math.max(0,1100-(Date.now()-(b.last??0))));b.last=Date.now();const from=b.lines.length;b.chat('/mycli '+s);await sleep(500);return b.lines.slice(from).join('\n');}
async function tasks(b){const before=b.payloads.length,from=b.lines.length;await say(b,'tasks status --json');return until(()=>{
 const payload=b.payloads.slice(before).find(p=>p.channel==='mcagent:tasks'&&p.data.type==='status')?.data;
 if(payload)return payload;
 for(const line of b.lines.slice(from)){const at=line.indexOf('MC_TASKS ');if(at>=0){const parsed=JSON.parse(line.slice(at+9));if(parsed.type==='status')return parsed;}}
 if(b.lines.slice(from).some(l=>l.includes('MC_AUTH_DENIED')))throw Error('QA authentication fixture missing');
 },'task status; QA receipt '+b.lines.slice(from).join(' | '));}
async function harvest(b,x,z){await rc(`minecraft:tp ${b.username} ${x+.5} 65 ${z-1+.5}`);await rc(`minecraft:setblock ${x} 64 ${z} minecraft:farmland[moisture=7]`);await rc(`minecraft:setblock ${x} 65 ${z} minecraft:wheat[age=7]`);const target=new Vec3(x,65,z);await until(()=>b.blockAt(target)?.name==='wheat','wheat');await b.dig(b.blockAt(target));await sleep(200);}
try{
 if(phase==='help'){
  const b=await make('QDEndHelp');
  check('live capabilities describe retired task pause',(await say(b,'capabilities info tasks.pause')).includes('已撤下的农耕旧单'));
  await say(b,'menu');await until(()=>b.currentWindow,'skill compass');
  check('personal reward stash is primary menu slot eight',b.currentWindow.slots[8]?.name==='chest');
  check('creative menu replaces farming label',b.currentWindow.slots[13]?.name==='writable_book');b.closeWindow(b.currentWindow);
 }else if(phase==='before'){
  const b=await make('QDFarmLegacyB');await rc('minecraft:gamemode survival QDFarmLegacyB');await rc('minecraft:fill 10 64 10 30 64 30 minecraft:stone');
  let initial=await tasks(b);
  check('old legacy farm accepted',initial.life.activeId==='farmer_harvest'||(await say(b,'life accept farmer_harvest')).includes('已接'));
  const accepted=initial.adventure.activeId==='tm_field_cycle'?'已接':await say(b,'guild accept tm_field_cycle');
  console.log('QA market acceptance receipt:',accepted);
  check('old market farm accepted',accepted.includes('已接'));
  await harvest(b,15,15);let state=await tasks(b);check('old native harvest records real progress',state.adventure.activeId==='tm_field_cycle'&&state.adventure.progress===1&&state.life.activeId==='farmer_harvest'&&state.life.progress===1);
  fs.writeFileSync(root+'/farm-before-state.json',JSON.stringify(state,null,2));
 }else{
  const b=await make('QDFarmNew');
  for(const cmd of ['life accept farmer_harvest','guild accept harvest_home','guild accept tm_field_cycle','guild accept tm_vegetable_cycle'])check('new accept withdrawn '+cmd,(await say(b,cmd)).includes('农耕委托已撤下'));
  const board=await say(b,'world board');check('resident board no crop invitations',!board.includes('青禾的麦田约定')&&!board.includes('菜园里的十个明天'));
  const life=await say(b,'life board');check('legacy board no farm invitation',!life.includes('farmer_harvest'));
  await say(b,'life menu');await until(()=>b.currentWindow,'menu');check('menu farm slot empty',!b.currentWindow.slots[10]);b.closeWindow(b.currentWindow);
  const list=await say(b,'tasks list --json');check('exploration and combat routes discoverable',list.includes('exploration')&&list.includes('combat'));
  const old=await make('QDFarmLegacyB');let state=await tasks(old);const before=JSON.parse(fs.readFileSync(root+'/farm-before-state.json'));
  check('old farm frozen ID and native progress preserved',state.adventure.activeId===before.adventure.activeId&&state.adventure.progress===before.adventure.progress&&state.life.activeId===before.life.activeId&&state.life.progress===before.life.progress);
  check('old farm recommends preserved pause instead of farming',state.adventure.nextCommand==='/mycli tasks pause'&&state.life.nextCommand==='/mycli tasks list exploration');
  const pause=await say(old,'tasks pause');check('retired daily pause is available',pause.includes('success')||pause.includes('已保存'));
  let paused=await tasks(old);check('pause frees adventure slot and retains old progress',paused.adventure.activeId===''&&paused.pausedExploration.id==='tm_field_cycle'&&paused.pausedExploration.progress===before.adventure.progress);
  await say(old,'tasks resume');state=await tasks(old);check('resume restores same frozen progress',state.adventure.activeId===before.adventure.activeId&&state.adventure.progress===before.adventure.progress);
  for(let i=0;i<11;i++)await harvest(old,16+i,15);
  const submitted=await say(old,'guild claim');check('withdrawn frozen stage can still be delivered',submitted.includes('阶段')||submitted.includes('下一步')||submitted.includes('完成'));
  state=await tasks(old);check('frozen market advances into replant without clearing old run',state.adventure.activeId==='tm_field_cycle'&&state.adventure.progress===0);
  const lifeClaim=await say(old,'life claim');check('withdrawn legacy earned reward still claimable',lifeClaim.includes('委托完成'));
  await say(b,'tasks list exploration --json');check('query does not enrol',(await tasks(b)).adventure.activeId==='');
 }
 fs.writeFileSync(root+'/adventure-'+phase+'-proof.json',JSON.stringify({passed:true,phase,checks,productionChanged:false},null,2));
}finally{for(const b of bots)b.quit('Isolated checks complete');await sleep(400);}
