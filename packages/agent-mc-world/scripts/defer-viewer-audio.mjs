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
      const file = prefix + 'public/sounds/' + name, path = join(viewer, file), bytes = await readFile(path);
      if (createHash('sha1').update(bytes).digest('hex') !== sha1) throw new Error('Source audio differs from Mojang index: ' + name);
      files.push({ file, sha1, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
      await rm(path);
    }
  }
  await writeFile(join(viewer, 'audio-downloads.json'), JSON.stringify({ schema: 'agent-mc-viewer-audio/v1', viewerArchiveSha256,
    source: 'https://resources.download.minecraft.net', files }) + '\n');
  return { mode: 'explicit-first-setup', files: files.length, uniqueFiles: new Set(files.map(file => file.sha1)).size };
}
