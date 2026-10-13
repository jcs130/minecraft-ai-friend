import { itemHeadProfile, minecraftTextureHash } from './viewer-item-profile.mjs';

// Same-origin proxy for profiles actually received on the subject connection.
// This is not an arbitrary URL loader; unknown hashes never trigger a request.
export function createViewerHeadTextures({ fetcher = fetch, now = Date.now, limit = 128 } = {}) {
  const allowed = new Map(), cache = new Map(), pending = new Map(), failures = new Map();
  const remember = hash => {
    if (!hash) return;
    allowed.delete(hash); allowed.set(hash, true);
    while (allowed.size > limit) { const first = allowed.keys().next().value; allowed.delete(first); cache.delete(first); failures.delete(first); }
  };
  const observeItem = item => { const hash = itemHeadProfile(item)?.hash; remember(hash); return hash; };
  const observeBot = bot => {
    for (const item of bot.inventory?.slots ?? []) observeItem(item);
    for (const item of bot.currentWindow?.slots ?? []) observeItem(item);
    observeItem(bot.currentWindow?.selectedItem ?? bot.inventory?.selectedItem);
    for (const entity of Object.values(bot.entities ?? {})) {
      for (const item of entity.equipment ?? []) observeItem(item);
      try { observeItem(entity.getDroppedItem?.()); } catch { /* Not a dropped item. */ }
    }
    for (const player of Object.values(bot.players ?? {})) remember(minecraftTextureHash(player.skinData?.url));
  };
  async function read(hash) {
    if (!allowed.has(hash)) return null;
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
        if (!allowed.has(hash)) return null;
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
  return { observeItem, observeBot, read, serve };
}
