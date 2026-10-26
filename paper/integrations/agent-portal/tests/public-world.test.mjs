import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {siteFixture} from './helpers.mjs';
import {parsePublicDialogue,publicDialogueText} from '../src/public-dialogue.mjs';
import {ArchiveReader} from '../src/public-archives.mjs';
import {WorldCatalog} from '../src/world-catalog.mjs';

test('actual vanilla/async Paper public chat preserves speech and sender without promoting quoted commands to events',()=>{
 for(const prefix of ['[Server thread/INFO]: ','[Async Chat Thread - #12/INFO]: [Not Secure] ']){
  const row=parsePublicDialogue('[18:06:28] '+prefix+'<ag_Alpha> @ag_CorMy 我在呢。我们一起去墓穴吧！','2026-10-25');
  assert.equal(row.playerName,'ag_Alpha');assert.equal(row.kind,'chat');assert.match(row.body,/一起去墓穴/);
 }
 assert.equal(parsePublicDialogue('[12:00:00] [Server thread/INFO]: <ag_Alpha> ag_Beta joined the game','2026-10-25').kind,'chat');
 const fakeCredential = ['not', 'a', 'real', 'credential'].join('-');
 for(const content of ['/login never-publish-test','MC_AUTH_SUCCESS authenticated','api_key='+fakeCredential,'我的密码是 never-publish-test','Bearer never-publish-test'])assert.equal(publicDialogueText(content),null);
 for(const content of ['ag_Alpha issued server command: /msg ag_Beta hello','[SomePlugin] <ag_Alpha> made up','ag_Alpha whispers to you: hello'])assert.equal(parsePublicDialogue('[12:00:00] [Server thread/INFO]: '+content,'2026-10-25'),null);
});

test('dialogue survives rereads and restart; real repeated same-second messages stay distinct, unsafe/unknown lines never persist',async t=>{
 const f=await siteFixture(t),file=path.join(f.root,'game/logs/latest.log');
 const line='[12:02:00] [Async Chat Thread - #1/INFO]: [Not Secure] <ag_Alpha> 大家来组队吧\n';
 await fs.writeFile(file,line+line+'[12:02:01] [Server thread/INFO]: <ag_Alpha> /login secret-test\n'+'[12:02:02] [Server thread/INFO]: <Unknown> 无身份消息\n');
 assert.equal((await f.admin.request('/world/events?kind=chat')).data.total,2);
 assert.equal((await f.admin.request('/world/events?kind=chat&player=ag_alpha')).data.total,2);
 assert.equal((await f.admin.request('/world/events?kind=chat&player=ag_Beta')).data.total,0);
 const restarted=new WorldCatalog(f.config,f.game,f.portal.store);await restarted.collect();
 assert.equal((await restarted.events({kind:'chat'})).total,2);
 const pending=await restarted.pendingEvents();assert.equal(pending.length,3);
 assert.equal((await restarted.pendingEvents()).length,3,'no send counts as acknowledgement');
 restarted.acknowledgeEvents(pending.map(row=>row.id));assert.equal((await restarted.pendingEvents()).length,0);
 const another=new WorldCatalog(f.config,f.game,f.portal.store);assert.equal((await another.pendingEvents()).length,0,'ack survives reader restart');
 await fs.appendFile(file,'[12:02:03] [Server thread/INFO]: <ag_Alpha> 新的一句话');
 assert.equal((await another.pendingEvents()).length,0);await fs.appendFile(file,'\n');assert.equal((await another.pendingEvents()).length,1);
 const text=JSON.stringify(f.portal.store.db.prepare('SELECT * FROM public_events').all());assert.ok(!text.includes('secret-test'));assert.ok(!text.includes('无身份消息'));
 assert.equal((await f.admin.request('/world/events?day=bad')).status,400);
});

test('guests can read public saved bag but not login/account/profile metadata; original private API remains protected',async t=>{
 const f=await siteFixture(t,{live:{worldObserverPublicDefault:true}});
 f.game.playerState=async()=>({freshness:'saved',savedAt:'2026-10-25T00:00:00Z',vitals:{health:18,food:20,level:7},inventory:[{slot:0,id:'minecraft:player_head',count:1,name:'大背包',private:'secret-test'}],account:{password:'secret-test'},progress:{private:'secret-test'}});
 const data=await fetch(f.origin+'/api/v1/world/players/'+f.agent.id+'/bag').then(r=>r.json());
 assert.equal(data.inventory[0].name,'大背包');assert.equal(data.vitals.health,18);assert.ok(!JSON.stringify(data).includes('secret-test'));
 f.portal.worldView.config.live.worldObserverPublicDefault=false;
 assert.equal((await fetch(f.origin+'/api/v1/world/players/'+f.agent.id+'/bag')).status,404);
});

test('outbox drains over 500 offline messages in bounded acknowledged batches without losing older conversations',async t=>{
 const f=await siteFixture(t),world=f.portal.world;
 await world.collect();const initial=await world.pendingEvents();world.acknowledgeEvents(initial.map(row=>row.id));
 for(let i=0;i<601;i++)world.insert({kind:'chat',playerName:'ag_Alpha',title:'ag_Alpha 说',body:'旅行记录 '+i,occurredAt:Date.now()+i,precision:'second',source:'minecraft.public-chat'},'chat:'+i);
 const ids=new Set();
 for(let i=0;i<7;i++){const batch=await world.pendingEvents();assert.ok(batch.length<=100);for(const row of batch){assert.ok(!ids.has(row.id));ids.add(row.id);}world.acknowledgeEvents(batch.map(row=>row.id));}
 assert.equal(ids.size,601);assert.equal((await world.pendingEvents()).length,0);
});

test('read-only archive ingestion distinguishes missing feature, publishes real books, retries unacknowledged batch and preserves withdrawal',async t=>{
 const f=await siteFixture(t),reader=new ArchiveReader(f.config,f.portal.store);
 assert.equal((await reader.read()).available,false);
 const file=path.join(f.config.serverDir,'plugins/AgentFriend/archives/archive.db');await fs.mkdir(path.dirname(file),{recursive:true});
 const db=new DatabaseSync(file);db.exec('PRAGMA user_version=1;CREATE TABLE archive_entries(id TEXT,version INTEGER,kind TEXT,author TEXT,author_name TEXT,title TEXT,body TEXT,metadata TEXT,published INTEGER,created_at INTEGER,PRIMARY KEY(id,version));');
 t.after(()=>{try{db.close();}catch{}});const id='22222222-2222-4222-8222-222222222222';
 db.prepare('INSERT INTO archive_entries VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,1,'book',f.uuid,'ag_Alpha','营地的第一夜','今天和伙伴一起走过村路。\n明天继续冒险。','{"private":"secret-test"}',1,Date.now());
 const first=await reader.read();assert.equal(first.entries.length,1);assert.equal((await reader.read()).entries.length,1);
 f.portal.archives.accept(first);reader.acknowledge();assert.equal((await new ArchiveReader(f.config,f.portal.store).read()).entries.length,0);
 const books=await fetch(f.origin+'/api/v1/archives').then(r=>r.json());assert.equal(books.total,1);assert.ok(!JSON.stringify(books).includes('secret-test'));assert.ok(!('body' in books.entries[0]));
 const read=await fetch(f.origin+'/api/v1/archives/'+id).then(r=>r.json());assert.match(read.body,/明天/);
 f.portal.archives.accept(first);assert.equal(f.portal.archives.list().total,1);
 db.prepare('INSERT INTO archive_entries VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,2,'book',f.uuid,'ag_Alpha','秘密','密码 secret-test','{}',0,Date.now());
 const withdrawn=await reader.read();assert.ok(!JSON.stringify(withdrawn).includes('secret-test'));f.portal.archives.accept(withdrawn);reader.acknowledge();
 assert.equal((await fetch(f.origin+'/api/v1/archives/'+id)).status,404);assert.equal(f.portal.archives.list().total,0);
 assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM public_archive_entries').get().n,2,'old originals survive');
 db.close();
});
