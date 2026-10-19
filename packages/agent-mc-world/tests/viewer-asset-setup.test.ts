import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { prepareMinecraftViewerAssets, type ViewerAssetProgress } from '../src/client/viewer-assets.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const hash = (bytes: Uint8Array, algorithm: string) => createHash(algorithm).update(bytes).digest('hex');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mc-viewer-setup-')); roots.push(root);
  const templateDir = join(root, 'template'), cacheDir = join(root, 'cache'); await mkdir(templateDir);
  const bytes = Buffer.from('OggS test fixture resource');
  const source = { sha1: hash(bytes, 'sha1'), sha256: hash(bytes, 'sha256'), bytes: bytes.length };
  const files = ['public/sounds/note/a.ogg', 'versions/1.20.6/public/sounds/note/a.ogg'].map(file => ({ file, ...source }));
  await writeFile(join(templateDir, 'audio-downloads.json'), JSON.stringify({ schema: 'agent-mc-viewer-audio/v1', files }));
  await writeFile(join(templateDir, 'index.html'), 'viewer fixture');
  return { templateDir, cacheDir, bytes, files };
}

describe('explicit complete viewer resource preparation', () => {
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
    await writeFile(join(f.templateDir, 'audio-downloads.json'), JSON.stringify({ schema: 'agent-mc-viewer-audio/v1', files: [{ ...f.files[0], file: 'public/sounds/../../secret.ogg' }] }));
    const fetch = vi.fn();
    await expect(prepareMinecraftViewerAssets({ ...f, fetch })).rejects.toThrow('catalog entry'); expect(fetch).not.toHaveBeenCalled();
  });
});
