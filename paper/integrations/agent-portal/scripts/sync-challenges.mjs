import fs from 'node:fs/promises';
import path from 'node:path';
import {loadConfig} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {GameData} from '../src/game-data.mjs';
import {SavedChallenges} from '../src/challenges.mjs';

const configPath=process.argv[process.argv.indexOf('--config')+1];
if(!process.argv.includes('--config')||!path.isAbsolute(configPath))throw Error('Use --config with an absolute private sync configuration');
const settings=JSON.parse(await fs.readFile(configPath,'utf8')),endpoint=new URL(settings.endpoint);
if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/api/v1/internal/snapshot'||endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(endpoint.hostname)))throw Error('Use the existing HTTPS or loopback snapshot origin');
endpoint.pathname='/api/v1/internal/challenges';
const directory=path.join(path.dirname(configPath),'challenges'),lockFile=path.join(directory,'worker.lock'),stopFile=path.join(directory,'stop.request');
await fs.mkdir(directory,{recursive:true});
let lock;
try{lock=await fs.open(lockFile,'wx');}catch(e){
  if(e.code!=='EEXIST')throw e;
  const owner=Number(await fs.readFile(lockFile,'utf8'));if(!Number.isInteger(owner)||owner<=0)throw Error('Inspect challenge collector lock');
  try{process.kill(owner,0);throw Error('Challenge collector already running');}catch(reason){if(reason.code!=='ESRCH')throw reason;}
  await fs.unlink(lockFile);lock=await fs.open(lockFile,'wx');
}
await lock.writeFile(String(process.pid));
const config=loadConfig({...settings.game,skipLocalConfig:true,sourceMode:'local',authBridge:{enabled:false},cloudAccounts:{enabled:false},dataDir:path.join(directory,'journal')});
const store=new Store(config.dataDir),game=new GameData(config,store.salt),reader=new SavedChallenges(config,game,store);
let stopping=false,lastReport;
const report=value=>{if(value!==lastReport){console.log(value);lastReport=value;}};
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;});
try{
  const token=(await fs.readFile(settings.tokenFile,'utf8')).trim();if(!/^srv_[A-Za-z0-9_-]{43}$/.test(token))throw Error('Invalid existing sync credential');
  do{
    try{
      const snapshot=await reader.snapshot(),body=JSON.stringify(snapshot);if(Buffer.byteLength(body)>2097152)throw Error('Challenge snapshot too large');
      if(process.argv.includes('--dry-run')){console.log(JSON.stringify({available:snapshot.available,activities:snapshot.activities?.map(a=>({id:a.id,name:a.name,totalUnits:a.totalUnits})),records:snapshot.runs.length,bytes:Buffer.byteLength(body)}));break;}
      const response=await fetch(endpoint,{method:'PUT',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Object.assign(Error('Challenge sync not accepted'),{status:response.status});
      report('挑战战报同步已连接。');
    }catch(error){report('挑战战报暂未同步'+(error.status?'（HTTP '+error.status+'）':'')+'；保留已收录记录。');if([401,403].includes(error.status)){process.exitCode=1;break;}if(process.argv.includes('--once')||process.argv.includes('--dry-run'))process.exitCode=1;}
    if(process.argv.includes('--once')||process.argv.includes('--dry-run'))break;
    const until=Date.now()+Math.max(15000,Number(settings.intervalMs)||15000);
    while(!stopping&&Date.now()<until){if(await fs.stat(stopFile).then(()=>true,()=>false)){stopping=true;break;}await new Promise(r=>setTimeout(r,500));}
  }while(!stopping);
}finally{store.close();await lock.close();await fs.unlink(lockFile);}
