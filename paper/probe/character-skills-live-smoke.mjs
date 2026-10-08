// Production queries with a temporary ordinary client. No skill learning, point spending or property changes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);const mineflayer=require('mineflayer');
const roots=['E:/MC/ops/repairs/profession-skills-20261008','F:/MC-backups/repairs/profession-skills-20261008'];
const expected='10E42183647EA1B5A2C7F3E918AB15A43E1571CEEFBA8F087E8593FB051DD375',name='SkillLive92';
const rcon=q=>command(q,15000),sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=s=>JSON.parse(s.slice(s.indexOf('{')));
const report={passed:false,startedAt:new Date().toISOString(),checks:[],messages:[],packets:[],server:{}};let bot,added=false,last=0;
const check=(name,ok,detail)=>{report.checks.push({name,ok:!!ok,detail});assert.ok(ok,name+': '+JSON.stringify(detail??''));console.log('PASS '+name);};
const until=async(f,label,ms=16000)=>{let end=Date.now()+ms;while(Date.now()<end){if(await f())return;await sleep(80);}throw Error(label+' timeout');};
async function ask(q,prefix){let n=report.messages.length;await sleep(Math.max(0,1150-(Date.now()-last)));last=Date.now();bot.chat(q);if(prefix)await until(()=>report.messages.slice(n).some(s=>s.startsWith(prefix)),q);await sleep(150);return report.messages.slice(n);}
try{
 report.candidateSha256=createHash('sha256').update(readFileSync('E:/MC/server/plugins/AgentFriend-0.3.92.jar')).digest('hex').toUpperCase();check('live candidate is the final tested build',report.candidateSha256===expected);
 report.server.version=await rcon('version AgentFriend');check('runtime plugin is 0.3.92',report.server.version.includes('0.3.92'));
 let audit=json(await rcon('mycli admin professions audit'));check('live catalog has three roles and sixteen skills with valid ledger',audit.ready&&audit.professions===3&&audit.skills===16,audit);
 report.server.market=await rcon('mycli admin market list');check('original task market plus five trials has thirty-four templates and seven sites',(report.server.market.match(/^tm_/gm)||[]).length===34&&(report.server.market.match(/^site=/gm)||[]).length===7);
 const land=json(await rcon('mycli admin land audit')),guild=land.lands.find(l=>l.id==='adventurers_guild'),tower=land.lands.find(l=>l.id==='sky_view_tower');
 check('guild owner and private storage remain MicroKQ',guild.ownerUuid==='00000000-0000-0000-0009-00000d9f9c7b'&&guild.publicContainers===0);
 check('completed tower remains with original builder and one public gift chest',tower.ownerUuid==='ccba3629-1f58-33d2-bd0c-f7ba6e699816'&&tower.projectRun==='5806c539-ec5e-4006-a5a1-64d1b0795161'&&tower.publicContainers===1);
 for(const dim of ['overworld','the_nether','the_end']){let difficulty=await rcon('minecraft:execute in minecraft:'+dim+' run minecraft:difficulty'),keep=await rcon('minecraft:execute in minecraft:'+dim+' run minecraft:gamerule keepInventory');check(dim+' remains normal difficulty with keepInventory',difficulty.toLowerCase().includes('normal')&&keep.includes('true'));}
 check('Goddess stays spectator',/data: 3\b/.test(await rcon('minecraft:data get entity Goddess playerGameType')));
 let whitelist=JSON.parse(readFileSync('E:/MC/server/whitelist.json','utf8'));assert.ok(!whitelist.some(p=>p.name===name));await rcon('minecraft:whitelist add '+name);added=true;
 bot=mineflayer.createBot({host:'127.0.0.1',port:25565,username:name,auth:'offline',version:'1.20.6'});bot.on('messagestr',s=>report.messages.push(s));
 bot._client.on('custom_payload',p=>{if(['mcagent:state','mcviewer:state','mcagent:event','mcagent:market'].includes(p.channel))try{report.packets.push({channel:p.channel,...JSON.parse(p.data.toString())});}catch{}});
 await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);});bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:state\0mcviewer:state\0mcagent:event\0mcagent:market')});await sleep(800);
 let points=json((await ask('/mycli skills points','MC_SKILL_POINTS ')).find(s=>s.startsWith('MC_SKILL_POINTS ')));
 check('new live UUID has untouched six point pool and configured respec cost',points.earned===6&&points.spent===0&&points.remaining===6&&points.cap===30&&points.respecMana===10&&points.respecCooldownMs===300000&&!points.grandfathered,points);
 let detail=json((await ask('/mycli skills info healer_beacon','MC_SKILL ')).find(s=>s.startsWith('MC_SKILL ')));
 check('real client discovers all three advanced healing ranks',detail.level===0&&detail.levels.length===3&&detail.levels[2].targets===4&&detail.levels[2].immunityMs===1500);
 let denied=json((await ask('/cast sword_thrust','MC_PROFESSION_RESULT ')).find(s=>s.startsWith('MC_PROFESSION_RESULT ')));check('direct ordinary cast cannot bypass learning qualification',!denied.success&&denied.reason==='profession_required');
 denied=json((await ask('/mycli skills respec confirm','MC_PROFESSION_RESULT ')).find(s=>s.startsWith('MC_PROFESSION_RESULT ')));check('empty respec refuses without charging',!denied.success&&denied.reason==='nothing_to_refund');
 await ask('/mycli profession status','MC_PROFESSION ');check('classic branch discovery remains in private system chat',report.messages.some(s=>s.includes('warrior 战士'))&&report.messages.some(s=>s.includes('mage 法师'))&&report.messages.some(s=>s.includes('priest 牧师')));
 await ask('/mycli spells explain starbolt','MC_SPELL_DETAIL ');check('old spell IDs and guide remain available',report.messages.some(s=>s.startsWith('MC_SPELL_DETAIL ')&&json(s).id==='starbolt'));
 bot.chat('/mycli skills learnmenu');await until(()=>bot.currentWindow,'native learning menu');check('native learning menu includes twenty common and sixteen branch skills',bot.currentWindow.slots.slice(0,36).every(Boolean)&&bot.currentWindow.slots[48]?.name==='grindstone');bot.closeWindow(bot.currentWindow);await sleep(1200);
 await ask('/mycli book','');await until(()=>bot.inventory.items().some(i=>i.name==='written_book'),'status book');const book=bot.inventory.items().find(i=>i.name==='written_book'),bookText=JSON.stringify(book.components??book.nbt);report.statusBook=book.components??book.nbt;check('status book contains points profession growth and respec information',bookText.includes('技能点')&&bookText.includes('洗点'));
 await ask('/mycli status','MC_DUNGEON ');await sleep(600);check('both old state channels retain schema one and original mana fields',report.packets.some(p=>p.channel==='mcagent:state'&&p.schemaVersion===1&&p.mana&&p.abilities&&p.profession?.points?.cap===30)&&report.packets.some(p=>p.channel==='mcviewer:state'&&p.schemaVersion===1&&p.abilities));
 points=json((await ask('/mycli skills points','MC_SKILL_POINTS ')).find(s=>s.startsWith('MC_SKILL_POINTS ')));check('queries and failed operations spend no learning points',points.spent===0&&points.remaining===6);
 report.server.gifts=await rcon('mycli admin giftcatalog');check('Goddess gift verification remains ready',report.server.gifts.includes('"ready":true'));
 report.server.eye=await rcon('cortieye');report.server.roster=await rcon('minecraft:list uuids');report.server.mspt=await rcon('mspt');report.passed=true;
}catch(e){report.error=String(e.stack||e);console.error(e);process.exitCode=1;}
finally{if(bot){if(bot.currentWindow)bot.closeWindow(bot.currentWindow);bot.quit('release query checks done');await sleep(300);}if(added)await rcon('minecraft:whitelist remove '+name);report.finishedAt=new Date().toISOString();const stamp=new Date().toISOString().replaceAll(':','-');for(const dst of roots)writeFileSync(dst+'/live-'+stamp+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,eye:report.server.eye,mspt:report.server.mspt}));}
