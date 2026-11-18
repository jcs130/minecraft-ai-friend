import { copyFile, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const { name, version, description, license, engines, private: isPrivate } =
  JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const entry = { types: './lib/index.d.ts', import: './lib/index.js' };
const manifest = { name, version, description, license, engines, private: isPrivate, type: 'module',
  main: entry.import, types: entry.types, exports: { '.': entry }, files: ['lib', 'README.md', 'LICENSE'] };
await copyFile(new URL('../../LICENSE', root), new URL('dist/LICENSE', root));
await copyFile(new URL('README.md', root), new URL('dist/README.md', root));
await writeFile(new URL('dist/package.json', root), JSON.stringify(manifest, null, 2) + '\n');
