import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect,it } from 'vitest';
import { importProfileLearning } from '../scripts/import-profile-learning.mjs';

it('imports attributed legacy methods and only scene records; a second import preserves newer work',()=>{
  const folder=mkdtempSync(join(tmpdir(),'profile-learning-'));
  const origin={profile:'alpha',realm:'test-endpoint',auth:'offline',username:'Player',botName:'Agent',worlds:['mine']};
  const hash=(parts:unknown[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  const scopeKey=hash([JSON.stringify([origin.realm,['vanilla-world','mine']]),'offline:Player','Agent']);
  try{
    const mem=join(folder,'minecraft-memory');mkdirSync(mem);
    const book={version:1,scopeKey,entries:['scene-guide','note'].map(tag=>({versions:[{tags:[tag]}]}))};
    writeFileSync(join(mem,scopeKey+'.json'),JSON.stringify(book));
    const dir=join(folder,'minecraft-methods',hash([origin.realm,origin.auth,origin.username,origin.botName]));
    mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'index.json'),'{}');
    expect(importProfileLearning(folder,origin).map(x=>x.status)).toEqual(['would-import','would-import']);
    expect(importProfileLearning(folder,{...origin,username:'Another'})).toEqual([]);
    const [,scene]=importProfileLearning(folder,origin,true);
    const copied=JSON.parse(readFileSync(scene.target,'utf8'));expect(copied.scopeKey+'.json').not.toBe(scopeKey+'.json');
    expect(copied.entries).toEqual([book.entries[0]]);
    writeFileSync(scene.target,'newer');expect(importProfileLearning(folder,origin,true)[1].status).toBe('destination-exists');
    expect(readFileSync(scene.target,'utf8')).toBe('newer');expect(JSON.parse(readFileSync(scene.source,'utf8'))).toEqual(book);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
