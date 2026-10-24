import { readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Keep the full resource index; obtain exact Mojang audio on explicit first setup instead of npm. */
export async function deferViewerAudio(viewer, viewerArchiveSha256) {
  if (!/^[a-f0-9]{64}$/.test(viewerArchiveSha256)) throw new Error('A verified viewer archive identity is required');
  const roots = [''];
  for (const entry of await readdir(join(viewer, 'versions'), { withFileTypes: true }).catch(() => []))
    if (entry.isDirectory() && /^[0-9.]+$/.test(entry.name)) roots.push(`versions/${entry.name}/`);
  const files = [];
  const previous=await readFile(join(viewer,'audio-downloads.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const deferred=new Map();
  if(previous){
    if(previous.schema!=='agent-mc-viewer-audio/v1'||previous.source!=='https://resources.download.minecraft.net'||!Array.isArray(previous.files))throw Error('Invalid deferred audio index');
    for(const row of previous.files){
      if(typeof row.file!=='string'||!/^(?:versions\/[0-9.]+\/)?public\/sounds\/[A-Za-z0-9_./-]+\.ogg$/.test(row.file)
        ||row.file.split('/').some(part=>part==='.'||part==='..')||deferred.has(row.file)
        ||!/^[a-f0-9]{40}$/.test(row.sha1)||!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>64*1024*1024)
        throw Error('Invalid deferred audio record');
      deferred.set(row.file,row);
    }
  }
  for (const prefix of roots) {
    const raw = await readFile(join(viewer, prefix, 'public/sounds/manifest.json'), 'utf8').catch(async error => {
      if (error.code !== 'ENOENT') throw error;
      const receipt = JSON.parse(await readFile(join(viewer, prefix, 'viewer-assets.json'), 'utf8'));
      if (receipt.audio?.requested !== false || receipt.audio?.status !== 'disabled') throw error;
      return null; // An explicitly silent version never borrows another version's audio.
    });
    if (raw === null) continue;
    const manifest = JSON.parse(raw);
    for (const [name, sha1] of Object.entries(manifest.files)) {
      if (!/^[A-Za-z0-9_./-]+\.ogg$/.test(name) || name.split('/').some(part => part === '.' || part === '..') || !/^[a-f0-9]{40}$/.test(sha1))
        throw new Error('Invalid source audio index');
      const file = prefix + 'public/sounds/' + name, path = join(viewer, file), bytes = await readFile(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(bytes===null){
        const prior=deferred.get(file);
        if(!prior||prior.sha1!==sha1)throw Error('Missing original audio without a matching verified deferred record: '+name);
        files.push({file,sha1,sha256:prior.sha256,bytes:prior.bytes});deferred.delete(file);continue;
      }
      if (createHash('sha1').update(bytes).digest('hex') !== sha1) throw new Error('Source audio differs from Mojang index: ' + name);
      files.push({ file, sha1, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
      deferred.delete(file);
      await rm(path);
    }
  }
  if(deferred.size)throw Error('Deferred audio index contains entries outside the packaged exact-version manifests');
  await writeFile(join(viewer, 'audio-downloads.json'), JSON.stringify({ schema: 'agent-mc-viewer-audio/v1', viewerArchiveSha256,
    source: 'https://resources.download.minecraft.net', files }) + '\n');
  return { mode: 'explicit-first-setup', files: files.length, uniqueFiles: new Set(files.map(file => file.sha1)).size };
}
