import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {copyWorldStorage, planWorldStorage, prepareWorldStorage, worldDataDirectory} from '../src/client/world-storage.ts';
const directories: string[]=[];
afterEach(async()=>{for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true});});
async function rig(){const dataDir=await mkdtemp(join(tmpdir(),'world-storage-'));directories.push(dataDir);return {dataDir,id:'mymc',entries:['minecraft-world.json','minecraft-memory']};}
describe('isolated World storage and reviewed legacy copy',()=>{
  it('isolates fresh Worlds and leaves parent/other host files unchanged',async()=>{
    const options=await rig();await writeFile(join(options.dataDir,'host-memory.json'),'personal');
    await prepareWorldStorage(options);await prepareWorldStorage({...options,id:'another'});
    expect(worldDataDirectory(options.dataDir,'mymc')).not.toBe(worldDataDirectory(options.dataDir,'another'));
    expect((await planWorldStorage(options)).initialized).toBe(true);
    expect(await readFile(join(options.dataDir,'host-memory.json'),'utf8')).toBe('personal');
  });
  it('requires a current plan, retains bytes/scopes and originals, and resumes identical partial copies',async()=>{
    const options=await rig(),body='{"realm":"old","revision":4,"unknown":null}';
    await writeFile(join(options.dataDir,'minecraft-world.json'),body);
    await mkdir(join(options.dataDir,'minecraft-memory'));await writeFile(join(options.dataDir,'minecraft-memory','book.json'),body);
    await expect(prepareWorldStorage(options)).rejects.toThrow('review');
    const first=await planWorldStorage(options);await mkdir(first.target);await writeFile(join(first.target,'minecraft-world.json'),body);
    await expect(copyWorldStorage(options,first.planId)).rejects.toThrow('changed');
    const reviewed=await planWorldStorage(options);expect((await copyWorldStorage(options,reviewed.planId)).initialized).toBe(true);
    expect(await readFile(join(first.target,'minecraft-memory/book.json'),'utf8')).toBe(body);
    expect(await readFile(join(options.dataDir,'minecraft-world.json'),'utf8')).toBe(body);
    await prepareWorldStorage(options);
  });
  it('refuses changed sources and conflicting destinations without overwriting either',async()=>{
    const options=await rig();await writeFile(join(options.dataDir,'minecraft-world.json'),'old');const plan=await planWorldStorage(options);
    await writeFile(join(options.dataDir,'minecraft-world.json'),'new');await expect(copyWorldStorage(options,plan.planId)).rejects.toThrow('changed');
    await mkdir(plan.target);await writeFile(join(plan.target,'minecraft-world.json'),'owned');const conflict=await planWorldStorage(options);
    await expect(copyWorldStorage(options,conflict.planId)).rejects.toThrow('conflicts');
    expect(await readFile(join(plan.target,'minecraft-world.json'),'utf8')).toBe('owned');
  });
  it('rejects traversal and junctions instead of importing another extension',async()=>{
    const options=await rig();await expect(planWorldStorage({...options,entries:['../private']})).rejects.toThrow('top-level');
    const outside=await mkdtemp(join(tmpdir(),'other-world-'));directories.push(outside);
    await symlink(outside,join(options.dataDir,'minecraft-memory'),process.platform==='win32'?'junction':'dir');
    await expect(planWorldStorage(options)).rejects.toThrow('symlinks');expect(()=>worldDataDirectory(options.dataDir,'../bad')).toThrow();
  });
});
