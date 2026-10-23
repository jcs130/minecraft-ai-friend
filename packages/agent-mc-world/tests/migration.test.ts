import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {copyLegacyData,planLegacyConfiguration} from '../src/client/migration.ts';
it('preserves settings while separating host inference from game execution without activation',()=>{
  const input={worlds:{mymc:{host:'server.invalid',username:'Cormy',enabled:true,escapeCommand:'/mycli goto arena',
    combatDecision:{enabled:true,endpoint:'http://model.invalid'},idle:{enabled:true,selector:'decision',endpoint:'http://idle.invalid'},unknown:'retain'}}};
  const plan=planLegacyConfiguration(input);
  expect(plan).toMatchObject({core:{enabled:false,escapeCommand:'',idle:{enabled:false,selector:'random'}},
    host:{combatDecision:{endpoint:'http://model.invalid'}},server:{escapeCommand:'/mycli goto arena'},unused:{unknown:'retain'},original:input,connectionStarted:false});
  expect(input.worlds.mymc.enabled).toBe(true);
});
it('copies execution ledgers and archives all original host data, never overwriting or migrating a live lease',async()=>{
  const root=mkdtempSync(join(tmpdir(),'mc-migrate-')),source=join(root,'old'),target=join(root,'new');mkdirSync(source);
  try {
    writeFileSync(join(source,'minecraft-world.json'),'原目标、修订和证据');writeFileSync(join(source,'memory.json'),'host memory');
    writeFileSync(join(source,'connection.lock'),'old process');
    const report=await copyLegacyData(source,target);
    expect(report.files).toHaveLength(3);
    expect(readFileSync(join(target,'minecraft-world.json'),'utf8')).toBe('原目标、修订和证据');
    expect(readFileSync(join(target,'legacy-originals/memory.json'),'utf8')).toBe('host memory');
    expect(report.files.find(f=>f.source==='connection.lock')?.restored).toBeUndefined();
    await expect(copyLegacyData(source,target)).rejects.toThrow();
    await expect(copyLegacyData(source,join(source,'recursive'))).rejects.toThrow('outside');
    expect(readFileSync(join(source,'memory.json'),'utf8')).toBe('host memory');
  }finally{rmSync(root,{recursive:true,force:true});}
});
