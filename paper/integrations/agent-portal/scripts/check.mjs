import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { projectRoot } from '../src/config.mjs';
import path from 'node:path';

let count = 0;
for (const directory of ['src', 'public', 'scripts', 'tests']) {
  const files = await readdir(path.join(projectRoot, directory), { withFileTypes: true });
  for (const file of files) {
    if (!file.isFile() || !/\.(m?js)$/.test(file.name)) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(projectRoot, directory, file.name)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
    count++;
  }
}
console.log(`Syntax checked ${count} JavaScript modules.`);
