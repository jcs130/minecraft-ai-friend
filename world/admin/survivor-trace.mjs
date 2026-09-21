import fs from 'node:fs/promises';
import path from 'node:path';
import { freshness } from './read-model.mjs';

const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const list = v => Array.isArray(v) ? v : [];
const text = (v, n = 160) => typeof v === 'string' ? v.slice(0, n) : null;
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v) ? v : null;
const stamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const elapsed = (a, b) => a !== null && b !== null && b >= a ? b - a : null;
const position = v => Object.fromEntries(['x','y','z'].map(k => [k, num(v?.[k])]));
const counts = v => Object.fromEntries(Object.entries(object(v)).filter(([k,n]) => /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(k) && num(n) !== null).slice(0,80));
function body(v) {
  if (v?.ok !== true) return null;
  return { observedAt: num(v.observedAt), hp: num(v.hp), hunger: num(v.hunger),
    position: position(v.position), dimension: text(v.dimension), inventory: counts(v.counts) };
}
const argumentKeys = new Set(['x','y','z','item_id','item','count','amount','action','slot','button','hold_ticks','target','target_id','entity_uuid','task_id','name','version','radius','distance','dimension','recipe_id','quest_id','face','hand','sneak','duration','seconds']);
function args(v) {
  return Object.fromEntries(Object.entries(object(v)).filter(([k,v]) => argumentKeys.has(k)
    && (typeof v === 'boolean' || num(v) !== null || typeof v === 'string')).slice(0,24)
    .map(([k,v]) => [k, typeof v === 'string' ? v.slice(0,240) : v]));
}
export function projectTraceAction(raw) {
  const r = object(raw), start = num(r.acceptedAt), observed = num(r.observedAt);
  const confirmed = r.completionConfirmed === true;
  const state = ['completed','failed','rejected','accepted','pending','in_flight','unknown','observed_ended'].includes(r.status) ? r.status : 'unknown';
  const before = body(r.before), after = body(r.after);
  const comparable = before && after && r.before.bodyUuid && r.before.bodyUuid === r.after.bodyUuid
    && before.dimension && before.dimension === after.dimension;
  const inventoryDelta = comparable ? Object.fromEntries([...new Set([...Object.keys(before.inventory), ...Object.keys(after.inventory)])]
    .map(k => [k,(after.inventory[k] || 0) - (before.inventory[k] || 0)]).filter(([,v])=>v !== 0)) : null;
  return { actionId: id(r.actionId), turnId: id(r.turnId), tool: text(r.tool,80), args: args(r.args),
    argumentsOmitted: Object.keys(object(r.args)).some(k => !argumentKeys.has(k)), status: state,
    completionConfirmed: confirmed, startedAt: start, observedAt: observed,
    durationMs: (confirmed || state === 'rejected') ? elapsed(start,observed) : null,
    nativeTaskId: text(r.nativeTaskId), code: text(r.result?.code),
    before, after, inventoryDelta,
    hpDelta: comparable && before.hp !== null && after.hp !== null ? after.hp-before.hp : null,
    hungerDelta: comparable && before.hunger !== null && after.hunger !== null ? after.hunger-before.hunger : null,
    navigation: r.navigationOutcome ? {success: r.navigationOutcome.success === true ? true : r.navigationOutcome.success === false ? false : null,
      reason: text(r.navigationOutcome.reason,400), distance: num(r.navigationOutcome.horizontalDistance)} : null };
}

// Only fixed files and validated receipt IDs are read. No native messages or credentials are returned.
async function readJson(root, name, problems) {
  try {
    const target = path.join(root,name), stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2*1024*1024) throw new Error('bounded_file');
    return JSON.parse((await fs.readFile(target,'utf8')).replace(/^\uFEFF/,''));
  } catch { problems.add(name.split('/')[0]); return null; }
}
async function readEpisodes(root, problems) {
  let file;
  try {
    const target = path.join(root,'episodes.jsonl'), stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('bounded_file');
    file = await fs.open(target,'r');
    const size = Math.min(stat.size,256*1024), offset = stat.size-size, buffer=Buffer.alloc(size);
    const {bytesRead} = await file.read(buffer,0,size,offset);
    let lines = buffer.subarray(0,bytesRead).toString('utf8').split('\n');
    if(offset) lines.shift();
    return lines.filter(Boolean).flatMap(line => {try{return [JSON.parse(line)];}catch{problems.add('episodes_partial');return [];}}).slice(-600);
  } catch {problems.add('episodes.jsonl');return [];} finally {await file?.close();}
}

export async function readSurvivorTrace({stateDir, traceDir}, now=Date.now()) {
  const problems = new Set();
  const snapshot = await readJson(stateDir,'survivor.json',problems);
  if(snapshot?.project !== 'qiandengji-survivor' || snapshot?.bodyName !== 'Kirito' || snapshot?.schema !== 1)
    return {schema:1,available:false,stale:true,turns:[],coverage:{partial:true,unavailable:['survivor.json']}};
  const [controller,memory,episodes] = traceDir ? await Promise.all([
    readJson(traceDir,'controller.json',problems), readJson(traceDir,'memory.json',problems),readEpisodes(traceDir,problems)]) : [null,null,list(snapshot.episodes)];
  if(!traceDir) problems.add('trace_directory');
  const c=object(controller), active=object(c.active), last=object(snapshot.lastDecision);
  const ids=[...new Set([...list(c.decisions).slice(-20).map(d=>id(d.turnId)),id(last.turnId),id(active.turnId)].filter(Boolean))].slice(-20).reverse();
  const turns=await Promise.all(ids.map(async turnId=>{
    const isActive=active.turnId===turnId, decision=list(c.decisions).find(d=>d.turnId===turnId);
    const events=episodes.filter(e=>e.turnId===turnId);
    const terminal=events.findLast(e=>e.kind==='decision_finished');
    const finish=stamp(terminal?.at) ?? (last.turnId===turnId ? stamp(last.at) : null);
    const start=num(decision?.startedAt) !== null ? decision.startedAt*1000 : isActive && num(active.startedAt) !== null ? active.startedAt*1000 : null;
    const history=list(memory?.history).findLast(m=>m.turnId===turnId);
    let receipts=[];
    if(traceDir) {
      const index=await readJson(traceDir,`turn-actions/${turnId}.json`,new Set());
      if(index?.turnId===turnId) receipts=(await Promise.all(list(index.actionIds).slice(-40).filter(id).map(async actionId=>{
        const row=await readJson(traceDir,`action-receipts/${actionId}.json`,problems);
        return row?.actionId===actionId && row?.turnId===turnId ? row : null;
      }))).filter(Boolean);
    }
    if(!receipts.length && last.turnId===turnId) receipts=list(last.actions).filter(r=>r.turnId===turnId);
    if(snapshot.actionExecution?.receipt?.turnId===turnId && !receipts.some(r=>r.actionId===snapshot.actionExecution.receipt.actionId)) receipts.push(snapshot.actionExecution.receipt);
    const actions=receipts.map(projectTraceAction).sort((a,b)=>(a.startedAt??Infinity)-(b.startedAt??Infinity));
    const completed=terminal?.completed ?? (last.turnId===turnId ? last.completed : null);
    return {turnId,taskId:text(isActive?active.taskId:terminal?.taskId??(last.turnId===turnId?last.taskId:null)),
      status: finish !== null ? completed===true?'completed':completed===false?'failed':'unknown' : isActive?'active':'unknown',
      startedAt:start,finishedAt:finish,durationMs:elapsed(start,finish),
      input: {body:isActive?body(active.before):null, mission:isActive?text(active.mission,1600):null,
        bytes:isActive?num(active.contextStats?.inputBytes):null,purpose:isActive?text(active.contextStats?.purpose,40):null,
        eventCount:isActive?list(active.eventIds).length:null},
      summary:history?{goal:text(history.goal,1600),lesson:text(history.lesson,2400),nextFocus:text(history.nextFocus,1200),at:num(history.at)}:null,
      failureReason:text(terminal?.failureReason ?? (last.turnId===turnId?last.failureReason:null),400),actions,
      events:events.slice(-24).map(e=>({kind:text(e.kind,80),at:stamp(e.at),action:text(e.action,80),reason:text(e.reason,300)})),
      coverage:{actionsLimited:true,fullPromptRecorded:false,allModelToolsRecorded:false} };
  }));
  const policy=object(snapshot.executionSystems?.fast?.localPolicy);
  return {schema:1,available:true,...freshness(snapshot.generatedAt,now,90),generatedAt:text(snapshot.generatedAt,64),
    agent:{name:'桐人',bodyName:'Kirito',status:text(snapshot.status),goal:text(snapshot.goal,1600),
      hp:num(snapshot.body?.hp),hunger:num(snapshot.body?.hunger),position:position(snapshot.body?.position)},turns,
    systemOne:policy.model?{model:text(policy.model,80),choice:text(policy.choice,100),confidence:num(policy.confidence),
      latencyMs:num(policy.latencyMs),handoffMs:num(policy.handoffMs),observedAt:num(policy.observedAt),code:text(policy.code,80)}:null,
    coverage:{partial:true,limit:20,unavailable:[...problems],scope:'recent_retained_turns_and_game_action_receipts'} };
}

export function createTraceReader(options) {
  let cached, expires=0, pending;
  return async()=>{
    if(cached && Date.now()<expires)return cached;
    if(!pending)pending=readSurvivorTrace(options).then(value=>{cached=value;expires=Date.now()+5000;return value;}).finally(()=>{pending=null;});
    return pending;
  };
}
