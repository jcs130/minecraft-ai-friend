import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
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
    else files.set(name, { bytes, contentType: TYPES[name], etag: `W/"${entry.sha256}"`,
      encodings: { gzip: gzipSync(bytes, { level: 6 }), br: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) } });
  }
  const build = { browserBundleSha256: sha(files.get('client.js').bytes), consoleBundleSha256: sha(files.get('native-console.js').bytes) };
  return { build, manifest, file(name) { return files.get(name === 'index.js' ? 'native-console.js' : name) ?? null; },
    // Only operator-built, hash-checked application code is public/cacheable.
    // No publisher files, models, inventories, or role-specific CSS enter here.
    staticFile(resource) {
      const match = /^([a-f0-9]{64})\/(client\.js|native-console\.js)$/.exec(resource);
      return match && manifest.files[match[2]]?.sha256 === match[1] ? files.get(match[2]) : null;
    },
    page(basePath, viewerBuild, mode = 'first', { staticPrefix = '/watch/_static' } = {}) {
      if (!/^\/(?:[A-Za-z0-9_-]+\/)+$/.test(basePath) || !pages.has(mode) || !BUILD_PATTERN.test(viewerBuild)) throw Error('SPECTATOR_PAGE_INVALID');
      if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(staticPrefix)) throw Error('SPECTATOR_PAGE_INVALID');
      let html = pages.get(mode).replaceAll(BASE, basePath);
      for (const [alias, name] of [['index.js', 'native-console.js'], ['native-console.js', 'native-console.js'], ['client.js', 'client.js']]) {
        html = html.replaceAll(`src="${basePath}${alias}"`, `src="${staticPrefix}/${manifest.files[name].sha256}/${name}"`);
      }
      return Buffer.from(html.replace(/<head\b[^>]*>/i,
        head => head + '<meta name="native-viewer-build" content="' + viewerBuild + '">'));
    } };
}
