import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadViewerSoundRegistry,validateViewerSoundRegistry} from '../core/viewer-sound-registry.ts';

it('uses only a complete original-client-bound 1.21.1 numeric sound registry',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sound-1211-'));
  // Synthetic names exercise the integrity gate, not a claim of original audio.
  const table={schemaVersion:1,minecraftVersion:'1.21.1',clientJarSha256:'499f6897d1837516680f3114072d8106e11c9adcd933fe5cf051b551089b0c99',
    events:Object.fromEntries(Array.from({length:1611},(_,id)=>[id,{name:`minecraft:test.sound_${id}`}]))};
  await mkdir(join(root,'public/sounds'),{recursive:true});await writeFile(join(root,'public/sounds/registry.json'),JSON.stringify(table));
  const loaded=await loadViewerSoundRegistry(root,'1.21.1',{sounds:{0:{name:'unverified'}}});
  expect(loaded.source).toBe('exact-assets');expect(loaded.registry.sounds?.[1610]?.name).toBe('minecraft:test.sound_1610');
  expect(validateViewerSoundRegistry(table,'1.20.6')).toBeNull();
  expect(validateViewerSoundRegistry({...table,clientJarSha256:'a'.repeat(64)},'1.21.1')).toBeNull();
  delete table.events[0];expect(validateViewerSoundRegistry(table,'1.21.1')).toBeNull();
  const absent=await loadViewerSoundRegistry('','1.21.1',{sounds:{0:{name:'unverified'}}});
  expect(absent.source).toBe('unavailable');expect(absent.registry.sounds).toEqual({});expect(absent.diagnostic).toContain('1.21.1');
});
