import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {Store,digest} from '../src/store.mjs';
import {SavedChallenges,CloudChallenges,challengeScore,towerDifficultyProof} from '../src/challenges.mjs';
import {projectRoot} from '../src/config.mjs';
import {siteFixture} from './helpers.mjs';

const uuids=['11111111-1111-3111-8111-111111111111','22222222-2222-3222-8222-222222222222'];
const names=['ag_Alpha','LittleFish0510'];
async function fixture(t){
 const root=path.join(projectRoot,'.local/tests/challenges-'+randomUUID());
 const store=new Store(path.join(root,'data')),documents={'config.yml':{'dungeon-challenge-built':true},'dungeons.yml':{sites:{crypt:{name:'测试墓穴',rooms:[{},{},{}]}}}};
 const game={roster:async()=>names.map((name,i)=>({name,playerUuid:uuids[i],available:true,kind:'agent'})),plugin:async file=>({data:documents[file],savedAt:new Date().toISOString()})};
 const reader=new SavedChallenges({serverDir:root},game,store);
 t.after(async()=>{store.close();assert.ok(root.startsWith(path.join(projectRoot,'.local/tests')+path.sep));await fs.rm(root,{recursive:true,force:true});});
 return {root,store,game,documents,reader};
}
const activity={id:'trial_tower',type:'tower',name:'试炼塔',unit:'层',totalUnits:15};
const record=(id='a'.repeat(24),extra={})=>({id,activityId:'trial_tower',state:'completed',difficulty:'normal',reachedUnits:15,clearedUnits:15,totalUnits:15,party:['ag_Alpha'],hiddenMembers:0,startedAt:new Date(Date.now()-60000).toISOString(),endedAt:new Date(Date.now()-1000).toISOString(),observedAt:new Date(Date.now()-1000).toISOString(),reason:'cleared',evidence:'saved-outcome',...extra});
const feed=runs=>({schemaVersion:1,available:true,activities:[activity],observedAt:new Date().toISOString(),runs});

test('an administrator participating as a player stays on the public team without granting private account access',async t=>{
 const f=await fixture(t);f.game.roster=async()=>[{name:'ag_Alpha',playerUuid:uuids[0],available:true,kind:'agent'},{name:'LittleFish0510',playerUuid:uuids[1],available:true,kind:'admin',isReserved:true}];
 const cloud=new CloudChallenges(f.store,f.game);await cloud.accept(feed([record('a'.repeat(24),{party:names})]));const r=await cloud.query();assert.deepEqual(r.runs[0].party,names);assert.ok(!JSON.stringify(r).includes(uuids[1]));
});

test('legacy tower result is not assigned a current selected difficulty or guessed score',async t=>{
 const f=await fixture(t),d=f.documents['config.yml'];Object.assign(d,{'dungeon-last-run':Date.now()-2000,'dungeon-last-outcome':'won','dungeon-last-finish-floor':15,'dungeon-last-finish-reason':'cleared','dungeon-last-participants':uuids,'dungeon-difficulty':{[uuids[0]]:'apocalypse'}});
 const one=await f.reader.snapshot(),two=await f.reader.snapshot();assert.equal(two.runs.length,1);assert.equal(one.runs[0].difficulty,null);assert.equal(challengeScore(one.runs[0]),null);assert.equal(one.runs[0].clearedUnits,15);assert.deepEqual(one.runs[0].party,['ag_Alpha','LittleFish0510']);
});

test('same-file final reward and exact persisted finish prove the historical difficulty; chat cannot forge it',async t=>{
 const f=await fixture(t),end=Date.now()-1000;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(end));
 const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(end));
 await fs.mkdir(path.join(f.root,'logs'),{recursive:true});
 const p=path.join(f.root,'logs',date+'-1.log.gz');
 const reward=`[${clock}] [Server thread/INFO]: [AgentFriend] Dungeon floor reward: floor=15, difficulty=adventure, credited=2`;
 const finish=`[${clock}] [Server thread/INFO]: [AgentFriend] Dungeon finished: won=true, floor=15, reason=cleared, remaining=0, message=完成`;
 await fs.writeFile(p,gzipSync('<ag_Fake> '+reward+'\n'+finish+'\n'));assert.equal(await towerDifficultyProof(f.root,end,15),null);
 await fs.writeFile(p,gzipSync(reward+'\n'+finish+'\n'));assert.equal(await towerDifficultyProof(f.root,end,15),'adventure');
 assert.equal(await towerDifficultyProof(f.root,end-10000,15),null,'Nearby unrelated times are not the same run');
});

test('tower captures and finalizes one run without calling a reached floor cleared',async t=>{
 const f=await fixture(t),d=f.documents['config.yml'],id=randomUUID();
 d['dungeon-active-run']={id,floor:3,difficulty:'adventure',cleared:false,participants:uuids,'run-started-at':Date.now()-30000};
 await f.reader.capture();assert.equal(f.reader.all()[0].clearedUnits,null);
 d['dungeon-active-run'].cleared=true;await f.reader.capture();d['dungeon-active-run'].floor=4;d['dungeon-active-run'].cleared=false;await f.reader.capture();
 delete d['dungeon-active-run'];Object.assign(d,{'dungeon-last-run':Date.now()+5,'dungeon-last-outcome':'failed','dungeon-last-finish-floor':4,'dungeon-last-finish-reason':'party_defeated','dungeon-last-participants':uuids});
 await f.reader.capture();await f.reader.capture();const rows=f.reader.all();assert.equal(rows.length,1);assert.equal(rows[0].reachedUnits,4);assert.equal(rows[0].clearedUnits,3);assert.equal(rows[0].difficulty,'adventure');assert.equal(challengeScore(rows[0]),600);
});

test('an observation gap preserves an unknown result instead of making up a defeat',async t=>{
 const f=await fixture(t),d=f.documents['config.yml'];d['dungeon-active-run']={id:randomUUID(),floor:2,difficulty:'normal',participants:uuids,'run-started-at':Date.now()-30000};
 await f.reader.capture();delete d['dungeon-active-run'];await f.reader.capture();assert.equal(f.reader.all()[0].state,'interrupted');assert.equal(f.reader.all()[0].endedAt,null);assert.equal((await f.reader.query()).leaderboards[0].teams,0);
});

test('dungeon per-player outcomes group only by the same run, retain teammates and never downgrade a final outcome',async t=>{
 const f=await fixture(t),run=randomUUID(),end=Date.now()-1000,base={run,difficulty:'normal',startedAt:end-100000,endedAt:end,clearedRooms:3,requiredRooms:3,reason:'completed'};
 const site={outcomes:{[uuids[0]]:{crypt:base},[uuids[1]]:{crypt:{...base,endedAt:end-1000,clearedRooms:0,reason:'player_left'}}},'last-outcomes':{crypt:{...base}}};
 f.documents['config.yml']['site-dungeons']=site;await f.reader.capture();let rows=f.reader.all();assert.equal(rows.length,1);assert.deepEqual(rows[0].party,names);assert.equal(rows[0].state,'completed');assert.equal(challengeScore(rows[0]),800);
 site.outcomes[uuids[0]].crypt={...base,run:randomUUID(),endedAt:end+100,clearedRooms:0,reason:'party_defeated'};delete site['last-outcomes'].crypt;
 await f.reader.capture();rows=f.reader.all();assert.equal(rows.length,2);assert.equal(rows.find(r=>r.state==='completed').clearedUnits,3);
});

test('cleared rooms without the required return settlement are stage progress, not a full clear',async t=>{
 const f=await fixture(t);f.documents['config.yml']['site-dungeons']={outcomes:{[uuids[0]]:{crypt:{run:randomUUID(),difficulty:'normal',startedAt:Date.now()-10000,endedAt:Date.now()-1000,clearedRooms:3,reason:'return_grace_expired'}}}};
 const row=(await f.reader.snapshot()).runs[0];assert.equal(row.state,'ended');assert.equal(challengeScore(row),300);
});

test('paused dungeon faults remain visible as paused, not completed or rewarded',async t=>{
 const f=await fixture(t);f.documents['config.yml']['site-dungeons']={runs:{crypt:{id:randomUUID(),stage:1,mode:'normal',phase:'moving',fault:'data_unavailable',pausedAt:Date.now()-1000,party:uuids,started:Date.now()-60000}}};
 const row=(await f.reader.snapshot()).runs[0];assert.equal(row.state,'paused');assert.equal(row.clearedUnits,1);assert.equal(row.reason,'data_unavailable');assert.equal((await f.reader.query({activity:'crypt'})).leaderboards[0].teams,0);
});

test('cloud ignores caller scores/private extras and filters hidden identities',async t=>{
 const f=await fixture(t),cloud=new CloudChallenges(f.store,f.game),r=record();
 await cloud.accept(feed([{...r,score:999999,password:'private-do-not-publish',playerUuid:uuids[0],inventory:['secret']}]))
 const result=await cloud.query();assert.equal(result.leaderboards[0].rows[0].score,2000);const encoded=JSON.stringify(result);
 for(const privateValue of ['999999','private-do-not-publish',uuids[0],'inventory'])assert.ok(!encoded.includes(privateValue));
 f.game.config={hiddenPlayers:['ag_Hidden']};
 assert.equal((await cloud.accept(feed([record('b'.repeat(24),{party:['ag_Hidden']})]))).records,0);
});

test('offline teammates resolve only through saved UUIDs and retain their historical ranks',async t=>{
 const f=await fixture(t);f.game.roster=async()=>[];f.game.document=async()=>({data:[{name:'ag_Alpha',uuid:uuids[0]},{name:'LittleFish0510',uuid:uuids[1]}]});
 Object.assign(f.documents['config.yml'],{'dungeon-last-run':Date.now()-1000,'dungeon-last-outcome':'won','dungeon-last-finish-floor':15,'dungeon-last-finish-reason':'cleared','dungeon-last-participants':uuids});
 const row=(await f.reader.snapshot()).runs[0];assert.deepEqual(row.party,names);assert.equal(row.hiddenMembers,0);
 const cloud=new CloudChallenges(f.store,f.game);await cloud.accept(feed([record('d'.repeat(24),{party:names})]));assert.equal((await cloud.query()).leaderboards[0].teams,1);
});

test('older feed cannot roll back progress; omission never erases previously collected runs',async t=>{
 const f=await fixture(t),cloud=new CloudChallenges(f.store,f.game),one=feed([record()]);await cloud.accept(one);
 await cloud.accept({...feed([]),observedAt:one.observedAt});assert.equal((await cloud.query()).total,1);
 await assert.rejects(cloud.accept({...one,observedAt:new Date(Date.parse(one.observedAt)-1000).toISOString()}),e=>e.reason==='CHALLENGE_FEED_OLD');
 const reopened=new CloudChallenges(f.store,f.game);assert.equal((await reopened.query()).total,1);
});

test('rankings use one best score per exact team and difficulty, with tied ranks',async t=>{
 const f=await fixture(t),cloud=new CloudChallenges(f.store,f.game);
 await cloud.accept(feed([record('a'.repeat(24)),record('b'.repeat(24)),record('c'.repeat(24),{party:['LittleFish0510']}),record('d'.repeat(24),{difficulty:'adventure'})]));
 const result=await cloud.query();assert.equal(result.leaderboards[0].teams,2);assert.deepEqual(result.leaderboards[0].rows.map(r=>r.rank),[1,1]);assert.equal(result.leaderboards[1].rows[0].score,4000);
 assert.equal((await cloud.query({difficulty:'adventure'})).total,1);
});

test('inconsistent results, malformed party names and unbounded feeds fail atomically',async t=>{
 const f=await fixture(t),cloud=new CloudChallenges(f.store,f.game);
 for(const r of [record('a'.repeat(24),{clearedUnits:14}),record('a'.repeat(24),{party:['<script>']}),record('a'.repeat(24),{reachedUnits:99}),record('a'.repeat(24),{endedAt:null}),record('a'.repeat(24),{observedAt:0})])await assert.rejects(cloud.accept(feed([r])),e=>e.reason==='CHALLENGE_FEED_INVALID');
 await assert.rejects(cloud.accept(feed(Array(501).fill(record()))),e=>e.reason==='CHALLENGE_FEED_INVALID');assert.equal(cloud.all().length,0);
});

test('old smaller tower layouts keep their frozen per-run total instead of being rewritten as the new tower',async t=>{
 const f=await fixture(t),cloud=new CloudChallenges(f.store,f.game);await cloud.accept(feed([record('a'.repeat(24),{totalUnits:6,reachedUnits:6,clearedUnits:6})]));assert.equal((await cloud.query()).runs[0].totalUnits,6);
});

test('old best clears stay on the ranking after more than five thousand newer attempts',async t=>{
 const f=await fixture(t),cloud=new CloudChallenges(f.store,f.game);await cloud.accept(feed([record()]));
 f.store.db.exec('BEGIN IMMEDIATE');
 try{for(let i=1;i<=5001;i++)cloud.put(record(i.toString(16).padStart(24,'0'),{state:'ended',clearedUnits:1,reason:'party_defeated',endedAt:new Date().toISOString(),observedAt:new Date().toISOString()}));f.store.db.exec('COMMIT');}catch(e){f.store.db.exec('ROLLBACK');throw e;}
 const result=await cloud.query();assert.equal(result.total,5002);assert.equal(result.runs.length,20);assert.equal(result.leaderboards[0].rows[0].score,2000);assert.equal(result.leaderboards[0].teams,1);assert.equal(result.pages,251);
});

test('late terminal metadata cannot downgrade an already verified full clear',async t=>{
 const f=await fixture(t),cloud=new CloudChallenges(f.store,f.game),r=record();await cloud.accept(feed([r]));
 await cloud.accept(feed([{...r,state:'ended',clearedUnits:1,reason:'party_defeated',observedAt:new Date().toISOString()}]));assert.equal((await cloud.query()).runs[0].state,'completed');
});

test('unreadable game saves keep the journal and mark synchronization unavailable',async t=>{
 const f=await fixture(t);f.documents['config.yml']['site-dungeons']={outcomes:{[uuids[0]]:{crypt:{run:randomUUID(),difficulty:'normal',startedAt:Date.now()-10000,endedAt:Date.now()-1000,clearedRooms:1,reason:'party_defeated'}}}};
 await f.reader.capture();f.documents['config.yml']=null;const snapshot=await f.reader.snapshot();assert.equal(snapshot.available,false);assert.equal(snapshot.runs.length,1);
});

test('an unavailable empty feed keeps the last known challenge catalogue and scores',async t=>{
 const f=await fixture(t),cloud=new CloudChallenges(f.store,f.game);await cloud.accept(feed([record()]));
 await cloud.accept({...feed([]),activities:[],available:false});const result=await cloud.query();assert.equal(result.activities[0].id,'trial_tower');assert.equal(result.runs[0].score,2000);assert.equal(result.sync.stale,true);
});

test('real HTTP public challenge access stays read-only while ingestion requires the existing server credential',async t=>{
 const token='srv_'+'f'.repeat(43),f=await siteFixture(t,{sourceMode:'cloud',cloudSync:{enabled:true,tokenHash:digest(token)}});
 const put=(body,credential=token,extra={})=>fetch(f.origin+'/api/v1/internal/challenges',{method:'PUT',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 assert.equal((await put(feed([record()]),'wrong')).status,401);
 assert.equal((await put(feed([record()]),token,{Origin:f.origin})).status,403);
 assert.equal((await put(feed([record()]))).status,200);
 const r=await fetch(f.origin+'/api/v1/challenges'),value=await r.json();assert.equal(r.status,200);assert.equal(value.runs[0].score,2000);
 assert.equal((await fetch(f.origin+'/api/v1/challenges?page=-1')).status,400);assert.equal((await fetch(f.origin+'/api/v1/challenges?activity=missing')).status,404);
 assert.equal((await f.admin.request('/game-capabilities')).data.ready,false);
});
