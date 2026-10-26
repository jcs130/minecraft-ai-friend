import fs from 'node:fs';import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';import {setTimeout as sleep} from 'node:timers/promises';import {command} from '../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage=process.env.MC_ARCHIVE_TEST_SERVER,root=process.env.MC_ARCHIVE_TEST_OUTPUT;assert(stage?.replaceAll('\\','/').startsWith('E:/MC/staging/')&&root);
const props=fs.readFileSync(stage+'/server.properties','utf8');assert(/^motd=QD_PUBLIC_ARCHIVES_TEST_ONLY$/m.test(props)&&/^rcon.port=25915$/m.test(props));
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),python=process.env.MC_ARCHIVE_TEST_PYTHON??'C:/Users/lzl19/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',db=stage+'/plugins/AgentFriend/archives/archive.db';
const version=process.env.MC_ARCHIVE_TEST_VERSION||'0.4.48';assert(['0.4.48','0.4.47.15'].includes(version));
const rc=q=>command(q,15000,{port:25915,properties:stage+'/server.properties'}),report={at:new Date().toISOString(),checks:[],sha256:createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-'+version+'.jar')).digest('hex')};let bot;const children=[];
const check=(n,v)=>{assert(v,n);report.checks.push(n);console.log('PASS '+n);};
async function until(f,n,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await f())return;await sleep(80);}throw Error('Timeout '+n);}
function sql(q){return JSON.parse(execFileSync(python,['-X','utf8','-c','import sqlite3,json,sys\nc=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True);c.row_factory=sqlite3.Row\nprint(json.dumps([dict(r) for r in c.execute(sys.argv[2])],ensure_ascii=False))',db,q],{encoding:'utf8'}));}
async function hold(ms=1800){const p=spawn(python,['-X','utf8','-u','-c','import sqlite3,time,sys\nc=sqlite3.connect(sys.argv[1]);c.execute("BEGIN IMMEDIATE");print("LOCKED",flush=True);time.sleep(float(sys.argv[2]));c.rollback();c.close()',db,String(ms/1000)],{windowsHide:true});children.push(p);let s='';p.stdout.on('data',b=>s+=b);await until(()=>s.includes('LOCKED'),'fixture database lock');return {released:new Promise((r,j)=>{p.once('exit',c=>c===0?r():j(Error('lock fixture exit '+c)));})};}
async function join(){const b=req('mineflayer').createBot({host:'127.0.0.1',port:25914,username:'ag_ArchiveRace',version:'1.21.1',auth:'offline',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});installRecipePacketBypass(b._client);b.physicsEnabled=false;b.rows=[];b.on('messagestr',s=>{if(s.startsWith('MC_ARCHIVE '))b.rows.push(JSON.parse(s.slice(11)));});await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'race actor spawn');return b;}
const quills=b=>b.inventory.items().filter(i=>i.name==='writable_book').reduce((n,i)=>n+i.count,0);
async function query(s){const n=bot.rows.length;bot.chat('/mycli archive '+s);await until(()=>bot.rows.length>n,s);return bot.rows.at(-1);}
try{
 bot=await join();await sleep(4500);await rc('minecraft:gamemode survival ag_ArchiveRace');await rc('minecraft:clear ag_ArchiveRace');await rc('minecraft:give ag_ArchiveRace writable_book 1');await sleep(300);
 const slot=bot.inventory.items().find(i=>i.name==='writable_book').slot;assert(slot>=36);const request='race-slot-'+Date.now(),lock=await hold();
 const q=query('create 不覆盖移动物品|数据库稍后提交时，原材料槽位已被本人改变。 --request-id '+request+' --json');await sleep(250);
 await rc('minecraft:item replace entity ag_ArchiveRace hotbar.'+(slot-36)+' with minecraft:diamond 1');await lock.released;const result=await q;
 check('changed material slot reports stored but unprinted',result.durable&&!result.printed&&result.state==='stored_print_not_confirmed');
 check('late archive callback never overwrites changed inventory',bot.inventory.slots[slot]?.name==='diamond');
 check('unprinted original remains recoverable in database',sql("SELECT body FROM archive_entries WHERE id='"+result.id+"'").length===1);
 await rc('minecraft:give ag_ArchiveRace writable_book 1');await sleep(200);
 const request2='race-reconnect-'+Date.now(),lock2=await hold(2500),body='断线后仍保留这篇正文，不自动重复扣书或打印。';
 bot.chat('/mycli archive create 断线日记|'+body+' --request-id '+request2+' --json');await sleep(150);bot.quit();await sleep(250);bot=await join();await lock2.released;await sleep(500);
 const row=sql("SELECT e.* FROM archive_entries e JOIN archive_requests r ON e.id=r.entry_id AND e.version=r.version WHERE r.request='"+request2+"'")[0];check('disconnect during commit keeps exact durable original',row?.body===body);
 check('old connection callback does not print into new session',!bot.inventory.items().some(i=>JSON.stringify(i.components??i.nbt).includes(row.id))&&quills(bot)===1);
 const repeat=await query('create 断线日记|'+body+' --request-id '+request2+' --json');check('explicit retry after reconnect is deduplicated without consuming material',repeat.id===row.id&&repeat.replayed&&!repeat.printed&&quills(bot)===1);
 // A real edit_book packet, signed by the server as this authenticated body.
 const quill=bot.inventory.items().find(i=>i.name==='writable_book');assert(quill.slot>=36);bot.setQuickBarSlot(quill.slot-36);await sleep(150);
 const nativeTitle='原版签名游记_'+String(Date.now()).slice(-8);bot._client.write('edit_book',{hand:quill.slot-36,pages:['原版第一页：在营地记录今天的旅程。','原版第二页：这两页的分页需要完整保留。'],title:nativeTitle});
 await until(()=>sql("SELECT metadata FROM archive_entries WHERE author_name='ag_ArchiveRace' AND title='"+nativeTitle+"'").length,'native signed-book archival');
 const native=sql("SELECT * FROM archive_entries WHERE author_name='ag_ArchiveRace' AND title='"+nativeTitle+"' ORDER BY created_at DESC LIMIT 1")[0];
 check('native signing records actual player and original page boundaries',native.author===bot.player.uuid&&JSON.parse(native.metadata).pages.length===2&&native.body.includes('原版第二页'));
 report.passed=true;
}catch(e){report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{bot?.quit();for(const p of children)if(p.exitCode===null)p.kill();await sleep(500);fs.writeFileSync(root+'/race-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failure:report.failure??null}));}
