/** Read-only public projection. The caller supplies its trusted current roster
 * and visibility exclusions; source names/UUIDs never grant public visibility. */
export const activityCategories = Object.freeze({farming:'农业',crafting:'制造',construction:'建设',exploration:'探索',combat:'战斗',fishing:'垂钓',trade:'商贸',culture:'文化与创作',logistics:'补给与交付',magic:'魔法',mixed:'综合委托',other:'其他/待分类'});
const uuid = value => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const name = value => typeof value==='string' && /^\.?[A-Za-z0-9_]{1,16}$/.test(value);
const day = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const text = (value,n=160) => typeof value==='string' ? value.replace(/§[0-9a-fk-or]/gi,'').replace(/[\u0000-\u001f]/g,'').slice(0,n) : '';
const integer = value => Number.isSafeInteger(value) && value>=0 && value<=1e9;
const identifier = value => typeof value==='string' && /^[a-zA-Z0-9_.:-]{1,96}$/.test(value);
const timestamp = value => typeof value==='string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const category = value => Object.hasOwn(activityCategories,value) ? value : 'other';
const error = reason => Object.assign(new Error(reason),{status:400,reason});
const sources = ['public_chest','commission_delivery','admin_transfer'];

export function validateActivitySnapshot(raw,{now=Date.now()}={}) {
  if(!raw || raw.schemaVersion!==1 || raw.serverId!=='qiandengji' || typeof raw.available!=='boolean'
    || !timestamp(raw.observedAt) || Date.parse(raw.observedAt)>now+30000 || !day(raw.window?.from) || !day(raw.window?.through)
    || raw.window.from>raw.window.through || raw.window.timezone!=='Asia/Shanghai'
    || (Date.parse(raw.window.through)-Date.parse(raw.window.from))/86400000>29
    || !Array.isArray(raw.commissions) || raw.commissions.length>5000 || !Array.isArray(raw.donations) || raw.donations.length>10000
    || !Array.isArray(raw.active) || raw.active.length>4096) throw error('INVALID_ACTIVITY_SNAPSHOT');
  for(const row of raw.commissions) {
    if(!identifier(row.id)||!uuid(row.playerUuid)||!identifier(row.taskId)||!['guild','life'].includes(row.system)
      ||!['accepted','completed','abandoned'].includes(row.status)||!timestamp(row.occurredAt)||!day(row.day)
      ||row.day<raw.window.from||row.day>raw.window.through)throw error('INVALID_COMMISSION_RECORD');
  }
  for(const row of raw.donations) {
    if(!identifier(row.id)||row.playerUuid!==null&&!uuid(row.playerUuid)||!sources.includes(row.source)||!day(row.day)
      ||row.day<raw.window.from||row.day>raw.window.through||row.occurredAt!==null&&!timestamp(row.occurredAt)
      ||typeof row.material!=='string'||!/^[-a-z0-9_.]+:[-a-z0-9_./]+$/.test(row.material)||row.material.length>160
      ||!integer(row.deposited)||!integer(row.withdrawn)||row.net!==row.deposited-row.withdrawn||!integer(row.transactions)||row.transactions<1)throw error('INVALID_DONATION_RECORD');
  }
  for(const row of raw.active)if(!uuid(row.playerUuid)||!identifier(row.taskId)||!['guild','life'].includes(row.system))throw error('INVALID_ACTIVE_RECORD');
  return raw;
}

/** Reject an older delivery; repeat timestamps must not rewrite a different snapshot. */
export function activityReplacement(previous,incoming,options) {
  validateActivitySnapshot(incoming,options);
  if(previous) {
    const before=Date.parse(previous.observedAt),after=Date.parse(incoming.observedAt);
    if(after<before)throw error('STALE_ACTIVITY_SNAPSHOT');
    if(after===before) {
      if(JSON.stringify(previous)!==JSON.stringify(incoming))throw error('ACTIVITY_TIMESTAMP_CONFLICT');
      return {changed:false,snapshot:previous};
    }
  }
  return {changed:true,snapshot:incoming};
}

function publicIdentities(roster,excludedNames) {
  const excluded=new Set(excludedNames.map(n=>String(n).toLowerCase()));excluded.add('live');
  const identities=new Map(),conflicts=new Set();
  for(const row of roster) {
    if(!uuid(row.playerUuid)||!name(row.name)||row.hidden||row.historical||row.identityConflict||row.available===false
      ||['observer','admin','test'].includes(row.kind)||/eye$/i.test(row.name)||excluded.has(row.name.toLowerCase()))continue;
    if(identities.has(row.playerUuid)&&identities.get(row.playerUuid)!==row.name)conflicts.add(row.playerUuid);
    identities.set(row.playerUuid,row.name);
  }
  for(const id of conflicts)identities.delete(id);
  return identities;
}

function publicCoverage(coverage,from,through) {
  const result={};
  for(const kind of ['config','catalogue','logs','commissions','publicStorage','donations']) {
    const src=coverage?.[kind]||{};
    const row={available:src.available===true,complete:src.complete===true,reason:text(src.reason,100)||null};
    if(kind==='logs') {
      for(const key of ['completeDays','partialDays','unreadDays','missingDays'])row[key]=(Array.isArray(src[key])?src[key]:[]).filter(d=>day(d)&&d>=from&&d<=through);
      // Window-level completeness requires every selected date to be accounted for.
      row.windowFilesComplete=new Set(row.completeDays).size===1+(Date.parse(through)-Date.parse(from))/86400000;
      row.meaning='仅指仍保留的日志文件读取范围；删除或未记录的历史仍未知。';
    }
    result[kind]=row;
  }
  return result;
}

export function projectWorldActivity(snapshot,roster,{days=7,excludedNames=[],now=Date.now()}={}) {
  if(![7,30].includes(days))throw error('INVALID_ACTIVITY_WINDOW');
  if(!snapshot)return {schemaVersion:1,available:false,observedAt:null,stale:true,reason:'ACTIVITY_NOT_RECEIVED',totals:null,categories:[],contributions:[],active:[],residents:[]};
  validateActivitySnapshot(snapshot,{now});
  const through=snapshot.window.through;
  const requestedFrom=new Date(Date.parse(through+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
  const from=requestedFrom>snapshot.window.from?requestedFrom:snapshot.window.from;
  const ids=publicIdentities(roster,excludedNames);
  const groups=new Map(Object.entries(activityCategories).map(([id,label])=>[id,{id,label,completed:0,accepted:0,abandoned:0,active:0,participants:new Set()}]));
  const residents=new Map();
  const resident=id=>{if(!residents.has(id))residents.set(id,{name:ids.get(id),completed:0,accepted:0,abandoned:0,active:0,contributions:new Map()});return residents.get(id);};
  const seen=new Set();
  const totals={completed:0,accepted:0,abandoned:0,active:0,participants:0};
  for(const row of snapshot.commissions) {
    if(!ids.has(row.playerUuid)||row.day<from||row.day>through||seen.has(row.id))continue;
    seen.add(row.id);const group=groups.get(category(row.category));group[row.status]++;group.participants.add(row.playerUuid);
    totals[row.status]++;resident(row.playerUuid)[row.status]++;
  }
  const active=[],activeIds=new Set();
  for(const row of snapshot.active) {
    const identity=[row.playerUuid,row.system,row.taskId].join(':');
    if(!ids.has(row.playerUuid)||activeIds.has(identity))continue;
    activeIds.add(identity);totals.active++;resident(row.playerUuid).active++;
    groups.get(category(row.category)).active++;groups.get(category(row.category)).participants.add(row.playerUuid);
    active.push({name:ids.get(row.playerUuid),system:row.system,taskId:row.taskId,title:text(row.title),category:category(row.category)});
  }
  const contributions=[],donationIds=new Set();
  for(const source of sources) {
    const materials=new Map(),contributors=new Set();
    for(const row of snapshot.donations) {
      if(row.source!==source||!ids.has(row.playerUuid)||row.day<from||row.day>through||donationIds.has(row.id))continue;
      donationIds.add(row.id);contributors.add(row.playerUuid);
      if(!materials.has(row.material))materials.set(row.material,{material:row.material,deposited:0,withdrawn:0,net:0,transactions:0});
      const material=materials.get(row.material);for(const key of ['deposited','withdrawn','net','transactions'])material[key]+=row[key];
      const own=resident(row.playerUuid).contributions,ownKey=source+':'+row.material;
      if(!own.has(ownKey))own.set(ownKey,{source,material:row.material,deposited:0,withdrawn:0,net:0,transactions:0});
      for(const key of ['deposited','withdrawn','net','transactions'])own.get(ownKey)[key]+=row[key];
    }
    contributions.push({source,participants:contributors.size,materials:[...materials.values()].sort((a,b)=>a.material.localeCompare(b.material))});
  }
  totals.participants=residents.size;
  return {schemaVersion:1,serverId:'qiandengji',available:snapshot.available,observedAt:snapshot.observedAt,
    stale:now-Date.parse(snapshot.observedAt)>180000,window:{from,through,requestedFrom,days,timezone:'Asia/Shanghai'},
    coverage:publicCoverage(snapshot.coverage,from,through),totals:snapshot.available?totals:null,
    categories:snapshot.available?[...groups.values()].map(r=>({...r,participants:r.participants.size})):[],
    contributions,active,residents:[...residents.values()].map(r=>({...r,contributions:[...r.contributions.values()].sort((a,b)=>a.source.localeCompare(b.source)||a.material.localeCompare(b.material))})).sort((a,b)=>b.completed-a.completed||a.name.localeCompare(b.name)),
    notices:['显示已观察到的完整交付、接取与放弃次数；缺少一致分母，不计算完成率。','公共箱存入、取出与任务交付分别展示；不把物品件数合并成捐赠价值。','在途是服务器上次保存的状态，不代表居民此刻在线或正在执行。']};
}
