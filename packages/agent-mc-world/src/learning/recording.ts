import { writeFile, rename, mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, basename, join, sep } from 'node:path';
import { GameplayArchive, type ArchiveOptions } from './archive.ts';
import { OperationFollower } from './follower.ts';
import { ViewerGameplayObserver, type ViewerObserverOptions } from './viewer-observer.ts';
import { MotorPolicyShadow, type MotorShadowOptions } from './motor-shadow.ts';
import { PolicyUsageWindow } from './policy-statistics.ts';
export type GameplayRecordingConfig=ArchiveOptions & { sourceDirectory:string;statusFile:string;viewer?:ViewerObserverOptions;sealEveryMs?:number;motorShadow?:MotorShadowOptions };
async function canonicalTarget(path:string):Promise<string>{
  const target=resolve(path);try{return await realpath(target);}catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT'||dirname(target)===target)throw error;
    return join(await canonicalTarget(dirname(target)),basename(target));
  }
}
function inside(source:string,target:string){const path=relative(source,target);return !path||(!isAbsolute(path)&&path!=='..'&&!path.startsWith('..'+sep));}
/** Explicit background recorder lifecycle; safe to run beside an existing host without a reload. */
export async function startGameplayRecording(config:GameplayRecordingConfig) {
  // Check resolved targets before even an archive marker/status file can touch the source.
  const source=await realpath(config.sourceDirectory);
  if(basename(source)!==config.scopeKey||inside(source,await canonicalTarget(config.directory))||inside(source,await canonicalTarget(config.statusFile)))
    throw Error('Archive/status must be separate from the read-only scoped operation journal');
  if(config.motorShadow&&!config.viewer)throw Error('Motor shadow requires the explicit passive viewer');
  const archive=new GameplayArchive(config),usage=new PolicyUsageWindow(config.scopeKey);
  const shadow=config.motorShadow?await MotorPolicyShadow.load(config.motorShadow,async row=>{await archive.append(row);usage.observe(row);}):undefined;
  const observer=config.viewer?new ViewerGameplayObserver(config.viewer,config.scopeKey,archive,row=>shadow?.observe(row)??Promise.resolve()):undefined;
  const follower=new OperationFollower(config.sourceDirectory,config.scopeKey,archive,config.directory,row=>{
    observer?.confirmScope(row);usage.observe(row);shadow?.observeOperation(row);
  });
  let stopped=false,errors=0,sealing=false,reconciling=false;
  const timers:ReturnType<typeof setInterval>[]=[];
  const statusFile=resolve(config.statusFile);
  const status=()=>({protocol:'agent-mc-gameplay-recorder/v1',pid:process.pid,at:new Date().toISOString(),state:stopped?'stopped':archive.status().storageFailed?'storage-stopped':'recording',
    errors,archive:archive.status(),source:follower.status(),viewer:observer?.status()??null,policyUsage:usage.status(),motorShadow:shadow?.status()??null,
    llmCalls:0,bodyControlCalls:0,personalMemoryWrites:0,automaticTraining:false,automaticSkillAdoption:false});
  let statusChain:Promise<void>=Promise.resolve();
  const save=()=>{statusChain=statusChain.then(async()=>{await mkdir(dirname(statusFile),{recursive:true});const temporary=statusFile+'.partial';await writeFile(temporary,JSON.stringify(status(),null,2));await rename(temporary,statusFile);}).catch(()=>{errors++;});return statusChain;};
  const stop=async()=>{if(stopped)return;stopped=true;for(const timer of timers)clearInterval(timer);
    await observer?.stop();await follower.stop();await archive.close();await save();};
  try{
    await archive.start();observer?.start();await follower.start();
    timers.push(setInterval(()=>{void follower.drain().catch(()=>{errors++;});},250));
    timers.push(setInterval(()=>{if(reconciling)return;reconciling=true;void follower.reconcile().catch(()=>{errors++;}).finally(()=>{reconciling=false;});},60000));
    const sealEvery=config.sealEveryMs??60000;if(!Number.isInteger(sealEvery)||sealEvery<1000||sealEvery>3600000)throw Error('sealEveryMs must be 1000..3600000');
    timers.push(setInterval(()=>{if(sealing)return;sealing=true;void archive.flush().catch(()=>{errors++;}).finally(()=>{sealing=false;});},sealEvery));
    timers.push(setInterval(()=>{void save();},5000));await archive.flush();await save();
    return {status,stop,flush:()=>archive.flush()};
  }catch(error){await stop();throw error;}
}
