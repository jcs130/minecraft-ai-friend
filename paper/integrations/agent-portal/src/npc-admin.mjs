const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const error = (status, reason) => Object.assign(Error(reason), {status, reason});
const line = (s, max) => typeof s === 'string' && s.trim().length > 0 && [...s].length <= max && !/[\x00-\x1f\x7f]/.test(s);
export function npcProfile(input) {
  if (!input || Object.keys(input).sort().join() !== 'appearance,autonomous,brain,mapVisible,name,persona,voice'
      || !line(input.name,24) || !line(input.persona,1200)
      || !/^[a-z][a-z0-9_-]{0,23}$/.test(input.brain) || !/^[a-z][a-z0-9_-]{0,31}$/.test(input.voice)
      || !/^[a-z][a-z0-9_-]{0,31}$/.test(input.appearance)
      || typeof input.autonomous !== 'boolean' || typeof input.mapVisible !== 'boolean') throw error(400,'NPC_PROFILE_INVALID');
  return Object.fromEntries(['name','persona','brain','voice','appearance','autonomous','mapVisible'].map(k=>[k,input[k]]));
}
export function npcCatalogue(value, now=Date.now()) {
  const at=Date.parse(value?.observedAt);
  if(value?.schemaVersion!==1 || !Number.isFinite(at) || Math.abs(now-at)>30000 || !Array.isArray(value.residents) || value.residents.length>24) throw error(400,'NPC_SNAPSHOT_INVALID');
  const ids=new Set();
  const residents=value.residents.map(r=>{
    if(!uuid.test(r.id)||ids.has(r.id)||!Number.isSafeInteger(r.revision)||r.revision<0||typeof r.loaded!=='boolean'
       ||!line(r.profession,32)||!Array.isArray(r.brains)||!r.brains.length||r.brains.length>8||!Array.isArray(r.voices)||r.voices.length>34
       ||!r.brains.every(b=>/^[a-z][a-z0-9_-]{0,23}$/.test(b.id)&&line(b.model,128))
       ||!Array.isArray(r.models)||!r.models.length||r.models.length>33||!r.models.every(m=>/^[a-z][a-z0-9_-]{0,31}$/.test(m.id)&&line(m.label,48))
       ||!r.voices.every(v=>/^[a-z][a-z0-9_-]{0,31}$/.test(v))||!line(r.currentBrain,32))throw error(400,'NPC_SNAPSHOT_INVALID');
    ids.add(r.id);
    return {id:r.id,revision:r.revision,profile:npcProfile(r.profile),loaded:r.loaded,profession:r.profession,
      brains:r.brains.map(b=>({id:b.id,model:b.model})),voices:[...r.voices],models:r.models.map(m=>({id:m.id,label:m.label})),currentBrain:r.currentBrain};
  });
  return {schemaVersion:1,observedAt:new Date(at).toISOString(),residents};
}
export class NpcAdmin {
  constructor(store,{now=Date.now}={}) {
    this.store=store;this.db=store.db;this.now=now;
    this.db.exec(`CREATE TABLE IF NOT EXISTS npc_admin_jobs(id TEXT PRIMARY KEY, npc_id TEXT NOT NULL, owner_id TEXT NOT NULL, input TEXT NOT NULL, state TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS npc_admin_snapshot(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);`);
  }
  state() {
    const row=this.db.prepare('SELECT body FROM npc_admin_snapshot WHERE id=1').get();
    const value=row?JSON.parse(row.body):{schemaVersion:1,observedAt:null,residents:[]};
    return {...value,available:!!row&&this.now()-Date.parse(value.observedAt)<30000,
      jobs:this.db.prepare('SELECT id,npc_id,state,result,created_at FROM npc_admin_jobs ORDER BY created_at DESC LIMIT 32').all().map(r=>({requestId:r.id,id:r.npc_id,status:r.state,result:r.result?JSON.parse(r.result):null,createdAt:r.created_at}))};
  }
  enqueue(owner,id,input) {
    if(owner?.role!=='admin')throw error(403,'ADMIN_REQUIRED');
    if(!uuid.test(id)||!uuid.test(input?.requestId)||!Number.isSafeInteger(input.revision)||input.revision<0||Object.keys(input).sort().join()!=='profile,requestId,revision')throw error(400,'NPC_REQUEST_INVALID');
    const data={requestId:input.requestId,id,revision:input.revision,profile:npcProfile(input.profile)};
    const encoded=JSON.stringify(data),old=this.db.prepare('SELECT * FROM npc_admin_jobs WHERE id=?').get(data.requestId);
    if(old){if(old.owner_id!==owner.id||old.input!==encoded)throw error(409,'REQUEST_ID_CONFLICT');return {requestId:old.id,status:old.state};}
    const state=this.state(),npc=state.residents.find(r=>r.id===id);
    if(!state.available||!npc)throw error(503,'NPC_SOURCE_UNAVAILABLE');
    if(npc.revision!==data.revision)throw error(409,'NPC_REVISION_CHANGED');
    if(!npc.brains.some(b=>b.id===data.profile.brain)||!npc.voices.includes(data.profile.voice)||!npc.models.some(m=>m.id===data.profile.appearance))throw error(400,'NPC_OPTION_NOT_CONFIGURED');
    if(this.db.prepare("SELECT id FROM npc_admin_jobs WHERE npc_id=? AND state IN ('queued','dispatched','unknown','waiting_body')").get(id))throw error(409,'NPC_REQUEST_PENDING_READ_ORIGINAL');
    this.db.prepare('INSERT INTO npc_admin_jobs VALUES(?,?,?,?,?,?,?)').run(data.requestId,id,owner.id,encoded,'queued',null,this.now());
    this.store.audit(owner.id,'npc.profile.request',id);
    return {requestId:data.requestId,status:'queued',completed:false};
  }
  poll(input) {
    const snapshot=npcCatalogue(input?.catalogue,this.now());
    if(!Array.isArray(input.results)||input.results.length>8)throw error(400,'NPC_RESULTS_INVALID');
    const checked=input.results.map(r=>{
      if(!uuid.test(r?.requestId)||!uuid.test(r.id)||!['applied','failed','unknown','waiting_body'].includes(r.status)
          ||typeof r.completed!=='boolean'||r.completed!==(r.status==='applied')||!/^[a-z0-9_:-]{1,120}$/.test(r.reason))throw error(400,'NPC_RESULT_INVALID');
      return {requestId:r.requestId,id:r.id,status:r.status,completed:r.completed,reason:r.reason};
    });
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('INSERT OR REPLACE INTO npc_admin_snapshot VALUES(1,?)').run(JSON.stringify(snapshot));
      const acknowledged=[];
      for(const r of checked){
        const job=this.db.prepare('SELECT * FROM npc_admin_jobs WHERE id=? AND npc_id=?').get(r.requestId,r.id);
        if(!job)continue;
        if(['applied','failed'].includes(job.state)){acknowledged.push(job.id);continue;}
        if(job.state==='queued')throw error(409,'NPC_RESULT_BEFORE_DISPATCH');
        const wanted=JSON.parse(job.input),actual=snapshot.residents.find(n=>n.id===r.id);
        if(r.status==='applied'&&(!actual||actual.revision!==wanted.revision+1||JSON.stringify(actual.profile)!==JSON.stringify(wanted.profile)||actual.currentBrain!==wanted.profile.brain))throw error(409,'NPC_APPLIED_STATE_MISMATCH');
        this.db.prepare('UPDATE npc_admin_jobs SET state=?,result=? WHERE id=?').run(r.status,JSON.stringify(r),job.id);acknowledged.push(job.id);
      }
      const job=this.db.prepare("SELECT * FROM npc_admin_jobs WHERE state IN ('queued','dispatched','unknown','waiting_body') ORDER BY CASE WHEN state='queued' THEN 0 ELSE 1 END,created_at LIMIT 1").get();
      const requests=job?[{...JSON.parse(job.input),reconcileOnly:job.state!=='queued'}]:[];
      if(job?.state==='queued')this.db.prepare("UPDATE npc_admin_jobs SET state='dispatched' WHERE id=?").run(job.id);
      this.db.exec('COMMIT');return {acknowledged,requests};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
}
