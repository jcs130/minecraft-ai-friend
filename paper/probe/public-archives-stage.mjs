import fs from 'node:fs';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';import {setTimeout as sleep} from 'node:timers/promises';import {execFileSync} from 'node:child_process';
import {command} from '../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const server=process.env.MC_ARCHIVE_TEST_SERVER,root=process.env.MC_ARCHIVE_TEST_OUTPUT;
assert(server&&root&&server.replaceAll('\\','/').startsWith('E:/MC/staging/'),'Isolated staging directory required');
const properties=fs.readFileSync(server+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(properties)&&/^server-port=25914$/m.test(properties)&&/^rcon.port=25915$/m.test(properties)&&/^motd=QD_PUBLIC_ARCHIVES_TEST_ONLY$/m.test(properties),'Dedicated loopback fixture, never production');
fs.mkdirSync(root,{recursive:true});const request=createRequire(process.env.MC_MINEFLAYER_PACKAGE??'E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const rc=q=>command(q,30000,{port:25915,properties:server+'/server.properties'}),report={at:new Date().toISOString(),checks:[],messages:[],scope:'Native Paper, ordinary vanilla-protocol books and SQLite; no production inventory changes or GPU rendering'};
report.sha256=createHash('sha256').update(fs.readFileSync(server+'/plugins/AgentFriend-0.4.48.jar')).digest('hex');
const bots=[];const db=server+'/plugins/AgentFriend/archives/archive.db';
const python=process.env.MC_ARCHIVE_TEST_PYTHON??'C:/Users/lzl19/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
function sql(query){const code='import sqlite3,json,sys\nc=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)\nc.row_factory=sqlite3.Row\nprint(json.dumps([dict(r) for r in c.execute(sys.argv[2])],ensure_ascii=False))';return JSON.parse(execFileSync(python,['-X','utf8','-c',code,db,query],{encoding:'utf8'}));}
function check(name,ok){assert(ok,name);report.checks.push(name);console.log('PASS '+name);}
async function until(f,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await f())return;await sleep(100);}throw Error('Timeout '+label);}
async function connect(username){const b=request('mineflayer').createBot({host:'127.0.0.1',port:25914,username,version:'1.21.1',auth:'offline',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});bots.push(b);installRecipePacketBypass(b._client);b.physicsEnabled=false;b.lines=[];b.results=[];b.books=0;
 b.on('messagestr',s=>{b.lines.push(s);report.messages.push({player:username,text:s});if(s.startsWith('MC_ARCHIVE '))try{b.results.push(JSON.parse(s.slice(11)));}catch{}});b._client.on('packet',(_,m)=>{if(m.name==='open_book')b.books++;});
 await new Promise((resolve,reject)=>{b.once('spawn',resolve);b.once('error',reject);b.once('kicked',r=>reject(Error(JSON.stringify(r))));});return b;
}
async function query(b,cmd){const n=b.results.length;b.chat('/mycli archive '+cmd);await until(()=>b.results.length>n,cmd);return b.results.at(-1);}
const amount=(b,name)=>b.inventory.items().filter(i=>i.name===name).reduce((n,i)=>n+i.count,0);
const archivedBooks=(b,id)=>b.inventory.items().filter(i=>i.name==='written_book'&&JSON.stringify(i.components??i.nbt,(_k,v)=>typeof v==='bigint'?String(v):v).includes(id));
try{
 check('archive candidate is actually loaded',(await rc('version AgentFriend')).includes('0.4.48'));
 const author=await connect('ag_ArchiveQA'),reader=await connect('ArchiveReader');
 await rc('minecraft:gamemode survival ag_ArchiveQA');await rc('minecraft:gamemode survival ArchiveReader');await rc('minecraft:time set day');
 await rc('minecraft:tp ag_ArchiveQA -1116.5 64 -600.5');await rc('minecraft:tp ArchiveReader -1115.5 64 -600.5');
 await rc('minecraft:clear ag_ArchiveQA');await rc('minecraft:clear ArchiveReader');await sleep(400);
 const status=await query(author,'status --json');check('SQLite ready without network dependency',status.ready===true&&status.publicBooks===true);
 const before=sql('SELECT COUNT(*) n FROM archive_entries')[0].n;
 await query(reader,'list book --json');await query(reader,'status --json');
 check('ordinary status/list do not write database or enrol',sql('SELECT COUNT(*) n FROM archive_entries')[0].n===before);
 let result=await query(reader,'create 空手测试|没有书与笔不会凭空出书。 --json');check('missing material fails with structured actionable error',result.errorCode==='MATERIAL_REQUIRED'&&result.nextCommand);
 check('failed create does not add original',sql('SELECT COUNT(*) n FROM archive_entries')[0].n===before);
 await rc('minecraft:give ag_ArchiveQA minecraft:writable_book 3');await sleep(400);
 const quills=amount(author,'writable_book'),title='营地的第一篇日记',body='今天我在旅人营地遇到了新伙伴，大家把多余装备放进公共箱子。以后我想带大家去看城外的河流，也想记住每一次旅行。';
 const req='fixture-'+Date.now();result=await query(author,'create '+title+'|'+body+' --request-id '+req+' --json');report.bookId=result.id;
 check('authoring confirms committed public original and physical book',result.durable&&result.printed&&result.published&&result.readOnly===false);
 await until(()=>archivedBooks(author,result.id).length===1,'native archived book slot');check('exactly one quill is consumed',amount(author,'writable_book')===quills-1);
 const row=sql("SELECT * FROM archive_entries WHERE id='"+result.id+"'")[0];check('database contains exact author, title and complete body',row.body===body&&row.title===title&&row.author===author.player.uuid&&row.published===1);
 const item=archivedBooks(author,result.id)[0];report.bookComponents=item.components;
 const storageSlot=item.slot>=36?item.slot-36:item.slot;
 const bookPath='minecraft:data get entity ag_ArchiveQA Inventory[{Slot:'+storageSlot+'b}]';
 const native=await Promise.all([rc(bookPath+'.id'),rc(bookPath+'.components."minecraft:written_book_content".author'),rc(bookPath+'.components."minecraft:custom_data".PublicBukkitValues."agentfriend:archive_entry"')]);report.nativeBook=native;check('native written_book carries original author and archive identity',native[0].includes('minecraft:written_book')&&native[1].includes('ag_ArchiveQA')&&native[2].includes(result.id));
 const written=archivedBooks(author,report.bookId).length;result=await query(author,'create '+title+'|'+body+' --request-id '+req+' --json');await sleep(200);
 check('same request returns original without printing or consuming again',result.id===report.bookId&&result.replayed&&!result.printed&&archivedBooks(author,report.bookId).length===written&&amount(author,'writable_book')===quills-1);
 result=await query(author,'create 不同书名|不同正文 --request-id '+req+' --json');check('conflicting request is rejected without a new original',result.errorCode==='INVALID_ARGUMENT');
 const list=await query(reader,'list book --json');check('unprivileged reader sees another author public diary',list.items.some(i=>i.id===report.bookId&&i.author==='ag_ArchiveQA'));
 const n=reader.books;result=await query(reader,'read '+report.bookId+' --json');await until(()=>reader.books>n,'native book reading packet');check('ordinary reader receives exact text and native open_book',result.text===body&&result.pages===1&&archivedBooks(reader,report.bookId).length===0);
 const count=sql('SELECT COUNT(*) n FROM archive_entries')[0].n;
 await rc('minecraft:give ArchiveReader minecraft:writable_book 2');await sleep(200);
 const restore='restore-'+Date.now();result=await query(reader,'restore '+report.bookId+' --request-id '+restore+' --json');check('lost book restores as a marked copy without new achievement',result.printed&&result.copyId&&result.newAchievement===false);
 await until(()=>archivedBooks(reader,report.bookId).length===1,'restored copy slot');const copyItem=archivedBooks(reader,report.bookId)[0],copySlot=copyItem.slot>=36?copyItem.slot-36:copyItem.slot;const copyPath='minecraft:data get entity ArchiveReader Inventory[{Slot:'+copySlot+'b}]';const nativeCopy=await Promise.all([rc(copyPath+'.components."minecraft:written_book_content".author'),rc(copyPath+'.components."minecraft:custom_data".PublicBukkitValues."agentfriend:archive_entry"'),rc(copyPath+'.components."minecraft:written_book_content".generation')]);report.nativeCopy=nativeCopy;check('restored physical copy retains original author and version',nativeCopy[0].includes('ag_ArchiveQA')&&nativeCopy[1].includes(report.bookId)&&/: 1$/.test(nativeCopy[2]));
 result=await query(reader,'restore '+report.bookId+' --request-id '+restore+' --json');await sleep(200);check('restore retry never duplicates a copy or consumes another quill',!result.printed&&archivedBooks(reader,report.bookId).length===1&&amount(reader,'writable_book')===1);
 check('restoration cannot mint new original or quest evidence',sql('SELECT COUNT(*) n FROM archive_entries')[0].n===count);
 const invalid=await query(reader,'list --page 0 --json');check('invalid JSON arguments have machine-readable error and next step',invalid.errorCode==='INVALID_ARGUMENT'&&invalid.nextCommand);
 const peerBefore=reader.results.length;await query(author,'info '+report.bookId+' --json');await sleep(300);check('private command replies are not broadcast to unrelated player',reader.results.length===peerBefore);
 await rc('minecraft:give ag_ArchiveQA minecraft:writable_book 1');await sleep(100);result=await query(author,'notice 旅行伙伴招募|明天想去森林走走，欢迎愿意同行的朋友。 --json');check('public notice is an authored native book, not a reward contract',result.kind==='notice'&&result.printed&&result.published);
 const literal='写下命令 /mycli --help 和 --json，只作为书中的文字示例。';result=await query(author,'create --json --request-id literal-'+Date.now()+' -- 技能笔记|'+literal);check('literal CLI examples do not invoke help or strip text from a diary',result.printed&&sql("SELECT body FROM archive_entries WHERE id='"+result.id+"'")[0].body===literal);
 const missing=await query(reader,'info 00000000-0000-0000-0000-000000000001 --json');check('ordinary missing-work error honours JSON mode',missing.errorCode==='ARCHIVE_NOT_FOUND');
 report.authoredOriginals=sql("SELECT id,kind,author,title,body,published FROM archive_entries WHERE author='"+author.player.uuid+"'");report.copies=sql("SELECT c.* FROM archive_copies c WHERE c.recipient='"+reader.player.uuid+"' AND c.entry_id='"+report.bookId+"'");
 check('one restoration attempt reservation persists',report.copies.length===1);
 report.passed=true;
}catch(e){report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{for(const b of bots)b.quit();await sleep(600);fs.writeFileSync(root+'/native-'+Date.now()+'.json',JSON.stringify(report,(_k,v)=>typeof v==='bigint'?String(v):v,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failure:report.failure??null}));}
