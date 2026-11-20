import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rmdir, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import extension from './world.mjs';

// Ship identical runtime source across checkouts. API 5 and 6 use different manifest keys for the panel.
const args = process.argv.slice(2);
const api5 = args[0] === '--api5';
const dest = resolve(args[api5 ? 1 : 0] || process.cwd());
const manifest = JSON.parse(await readFile(new URL('package.json', import.meta.url)));
const dir = await mkdtemp(join(tmpdir(), 'qd-cortico-api6-'));
const sourceFiles = ['world.mjs', 'panel.mjs', 'README.md'];
const files = [...sourceFiles, 'package.json', 'describe.json', 'LICENSE'];
try {
  for (const file of sourceFiles) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    await writeFile(join(dir, file), source.replaceAll('\r\n', '\n'));
  }
  const license = await readFile(new URL('../../../../LICENSE', import.meta.url), 'utf8');
  await writeFile(join(dir, 'LICENSE'), license.replaceAll('\r\n', '\n'));
  if (!api5) {
    manifest.name += '-api6';
    manifest.cortico.api = 6;
    manifest.cortico.webUiClient = manifest.cortico.consoleClient;
    delete manifest.cortico.consoleClient;
    manifest.cortico.describe = 'describe.json';
    manifest.files.push('describe.json');
    await writeFile(join(dir, 'describe.json'), JSON.stringify(extension.describe, null, 2) + '\n');
  }
  delete manifest.scripts;
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--pack-destination', dest],
               {cwd: dir, stdio: 'inherit'});
} finally {
  for (const file of files) await unlink(join(dir, file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(dir);
}
