import { cp, link, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';

export interface ViewerAssetProgress {
  phase: 'copying' | 'downloading' | 'ready'; completed: number; total: number; downloaded: number; bytes: number;
}
/** Base files can be served before all content-addressed audio entries are ready. */
export interface ViewerAssetBase { directory: string; total: number }
export interface ViewerAssetOptions {
  templateDir: string;
  cacheDir: string;
  signal?: AbortSignal;
  /** Called once after template/catalog checks, before downloading audio. Not an audio-ready signal. */
  onBaseReady?(base: ViewerAssetBase): void | Promise<void>;
  onProgress?(progress: ViewerAssetProgress): void;
  /** Explicit transport injection for hosts and isolated tests. URLs remain official, content addressed. */
  fetch?: typeof globalThis.fetch;
}
interface AudioEntry { file: string; sha1: string; sha256: string; bytes: number }
const hash = (bytes: Uint8Array, algorithm: string) => createHash(algorithm).update(bytes).digest('hex');
const inside = (base: string, name: string) => {
  const target = resolve(base, name);
  if (!target.startsWith(resolve(base) + sep)) throw new Error('Viewer asset path escaped the cache.');
  return target;
};
async function matches(file: string, entry: AudioEntry): Promise<boolean> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Viewer cache must contain regular files, not symbolic links.');
    const bytes = await readFile(file); return bytes.length === entry.bytes && hash(bytes, 'sha256') === entry.sha256;
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Explicit, resumable preparation. No game/model connection; private full bundles need no download. */
export async function prepareMinecraftViewerAssets(options: ViewerAssetOptions): Promise<{ directory: string; downloaded: number; total: number }> {
  options.signal?.throwIfAborted();
  const marker = join(options.templateDir, 'audio-downloads.json');
  let text: string;
  try { text = await readFile(marker, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    options.signal?.throwIfAborted();
    await options.onBaseReady?.({ directory: options.templateDir, total: 0 });
    options.signal?.throwIfAborted();
    return { directory: options.templateDir, downloaded: 0, total: 0 };
  }
  const catalog = JSON.parse(text) as { schema: string; viewerArchiveSha256: string; files: AudioEntry[] };
  if (catalog.schema !== 'agent-mc-viewer-audio/v1' || !/^[a-f0-9]{64}$/.test(catalog.viewerArchiveSha256)
    || !Array.isArray(catalog.files) || catalog.files.length > 20000)
    throw new Error('Unsupported viewer audio catalog.');
  for (const entry of catalog.files) {
    if (!/^(?:versions\/[0-9.]+\/)?public\/sounds\/[A-Za-z0-9_./-]+\.ogg$/.test(entry.file)
      || entry.file.split('/').some(part => part === '..' || part === '.')
      || !/^[a-f0-9]{40}$/.test(entry.sha1) || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > 100 * 1024 * 1024)
      throw new Error('Invalid viewer audio catalog entry.');
  }
  const groups = new Map<string, AudioEntry[]>();
  for (const entry of catalog.files) {
    const group = groups.get(entry.sha1) ?? [];
    if (group.some(other => other.sha256 !== entry.sha256 || other.bytes !== entry.bytes)) throw new Error('Conflicting viewer audio hashes.');
    group.push(entry); groups.set(entry.sha1, group);
  }
  const id = hash(Buffer.from(text), 'sha256').slice(0, 24);
  const directory = inside(options.cacheDir, `viewer-${id}`), objects = inside(options.cacheDir, 'audio-objects');
  const progress: ViewerAssetProgress = { phase: 'copying', completed: 0, total: catalog.files.length, downloaded: 0, bytes: 0 };
  const report = () => { try { options.onProgress?.({ ...progress }); } catch { /* Observation does not change preparation. */ } };
  options.signal?.throwIfAborted(); report();
  await mkdir(directory, { recursive: true }); await mkdir(objects, { recursive: true });
  for (const folder of [directory, objects]) if ((await lstat(folder)).isSymbolicLink()) throw new Error('Viewer cache directories must not be symbolic links.');
  // Copy only package-owned viewer templates. Downloaded files live in the deployment cache, never node_modules.
  if (resolve(options.templateDir) !== directory)
    await cp(options.templateDir, directory, { recursive: true, force: false, errorOnExist: false, filter: async (source, target) => {
      options.signal?.throwIfAborted();
      if ((await lstat(source)).isSymbolicLink()) throw new Error('Viewer templates must not contain symbolic links.');
      try { if ((await lstat(target)).isSymbolicLink()) throw new Error('Viewer cache must not contain symbolic links.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      return true;
    } });
  options.signal?.throwIfAborted();
  await options.onBaseReady?.({ directory, total: catalog.files.length });
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const pending = [...groups.values()]; let cursor = 0;
  progress.phase = 'downloading'; report();
  const worker = async () => {
    while (cursor < pending.length) {
      signal.throwIfAborted();
      const entries = pending[cursor++], entry = entries[0], object = inside(objects, entry.sha1);
      if (!await matches(object, entry)) {
        // Reuse a verified installed file on a retry; never trust a completion flag alone.
        const existing = entries.find(item => item.file === entry.file)!;
        const local = inside(directory, existing.file);
        if (await matches(local, entry)) {
          await cp(local, object);
        } else {
          const response = await (options.fetch ?? globalThis.fetch)(`https://resources.download.minecraft.net/${entry.sha1.slice(0, 2)}/${entry.sha1}`,
            { signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]), redirect: 'error' });
          if (!response.ok || !response.body) throw new Error(`Minecraft audio download failed (${response.status}). Retry to resume.`);
          const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
          try {
            while (true) {
              const chunk = await reader.read(); if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > entry.bytes) throw new Error('Minecraft audio exceeded its verified size.');
              chunks.push(chunk.value);
            }
          } finally { await reader.cancel().catch(() => {}); }
          const bytes = Buffer.concat(chunks);
          if (bytes.length !== entry.bytes || hash(bytes, 'sha1') !== entry.sha1 || hash(bytes, 'sha256') !== entry.sha256)
            throw new Error('Minecraft audio integrity verification failed. Retry to resume.');
          const temporary = object + '.' + randomUUID() + '.partial';
          try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, object); }
          finally { await rm(temporary, { force: true }); }
          progress.downloaded++; progress.bytes += bytes.length;
        }
      }
      for (const item of entries) {
        const target = inside(directory, item.file);
        if (!await matches(target, item)) {
          await mkdir(dirname(target), { recursive: true });
          await rm(target, { force: true });
          try { await link(object, target); } catch { await cp(object, target); }
        }
        progress.completed++; report();
      }
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(8, pending.length) }, async () => {
    try { await worker(); } catch (error) { controller.abort(error); throw error; }
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  signal.throwIfAborted();
  progress.phase = 'ready'; report();
  return { directory, downloaded: progress.downloaded, total: progress.total };
}
