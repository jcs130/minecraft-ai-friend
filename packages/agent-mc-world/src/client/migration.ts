import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { MINECRAFT_CLIENT_DEFAULTS } from './config.ts';

/** Does not activate any migrated model, server, performance endpoint or connection. */
export function planLegacyConfiguration(input: Record<string, unknown>) {
  const root=structuredClone(input);
  const worlds=root.worlds as Record<string, unknown>|undefined;
  const legacy=(root.world ?? worlds?.mymc ?? worlds?.minecraft ?? root) as Record<string,unknown>;
  if(!legacy || Array.isArray(legacy) || typeof legacy!=='object')throw new Error('Invalid legacy world configuration');
  const host:Record<string,unknown>={}, server:Record<string,unknown>={}, unused:Record<string,unknown>={};
  const core:Record<string,unknown>={};
  for(const [key,value] of Object.entries(legacy)) {
    if(['decision','combatDecision'].includes(key))host[key]=value;
    else if(['preserveLoginName','repeatSuccessFallback','combatOptions'].includes(key))server[key]=value;
    else if(Object.hasOwn(MINECRAFT_CLIENT_DEFAULTS,key))core[key]=value;
    else unused[key]=value;
  }
  if(host.combatDecision && typeof host.combatDecision==='object') {
    const policy=host.combatDecision as Record<string,unknown>;
    server.combatOptions=Object.fromEntries(['maxEntities','maxCandidates','allowMovement','allowEngage','engageScope','movementStallMs'].filter(key=>policy[key]!==undefined).map(key=>[key,policy[key]]));
  }
  const idle=core.idle as Record<string,unknown>|undefined;
  if(idle?.selector==='decision') {
    host.idle=structuredClone(idle);
    core.idle={...idle,enabled:false,selector:'random'};
  }
  if(core.idle) for(const key of ['endpoint','timeoutMs','decisionPolicy']) delete (core.idle as Record<string,unknown>)[key];
  // Never silently convert server commands into generic survival policy.
  if(typeof core.escapeCommand==='string' && core.escapeCommand.startsWith('/mycli')) {
    server.escapeCommand=core.escapeCommand;core.escapeCommand='';
  }
  core.enabled=false;
  const actions:string[]=[];
  if(Object.keys(host).length)actions.push('Wire host-owned decision helpers explicitly; migrated models are not started.');
  if(Object.keys(server).length || worlds?.mymc)actions.push('Select the Qiandengji integration explicitly before using server-specific capabilities.');
  if(Object.keys(unused).length)actions.push('Review preserved unknown configuration fields.');
  return {schema:'agent-mc-migration/v1' as const,core,host,server,unused,original:root,actions,
    memoryAndPersonality:'remain-with-host',connectionStarted:false};
}

/** Copy only, to a new directory. Every original is retained with hashes, including unknown host data. */
export async function copyLegacyData(sourceDirectory:string,targetDirectory:string) {
  const source=await realpath(sourceDirectory),target=resolve(targetDirectory);
  // Resolve the existing parent as well, so a directory junction cannot turn the copy into recursion.
  const parent=await realpath(resolve(target,'..'));
  const actual=join(parent,relative(resolve(target,'..'),target));
  const within=relative(source,actual);
  if(!within || (!within.startsWith('..') && !isAbsolute(within)))throw new Error('Migration target must be outside the source');
  const files:Array<{source:string;archived:string;restored?:string;sha256:string}>=[];
  async function scan(dir:string) {
    for(const item of await readdir(dir,{withFileTypes:true})) {
      const path=join(dir,item.name),stat=await lstat(path);
      if(stat.isSymbolicLink())throw new Error('Migration refuses symbolic links or junctions: '+path);
      if(stat.isDirectory())await scan(path);
      else if(stat.isFile()) {
        const name=relative(source,path).replaceAll('\\','/');
        // Connection leases are process state; retain their originals but never activate them.
        const execution=/^(minecraft-[^/]+\.json|events-[a-f0-9-]+\.jsonl|traces-[a-f0-9-]+\.jsonl|tools\.jsonl)$/.test(name)
          || /^(artifacts|requests|minecraft-methods|minecraft-skins)\//.test(name);
        files.push({source:name,archived:'legacy-originals/'+name,...(execution?{restored:name}:{}),
          sha256:createHash('sha256').update(await readFile(path)).digest('hex')});
      }
    }
  }
  await scan(source);
  await mkdir(target); // EEXIST is intentional: never merge into or overwrite an active data directory.
  for(const file of files)for(const destination of [file.archived,...(file.restored?[file.restored]:[])]) {
    const path=join(target,destination);await mkdir(resolve(path,'..'),{recursive:true});
    await cp(join(source,file.source),path,{force:false,errorOnExist:true});
    if(createHash('sha256').update(await readFile(path)).digest('hex')!==file.sha256)throw new Error('Migration copy changed: '+file.source);
  }
  const report={schema:'agent-mc-data-migration/v1',source,files,connectionStarted:false,
    note:'Unknown host data remains in legacy-originals. Goals, memories and credentials are not adopted by the game core.'};
  await writeFile(join(target,'migration.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
