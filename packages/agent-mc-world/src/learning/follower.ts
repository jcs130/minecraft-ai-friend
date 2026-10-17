/** Read-only consumer of an existing scope's operation evidence. No body, host or notebook writes. */
import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import { basename, resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { GameplayArchive } from './archive.ts';
import { gameplayFromExperience, type GameplayRecord } from './assessment.ts';
export class OperationFollower {
  private watcher?:FSWatcher;
  private queue=new Set<string>();
  private seen=new Map<string,string>();
  private running=false;
  private reading:Promise<void>=Promise.resolve();
  private failures=0;
  private readCount=0;
  private duplicates=0;
  private lastSourceAt:string|null=null;
  private lastSourceReadAt:string|null=null;
  private droppedNotifications=0;
  constructor(private readonly sourceDirectory:string,private readonly scopeKey:string,private readonly archive:GameplayArchive,
    private readonly outputDirectory:string,private readonly onRecord?:(row:GameplayRecord)=>void){}
  status(){return {sourceReads:this.readCount,duplicateReads:this.duplicates,sourceErrors:this.failures,pendingSources:this.queue.size,
    lastSourceAt:this.lastSourceAt,lastSourceReadAt:this.lastSourceReadAt,droppedNotifications:this.droppedNotifications};}
  private enqueue(name:string){if(!/^[a-f0-9]{64}\.json$/.test(name))return;if(this.queue.size>=2048&&!this.queue.has(name)){this.droppedNotifications++;return;}this.queue.add(name);}
  async start(){
    if(this.running)throw Error('Operation follower already running');
    const source=await realpath(this.sourceDirectory),output=await realpath(this.outputDirectory);
    if(basename(source)!==this.scopeKey||source.toLowerCase()===output.toLowerCase()||output.toLowerCase().startsWith(source.toLowerCase()+sep))throw Error('Explicit, distinct scope source and archive directories required');
    this.running=true;
    this.watcher=watch(source,(_event,file)=>{if(file)this.enqueue(String(file));});
    this.watcher.on('error',()=>{this.failures++;});
    // Watch first, then read the existing journal; updates racing the backfill remain queued.
    for(const name of (await readdir(source)).filter(x=>/^[a-f0-9]{64}\.json$/.test(x)).sort()){
      if(!this.running)break;await this.read(name);
    }
    await this.drain();
  }
  private async read(name:string){
    const file=join(this.sourceDirectory,name);
    try{
      const info=await stat(file);if(info.size>256000)throw Error('Oversized source');
      const text=await readFile(file,'utf8');if(Buffer.byteLength(text)>256000)throw Error('Oversized source');
      this.readCount++;
      const digest=createHash('sha256').update(text).digest('hex'),id=name.slice(0,-5);
      this.seen.set(name,`${info.mtimeMs}:${info.size}`);
      if(this.archive.cursor(id)===digest){this.duplicates++;return;}
      const row=gameplayFromExperience(JSON.parse(text),this.scopeKey,digest,this.archive.cursor(id));
      if(row.sourceId!==id)throw Error('Source file/row identity mismatch');
      await this.archive.append(row);if(!this.lastSourceAt||Date.parse(row.updatedAt)>Date.parse(this.lastSourceAt))this.lastSourceAt=row.updatedAt;this.lastSourceReadAt=new Date().toISOString();
      this.onRecord?.(row);
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.failures++;else this.enqueue(name);}
  }
  drain():Promise<void>{
    this.reading=this.reading.then(async()=>{for(const name of [...this.queue]){if(!this.running)break;this.queue.delete(name);await this.read(name);}});
    return this.reading;
  }
  async reconcile(){
    for(const name of await readdir(this.sourceDirectory)){
      if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
      try{const s=await stat(join(this.sourceDirectory,name));if(this.seen.get(name)!==`${s.mtimeMs}:${s.size}`)this.enqueue(name);}catch{this.failures++;}
    }
    await this.drain();
  }
  async stop(){this.running=false;this.watcher?.close();await this.reading;}
}
