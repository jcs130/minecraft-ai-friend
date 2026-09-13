// ---------- 小地图地形 tile 服务（2026-08-26：面板小地图「没有东西」根治） ----------
// 复用 Goddess bot 已载入的区块（观察者跟随谁、谁的周边区块就在内存），读顶层块出俯视地形图。
// GET /map.png?cx=&cz=&r=  → r*2 见方 PNG（1px/格），缓存 90s，渲染串行+让路（不卡 viewer 流）。
// 配色与列扫描移植自 sidecar/guard/guard-render-pure.mts（守卫之眼同源，视觉一致）。
import http from 'node:http'
import { PNG } from 'pngjs'
import { Vec3 } from 'vec3'

const MAP_PORT = Number(process.env.MC_MAP_PORT ?? 3060)
const TILE_COLORS: Record<string, [number, number, number]> = {
  grass_block: [106, 170, 64], dirt: [134, 96, 67], coarse_dirt: [119, 85, 59],
  stone: [125, 125, 125], granite: [149, 103, 85], diorite: [188, 188, 191], andesite: [136, 136, 137],
  deepslate: [80, 80, 84], tuff: [108, 109, 102], gravel: [127, 124, 123], sand: [219, 211, 160],
  sandstone: [216, 203, 155], red_sand: [190, 102, 40], snow_block: [240, 246, 246], ice: [145, 183, 251],
  water: [63, 118, 228], flowing_water: [63, 118, 228], lava: [207, 91, 19], flowing_lava: [207, 91, 19],
  oak_log: [109, 84, 51], spruce_log: [58, 37, 16], birch_log: [215, 205, 188], cherry_log: [214, 140, 152],
  oak_leaves: [55, 96, 47], spruce_leaves: [50, 90, 45], birch_leaves: [107, 141, 70], cherry_leaves: [228, 158, 191],
  oak_planks: [162, 130, 78], spruce_planks: [114, 84, 48], birch_planks: [192, 175, 121],
  cobblestone: [110, 110, 110], mossy_cobblestone: [90, 108, 90], stone_bricks: [122, 121, 122],
  bricks: [151, 97, 91], glass: [180, 220, 240], iron_block: [216, 216, 216], gold_block: [246, 208, 61],
  diamond_block: [98, 237, 228], emerald_block: [98, 224, 113], lapis_block: [35, 79, 175],
  coal_ore: [80, 80, 80], iron_ore: [175, 142, 117], copper_ore: [181, 108, 80], gold_ore: [180, 155, 78],
  redstone_ore: [150, 70, 70], diamond_ore: [95, 130, 130], emerald_ore: [100, 160, 110], lapis_ore: [60, 75, 140],
  bedrock: [60, 60, 60], obsidian: [21, 18, 32], glowstone: [220, 190, 110], sea_lantern: [173, 214, 214],
  pumpkin: [196, 118, 21], melon: [108, 154, 24], hay_block: [255, 178, 0], wheat: [218, 182, 67],
  carrot: [255, 255, 255], potato: [255, 255, 255], torch: [230, 170, 60], lantern: [230, 170, 60],
  chest: [140, 100, 50], crafting_table: [120, 90, 50], furnace: [90, 90, 90], bookshelf: [140, 110, 70],
  bed: [200, 60, 60], path: [180, 160, 120], farmland: [110, 70, 40], clay: [160, 170, 180],
  terracotta: [150, 100, 80], bamboo: [100, 140, 60], sugar_cane: [140, 180, 100], cactus: [80, 140, 60],
  lily_pad: [50, 130, 80], seagrass: [60, 120, 90], kelp: [40, 110, 70], kelp_plant: [40, 110, 70],
}
function tileColorFor(name: string): [number, number, number] {
  const c = TILE_COLORS[name]
  if (c) return c
  const n = name || ''
  if (n.includes('leaves')) return [60, 110, 45]
  if (n.includes('log') || n.includes('wood')) return [110, 80, 45]
  if (n.includes('planks') || n.includes('stairs') || n.includes('slab') || n.includes('fence') || n.includes('door')) return [150, 120, 75]
  if (n.includes('ore')) return [90, 90, 90]
  if (n.includes('stone') || n.includes('brick')) return [118, 118, 118]
  if (n.includes('water')) return [63, 118, 228]
  if (n.includes('lava')) return [207, 91, 19]
  if (n.includes('sand')) return [216, 208, 160]
  if (n.includes('glass')) return [170, 190, 200]
  if (n.includes('flower') || n.includes('poppy') || n.includes('tulip') || n.includes('grass')) return [106, 170, 64]
  if (n.includes('snow') || n.includes('ice')) return [230, 240, 245]
  if (n.includes('wool') || n.includes('carpet')) return [190, 160, 170]
  return [127, 127, 127] as [number, number, number]
}
const yieldTick = () => new Promise<void>((r) => setImmediate(r))
async function renderTilePNG(bot: any, cx: number, cz: number, r: number, cancelled = () => false): Promise<Buffer> {
  const size = r * 2
  const png = new PNG({ width: size, height: size })
  const yTop = 110, yBot = -16
  const ox = Math.round(cx) - r, oz = Math.round(cz) - r
  for (let dz = 0; dz < size; dz++) {
    if (cancelled()) throw new Error('map_render_cancelled')
    for (let dx = 0; dx < size; dx++) {
      const bx = ox + dx, bz = oz + dz
      let col: [number, number, number] | null = null
      for (let y = yTop; y >= yBot; y--) {
        const b = bot.world.getBlock(new Vec3(bx, y, bz))
        if (b && b.name && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air') { col = tileColorFor(b.name); break }
      }
      const c = col ?? [28, 32, 48] // 未载区块（远离跟随目标）= 深夜蓝
      const idx = (size * dz + dx) << 2
      png.data[idx] = c[0]; png.data[idx + 1] = c[1]; png.data[idx + 2] = c[2]; png.data[idx + 3] = 255
    }
    if ((dz & 7) === 7) await yieldTick() // 每 8 行让路事件循环，viewer 流不断
  }
  return PNG.sync.write(png)
}
export function serveMapTiles(getBot: () => any, worlddb?: { discoveryList(): Array<{ id: number; name: string; kind: string; x: number; z: number; found_by: string; ts: number }> }, options = {}) {
  const tileCache = new Map<string, { buf: Buffer; at: number }>()
  const render = options.render ?? renderTilePNG
  const now = options.now ?? Date.now
  const renderTimeout = Math.min(8000, Math.max(1, options.renderTimeoutMs ?? 8000))
  let tileBusy = false, stopped = false, generation = 0, trackedBot = null, trackedWorld = null, trackedDimension = null
  let inFlight = Promise.resolve(), cancelActive = () => {}
  const clearWorld = () => { generation++; tileCache.clear() }
  const gameChanged = () => { if (trackedBot?.game?.dimension !== trackedDimension) { trackedDimension = trackedBot?.game?.dimension; clearWorld() } }
  function current() {
    let b
    try { b = getBot() } catch { return null }
    const dim = b?.game?.dimension
    if (!b?.world || !b.entity || b._client?.state !== 'play' || b._client?.ended === true
        || b._client?.socket?.destroyed === true || typeof dim !== 'string' || !/^[a-z0-9_.:/-]{1,128}$/.test(dim)) return null
    if (trackedBot !== b || trackedWorld !== b.world || trackedDimension !== dim) {
      trackedBot?.off?.('respawn', clearWorld); trackedBot?.off?.('game', gameChanged)
      trackedBot = b; trackedWorld = b.world; trackedDimension = dim; clearWorld()
      b.on?.('respawn', clearWorld); b.on?.('game', gameChanged)
    }
    return { bot: b, world: b.world, dimension: dim, generation }
  }
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'GET') { res.writeHead(405).end('GET required'); return }
    let url
    try { url = new URL(req.url ?? '/', 'http://localhost') }
    catch { res.writeHead(400).end('bad URL'); return }
    // 探索者舆图（2026-08-29 造物主谕）：发现点地名经纬，供 9090 世界地图上图。
    if (url.pathname === '/api/discoveries') {
      let rows
      try { rows = worlddb?.discoveryList() ?? [] } catch { res.writeHead(503).end('discoveries unavailable'); return }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(rows))
      return
    }
    if (url.pathname !== '/map.png') {
      // 【地图排障 2026-08-29】/mapdiag → chunk 收到/装载计数+实体脚下采样（判断 chunk 装载 vs stateId 查询）
      if (url.pathname === '/mapdiag') {
        const b = current()?.bot
        let info: Record<string, unknown> = { online: !!(b && b.world) }
        try {
          // 懒挂探针：map_chunk 收到数 vs chunkColumnLoad 装载数（每次重连换 client，WeakSet 防重挂）
          const diagGlobal = globalThis as any
          if (b?._client && !diagGlobal.__mapdiagHooked?.has(b._client)) {
            diagGlobal.__mapdiagHooked ??= new WeakSet()
            diagGlobal.__mapdiagHooked.add(b._client)
            diagGlobal.__mapChunkSeen ??= 0; diagGlobal.__columnLoadSeen ??= 0
            b._client.on('map_chunk', () => { diagGlobal.__mapChunkSeen++ })
            b.world?.on?.('chunkColumnLoad', () => { diagGlobal.__columnLoadSeen++ })
          }
          info.mapChunkSeen = diagGlobal.__mapChunkSeen ?? -1
          info.columnLoadSeen = diagGlobal.__columnLoadSeen ?? -1
          const ep: any = b?.entity?.position
          info.entityPos = ep ? [Math.floor(ep.x), Math.floor(ep.y), Math.floor(ep.z)] : null
          const w: any = b?.world
          const sample: unknown[] = []
          const bx = ep ? Math.floor(ep.x) : 0, bz = ep ? Math.floor(ep.z) : 0
          for (const [dx, dy, dz] of [[0, 60, 0], [0, 70, 0], [0, 80, 0], [5, 70, 5], [-5, 70, -5]] as const) {
            const blk = w?.getBlock?.(new Vec3(bx + dx, dy, bz + dz))
            sample.push({ at: `${bx + dx},${dy},${bz + dz}`, name: blk?.name ?? null, stateId: blk?.stateId ?? null })
          }
          info.sample = sample
        } catch (e) { info.err = String(e) }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(info))
        return
      }
      res.writeHead(404).end(); return
    }
    const cx = Number(url.searchParams.get('cx')), cz = Number(url.searchParams.get('cz'))
    let r = Number(url.searchParams.get('r') ?? 64)
    if (!url.searchParams.has('cx') || !url.searchParams.has('cz') || !Number.isFinite(cx) || !Number.isFinite(cz)
        || Math.abs(cx) > 30_000_000 || Math.abs(cz) > 30_000_000) { res.writeHead(400).end('bad cx/cz'); return }
    r = Math.floor(Math.max(8, Math.min(128, Number.isFinite(r) ? r : 64))) // 保持原半径上限，不扩大扫描
    const view = current()
    if (stopped || !view) { res.writeHead(503).end('bot not ready'); return }
    res.setHeader('X-Qiandeng-Dimension', view.dimension)
    res.setHeader('X-Qiandeng-Generation', String(view.generation))
    const key = `${view.generation}:${view.dimension}:${Math.round(cx)},${Math.round(cz)},${r}`
    const hit = tileCache.get(key)
    if (hit && now() - hit.at >= 0 && now() - hit.at < 90_000) {
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(hit.buf)
      return
    }
    // No overwritten waiter: every concurrent request gets an explicit answer.
    if (tileBusy) { res.writeHead(503, { 'Retry-After': '1' }).end('map busy'); return }
    tileBusy = true
    let cancelled = false
    const complete = (code, content) => { if (!res.destroyed && !res.writableEnded) res.writeHead(code, code === 200 ? { 'Content-Type': 'image/png' } : {}).end(content) }
    const unchanged = () => {
      const next = current()
      return next && next.bot === view.bot && next.world === view.world && next.dimension === view.dimension && next.generation === view.generation
    }
    cancelActive = () => { cancelled = true }
    res.once('close', () => { cancelled = true })
    const timeout = setTimeout(() => { cancelled = true; complete(503, 'map render timeout') }, renderTimeout)
    timeout.unref()
    inFlight = Promise.resolve().then(() => render(view.bot, cx, cz, r, () => cancelled || stopped || !unchanged()))
      .then(buf => {
        if (cancelled || stopped || !unchanged()) { complete(503, 'observer world changed'); return }
        tileCache.set(key, { buf, at: now() })
        if (tileCache.size > 80) tileCache.delete(tileCache.keys().next().value)
        complete(200, buf)
      }).catch(() => complete(cancelled ? 503 : 500, 'map unavailable')).finally(() => {
        clearTimeout(timeout); tileBusy = false; cancelActive = () => {}
      })
  })
  server.headersTimeout = 5000; server.requestTimeout = 10000; server.keepAliveTimeout = 1000; server.maxConnections = 16
  const port = options.port ?? MAP_PORT
  const ready = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, options.host ?? '0.0.0.0', () => {
      console.log(`[bootstrap-world] map tile service on :${port} (/map.png?cx=&cz=&r=)`)
      resolve()
    })
  })
  let closing
  function dispose() {
    if (closing) return closing
    stopped = true; cancelActive()
    trackedBot?.off?.('respawn', clearWorld); trackedBot?.off?.('game', gameChanged)
    server.closeAllConnections()
    closing = Promise.all([inFlight, new Promise(resolve => server.close(resolve))]).then(() => {})
    return closing
  }
  return { server, ready, dispose }
}
