import { Buffer } from 'node:buffer';
import { itemHeadProfile, minecraftTextureHash } from './viewer-item-profile.mjs';
import {playerSkinTexture} from './viewer-player-profile.mjs';

// Same-origin proxy for profiles actually received on the subject connection.
// This is not an arbitrary URL loader; unknown hashes never trigger a request.
export function createViewerHeadTextures({ fetcher = fetch, now = Date.now, limit = 128 } = {}) {
  const allowed = new Map(), cache = new Map(), pending = new Map(), failures = new Map();
  // Two bounded pools: per-request bot rescans (inventory, entities, every tab-list skin) must not
  // evict profiles that were only delivered once in block-entity or entity frames.
  const delivered = new Map();
  const permitted = hash => allowed.has(hash) || delivered.has(hash);
  const rememberIn = (pool, hash) => {
    if (!hash) return;
    pool.delete(hash); pool.set(hash, true);
    while (pool.size > limit) {
      const first = pool.keys().next().value; pool.delete(first);
      if (!permitted(first)) { cache.delete(first); failures.delete(first); }
    }
  };
  const remember = hash => rememberIn(allowed, hash);
  const rememberDelivered = hash => rememberIn(delivered, hash);
  const observeItem = item => { const hash = itemHeadProfile(item)?.hash; remember(hash); return hash; };
  // Profiles already delivered as block entities or derived item visuals use the
  // same allowlist. Bounded scan; it only records hashes, never fetches.
  const scanValue = (value, budget = { nodes: 4096 }, depth = 0) => {
    if (depth > 24 || --budget.nodes < 0 || value == null) return;
    if (typeof value === 'string') {
      if (value.length > 16384) return;
      for (const m of value.matchAll(/https?:\/\/textures\.minecraft\.net\/texture\/[0-9a-fA-F]{40,64}/g)) rememberDelivered(minecraftTextureHash(m[0]));
      if (value.length >= 60 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        try { const text = Buffer.from(value, 'base64').toString('utf8'); if (text.includes('textures.minecraft.net')) scanValue(JSON.parse(text), budget, depth + 1); } catch { /* Not a profile. */ }
      }
      return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const v of value.slice(0, 256)) scanValue(v, budget, depth + 1); return; }
    for (const [key, v] of Object.entries(value).slice(0, 256)) {
      if (key === 'headTextureHash' && typeof v === 'string' && /^[0-9a-f]{40,64}$/.test(v)) rememberDelivered(v);
      else scanValue(v, budget, depth + 1);
    }
  };
  // Snapshots are maps of many block entities/entities: give each entry its own node budget so a
  // large chunk snapshot cannot starve skulls that happen to be serialised last.
  const observeValue = value => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const entry of Object.values(value).slice(0, 4096)) scanValue(entry);
    } else scanValue(value);
  };
  const observeBot = bot => {
    for (const item of bot.inventory?.slots ?? []) observeItem(item);
    for (const item of bot.currentWindow?.slots ?? []) observeItem(item);
    observeItem(bot.currentWindow?.selectedItem ?? bot.inventory?.selectedItem);
    for (const entity of Object.values(bot.entities ?? {})) {
      for (const item of entity.equipment ?? []) observeItem(item);
      try { observeItem(entity.getDroppedItem?.()); } catch { /* Not a dropped item. */ }
    }
    for (const player of Object.values(bot.players ?? {})) remember(playerSkinTexture(player)?.hash);
  };
  async function read(hash) {
    if (!permitted(hash)) return null;
    if (cache.has(hash)) return cache.get(hash);
    if ((failures.get(hash) ?? 0) > now() || pending.size >= 8 && !pending.has(hash)) return null;
    if (!pending.has(hash)) pending.set(hash, (async () => {
      try {
        const response = await fetcher('https://textures.minecraft.net/texture/' + hash, { redirect: 'error', signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw Error('HEAD_TEXTURE_UNAVAILABLE');
        const parts = []; let length = 0;
        for await (const part of response.body) { length += part.length; if (length > 65536) throw Error('HEAD_TEXTURE_BUDGET'); parts.push(part); }
        const bytes = Buffer.concat(parts);
        if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
          || bytes.readUInt32BE(16) !== 64 || ![32, 64].includes(bytes.readUInt32BE(20))) throw Error('HEAD_TEXTURE_FORMAT');
        if (!permitted(hash)) return null;
        cache.set(hash, bytes); return bytes;
      } catch { failures.set(hash, now() + 30_000); return null; }
      finally { pending.delete(hash); }
    })());
    return pending.get(hash);
  }
  async function serve(req, res, pathname, bot) {
    if (!pathname.startsWith('/head-texture/')) return false;
    observeBot(bot);
    const hash = /^\/head-texture\/([0-9a-f]{40,64})\.png$/.exec(pathname)?.[1], bytes = await read(hash);
    res.writeHead(bytes ? 200 : 404, { 'Content-Type': bytes ? 'image/png' : 'text/plain',
      'Cache-Control': bytes ? 'private, max-age=86400' : 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes ?? '原物品贴图暂不可用'); return true;
  }
  return { observeItem, observeBot, observeValue, read, serve };
}
