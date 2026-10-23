import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(resolve(root, 'release-sources.json'), 'utf8')).viewer;
const input = process.argv[2];
if (!input) throw new Error('Provide the explicitly prepared mc-visual-console archive path. No network download is performed.');
const bytes = await readFile(resolve(input));
if (createHash('sha256').update(bytes).digest('hex') !== lock.sha256)
  throw new Error('Viewer archive does not match release-sources.json');
const target = resolve(root, lock.artifact);
if (!target.startsWith(resolve(root, 'vendor') + sep))
  throw new Error('Viewer artifact must be inside this package vendor directory');
await mkdir(dirname(target), { recursive: true });
if (resolve(input) !== target) await copyFile(resolve(input), target);
console.log('Locked viewer archive prepared; build can now run offline.');
