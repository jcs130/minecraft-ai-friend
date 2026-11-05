import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';

const [stage,out,modules]=process.argv.slice(2);
assert.equal(await fs.readFile(stage+'/.city-gate-qa','utf8'),'CITY_GATE_QA_ONLY');
assert.match(await fs.readFile(stage+'/server.properties','utf8'),/^server-ip=127\.0\.0\.1$/m);
const mineflayer=createRequire(modules)('mineflayer'),checks=[],lines=[];
const rc=t=>command(t,15000,{properties:stage+'/server.properties',port:25989});
const check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('PASS '+name);};
async function until(read,label,ms=15000){for(const end=Date.now()+ms;Date.now()<end;){const v=await read();if(v)return v;await sleep(100);}throw Error('Timeout '+label);}
async function qa(op){const s=await rc('gateqa '+op),i=s.indexOf('GATE_QA ');assert(i>=0,s);return JSON.parse(s.slice(i+8));}
const bot=mineflayer.createBot({host:'127.0.0.1',port:25988,username:'ag_TCA',version:'1.21.1',auth:'offline',hideErrors:true});
installRecipePacketBypass(bot._client);
let spawned=false,passed=false;
bot.on('spawn',()=>{spawned=true;bot.physicsEnabled=false;});bot.on('messagestr',text=>lines.push(text));
async function unchanged(op,label){const before=await qa('status');await qa(op);await sleep(220);const after=await qa('status');check(label,JSON.stringify(before.position)===JSON.stringify(after.position)&&after.mana>=before.mana-.01);}
async function click(x){await until(()=>bot.blockAt(new (createRequire(modules)('vec3').Vec3)(x,82,49))?.name==='stone_button','button terrain');const b=bot.blockAt(new (createRequire(modules)('vec3').Vec3)(x,82,49));await bot.lookAt(b.position.offset(.5,.5,1),true);await bot.activateBlock(b);}
try{
 await until(()=>spawned,'client spawn');await until(async()=>!(await qa('status')).loading,'native RPG profile');
 await qa('setup');await sleep(800);check('ordinary caller is not OP',!(await qa('status')).op);
 await qa('walk');await sleep(300);let s=await qa('status');check('crossing the old trigger volume does not teleport or charge',s.position[1]===49.5&&s.position[3]===48.5&&s.mana>=20);
 await qa('origin');await unchanged('event left','left click does not teleport');await unchanged('event offhand','off hand does not teleport');
 await unchanged('event other','nearby unrelated block does not teleport');
 await qa('deny true');await unchanged('event right','protection veto is respected');await qa('deny false');
 await qa('far');await unchanged('event right','out of reach synthetic interaction is rejected');await qa('origin');
 await qa('mode SPECTATOR');await unchanged('event right','spectator interaction is rejected');await qa('origin');
 await sleep(2100);await qa('mode CREATIVE');let creativeNotice=lines.length;
 await unchanged('event right','creative gate click does not charge or teleport');
 check('creative mode receives an actionable explanation',lines.slice(creativeNotice).some(t=>/创造.*模式.*生存/.test(t)));await qa('origin');
 await qa('frame false');await unchanged('event right','broken portal frame cannot trigger');await qa('frame true');
 await qa('mana 0');let n=lines.length;await click(47);await sleep(600);s=await qa('status');check('insufficient mana does not teleport',s.position[1]===47.5&&s.position[3]===51.5);check('insufficient mana has an actionable response',lines.slice(n).some(t=>/魔力|mana/i.test(t)));
 await sleep(5200);await qa('origin');await sleep(300);n=lines.length;await click(47);await qa('event offhand');await qa('event right');
 s=await until(async()=>{const a=await qa('status');return a.position[1]===63.5?a:null;},'deliberate button travel');
 check('right click uses the existing destination',s.position[3]===51.5);check('success charges only one six-mana fee',s.mana>=14&&s.mana<16);
 check('successful travel has a real result message',lines.slice(n).some(t=>/成功|传送|MC_TRAVEL/.test(t)));
 await sleep(5200);await qa('mana 20');await click(63);s=await until(async()=>{const a=await qa('status');return a.position[1]===47.5?a:null;},'return button');
 check('return gate also requires a deliberate button',s.mana>=14&&s.mana<16);passed=true;
}finally{
 await fs.writeFile(out,JSON.stringify({passed,checks,lines,productionChanged:false},null,2)+'\n');bot.quit();await sleep(250);
}
