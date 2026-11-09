import {createHash} from 'node:crypto';

export const MAP_TILE_MANIFEST_LIMIT = 32 * 1024 * 1024;
const tile = /^maps\/(?:overworld|nether|end|aincrad)\/tiles\/\d{1,2}\/x-?\d{1,9}(?:\/\d{1,9}){0,3}\/z-?\d{1,9}(?:\/\d{1,9}){0,3}\.(?:prbm|png)(?:\.gz)?$/;
export const isWorldMapTileKey = key => typeof key === 'string' && tile.test(key);
const fail = reason => Object.assign(new Error(reason), {status:503,reason});

// Only immutable public terrain goes to the CDN. Live positions, player heads,
// account data and the application remain on the existing authenticated service.
export class MapTileCdn {
  constructor(config, readManifest) {
    const url = new URL(config.baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || url.pathname.includes('//') || !/^[a-f0-9]{64}$/.test(config.manifestSha256 || '')
        || typeof readManifest !== 'function') throw fail('MAP_TILE_CDN_CONFIGURATION');
    this.baseUrl = url.href.replace(/\/$/, ''); this.origin = url.origin;
    this.digest = config.manifestSha256; this.readManifest = readManifest;
  }
  async load() {
    if (!this.loading) this.loading = (async () => {
      const bytes = await this.readManifest();
      if (!Buffer.isBuffer(bytes) || bytes.length > MAP_TILE_MANIFEST_LIMIT
          || createHash('sha256').update(bytes).digest('hex') !== this.digest) throw fail('MAP_TILE_MANIFEST_UNVERIFIED');
      const value = JSON.parse(bytes.toString('utf8'));
      if (value.schemaVersion !== 1 || !Array.isArray(value.files) || value.files.length > 200000) throw fail('MAP_TILE_MANIFEST_FORMAT');
      const files = new Map();
      for (const row of value.files) {
        if (!Array.isArray(row) || row.length !== 3 || !isWorldMapTileKey(row[0]) || files.has(row[0])
            || !/^[a-f0-9]{64}$/.test(row[1]) || !Number.isSafeInteger(row[2]) || row[2] < 1 || row[2] > 8 * 1024 * 1024) throw fail('MAP_TILE_MANIFEST_FORMAT');
        files.set(row[0], {sha256:row[1],bytes:row[2]});
      }
      return files;
    })();
    return this.loading;
  }
  async lookup(key) {
    if (!isWorldMapTileKey(key)) return null;
    const files = await this.load();
    const stored = files.has(key) ? key : !key.endsWith('.gz') && files.has(key+'.gz') ? key+'.gz' : null;
    if (!stored) return {known:false};
    return {known:true, url:this.baseUrl+'/'+stored, ...files.get(stored)};
  }
}
