import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { prepareMinecraftViewerAssets, type ViewerAssetBase, type ViewerAssetProgress } from '../src/client/viewer-assets.ts';
// @ts-expect-error The build helper has no SDK declaration surface.
import { deferViewerAudio } from '../scripts/defer-viewer-audio.mjs';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const hash = (bytes: Uint8Array, algorithm: string) => createHash(algorithm).update(bytes).digest('hex');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mc-viewer-setup-')); roots.push(root);
  const templateDir = join(root, 'template'), cacheDir = join(root, 'cache'); await mkdir(templateDir);
  const bytes = Buffer.from('OggS test fixture resource');
  const source = { sha1: hash(bytes, 'sha1'), sha256: hash(bytes, 'sha256'), bytes: bytes.length };
  const files = ['public/sounds/note/a.ogg', 'versions/1.20.6/public/sounds/note/a.ogg'].map(file => ({ file, ...source }));
  await writeFile(join(templateDir, 'audio-downloads.json'), JSON.stringify({ schema: 'agent-mc-viewer-audio/v1', viewerArchiveSha256: 'a'.repeat(64), files }));
  await writeFile(join(templateDir, 'index.html'), 'viewer fixture');
  return { templateDir, cacheDir, bytes, files };
}

describe('explicit complete viewer resource preparation', () => {
  it('exposes the copied base before a slow download, without claiming complete audio', async () => {
    const f = await fixture(), progress: ViewerAssetProgress[] = [];
    let base!: (value: ViewerAssetBase) => void, release!: () => void;
    const baseReady = new Promise<ViewerAssetBase>(resolve => { base = resolve; });
    const download = new Promise<void>(resolve => { release = resolve; });
    let completed = false;
    const pending = prepareMinecraftViewerAssets({ ...f, onBaseReady: base,
      onProgress: row => progress.push(row), fetch: vi.fn(async () => { await download; return new Response(f.bytes); }) });
    void pending.then(() => { completed = true; });
    const ready = await baseReady;
    try {
      expect(ready.total).toBe(2);
      expect(await readFile(join(ready.directory, 'index.html'), 'utf8')).toBe('viewer fixture');
      expect(await readFile(join(ready.directory, f.files[0].file)).catch(() => null)).toBeNull();
      expect(completed).toBe(false); expect(progress.some(row => row.phase === 'ready')).toBe(false);
    } finally { release(); await pending; }
    expect(progress.at(-1)).toMatchObject({ phase: 'ready', completed: 2 });
  });
  it('keeps base readiness distinct from a later download failure and permits retry', async () => {
    const f = await fixture(), onBaseReady = vi.fn(), progress: ViewerAssetProgress[] = [];
    await expect(prepareMinecraftViewerAssets({ ...f, onBaseReady, onProgress: row => progress.push(row),
      fetch: vi.fn(async () => { throw new DOMException('simulated audio timeout', 'TimeoutError'); }) })).rejects.toThrow('simulated audio timeout');
    expect(onBaseReady).toHaveBeenCalledOnce();
    expect(progress.some(row => row.phase === 'ready')).toBe(false);
    const retried = await prepareMinecraftViewerAssets({ ...f, fetch: vi.fn(async () => new Response(f.bytes)) });
    expect(retried.directory).toBe(onBaseReady.mock.calls[0][0].directory);
    expect(await readFile(join(retried.directory, f.files[0].file))).toEqual(f.bytes);
  });
  it('honors cancellation or host failure at the base handoff before starting downloads', async () => {
    const f = await fixture(), controller = new AbortController(), fetch = vi.fn();
    await expect(prepareMinecraftViewerAssets({ ...f, signal: controller.signal, fetch,
      onBaseReady: () => { controller.abort(new Error('closed at handoff')); } })).rejects.toThrow('closed at handoff');
    await expect(prepareMinecraftViewerAssets({ ...f, fetch,
      onBaseReady: async () => { throw new Error('host could not adopt base'); } })).rejects.toThrow('host could not adopt base');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('signals a full offline bundle once and respects an already-cancelled offline preparation', async () => {
    const f = await fixture(); await rm(join(f.templateDir, 'audio-downloads.json'));
    const onBaseReady = vi.fn();
    await prepareMinecraftViewerAssets({ ...f, onBaseReady });
    expect(onBaseReady).toHaveBeenCalledOnce();
    expect(onBaseReady).toHaveBeenCalledWith({ directory: f.templateDir, total: 0 });
    const controller = new AbortController(); controller.abort(new Error('offline stop'));
    await expect(prepareMinecraftViewerAssets({ ...f, onBaseReady, signal: controller.signal })).rejects.toThrow('offline stop');
    expect(onBaseReady).toHaveBeenCalledOnce();
  });
  it('does not hand an invalid hash catalog to a host', async () => {
    const f = await fixture(), onBaseReady = vi.fn(), fetch = vi.fn();
    await writeFile(join(f.templateDir, 'audio-downloads.json'), JSON.stringify({ schema: 'agent-mc-viewer-audio/v1',
      viewerArchiveSha256: 'a'.repeat(64), files: [f.files[0], { ...f.files[1], sha256: 'b'.repeat(64) }] }));
    await expect(prepareMinecraftViewerAssets({ ...f, onBaseReady, fetch })).rejects.toThrow('Conflicting');
    expect(onBaseReady).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('uses a full private bundle without network or writes', async () => {
    const f = await fixture(); await rm(join(f.templateDir, 'audio-downloads.json'));
    const fetch = vi.fn();
    expect(await prepareMinecraftViewerAssets({ ...f, fetch })).toEqual({ directory: f.templateDir, downloaded: 0, total: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('downloads through an actual HTTP transport once per hash, verifies, resumes and keeps templates read only', async () => {
    const f = await fixture(), requested: string[] = [], progress: ViewerAssetProgress[] = [];
    const server = createServer((req, res) => { requested.push(req.url!); res.end(f.bytes); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const transport: typeof fetch = (input, init) => {
      expect(String(input)).toBe(`https://resources.download.minecraft.net/${f.files[0].sha1.slice(0, 2)}/${f.files[0].sha1}`);
      return fetch(`http://127.0.0.1:${port}${new URL(String(input)).pathname}`, init);
    };
    try {
      const prepared = await prepareMinecraftViewerAssets({ ...f, fetch: transport, onProgress: row => progress.push(row) });
      expect(prepared).toMatchObject({ downloaded: 1, total: 2 });
      expect(requested).toHaveLength(1);
      for (const entry of f.files) expect(await readFile(join(prepared.directory, entry.file))).toEqual(f.bytes);
      expect(await readFile(join(prepared.directory, 'index.html'), 'utf8')).toBe('viewer fixture');
      expect(await readFile(join(f.templateDir, f.files[0].file)).catch(() => null)).toBeNull();
      expect(progress.at(-1)).toMatchObject({ phase: 'ready', completed: 2, total: 2 });
      const second = await prepareMinecraftViewerAssets({ ...f, fetch: transport });
      expect(second.directory).toBe(prepared.directory); expect(second.downloaded).toBe(0); expect(requested).toHaveLength(1);
      expect((await prepareMinecraftViewerAssets({ ...f, templateDir: prepared.directory, fetch: transport })).directory).toBe(prepared.directory);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('refuses corrupt or oversized audio instead of recording success; the next attempt can resume', async () => {
    const f = await fixture();
    await expect(prepareMinecraftViewerAssets({ ...f, fetch: vi.fn(async () => new Response('corrupt')) })).rejects.toThrow('integrity');
    await expect(prepareMinecraftViewerAssets({ ...f, fetch: vi.fn(async () => new Response(Buffer.alloc(1000))) })).rejects.toThrow('exceeded');
    const result = await prepareMinecraftViewerAssets({ ...f, fetch: vi.fn(async () => new Response(f.bytes)) });
    expect(result.downloaded).toBe(1);
  });
  it('reports HTTP failure and cancellation without marking preparation ready', async () => {
    const f = await fixture(), progress: ViewerAssetProgress[] = [];
    await expect(prepareMinecraftViewerAssets({ ...f, fetch: vi.fn(async () => new Response('', { status: 503 })), onProgress: row => progress.push(row) })).rejects.toThrow('503');
    expect(progress.some(row => row.phase === 'ready')).toBe(false);
    const controller = new AbortController(); controller.abort(new Error('cancel fixture'));
    const fetch = vi.fn();
    await expect(prepareMinecraftViewerAssets({ ...f, signal: controller.signal, fetch })).rejects.toThrow('cancel fixture');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects traversal or arbitrary URLs before a download', async () => {
    const f = await fixture();
    await writeFile(join(f.templateDir, 'audio-downloads.json'), JSON.stringify({ schema: 'agent-mc-viewer-audio/v1', viewerArchiveSha256: 'a'.repeat(64), files: [{ ...f.files[0], file: 'public/sounds/../../secret.ogg' }] }));
    const fetch = vi.fn();
    await expect(prepareMinecraftViewerAssets({ ...f, fetch })).rejects.toThrow('catalog entry'); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects template links instead of copying or writing outside the cache', async () => {
    const f = await fixture(), outside = join(f.cacheDir, '../outside'); await mkdir(outside);
    await writeFile(join(outside, 'untouched.txt'), 'fixture');
    await symlink(outside, join(f.templateDir, 'public'), process.platform === 'win32' ? 'junction' : 'dir');
    const fetch = vi.fn();
    await expect(prepareMinecraftViewerAssets({ ...f, fetch })).rejects.toThrow('symbolic links');
    expect(fetch).not.toHaveBeenCalled(); expect(await readFile(join(outside, 'untouched.txt'), 'utf8')).toBe('fixture');
  });
  it('changes the prepared viewer when its archive changes even when all audio stays identical', async () => {
    const f = await fixture(), versions = [];
    for (const [label, sha] of [['first', 'a'], ['updated', 'b']]) {
      const template = join(f.templateDir, label); await mkdir(join(template, 'public/sounds/note'), { recursive: true });
      await writeFile(join(template, 'public/sounds/note/a.ogg'), f.bytes);
      await writeFile(join(template, 'public/sounds/manifest.json'), JSON.stringify({ files: { 'note/a.ogg': f.files[0].sha1 } }));
      await writeFile(join(template, 'index.html'), label);
      await deferViewerAudio(template, sha.repeat(64));
      versions.push(await prepareMinecraftViewerAssets({ templateDir: template, cacheDir: f.cacheDir, fetch: vi.fn(async () => new Response(f.bytes)) }));
    }
    expect(versions[1].directory).not.toBe(versions[0].directory);
    expect(await readFile(join(versions[1].directory, 'index.html'), 'utf8')).toBe('updated');
    expect(versions[1].downloaded).toBe(0);
  });
  it('preserves an explicitly silent version, but does not excuse an accidentally missing sound catalogue', async()=>{
    const f=await fixture();
    const primary=join(f.templateDir,'public/sounds'),silent=join(f.templateDir,'versions/1.21.11');
    await mkdir(primary,{recursive:true});await writeFile(join(primary,'manifest.json'),JSON.stringify({files:{}}));
    await mkdir(silent,{recursive:true});
    await expect(deferViewerAudio(f.templateDir,'c'.repeat(64))).rejects.toThrow();
    await writeFile(join(silent,'viewer-assets.json'),JSON.stringify({minecraftVersion:'1.21.11',audio:{requested:false,status:'disabled'}}));
    await expect(deferViewerAudio(f.templateDir,'c'.repeat(64))).resolves.toMatchObject({files:0});
    expect((await readFile(join(f.templateDir,'audio-downloads.json'),'utf8'))).not.toContain('1.21.1/');
  });
});
