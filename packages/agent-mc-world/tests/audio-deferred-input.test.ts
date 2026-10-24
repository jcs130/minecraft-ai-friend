import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deferViewerAudio} from '../scripts/defer-viewer-audio.mjs';
it('keeps verified deferred audio and original download hashes when a new viewer build reuses exact-version assets',async()=>{
  const d=await mkdtemp(join(tmpdir(),'mc-audio-input-'));
  try{
    await mkdir(join(d,'public/sounds'),{recursive:true});const bytes=Buffer.from('original audio fixture'),sha1=createHash('sha1').update(bytes).digest('hex');
    await writeFile(join(d,'public/sounds/manifest.json'),JSON.stringify({files:{'sample.ogg':sha1}}));
    await writeFile(join(d,'public/sounds/sample.ogg'),bytes);
    await deferViewerAudio(d,'a'.repeat(64));
    const before=JSON.parse(await readFile(join(d,'audio-downloads.json'),'utf8'));
    expect(await deferViewerAudio(d,'b'.repeat(64))).toMatchObject({files:1,uniqueFiles:1});
    const after=JSON.parse(await readFile(join(d,'audio-downloads.json'),'utf8'));
    expect(after.files).toEqual(before.files);expect(after.viewerArchiveSha256).toBe('b'.repeat(64));
    after.files[0].sha1='c'.repeat(40);await writeFile(join(d,'audio-downloads.json'),JSON.stringify(after));
    await expect(deferViewerAudio(d,'b'.repeat(64))).rejects.toThrow(/matching verified deferred/);
  }finally{await rm(d,{recursive:true,force:true});}
});
