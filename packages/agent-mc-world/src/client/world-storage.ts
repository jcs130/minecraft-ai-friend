import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile, link, lstat, mkdir, readFile, readdir, unlink, writeFile, chmod} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';

const MARKER = '.world-storage.json';
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Bound actual file work, and settle in-flight work before returning a failure. */
async function eachFile<T>(items: readonly T[], visit: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0, failed = false, failure: unknown;
  await Promise.all(Array.from({length: Math.min(8, items.length)}, async () => {
    while (!failed && cursor < items.length) {
      const item = items[cursor++];
      try { await visit(item); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }));
  if (failed) throw failure;
}
// Keep the previous sorted depth-first file order, independently of I/O completion order.
const storageOrder = (a: string, b: string) => {
  const left = a.split('/'), right = b.split('/');
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return left.length - right.length;
};
async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function worldDataDirectory(dataDir: string, id: string): string {
  if (!isAbsolute(dataDir) || !/^[a-z][a-z0-9_-]{0,63}$/.test(id)) throw Error('An absolute data directory and a World id are required');
  return join(resolve(dataDir), id);
}
export interface WorldStorageOptions {dataDir: string; id: string; entries: readonly string[]}
export interface WorldStoragePlan {
  schema: 'agent-mc-world-storage/v1'; id: string; source: string; target: string;
  files: Array<{path: string; bytes: number; sha256: string; existing: boolean}>;
  conflicts: string[]; planId: string; required: boolean; initialized: boolean;
}
async function safePath(root: string, file: string): Promise<void> {
  const rel = relative(root, file);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) throw Error('Storage path escapes its root');
  let current = root;
  for (const part of ['', ...rel.split(/[\\/]/).filter(Boolean)]) {
    current = part ? join(current, part) : current;
    try { if ((await lstat(current)).isSymbolicLink()) throw Error('World storage refuses symlinks or junctions'); }
    catch (e) { if (missing(e)) return; throw e; }
  }
}
async function marker(options: WorldStorageOptions): Promise<boolean> {
  const target = worldDataDirectory(options.dataDir, options.id);
  await safePath(resolve(options.dataDir), join(target, MARKER));
  try {
    const value = JSON.parse(await readFile(join(target, MARKER), 'utf8'));
    if (value.schema !== 'agent-mc-world-storage/v1' || value.id !== options.id || value.completed !== true)
      throw Error('Invalid World storage marker');
    return true;
  } catch (e) { if (missing(e)) return false; throw e; }
}

/** Explicit allowlist; neither configuration, a lease nor unknown host state is discovered implicitly. */
export async function planWorldStorage(options: WorldStorageOptions): Promise<WorldStoragePlan> {
  const source = resolve(options.dataDir), target = worldDataDirectory(source, options.id);
  await safePath(source, source); await safePath(source, target);
  const initialized = await marker(options);
  const files: WorldStoragePlan['files'] = [], conflicts: string[] = [];
  let pending = initialized ? [] : [...new Set(options.entries)].sort();
  for (const entry of pending) {
    if (!entry || entry === '.' || entry === '..' || entry === options.id || /[\\/:]/.test(entry))
      throw Error('Legacy entries must be explicit top-level names outside the new namespace');
  }
  while (pending.length) {
    const next: string[] = [];
    await eachFile(pending, async name => {
      const input = join(source, name), output = join(target, name);
      await safePath(source, input); await safePath(source, output);
      let info; try { info = await lstat(input); } catch (e) { if (missing(e)) return; throw e; }
      if (info.isDirectory()) { next.push(...(await readdir(input)).map(child => join(name, child))); return; }
      if (!info.isFile()) throw Error('Legacy storage contains a non-regular file');
      const sha256 = await hashFile(input); let existing = false;
      try { const dest = await lstat(output); existing = true;
        if (!dest.isFile() || await hashFile(output) !== sha256) conflicts.push(name.replaceAll('\\', '/'));
      } catch (e) { if (!missing(e)) throw e; }
      files.push({path: name.replaceAll('\\', '/'), bytes: info.size, sha256, existing});
    });
    pending = next;
  }
  files.sort((a, b) => storageOrder(a.path, b.path));
  conflicts.sort(storageOrder);
  return {schema: 'agent-mc-world-storage/v1', id: options.id, source, target, files, conflicts,
    planId: digest([options.id, source, target, files]), required: !initialized && files.length > 0, initialized};
}
async function finish(options: WorldStorageOptions, value: unknown): Promise<void> {
  const target = worldDataDirectory(options.dataDir, options.id); await safePath(resolve(options.dataDir), target);
  await mkdir(target, {recursive: true, mode: 0o700});
  const file = join(target, MARKER), temp = file + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  try { await link(temp, file); } finally { await unlink(temp).catch(() => {}); }
}

/** Initialize only empty/new storage. Existing legacy records require a reviewed copy plan. */
export async function prepareWorldStorage(options: WorldStorageOptions): Promise<void> {
  const plan = await planWorldStorage(options); if (plan.initialized) return;
  if (plan.required) throw Error('Legacy World data needs review in the storage migration panel before connecting');
  await finish(options, {schema: plan.schema, id: plan.id, completed: true, mode: 'fresh', at: new Date().toISOString()});
}

/** Copies to the namespace; originals and conflicting destinations are never replaced or removed. */
export async function copyWorldStorage(options: WorldStorageOptions, expectedPlanId: string): Promise<WorldStoragePlan> {
  const plan = await planWorldStorage(options);
  if (plan.planId !== expectedPlanId || plan.initialized) throw Error('Storage plan changed; review the latest plan');
  if (plan.conflicts.length) throw Error('Storage destination conflicts; no original or destination was overwritten');
  // A staging directory contains only files from this operation and is never adopted as a World.
  await mkdir(plan.target, {recursive: true, mode: 0o700});
  await eachFile(plan.files, async file => {
    const input = join(plan.source, file.path), output = join(plan.target, file.path);
    await safePath(plan.source, input); await safePath(plan.source, output);
    if (await hashFile(input) !== file.sha256) throw Error('Legacy storage changed during migration');
    if (file.existing) return;
    await mkdir(dirname(output), {recursive: true, mode: 0o700});
    const temp = output + '.' + randomUUID() + '.import';
    try {
      await copyFile(input, temp); await chmod(temp, 0o600);
      if (await hashFile(temp) !== file.sha256 || await hashFile(input) !== file.sha256) throw Error('Legacy copy changed');
      await link(temp, output); // Atomic exclusive adoption; an active destination is never replaced.
    } finally { await unlink(temp).catch(() => {}); }
  });
  const verified = await planWorldStorage(options);
  if (verified.conflicts.length || verified.files.length !== plan.files.length
    || verified.files.some((f, i) => !f.existing || f.path !== plan.files[i].path || f.sha256 !== plan.files[i].sha256))
    throw Error('Storage changed before completion; retained copies require reconciliation');
  await finish(options, {...plan, completed: true, mode: 'copy', at: new Date().toISOString(), originalsRetained: true});
  return {...verified, initialized: true, required: false};
}
