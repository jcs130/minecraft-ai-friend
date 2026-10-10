// Private optional YSM lifecycle. The existing maintenance lock owns this process.
import net from 'node:net';
import {spawn} from 'node:child_process';
import {readFileSync,existsSync,createWriteStream,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function validateConfig(c) {
  if(c?.schemaVersion!==1 || typeof c.enabled!=='boolean' || !isAbsolute(c.root||'') || !isAbsolute(c.java||'')) throw Error('Invalid YSM configuration');
  if(!/^[a-f0-9]{64}$/.test(c.controlToken||'')) throw Error('Invalid YSM control credential');
  const ports=new Set();
  for(const port of [c.controlPort,c.proxy?.port,c.worker?.port,c.workerControllerPort]) {
    if(!Number.isInteger(port)||port<1024||port>65535||ports.has(port))throw Error('Invalid YSM ports');ports.add(port);
  }
  for(const name of ['proxy','worker']) {
    const s=c[name],dir=resolve(s?.directory||''),rel=relative(resolve(c.root),dir);
    if(!rel || rel.startsWith('..')||isAbsolute(rel)||!Number.isInteger(s.heapMiB)||s.heapMiB<256||s.heapMiB>1024
      || !/^[A-Za-z0-9_.+-]+\.jar$/.test(s.jar||'')||!/^[a-f0-9]{64}$/.test(s.sha256||''))throw Error('Invalid YSM service '+name);
  }
  return c;
}
export function permittedConsole(service,command) {
  if(typeof command!=='string'||command.length>256||/[\r\n\x00-\x1f]/.test(command))return false;
  if(service==='worker')return command==='ysm model reload';
  return service==='proxy' && /^(appearance (status|list)|appearance admin set [A-Za-z0-9_]{1,16} [\p{L}\p{N}_.-]{1,96} [\p{L}\p{N}_.-]{1,96})$/u.test(command);
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function listening(port) {
  return new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});const done=v=>{s.destroy();resolve(v);};s.setTimeout(750,()=>done(false));s.once('connect',()=>done(true));s.once('error',()=>done(false));});
}
export async function supervise(configPath) {
  if(process.env.YSM_START_GATE_FILE) {
    const deadline=Date.now()+10_000;
    while(!existsSync(process.env.YSM_START_GATE_FILE)) {if(Date.now()>deadline)throw Error('YSM_WINDOWS_JOB_NOT_READY');await pause(25);}
  }
  const c=validateConfig(JSON.parse(readFileSync(configPath,'utf8').replace(/^\uFEFF/,'')));
  if(!c.enabled)throw Error('YSM services disabled');
  const logs=join(c.root,'logs');mkdirSync(logs,{recursive:true});
  const state=new Map();let stopping=false,ticking=false,timer;
  function snapshot(){return {protocol:'YSM-SERVICES-V1',pid:process.pid,stopping,proxyPort:c.proxy.port,services:Object.fromEntries([...state].map(([n,s])=>[n,{pid:s.child?.pid??null,alive:!!s.child&&s.child.exitCode===null&&s.child.signalCode===null,starts:s.starts,lastExit:s.lastExit??null,error:s.error??null}]))};}
  function persist(){const f=join(c.root,'lifecycle-status.json'),tmp=f+'.tmp';writeFileSync(tmp,JSON.stringify({...snapshot(),at:new Date().toISOString()}));renameSync(tmp,f);}
  async function start(name) {
    const s=state.get(name),spec=c[name];if(stopping||s.suspended||s.child||Date.now()<s.retryAt)return;
    // A stale child/foreign port is never killed or adopted by a new supervisor.
    if(await listening(spec.port)||(name==='proxy'&&await listening(c.workerControllerPort))) {s.error='YSM_PORT_ALREADY_IN_USE';s.retryAt=Date.now()+30_000;return;}
    if(stopping||s.suspended)return;
    const jar=join(spec.directory,spec.jar);
    if(!existsSync(jar)||createHash('sha256').update(readFileSync(jar)).digest('hex')!==spec.sha256) {s.error='YSM_JAR_HASH_MISMATCH';s.retryAt=Date.now()+60_000;return;}
    const log=createWriteStream(join(logs,`${name}-${Date.now()}.log`),{flags:'wx'});
    const child=spawn(c.java,['-Xms128M',`-Xmx${spec.heapMiB}M`,'-XX:ActiveProcessorCount=4','-Dfile.encoding=UTF-8','-jar',jar,'nogui'],{cwd:spec.directory,stdio:['pipe','pipe','pipe'],windowsHide:true});
    s.child=child;s.starts++;s.startedAt=Date.now();s.error=null;
    child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.stdin.on('error',()=>{});
    child.once('error',e=>{s.error=e.code||'YSM_SPAWN_FAILED';});
    child.once('close',(code,signal)=>{log.end();s.child=null;s.lastExit={code,signal,at:new Date().toISOString()};s.failures=Date.now()-s.startedAt>120_000?0:s.failures+1;s.retryAt=Date.now()+Math.min(300_000,15_000*2**Math.min(s.failures,4));persist();});
    persist();
  }
  async function stopChild(name) {
    const s=state.get(name),p=s?.child;if(!p)return;
    p.stdin.write((name==='proxy'?'shutdown':'stop')+'\n');
    const end=Date.now()+90_000;while(s.child&&Date.now()<end)await pause(250);
    if(s.child)throw Error('YSM_CLEAN_STOP_TIMEOUT_'+name); // Preserve data; no forced kill.
  }
  async function stopAll() {
    if(stopping)return;stopping=true;clearInterval(timer);persist();
    // Proxy first removes mapper sessions; Worker then saves actual model/player data.
    await stopChild('proxy');await stopChild('worker');persist();
    server.close();
  }
  const server=net.createServer(socket=>{
    socket.setTimeout(5_000,()=>socket.destroy());let data='',handled=false;
    socket.on('error',()=>{});
    socket.on('data',chunk=>{
      if(handled)return;data+=chunk.toString('utf8');if(data.length>1024){socket.destroy();return;}
      if(!data.includes('\n'))return;handled=true;
      void(async()=>{
        let q;try{q=JSON.parse(data.slice(0,data.indexOf('\n')));}catch{socket.end('{"error":"invalid_request"}\n');return;}
        const provided=Buffer.from(String(q.token||'')),expected=Buffer.from(c.controlToken);
        if(provided.length!==expected.length||!timingSafeEqual(provided,expected)){socket.end('{"error":"unauthorized"}\n');return;}
        if(q.action==='status'){socket.end(JSON.stringify(snapshot())+'\n');return;}
        if(q.action==='stop'){socket.end(JSON.stringify({accepted:true,pid:process.pid})+'\n');await stopAll();return;}
        if(q.action==='console'&&permittedConsole(q.service,q.command)) {
          const child=state.get(q.service)?.child;if(!child){socket.end('{"error":"service_unavailable"}\n');return;}
          child.stdin.write(q.command+'\n');socket.end('{"accepted":true,"finalStateVerified":false}\n');return;
        }
        if(q.action==='restart-worker'&&!stopping){const s=state.get('worker');s.suspended=true;try{await stopChild('worker');s.retryAt=0;}finally{s.suspended=false;}socket.end('{"accepted":true}\n');return;}
        socket.end('{"error":"unsupported_action"}\n');
      })().catch(e=>{console.error(e.message);socket.destroy();});
    });
  });
  // Exclusive listener is the single-instance lock, acquired before starting JVMs.
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen({host:'127.0.0.1',port:c.controlPort,exclusive:true},ok);});
  server.on('error',e=>console.error(e.message));
  for(const name of ['proxy','worker'])state.set(name,{child:null,starts:0,failures:0,retryAt:0});
  await start('proxy');await start('worker');
  timer=setInterval(()=>{if(ticking||stopping)return;ticking=true;void(async()=>{for(const n of ['proxy','worker'])await start(n);persist();})().catch(e=>console.error(e.message)).finally(()=>{ticking=false;});},5000);
  process.once('SIGINT',()=>void stopAll().catch(e=>console.error(e.message)));
  process.once('SIGTERM',()=>void stopAll().catch(e=>console.error(e.message)));
  console.log('YSM-SERVICES-V1 '+process.pid);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)supervise(process.argv[2]||'E:/MC/ops/ysm-services.json').catch(e=>{console.error(e.message);process.exitCode=1;});
