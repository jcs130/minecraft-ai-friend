import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BUILD_PATTERN } from './spectator-protocol.mjs';

const BASE = '/__mc_spectator_base__/';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const TYPES = { 'native-console.js': 'text/javascript', 'client.js': 'text/javascript', 'viewer.css': 'text/css' };

// Read only an operator-deployed build, never files supplied by a publisher.
export async function loadSpectatorSite(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'spectator-site.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.protocol !== 'mc-spectator/1') throw Error('SPECTATOR_SITE_MANIFEST');
  const files = new Map(), pages = new Map();
  for (const name of [...Object.keys(TYPES), 'first.html', 'third.html', '3dview.html']) {
    const bytes = await readFile(path.join(directory, name)), entry = manifest.files?.[name];
    if (!entry || entry.bytes !== bytes.length || entry.sha256 !== sha(bytes)) throw Error('SPECTATOR_SITE_INTEGRITY');
    if (name.endsWith('.html')) pages.set(name.slice(0, -5), bytes.toString('utf8'));
    else files.set(name, { bytes, contentType: TYPES[name] });
  }
  const build = { browserBundleSha256: sha(files.get('client.js').bytes), consoleBundleSha256: sha(files.get('native-console.js').bytes) };
  return { build, manifest, file(name) { return files.get(name === 'index.js' ? 'native-console.js' : name) ?? null; },
    page(basePath, viewerBuild, mode = 'first') {
      if (!/^\/(?:[A-Za-z0-9_-]+\/)+$/.test(basePath) || !pages.has(mode) || !BUILD_PATTERN.test(viewerBuild)) throw Error('SPECTATOR_PAGE_INVALID');
      return Buffer.from(pages.get(mode).replaceAll(BASE, basePath).replace(/<head\b[^>]*>/i,
        head => head + '<meta name="native-viewer-build" content="' + viewerBuild + '">'));
    } };
}
