import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {playerNameValid} from './world-catalog.mjs';

export const difficulties = {normal:'普通',adventure:'冒险',apocalypse:'末日'};
const weights = {normal:1,adventure:2,apocalypse:3};
const fail = (reason,message,status=400) => Object.assign(Error(message),{status,reason});
const bounded = (value,max=64) => Number.isInteger(value)&&value>=0&&value<=max ? value : null;
const text = (value,max=100) => typeof value==='string' ? value.replace(/§[0-9a-fk-or]/gi,'').replace(/[\u0000-\u001f]/g,'').slice(0,max) : '';
const stamp = value => Number.isSafeInteger(value)&&value>0&&value<=Date.now()+30000 ? new Date(value).toISOString() : null;
const hash = value => createHash('sha256').update(value).digest('hex').slice(0,24);
const mode = value => Object.hasOwn(difficulties,value) ? value : null;
const unique = values => [...new Set(values)].sort((a,b)=>a.localeCompare(b));
const validActivity = value => typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value);

/** Website progress score, not an imported game score. No speed/kill guesses. */
export function challengeScore(run) {
  return mode(run.difficulty)&&bounded(run.clearedUnits)!==null ? (run.clearedUnits*100+(run.state==='completed'?500:0))*weights[run.difficulty] : null;
}

function visibleRun(run,names) {
  const party=run.party.filter(name=>names.has(name));
  return party.length ? {...run,party,hiddenMembers:run.hiddenMembers+run.party.length-party.length,score:challengeScore(run)} : null;
}

export class ChallengeLedger {
  constructor(store,game) {
    this.store=store;this.game=game;
    store.db.exec(`CREATE TABLE IF NOT EXISTS public_challenge_runs(id TEXT PRIMARY KEY,activity_id TEXT NOT NULL,state TEXT NOT NULL,ended_at TEXT,observed_at TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS challenge_activity ON public_challenge_runs(activity_id,ended_at,observed_at);
      CREATE TABLE IF NOT EXISTS challenge_feed(id INTEGER PRIMARY KEY CHECK(id=1),received_at INTEGER NOT NULL,payload TEXT NOT NULL);`);
  }
  get(id) { const row=this.store.db.prepare('SELECT payload FROM public_challenge_runs WHERE id=?').get(id);return row?JSON.parse(row.payload):null; }
  put(row) {
    const payload=JSON.stringify(row);
    this.store.db.prepare(`INSERT INTO public_challenge_runs VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,ended_at=excluded.ended_at,observed_at=excluded.observed_at,payload=excluded.payload WHERE payload<>excluded.payload`).run(row.id,row.activityId,row.state,row.endedAt,row.observedAt,payload);
  }
  all(limit=5000) { return this.store.db.prepare('SELECT payload FROM public_challenge_runs ORDER BY coalesce(ended_at,observed_at) DESC,id DESC LIMIT ?').all(limit).map(row=>JSON.parse(row.payload)); }
  metadata() {const row=this.store.db.prepare('SELECT * FROM challenge_feed WHERE id=1').get();return row?{...JSON.parse(row.payload),receivedAt:row.received_at}:null;}
  saveMetadata(value) {this.store.db.prepare('INSERT OR REPLACE INTO challenge_feed VALUES(1,?,?)').run(Date.now(),JSON.stringify(value));}
  async visibility() {
    // Offline players retain public history. This trusted feed proves a game
    // participation, not account ownership or access to someone's inventory.
    const excluded=new Set(this.store.db.prepare('SELECT name FROM archived_test_roles').all().map(r=>r.name.toLowerCase()));
    for(const name of this.game.config?.hiddenPlayers||[])excluded.add(String(name).toLowerCase());
    for(const r of await this.game.roster())if(r.kind==='observer')excluded.add(r.name.toLowerCase());
    excluded.add('live');
    return {excluded,has:name=>playerNameValid(name)&&!/eye$/i.test(name)&&!excluded.has(name.toLowerCase())};
  }
  async query({activity='trial_tower',difficulty='all',page=1}={}) {
    if(!validActivity(activity)||difficulty!=='all'&&!mode(difficulty)||!Number.isInteger(page)||page<1||page>1000)throw fail('INVALID_CHALLENGE_FILTER','请选择有效的挑战、难度与页码。');
    const meta=this.metadata(),activities=meta?.activities||[],selected=activities.find(row=>row.id===activity);
    if(activities.length&&!selected)throw fail('CHALLENGE_NOT_FOUND','这个挑战尚未收录，请从挑战目录选择。',404);
    const names=await this.visibility(),excluded=[...names.excluded],slots=excluded.map(()=>'?').join(',');
    const where=`activity_id=? AND (?='all' OR json_extract(payload,'$.difficulty')=?) AND EXISTS(SELECT 1 FROM json_each(payload,'$.party') WHERE lower(value) NOT LIKE '%eye' ${slots?'AND lower(value) NOT IN ('+slots+')':''})`;
    const args=[activity,difficulty,difficulty,...excluded];
    const summary=this.store.db.prepare(`SELECT count(*) AS records,coalesce(sum(state='completed'),0) AS completed,coalesce(sum(state IN ('active','paused')),0) AS active FROM public_challenge_runs WHERE ${where}`).get(...args);
    const rows=this.store.db.prepare(`SELECT payload FROM public_challenge_runs WHERE ${where} ORDER BY coalesce(ended_at,observed_at) DESC,id DESC LIMIT 20 OFFSET ?`).all(...args,(page-1)*20).map(r=>visibleRun(JSON.parse(r.payload),names)).filter(Boolean);
    // Select each team's best across the complete ledger before limiting the
    // displayed ranking. Old champions must not fall out of a recent-page cap.
    const best=this.store.db.prepare(`WITH scored AS (
      SELECT payload,ended_at,(json_extract(payload,'$.clearedUnits')*100+CASE WHEN state='completed' THEN 500 ELSE 0 END)*CASE json_extract(payload,'$.difficulty') WHEN 'normal' THEN 1 WHEN 'adventure' THEN 2 WHEN 'apocalypse' THEN 3 END AS score
      FROM public_challenge_runs WHERE ${where} AND state IN ('completed','ended') AND json_extract(payload,'$.clearedUnits') IS NOT NULL AND json_extract(payload,'$.difficulty') IN ('normal','adventure','apocalypse')
    ), ranked AS (SELECT payload,row_number() OVER(PARTITION BY json_extract(payload,'$.difficulty'),json_extract(payload,'$.party'),json_extract(payload,'$.hiddenMembers') ORDER BY score DESC,ended_at ASC) AS choice FROM scored)
      SELECT payload FROM ranked WHERE choice=1`).all(...args).map(r=>visibleRun(JSON.parse(r.payload),names)).filter(Boolean);
    const leaders=[];
    for(const level of Object.keys(difficulties).filter(id=>difficulty==='all'||difficulty===id)) {
      const teams=new Map();
      for(const run of best.filter(r=>r.difficulty===level)) {
        const key=JSON.stringify([run.party,run.hiddenMembers]);const before=teams.get(key);
        if(!before||run.score>before.score||run.score===before.score&&(run.endedAt||'')<(before.endedAt||''))teams.set(key,run);
      }
      const ranked=[...teams.values()].sort((a,b)=>b.score-a.score||b.clearedUnits-a.clearedUnits||a.party.join().localeCompare(b.party.join()));
      leaders.push({difficulty:level,label:difficulties[level],teams:ranked.length,rows:ranked.slice(0,20).map((r,i)=>({...r,rank:1+ranked.filter(other=>other.score>r.score).length}))});
    }
    return {schemaVersion:1,serverId:'qiandengji',activities,activity:selected||null,difficulty,leaderboards:leaders,
      runs:rows,page,pages:Math.max(1,Math.ceil(summary.records/20)),total:summary.records,summary,
      available:meta?.available===true,observedAt:meta?.observedAt||null,source:'AgentFriend.saved-challenge-records',
      sync:{stale:!meta||Date.now()-Date.parse(meta.observedAt)>45000||meta.available!==true},
      historyNotice:'收录服务器仍保存的历史结果及接入后观察到的场次；更早的记录可能不完整。',
      scoreRule:'网站挑战积分：每通关一层／一室100分，完整结算另加500分；普通×1、冒险×2、末日×3。缺少难度或通关证据时不计分。',scoreVersion:'progress-v1'};
  }
}

/** Exact final-floor reward + finish lines in one file, at the persisted end.
 * Never infer difficulty from a player's current selection or unrelated runs.
 * Read only the dated archive(s) once per outcome; do not tail all logs per poll. */
export async function towerDifficultyProof(serverDir,endedAt,floor) {
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(endedAt));
  const directory=path.join(serverDir,'logs');let files;
  try {files=(await fs.readdir(directory)).filter(name=>new RegExp('^'+day+'-\\d+\\.log\\.gz$').test(name)).sort().slice(-12);files.push('latest.log');}catch{return null;}
  const prefix='^\\[(\\d{2}:\\d{2}:\\d{2})\\] \\[Server thread/INFO\\]: \\[AgentFriend\\] ';
  const reward=new RegExp(prefix+'Dungeon floor reward: floor=(\\d+), difficulty=(normal|adventure|apocalypse), credited=\\d+$');
  const finished=new RegExp(prefix+'Dungeon finished: won=true, floor=(\\d+), reason=cleared, remaining=0, message=');
  const time=clock=>Date.parse(day+'T'+clock+'+08:00');
  for(const name of files)try{
    const file=path.join(directory,name),stat=await fs.stat(file);if(stat.size>8*1024*1024)continue;
    if(name==='latest.log'&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(stat.mtime)!==day)continue;
    const bytes=await fs.readFile(file),body=name.endsWith('.gz')?gunzipSync(bytes,{maxOutputLength:32*1024*1024}).toString('utf8'):bytes.toString('utf8');
    let last;
    for(const line of body.split(/\r?\n/)) {
      const r=reward.exec(line);if(r&&Number(r[2])===floor)last={at:time(r[1]),difficulty:r[3]};
      const end=finished.exec(line);
      if(end&&Number(end[2])===floor&&Math.abs(time(end[1])-endedAt)<=2000&&last&&time(end[1])-last.at>=0&&time(end[1])-last.at<=2000)return last.difficulty;
      if(end)last=null;
    }
  }catch{/* Missing/rotated archive leaves the historical difficulty unknown. */}
  return null;
}

export class SavedChallenges extends ChallengeLedger {
  constructor(config,game,store) {super(store,game);this.config=config;this.proofs=new Map();this.pending=null;store.db.exec('CREATE TABLE IF NOT EXISTS challenge_source_members(run_id TEXT NOT NULL,player_uuid TEXT NOT NULL,PRIMARY KEY(run_id,player_uuid))');}
  async capture() {
    if(this.pending)return this.pending;
    this.pending=this.collect().finally(()=>{this.pending=null;});return this.pending;
  }
  async collect() {
    const [document,definition,roster,cache]=await Promise.all([this.game.plugin('config.yml'),this.game.plugin('dungeons.yml'),this.game.roster(),this.game.document?this.game.document(path.join(this.config.serverDir,'usercache.json')):{data:null}]);
    const data=document.data,observedAt=new Date().toISOString();
    if(!data) {const previous=this.metadata();this.saveMetadata({schemaVersion:1,activities:previous?.activities||[],gameSavedAt:previous?.gameSavedAt||null,available:false,observedAt});return {available:false};}
    const observers=new Set(roster.filter(r=>r.kind==='observer').map(r=>r.name.toLowerCase()));
    const hiddenNames=new Set((this.config.hiddenPlayers||[]).map(n=>n.toLowerCase()));
    const names=new Map((Array.isArray(cache.data)?cache.data:[]).filter(r=>playerNameValid(r.name)&&typeof r.uuid==='string'&&/^[a-f0-9-]{36}$/.test(r.uuid)&&!/eye$/i.test(r.name)&&r.name.toLowerCase()!=='live'&&!observers.has(r.name.toLowerCase())&&!hiddenNames.has(r.name.toLowerCase())).map(r=>[r.uuid,r.name]));
    for(const r of roster)if(r.available&&r.kind!=='observer'&&r.playerUuid)names.set(r.playerUuid,r.name);
    const party=ids=>unique((Array.isArray(ids)?ids:[]).map(id=>names.get(id)).filter(Boolean));
    const hidden=ids=>unique(Array.isArray(ids)?ids:[]).filter(id=>!names.has(id)).length;
    const towerMax=data['dungeon-challenge-built']===true?15:data['dungeon-expanded']===true?10:6;
    const activities=[{id:'trial_tower',type:'tower',name:'试炼塔',unit:'层',totalUnits:towerMax}];
    for(const [id,row] of Object.entries(definition.data?.sites||{}).slice(0,32))if(validActivity(id)&&Array.isArray(row.rooms)&&row.rooms.length>0&&row.rooms.length<=64)activities.push({id,type:'dungeon',name:text(row.name)||id,unit:'室',totalUnits:row.rooms.length});
    if(!definition.data)activities.push(...(this.metadata()?.activities||[]).filter(a=>a.type==='dungeon'));
    const save=(row,ids=[])=>{
      // Private source identities keep a later public name from being counted
      // both as a named teammate and an old "unpublished teammate" placeholder.
      for(const id of ids)if(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id))this.store.db.prepare('INSERT OR IGNORE INTO challenge_source_members VALUES(?,?)').run(row.id,id);
      const members=this.store.db.prepare('SELECT player_uuid FROM challenge_source_members WHERE run_id=?').all(row.id).map(r=>r.player_uuid);
      if(members.length)row={...row,party:party(members),hiddenMembers:hidden(members)};
      if(row.party.length)this.put(row);
    };
    const finalTime=data['dungeon-last-run'],finalFloor=bounded(data['dungeon-last-finish-floor'],towerMax),finalParty=party(data['dungeon-last-participants']);
    if(stamp(finalTime)&&finalFloor!==null&&finalParty.length&&['won','failed'].includes(data['dungeon-last-outcome'])) {
      const ended=stamp(finalTime),legacyId=hash('tower-end:'+finalTime);
      let previous=this.all().find(r=>r.activityId==='trial_tower'&&r.endedAt===ended);
      if(!previous)previous=this.all().find(r=>r.activityId==='trial_tower'&&['active','paused'].includes(r.state)&&Date.parse(r.observedAt)<=finalTime&&finalTime-Date.parse(r.observedAt)<90000&&JSON.stringify(r.party)===JSON.stringify(finalParty));
      const completed=data['dungeon-last-outcome']==='won'&&finalFloor>0;
      const runTotal=completed?finalFloor:previous?.totalUnits||towerMax;
      let difficulty=previous?.difficulty||null;
      if(!difficulty&&completed) {
        if(!this.proofs.has(finalTime)){if(this.proofs.size>32)this.proofs.clear();this.proofs.set(finalTime,await towerDifficultyProof(this.config.serverDir,finalTime,finalFloor));}
        difficulty=this.proofs.get(finalTime);
      }
      save({id:previous?.id||legacyId,activityId:'trial_tower',state:completed?'completed':'ended',difficulty,
        reachedUnits:finalFloor,clearedUnits:completed?finalFloor:previous?.clearedUnits??null,totalUnits:runTotal,
        party:unique([...previous?.party||[],...finalParty]),hiddenMembers:Math.max(previous?.hiddenMembers||0,hidden(data['dungeon-last-participants'])),
        startedAt:previous?.startedAt||null,endedAt:ended,observedAt:ended,reason:text(data['dungeon-last-finish-reason'],64)||'unknown',
        evidence:previous?.startedAt?'saved-checkpoint+outcome':difficulty?'saved-outcome+exact-log':'saved-outcome'},data['dungeon-last-participants']);
    }
    const active=data['dungeon-active-run'];
    let activeTower;
    if(active&&typeof active.id==='string'&&bounded(active.floor,towerMax)>0) {
      const id=hash('tower:'+active.id),before=this.get(id);activeTower=id;
      save({id,activityId:'trial_tower',state:active['paused-at']>0?'paused':'active',difficulty:mode(active.difficulty),reachedUnits:active.floor,
        clearedUnits:active.cleared===true?Math.max(before?.clearedUnits||0,active.floor):before?.clearedUnits??null,totalUnits:towerMax,
        party:unique([...before?.party||[],...party(active.participants)]),hiddenMembers:Math.max(before?.hiddenMembers||0,hidden(active.participants)),
        startedAt:stamp(active['run-started-at']),endedAt:null,observedAt,reason:active['paused-at']>0?'waiting_reconnect':null,evidence:'saved-checkpoint'},active.participants);
    }
    for(const row of this.all().filter(r=>r.activityId==='trial_tower'&&['active','paused'].includes(r.state)&&r.id!==activeTower))save({...row,state:'interrupted',reason:'observation_gap'});
    const sites=data['site-dungeons']||{},groups=new Map();
    for(const [uuid,entries] of Object.entries(sites.outcomes||{}))for(const [site,row] of Object.entries(entries||{})) {
      if(!activities.some(a=>a.id===site)||typeof row.run!=='string'||!stamp(row.endedAt))continue;
      const key=site+':'+row.run,group=groups.get(key)||{site,run:row.run,rows:[],ids:[]};group.rows.push(row);group.ids.push(uuid);groups.set(key,group);
    }
    for(const g of groups.values()) {
      const activity=activities.find(a=>a.id===g.site),id=hash('site:'+g.site+':'+g.run),before=this.get(id),last=sites['last-outcomes']?.[g.site];
      const rows=g.rows.sort((a,b)=>b.endedAt-a.endedAt),end=last?.run===g.run?last:rows[0];
      if(before?.endedAt&&Date.parse(before.endedAt)>end.endedAt)continue;
      const cleared=Math.max(...rows.map(r=>bounded(r.clearedRooms,activity.totalUnits)??0),before?.clearedUnits||0,bounded(end.clearedRooms,activity.totalUnits)??0);
      const modes=unique(rows.map(r=>mode(r.difficulty)).filter(Boolean));
      save({id,activityId:g.site,state:end.reason==='completed'&&cleared===activity.totalUnits?'completed':'ended',difficulty:before?.difficulty||(modes.length===1?modes[0]:null),
        reachedUnits:Math.min(activity.totalUnits,cleared+1),clearedUnits:cleared,totalUnits:activity.totalUnits,
        party:unique([...before?.party||[],...party(g.ids)]),hiddenMembers:Math.max(before?.hiddenMembers||0,hidden(g.ids)),
        startedAt:before?.startedAt||stamp(Math.min(...rows.map(r=>r.startedAt).filter(Number.isSafeInteger))),endedAt:stamp(end.endedAt),observedAt:stamp(end.endedAt),reason:text(end.reason,64)||'unknown',evidence:'saved-outcome'},g.ids);
    }
    const activeSites=new Set();
    for(const [site,r] of Object.entries(sites.runs||{})) {
      const activity=activities.find(a=>a.id===site);if(!activity||typeof r.id!=='string'||bounded(r.stage,activity.totalUnits)===null)continue;
      const id=hash('site:'+site+':'+r.id),before=this.get(id);activeSites.add(id);
      save({id,activityId:site,state:r.pausedAt>0?'paused':'active',difficulty:mode(r.mode),reachedUnits:Math.min(activity.totalUnits,r.stage+1),clearedUnits:Math.max(r.stage,before?.clearedUnits||0),totalUnits:activity.totalUnits,
        party:unique([...before?.party||[],...party(r.party)]),hiddenMembers:Math.max(before?.hiddenMembers||0,hidden(r.party)),
        startedAt:stamp(r.started),endedAt:null,observedAt,reason:text(r.fault,64)||text(r.pauseReason,64)||null,evidence:'saved-checkpoint'},r.party);
    }
    for(const row of this.all().filter(r=>r.activityId!=='trial_tower'&&['active','paused'].includes(r.state)&&!activeSites.has(r.id)))save({...row,state:'interrupted',reason:'observation_gap'});
    this.saveMetadata({schemaVersion:1,available:!!definition.data,activities,observedAt,definitionSavedAt:definition.savedAt,gameSavedAt:document.savedAt});
    return {available:true};
  }
  async snapshot() {await this.capture();return {...this.metadata(),runs:this.all(500)};}
  async query(options) {await this.capture();return super.query(options);}
}

export class CloudChallenges extends ChallengeLedger {
  async accept(input) {
    if(input?.schemaVersion!==1||typeof input.available!=='boolean'||typeof input.observedAt!=='string'||!Number.isFinite(Date.parse(input.observedAt))||Math.abs(Date.now()-Date.parse(input.observedAt))>120000||!Array.isArray(input.activities)||input.activities.length>33||!Array.isArray(input.runs)||input.runs.length>500)throw fail('CHALLENGE_FEED_INVALID','挑战同步格式无效。');
    const previous=this.metadata();if(previous&&Date.parse(input.observedAt)<Date.parse(previous.observedAt))throw fail('CHALLENGE_FEED_OLD','旧挑战快照已拒绝。',409);
    const activities=input.activities.map(a=>{if(!validActivity(a.id)||!['tower','dungeon'].includes(a.type)||typeof a.name!=='string'||a.name.length>100||bounded(a.totalUnits)===null||a.totalUnits<1)throw fail('CHALLENGE_FEED_INVALID','挑战目录无效。');return {id:a.id,type:a.type,name:text(a.name),unit:a.type==='tower'?'层':'室',totalUnits:a.totalUnits};});
    if(!activities.length&&input.available===false)activities.push(...previous?.activities||[]);
    if(new Set(activities.map(a=>a.id)).size!==activities.length)throw fail('CHALLENGE_FEED_INVALID','挑战目录重复。');
    const names=await this.visibility(),ids=new Set();
    const runs=input.runs.map(r=>{
      const activity=activities.find(a=>a.id===r.activityId);
      if(!activity||!/^[a-f0-9]{24}$/.test(r.id||'')||ids.has(r.id)||!['active','paused','completed','ended','interrupted'].includes(r.state)||r.difficulty!==null&&!mode(r.difficulty)||!Array.isArray(r.party)||r.party.length>24||r.party.some(n=>!playerNameValid(n))||new Set(r.party.map(n=>n.toLowerCase())).size!==r.party.length||bounded(r.hiddenMembers,24)===null||r.party.length+r.hiddenMembers>24||bounded(r.totalUnits)===null||r.totalUnits<1)throw fail('CHALLENGE_FEED_INVALID','挑战场次身份或类型无效。');
      for(const k of ['reachedUnits','clearedUnits'])if(r[k]!==null&&bounded(r[k],r.totalUnits)===null)throw fail('CHALLENGE_FEED_INVALID','挑战进度越界。');
      for(const k of ['startedAt','endedAt','observedAt'])if(r[k]!==null&&(typeof r[k]!=='string'||!Number.isFinite(Date.parse(r[k]))||Date.parse(r[k])>Date.now()+30000))throw fail('CHALLENGE_FEED_INVALID','挑战时间无效。');
      if(r.startedAt&&r.endedAt&&Date.parse(r.startedAt)>Date.parse(r.endedAt)||r.clearedUnits!==null&&r.reachedUnits!==null&&r.clearedUnits>r.reachedUnits)throw fail('CHALLENGE_FEED_INVALID','挑战时间或层数顺序不一致。');
      if(!r.observedAt||r.state==='completed'&&(r.clearedUnits!==r.totalUnits||!r.endedAt)||['active','paused'].includes(r.state)&&r.endedAt)throw fail('CHALLENGE_FEED_INVALID','挑战结算与进度不一致。');
      ids.add(r.id);
      const iso=value=>value===null?null:new Date(value).toISOString();
      return visibleRun({id:r.id,activityId:r.activityId,state:r.state,difficulty:r.difficulty,reachedUnits:r.reachedUnits,clearedUnits:r.clearedUnits,totalUnits:r.totalUnits,party:unique(r.party),hiddenMembers:r.hiddenMembers,startedAt:iso(r.startedAt),endedAt:iso(r.endedAt),observedAt:iso(r.observedAt),reason:text(r.reason,64)||null,evidence:['saved-outcome','saved-checkpoint','saved-checkpoint+outcome','saved-outcome+exact-log'].includes(r.evidence)?r.evidence:'saved-outcome'},names);
    }).filter(Boolean).map(({score,...r})=>r);
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      for(const r of runs){
        const old=this.get(r.id);
        const regresses=old&&(old.state==='completed'&&r.state!=='completed'||old.clearedUnits!==null&&(r.clearedUnits===null||r.clearedUnits<old.clearedUnits));
        if(!regresses&&(!old||(!old.endedAt||r.endedAt)&&r.observedAt>=old.observedAt))this.put(r);
      }
      this.saveMetadata({schemaVersion:1,available:input.available,activities,observedAt:new Date(input.observedAt).toISOString(),gameSavedAt:typeof input.gameSavedAt==='string'&&Number.isFinite(Date.parse(input.gameSavedAt))?new Date(input.gameSavedAt).toISOString():null});
      this.store.db.exec('COMMIT');
    }catch(e){this.store.db.exec('ROLLBACK');throw e;}
    return {accepted:true,records:runs.length,observedAt:input.observedAt};
  }
}
