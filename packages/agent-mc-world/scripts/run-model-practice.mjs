/** Explicit one-shot runner. The host module owns its registered route and credentials. */
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export function practicePreflight(options){
  const issues=[];
  for(const key of ['java','python','serverJar','directory','modelModule'])
    if(typeof options[key]!=='string'||!isAbsolute(options[key]))issues.push(`${key}: explicit absolute path required`);
  for(const key of ['java','python','serverJar','modelModule'])
    if(options[key]&&!existsSync(options[key]))issues.push(`${key}: file unavailable`);
  if(options.directory&&existsSync(options.directory))issues.push('directory: must be new; preserve existing evidence');
  if(options.java&&existsSync(options.java)){
    const java=spawnSync(options.java,['-version'],{encoding:'utf8',timeout:10000});
    const version=/version\s+"(\d+)/.exec(String(java.stderr)+String(java.stdout));
    if(java.status!==0||Number(version?.[1])!==21)issues.push('java: Java 21 required for this fixed experiment');
  }
  if(options.serverJar&&existsSync(options.serverJar)){
    const sha=createHash('sha1').update(readFileSync(options.serverJar)).digest('hex');
    if(sha!=='59353fb40c36d304f2035d51e7d6e6baa98dc05c')issues.push('serverJar: official Java 1.21.1 SHA1 mismatch');
  }
  if(options.python&&existsSync(options.python)){
    const check=spawnSync(options.python,[fileURLToPath(new URL('../bridges/harness2/worker.py',import.meta.url)),'--check'],{encoding:'utf8',timeout:10000});
    if(check.status!==0)issues.push('python: pinned Harness² worker check failed');
  }
  return {ready:issues.length===0,issues,modelCredentialsChecked:false,modelCalls:0,gameConnections:0};
}

export async function runModelPractice(options){
  const check=practicePreflight(options);
  if(!check.ready)throw Error('Practice preflight failed: '+check.issues.join('; '));
  if(options.acceptEula!==true)throw Error('Explicit Minecraft EULA acceptance required: --acceptEula=true');
  // Loaded only on an explicit run, after local inputs pass. No ambient route or fallback.
  const host=await import(pathToFileURL(options.modelModule).href);
  if(typeof host.createPracticeModel!=='function')throw Error('Host module must export createPracticeModel({signal})');
  const controller=new AbortController(),abort=()=>controller.abort();
  options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted)abort();
  let port;
  try{
    controller.signal.throwIfAborted();port=await host.createPracticeModel({signal:controller.signal});
    if(port?.provenance?.kind!=='registered-host-llm')throw Error('Host must identify its registered LLM route');
    const {runConnectedCraftingExperiment}=await import('../examples/connected-crafting.mjs');
    return await runConnectedCraftingExperiment({...options,model:port.model,provenance:port.provenance,signal:controller.signal});
  }finally{options.signal?.removeEventListener('abort',abort);await port?.close?.();}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=Object.fromEntries(process.argv.slice(2).map(v=>v.split(/=(.*)/s).slice(0,2)));
  const options=Object.fromEntries(['java','python','serverJar','directory','modelModule'].map(k=>[k,args['--'+k]]));
  if(process.argv.includes('--preflight')){
    const check=practicePreflight(options);console.log(JSON.stringify(check,null,2));if(!check.ready)process.exitCode=2;
  }else{
    const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
    try{
      const report=await runModelPractice({...options,acceptEula:args['--acceptEula']==='true',signal:controller.signal});
      console.log(JSON.stringify({report:options.directory+'/report.json',gate:report.result.gate,modelCosts:report.modelCosts,adopted:false}));
    }finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
  }
}
