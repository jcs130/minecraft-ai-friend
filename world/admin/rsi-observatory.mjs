import fs from 'node:fs/promises';
import path from 'node:path';
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const arr=v=>Array.isArray(v)?v:[];
const str=(v,n=160)=>typeof v==='string'?v.slice(0,n):null;
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const valid=v=>typeof v==='string'&&/^[a-zA-Z0-9_.-]{1,120}$/.test(v)&&!v.includes('..');
async function json(file){try{const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>2*1024*1024)return null;return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));}catch{return null;}}
async function recentFiles(root,limit=12){
  const found=[];let visited=0;
  async function walk(dir,depth=0){
    if(depth>2||visited>=600)return;
    for(const e of (await fs.readdir(dir,{withFileTypes:true})).slice(0,600)){
      if(++visited>600)break;
      if(e.isSymbolicLink())continue;
      const file=path.join(dir,e.name);
      if(e.isDirectory())await walk(file,depth+1);
      else if(e.isFile()&&/\.(md|json)$/.test(e.name)){
        const stat=await fs.stat(file);found.push({file,name:path.relative(root,file).replaceAll('\\','/'),at:stat.mtimeMs,size:stat.size});
      }
    }
  }
  try{await walk(root);}catch{return {available:false,files:[],partial:true};}
  found.sort((a,b)=>b.at-a.at);
  return {available:true,files:found.slice(0,limit),partial:visited>=600||found.length>limit};
}
async function cases(root){
  let db;
  try{
    const {DatabaseSync}=await import('node:sqlite');
    db=new DatabaseSync(path.join(root,'team.sqlite3'),{readOnly:true});
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');
    const rows=db.prepare("SELECT id,author,owner,status,version,updated_at,body FROM cases WHERE json_valid(body) AND json_extract(body,'$.category')='improvement' ORDER BY updated_at DESC LIMIT 24").all();
    const totals=db.prepare("SELECT status,COUNT(*) AS count FROM cases WHERE json_valid(body) AND json_extract(body,'$.category')='improvement' GROUP BY status").all();
    return {available:true,counts:Object.fromEntries(totals.map(r=>[r.status,r.count])),items:rows.map(r=>{
      const b=JSON.parse(r.body);return {id:str(r.id),author:str(r.author),owner:str(r.owner),status:str(r.status),version:num(r.version),updatedAt:num(r.updated_at),title:str(b.title,240),observed:str(b.observed,1000),expected:str(b.expected,600),evidence:arr(b.evidence).slice(0,6).map(v=>str(v,240)).filter(Boolean)};
    })};
  }catch{return {available:false,counts:null,items:[]};}finally{db?.close();}
}
export async function readRsi({notesDir,learningDir,knowledgeDir,sharedSkillsDir,engineeringDir,teamDir,stateDir}){
  const [board,metrics,index,shared,config,knowledge,receipts,improvements,survival,commits]=await Promise.all([
    json(path.join(notesDir,'evolution-board.json')),json(path.join(notesDir,'metrics.json')),
    json(path.join(learningDir,'index.json')),json(path.join(sharedSkillsDir,'index.json')),
    json(path.join(engineeringDir,'config.json')),recentFiles(knowledgeDir),recentFiles(path.join(engineeringDir,'receipts'),11),cases(teamDir),json(path.join(stateDir,'survival-metrics.json')),recentFiles(path.join(engineeringDir,'state'),8)]);
  const local=Object.entries(obj(index?.skills)).slice(0,40).map(([name,v])=>({name:str(name),revision:str(v.revision),enabled:v.enabled===true,behaviorVerified:v.behaviorVerified===true,failures:num(v.failures),at:num(v.activatedAt)}));
  const published=Object.entries(obj(shared?.skills)).slice(0,60).map(([name,v])=>({name:str(name),revision:str(v.revision),origin:str(v.origin),at:num(v.publishedAt),tools:arr(v.tools).slice(0,30).map(t=>str(t,80)).filter(Boolean)}));
  let drafts=[];try{drafts=(await fs.readdir(path.join(learningDir,'drafts'),{withFileTypes:true})).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&valid(e.name)).slice(0,40).map(e=>e.name);}catch{}
  const engineeringReceipts=(await Promise.all([...receipts.files.filter(f=>f.name!=='_runner.json').slice(0,10),...commits.files].map(async f=>{
    const r=await json(f.file);if(!r)return null;
    return {name:f.name,fileUpdatedAt:f.at,startedAt:num(r.startedAt),finishedAt:num(r.finishedAt),ok:typeof r.ok==='boolean'?r.ok:null,status:str(r.status??r.state),code:str(r.code),
      commit:str(r.commit??r.commitSha??r.head),pushed:typeof r.pushed==='boolean'?r.pushed:null,
      keys:Object.keys(r).filter(k=>['testId','jobId','caseId','requestId','sourceSha256','baseCommit'].includes(k)).map(k=>({key:k,value:str(r[k])}))};
  }))).filter(Boolean);
  const roles=arr(board?.roles).slice(0,20).map(r=>({role:str(r.role),name:str(r.name),drafts:num(r.drafts),knowledge:num(r.knowledge),knowledgeFreshMinutes:num(r.knowledgeFreshMinutes),
    lastShift:r.lastShift?{status:str(r.lastShift.status),code:str(r.lastShift.code),ageMinutes:num(r.lastShift.ageMinutes)}:null}));
  const behaviors=arr(survival?.behaviors).map(b=>({category:str(b.category),sampled:num(b.sampled),succeeded:num(b.succeeded),rate:num(b.rate),outcomes:Object.fromEntries(['succeeded','failed','rejected','pending','unknown'].map(k=>[k,num(b.outcomes?.[k])]))}));
  return {schema:1,available:!!(board||index||improvements.available),generatedAt:Date.now(),
    sources:{boardAt:num(board?.generatedAt)!==null?board.generatedAt*1000:null,metricsAt:num(metrics?.generatedAt)!==null?metrics.generatedAt*1000:null,behaviorAt:num(survival?.at)!==null?survival.at*1000:null,
      learning:!!index,shared:!!shared,knowledge:knowledge.available,engineering:!!config,receipts:receipts.available,cases:improvements.available},
    l1:{generation:{memoryEpoch:str(survival?.generation?.memoryEpoch),startedAt:num(survival?.generation?.startedAt)},behaviors},
    l2:{roles,localSkills:local,sharedSkills:published,drafts,knowledge:knowledge.files.map(({name,at,size})=>({name,at,size})),knowledgePartial:knowledge.partial,
      feedback:arr(index?.feedback).slice(-8).map(v=>({name:str(v.name),outcome:str(v.outcome),at:num(v.at),evidence:str(v.evidence,1000),independentlyVerified:v.independentlyVerified===true}))},
    l3:{enabled:typeof config?.enabled==='boolean'?config.enabled:null,baseCommit:str(config?.baseCommit),branch:str(config?.branch),
      plans:arr(config?.plans).map(p=>({id:str(p.id),checks:Object.keys(obj(p.checks)).length})),cases:improvements,receipts:engineeringReceipts,
      verifiedImprovement:null,notice:'工程测试与候选提交分别记录；当前数据源没有完整的跨任务对照、代际收益与回退验收，不能据此证明 RSI 已提升。'}};
}
export function createRsiReader(options){let cached,pending,expires=0;return async()=>{
  if(!options?.notesDir)return {schema:1,available:false};
  if(cached&&Date.now()<expires)return cached;
  if(!pending)pending=readRsi(options).then(v=>{cached=v;expires=Date.now()+15000;return v;}).finally(()=>pending=null);
  return pending;
};}
