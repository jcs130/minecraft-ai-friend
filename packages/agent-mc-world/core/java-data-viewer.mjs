// Generated from mc-visual-console by tools/build-java-data-host.mjs. Edit the shared source.

// packages/modern-viewer/renderer-src/host/java-data-viewer.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path2 from "node:path";
import { createHash } from "node:crypto";
import { Server as SocketServer } from "socket.io";

// packages/modern-viewer/renderer-src/host/java-visual-data.mjs
import { createRequire } from "node:module";
var require2 = createRequire(import.meta.url);
var mc = require2("minecraft-data")("1.20.6");
var Block = require2("prismarine-block")("1.20.6");
var Chunk = require2("prismarine-chunk")("1.20.6");
var canonical = (props) => JSON.stringify(Object.entries(props).map(([k, v]) => [k, String(v)]).sort(([a], [b]) => a.localeCompare(b)));
var identifier = /^minecraft:[a-z0-9_./-]+$/;
var number = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
var integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
var requireValue = (ok, why) => {
  if (!ok) throw Error("JAVA_VISUAL_" + why);
};
var javaYaw = (degrees) => Math.PI - degrees * Math.PI / 180;
var javaPitch = (degrees) => -degrees * Math.PI / 180;
var JavaVisualData = class {
  constructor({ uuid, server, skinUrl = () => null }) {
    this.uuid = uuid.toLowerCase();
    this.server = server.toLowerCase().replace(/:25565$/, "");
    this.skinUrl = skinUrl;
    this.clear();
  }
  clear() {
    this.epoch = null;
    this.sequence = -1;
    this.blocks = null;
    this.biomes = null;
    this.nativeBiomes = /* @__PURE__ */ new Map();
    this.columns = /* @__PURE__ */ new Map();
    this.entities = /* @__PURE__ */ new Map();
    this.frame = null;
  }
  verify(value, epoch = false) {
    requireValue(value?.protocol === "agent-mc-visual/v1" && value.minecraftVersion === "1.20.6", "VERSION_MISMATCH");
    requireValue(value.uuid?.toLowerCase() === this.uuid && value.server?.toLowerCase().replace(/:25565$/, "") === this.server, "IDENTITY_MISMATCH");
    requireValue(typeof value.epoch === "string" && value.epoch.length < 128 && integer(value.sequence, 0, Number.MAX_SAFE_INTEGER) && number(value.sampledAt, 0, Number.MAX_SAFE_INTEGER), "ENVELOPE_INVALID");
    if (epoch) requireValue(value.epoch === this.epoch, "EPOCH_MISMATCH");
  }
  registry(value) {
    this.verify(value);
    const { blocks, biomes } = value.registry ?? {};
    requireValue(Array.isArray(blocks) && blocks.length > 0 && blocks.length <= 131072 && Array.isArray(biomes) && biomes.length <= 4096, "REGISTRY_INVALID");
    const states = /* @__PURE__ */ new Map(), biomeIds = /* @__PURE__ */ new Map(), nativeBiomes = /* @__PURE__ */ new Map(), vanillaStates = /* @__PURE__ */ new Map();
    for (const block of mc.blocksArray) for (let id = block.minStateId; id <= block.maxStateId; id++) vanillaStates.set(block.name + canonical(Block.fromStateId(id, 0).getProperties()), id);
    for (const row of blocks) {
      requireValue(integer(row.id, 0, 131071) && typeof row.name === "string" && row.properties && !states.has(row.id), "STATE_INVALID");
      let target = null;
      if (identifier.test(row.name)) {
        target = vanillaStates.get(row.name.slice(10) + canonical(row.properties)) ?? null;
      }
      states.set(row.id, target);
    }
    for (const row of biomes) {
      requireValue(integer(row.id, 0, 4095) && !biomeIds.has(row.id), "BIOME_INVALID");
      let mapped = identifier.test(row.name) ? mc.biomesByName[row.name.slice(10)]?.id ?? null : null;
      if (row.colors) {
        requireValue(typeof row.name === "string" && /^[a-z0-9_.-]+:[a-z0-9_./-]{1,128}$/.test(row.name) && ["grass", "foliage", "water"].every((k) => integer(row.colors[k], 0, 16777215)), "BIOME_COLORS_INVALID");
        mapped ??= 1024 + row.id;
        nativeBiomes.set(mapped, { id: mapped, name: row.name, colors: row.colors });
      }
      biomeIds.set(row.id, mapped);
    }
    this.clear();
    this.epoch = value.epoch;
    this.blocks = states;
    this.biomes = biomeIds;
    this.nativeBiomes = nativeBiomes;
  }
  decodeChunk(value) {
    this.verify(value, true);
    requireValue(this.blocks && integer(value.x, -1875e3, 1875e3) && integer(value.z, -1875e3, 1875e3) && integer(value.minY, -2048, 2048) && value.minY % 16 === 0 && integer(value.height, 16, 1024) && value.height % 16 === 0 && typeof value.sections === "string" && value.sections.length <= 3 * 1024 * 1024, "CHUNK_INVALID");
    requireValue(Array.isArray(value.skyLight) && Array.isArray(value.blockLight) && value.skyLight.length === value.height / 16 && value.blockLight.length === value.height / 16, "LIGHT_INVALID");
    const raw = new Chunk({ minY: value.minY, worldHeight: value.height });
    raw.maxBitsPerBlock = Math.ceil(Math.log2([...this.blocks.keys()].reduce((a, b) => Math.max(a, b), 0) + 1));
    raw.maxBitsPerBiome = Math.ceil(Math.log2([...this.biomes.keys()].reduce((a, b) => Math.max(a, b), 0) + 1));
    raw.load(Buffer.from(value.sections, "base64"));
    const usedBiomes = /* @__PURE__ */ new Set();
    for (let i = 0; i < raw.sections.length; i++) {
      const section = raw.sections[i];
      for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const p = { x, y, z }, before = section.get(p), after = this.blocks.get(before);
        requireValue(after !== void 0 && after !== null, "UNSUPPORTED_BLOCK_STATE_" + before);
        if (before !== after) section.set(p, after);
      }
      const biome = raw.biomes[i];
      for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
        const p = { x, y, z }, before = biome.get(p), after = this.biomes.get(before);
        requireValue(after !== void 0 && after !== null, "UNSUPPORTED_BIOME_" + before);
        usedBiomes.add(after);
        if (before !== after) biome.set(p, after);
      }
    }
    const masks = [raw.skyLightMask, raw.blockLightMask].map((mask) => {
      for (let i = 0; i < value.height / 16; i++) mask.set(i + 1, 1);
      return mask.toLongArray();
    });
    const lights = [value.skyLight, value.blockLight].map((rows) => rows.map((row) => {
      requireValue(row !== null, "LIGHT_UNAVAILABLE");
      requireValue(typeof row === "string" && row.length <= 2800, "LIGHT_INVALID");
      const b = Buffer.from(row, "base64");
      requireValue(b.length === 2048, "LIGHT_INVALID");
      return b;
    }));
    raw.loadParsedLight(lights[0], lights[1], masks[0], masks[1], [], []);
    const json = JSON.parse(raw.toJson());
    const palette = [...usedBiomes].map((id) => this.nativeBiomes.get(id)).filter(Boolean);
    if (palette.length) json.agentMcBiomes = { protocol: "agent-mc-native-biomes/v1", entries: palette };
    return {
      x: value.x * 16,
      z: value.z * 16,
      chunk: JSON.stringify(json),
      worldConfig: { minY: value.minY, worldHeight: value.height },
      native: {
        epoch: value.epoch,
        revision: value.revision,
        sampledAt: value.sampledAt,
        blockEntitiesAvailable: false,
        missingSkySections: value.skyLight.flatMap((v, i) => v === null ? [i] : []),
        missingBlockSections: value.blockLight.flatMap((v, i) => v === null ? [i] : [])
      }
    };
  }
  entity(row, self = false) {
    requireValue(integer(row.id, 0, 2147483647) && identifier.test(row.name) && Array.isArray(row.position) && row.position.length === 3 && row.position.every((v) => number(v, -3e7, 3e7)) && [row.yaw, row.pitch, row.headYaw].every((v) => number(v, -1e9, 1e9)), "ENTITY_INVALID");
    const equipment = (row.equipment ?? []).map((item) => {
      if (!item) return null;
      const native = identifier.test(item.name) && mc.itemsByName[item.name.slice(10)];
      requireValue(native, "UNSUPPORTED_ITEM");
      return { name: native.name, type: native.id, itemId: native.id, count: item.count, displayName: item.displayName };
    });
    const [x, y, z] = row.position;
    return {
      id: row.id,
      uuid: row.uuid,
      name: row.name.slice(10),
      type: row.name === "minecraft:player" ? "player" : "mob",
      username: row.username,
      pos: { x, y, z },
      yaw: javaYaw(row.yaw),
      pitch: javaPitch(row.pitch),
      headYaw: javaYaw(row.headYaw),
      width: row.width,
      height: row.height,
      isSelf: self,
      burning: row.burning,
      equipment,
      skinUrl: this.skinUrl(row.skinResource),
      skinModel: row.skinModel ?? null,
      metadata: [],
      nativePose: row.pose
    };
  }
  applyFrame(value, emit) {
    this.verify(value, true);
    requireValue(value.sequence > this.sequence, "STALE_FRAME");
    this.sequence = value.sequence;
    requireValue(Array.isArray(value.columns) && value.columns.length <= 81 && Array.isArray(value.entities) && value.entities.length <= 256, "FRAME_INVALID");
    const seen = /* @__PURE__ */ new Set();
    for (const c of value.columns) {
      const key = `${c.x},${c.z}`;
      requireValue(integer(c.x, -1875e3, 1875e3) && integer(c.z, -1875e3, 1875e3) && integer(c.revision, 0, Number.MAX_SAFE_INTEGER) && !seen.has(key), "COLUMN_INVALID");
      seen.add(key);
    }
    const self = this.entity(value.self, true), previous = this.frame;
    const teleport = !!previous && Math.hypot(...value.self.position.map((v, i) => v - previous.self.position[i])) > 8;
    emit("position", { pos: self.pos, yaw: self.yaw, pitch: self.pitch, teleport, sampledAt: value.sampledAt, sequence: value.sequence });
    const velocity = value.self.velocity ?? [0, 0, 0], speed = Math.hypot(velocity[0], velocity[2]) * 20;
    emit("avatarState", {
      seq: value.sequence,
      sequence: value.sequence,
      capturedAt: value.sampledAt,
      entity: self,
      health: value.health,
      food: value.food,
      dimension: value.dimension,
      onGround: value.self.onGround,
      eyeHeight: value.self.eyeHeight,
      sneaking: value.self.sneaking,
      sprinting: value.self.sprinting,
      velocity: { x: velocity[0], y: velocity[1], z: velocity[2] },
      movementState: value.self.sneaking ? speed > 0.05 ? "crouchWalking" : "crouch" : speed > 0.05 ? value.self.sprinting ? "running" : "walking" : "idle",
      horizontalSpeed: speed,
      teleported: teleport,
      usingItem: value.self.usingItem,
      source: "same_java_client_world"
    });
    const signature = JSON.stringify({ ...self, pos: null, yaw: null, pitch: null, headYaw: null });
    if (this.entities.get(self.id) !== signature) {
      emit("playerEntity", self);
      emit("entity", self);
      this.entities.set(self.id, signature);
    } else emit("entityMoved", self);
    if (previous && previous.self.id !== self.id) {
      emit("entity", { id: previous.self.id, delete: true });
      this.entities.delete(previous.self.id);
    }
    if (previous && value.self.hurtTime > previous.self.hurtTime) emit("entityDamage", { id: self.id, isSelf: true });
    if (!previous || value.time !== previous.time) emit("time", (value.time % 24e3 + 24e3) % 24e3);
    if (!previous || value.raining !== previous.raining || value.thunder !== previous.thunder) emit("weather", { raining: value.raining, thunder: value.thunder });
    const wanted = new Set(value.columns.map((c) => `${c.x},${c.z}`));
    for (const [key, column] of this.columns) if (!wanted.has(key)) {
      emit("unloadChunk", { x: column.x, z: column.z });
      this.columns.delete(key);
    }
    this.frame = value;
    return value.columns.filter((c) => this.columns.get(`${c.x},${c.z}`)?.native.revision !== c.revision).sort((a, b) => Math.hypot(a.x - self.pos.x / 16, a.z - self.pos.z / 16) - Math.hypot(b.x - self.pos.x / 16, b.z - self.pos.z / 16));
  }
  acceptChunk(value, emit) {
    requireValue(integer(value.revision, 0, Number.MAX_SAFE_INTEGER), "REVISION_INVALID");
    const wanted = this.frame?.columns.find((c) => c.x === value.x && c.z === value.z);
    if (!wanted || value.revision < wanted.revision || value.revision < (this.columns.get(`${value.x},${value.z}`)?.native.revision ?? -1)) return null;
    const column = this.decodeChunk(value);
    this.columns.set(`${value.x},${value.z}`, column);
    emit("loadChunk", column);
    return column;
  }
};

// packages/modern-viewer/renderer-src/host/viewer-asset-server.mjs
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
var MAX_ASSET_BYTES = 32 * 1024 * 1024;
var MIME = {
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ogg": "audio/ogg",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".vrm": "model/gltf-binary",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".zip": "application/zip"
};
function viewerByteRange(range, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || !match[1] && !match[2] || size <= 0)
    return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0)
      return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start)
    return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}
async function serveViewerAsset(res, root, relative, cacheControl = "public, max-age=3600", range) {
  const file = path.resolve(root, relative);
  const extension = path.extname(file).toLowerCase();
  if (!file.startsWith(path.resolve(root) + path.sep) || !MIME[extension])
    return false;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size > MAX_ASSET_BYTES)
    return false;
  const ranged = extension === ".ogg";
  const headers = {
    "content-type": MIME[extension],
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
    ...ranged ? { "accept-ranges": "bytes" } : {}
  };
  if (ranged && range !== void 0) {
    const selected = viewerByteRange(range, info.size);
    if (!selected) {
      res.writeHead(416, { ...headers, "content-range": `bytes */${info.size}`, "content-length": 0 });
      res.end();
      return true;
    }
    res.writeHead(206, {
      ...headers,
      "content-length": selected.end - selected.start + 1,
      "content-range": `bytes ${selected.start}-${selected.end}/${info.size}`
    });
    createReadStream(file, selected).on("error", (error) => res.destroy(error)).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, "content-length": info.size });
  createReadStream(file).on("error", (error) => res.destroy(error)).pipe(res);
  return true;
}

// packages/modern-viewer/renderer-src/host/java-data-viewer.mjs
async function createJavaDataViewer({ port, assetsDir, rpc, uuid, server: expectedServer, radius = 2 }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isInteger(radius) || radius < 0 || radius > 4) throw Error("JAVA_VIEWER_CONFIG_INVALID");
  const root = path2.resolve(assetsDir), source = JSON.parse(await readFile(path2.join(root, "public/asset-source.json"), "utf8"));
  if (source.minecraftVersion !== "1.20.6") throw Error("JAVA_VIEWER_ASSET_VERSION_MISMATCH");
  const notice = '<div role="status" style="position:fixed;bottom:54px;left:12px;z-index:99999;background:#13242fe8;color:white;padding:8px;max-width:430px;font:13px sans-serif">\u539F\u751F\u6570\u636E\u9884\u89C8 \xB7 \u5DF2\u63A5\u5165\u5730\u5F62\u4E0E\u672C\u4EBA\u79FB\u52A8\u3002\u5176\u4ED6\u5B9E\u4F53\u3001\u5BB9\u5668\u3001YSM\u3001\u6A21\u7EC4\u6750\u8D28\u4E0E\u5149\u5F71\u5C1A\u672A\u63A5\u5165\uFF1B\u754C\u9762\u7A7A\u69FD\u4E0D\u4EE3\u8868\u5B9E\u9645\u80CC\u5305\u4E3A\u7A7A\u3002</div>';
  const pages = new Map(await Promise.all(["", "third/", "dungeon/"].map(async (route) => [route, (await readFile(path2.join(root, "public", route, "index.html"), "utf8")).replace("</body>", notice + "</body>")])));
  const css = await readFile(path2.join(root, "public/viewer.css"));
  const skins = /* @__PURE__ */ new Map(), skinBytes = /* @__PURE__ */ new Map();
  const data = new JavaVisualData({ uuid, server: expectedServer, skinUrl: (resource) => skins.get(resource) ?? null });
  async function prepareSkin(resource) {
    if (skins.has(resource)) return;
    if (!/^minecraft:textures\/entity\/player\/(slim|wide)\/[a-z_]+\.png$/.test(resource ?? "")) throw Error("JAVA_VISUAL_NATIVE_SKIN_UNAVAILABLE");
    const bytes = await readFile(path2.join(root, "public/textures/1.20.6", resource.slice("minecraft:textures/".length)));
    const hash = createHash("sha256").update(bytes).digest("hex");
    skins.set(resource, `/head-texture/${hash}.png`);
    skinBytes.set(hash, bytes);
  }
  let activePort = port, closed = false, timer, chunkTimer, framePending = null, chunkBusy = false, dirty = [], error = null, lastFrameAt = 0;
  let retryAfter = 0, lastError = null;
  let frames = 0, columns = 0, chunkMs = 0, registryMs = 0, unsupportedEntities = 0;
  const clients = /* @__PURE__ */ new Set(), waiting = /* @__PURE__ */ new Set(), sockets = [];
  const demanded = () => clients.size + waiting.size > 0;
  const allowed = (req) => req.headers.host === `127.0.0.1:${activePort}` && (!req.headers.origin || req.headers.origin === `http://127.0.0.1:${activePort}`) && req.headers["sec-fetch-site"] !== "cross-site";
  const emit = (name, value) => {
    for (const socket of clients) {
      if (socket.conn.writeBuffer.length > 128) {
        socket.disconnect(true);
        continue;
      }
      socket.emit(name, value);
    }
  };
  const status = () => ({
    ok: !closed && !error && (!demanded() || lastFrameAt > 0 && Date.now() - lastFrameAt <= 3e3),
    state: closed ? "closed" : error ? "unavailable" : demanded() ? "streaming" : "idle",
    sampling: demanded() && !closed,
    source: "real-java-world-data",
    transport: "socket.io",
    minecraftVersion: "1.20.6",
    error,
    lastError,
    epoch: data.epoch,
    sampledAt: data.frame?.sampledAt,
    ageMs: lastFrameAt ? Date.now() - lastFrameAt : null,
    frames,
    columns: data.columns.size,
    chunkUpdates: columns,
    lastChunkMs: chunkMs,
    registryMs,
    viewers: [...clients].filter((s) => s.handshake.headers["x-mc-viewer-capture"] !== "1").length,
    maxSessions: 2,
    captureSessions: [...clients].filter((s) => s.handshake.headers["x-mc-viewer-capture"] === "1").length,
    maxCaptureSessions: 1,
    coverage: {
      self: true,
      loadedColumns: data.columns.size,
      radius,
      otherEntitiesRendered: false,
      observedOtherEntities: unsupportedEntities,
      blockEntities: false,
      modAnimations: false,
      clientShaders: false,
      fullParity: false
    }
  });
  const http = createServer(async (req, res) => {
    if (!allowed(req) || req.method !== "GET") {
      res.writeHead(403).end();
      return;
    }
    try {
      const route = new URL(req.url, "http://127.0.0.1").pathname.slice(1);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (pages.has(route)) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(pages.get(route));
        return;
      }
      if (route === "viewer.css") {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
        res.end(css);
        return;
      }
      if (route === "healthz" || route === "viewer-coverage") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(status()));
        return;
      }
      const skinHash = /^head-texture\/([a-f0-9]{64})\.png$/.exec(route)?.[1];
      if (skinHash && skinBytes.has(skinHash)) {
        res.setHeader("Content-Type", "image/png");
        res.end(skinBytes.get(skinHash));
        return;
      }
      if (route === "index.js" && await serveViewerAsset(res, root, "dist/modern-viewer.js", "no-store")) return;
      if (await serveViewerAsset(res, path2.join(root, "public"), route)) return;
      if (route.startsWith("textures/") && await serveViewerAsset(res, path2.join(root, "public"), `textures/1.20.6/${route.slice(9)}`)) return;
      res.writeHead(404).end();
    } catch {
      res.writeHead(503).end("Viewer resource unavailable");
    }
  });
  function unavailable(reason) {
    error = reason;
    lastError = reason;
    retryAfter = Date.now() + 1e3;
    dirty = [];
    data.clear();
    console.error(reason);
    for (const socket of clients) socket.disconnect(true);
  }
  function frame() {
    if (!closed && demanded() && framePending && lastFrameAt && Date.now() - lastFrameAt > 3e3 && !error) unavailable("JAVA_VISUAL_SAMPLE_STALE");
    if (closed || !demanded() || Date.now() < retryAfter) return Promise.resolve();
    return framePending ??= sampleFrame().finally(() => {
      framePending = null;
    });
  }
  async function sampleFrame() {
    try {
      const value = await rpc("visual_frame", { radius });
      if (closed) return;
      if (!demanded()) return;
      data.verify(value);
      if (Math.abs(Date.now() - value.sampledAt) > 3e3) throw Error("JAVA_VISUAL_SAMPLE_STALE");
      await prepareSkin(value.self.skinResource);
      if (closed) return;
      if (data.epoch !== value.epoch) {
        if (data.epoch) {
          emit("viewerReset");
          for (const socket of clients) socket.disconnect(true);
        }
        const started = performance.now(), registry = await rpc("visual_registry", {});
        if (closed) return;
        data.registry(registry);
        if (data.nativeBiomes.size && !(await readFile(path2.join(root, "public/mesher.js"), "utf8")).includes("agent-mc-native-biomes/v1")) throw Error("JAVA_VIEWER_NATIVE_BIOME_RENDERER_REQUIRED");
        registryMs = performance.now() - started;
        if (value.epoch !== data.epoch) return;
      }
      dirty = data.applyFrame(value, emit);
      lastFrameAt = Date.now();
      frames++;
      unsupportedEntities = value.entities.length;
      error = null;
    } catch (e) {
      if (!closed) unavailable(e.message);
    }
  }
  async function chunk() {
    if (closed || !clients.size || chunkBusy || !dirty.length || !data.epoch) return;
    chunkBusy = true;
    const item = dirty.shift(), epoch = data.epoch, started = performance.now();
    try {
      const value = await rpc("visual_chunk", { x: item.x, z: item.z, epoch });
      if (closed || data.epoch !== epoch || !data.frame?.columns.some((c) => c.x === item.x && c.z === item.z)) return;
      if (data.acceptChunk(value, emit)) columns++;
      chunkMs = performance.now() - started;
      emit("chunkStreamState", { streamed: data.columns.size, expected: data.frame.columns.length, retried: 0 });
    } catch (e) {
      if (!closed && data.epoch === epoch) unavailable(e.message);
    } finally {
      chunkBusy = false;
    }
  }
  for (const pathname of ["/socket.io", "/third/socket.io"]) {
    const io = new SocketServer(http, { path: pathname, serveClient: false, maxHttpBufferSize: 1024, allowRequest: (req, done) => done(null, allowed(req)) });
    sockets.push(io);
    io.on("connection", async (socket) => {
      const capture = socket.handshake.headers["x-mc-viewer-capture"] === "1";
      if ([...clients, ...waiting].filter((s) => s.handshake.headers["x-mc-viewer-capture"] === "1" === capture).length >= (capture ? 1 : 2)) {
        socket.emit("viewerBusy", { reason: "Viewer limit", maximum: capture ? 1 : 2 });
        socket.disconnect(true);
        return;
      }
      waiting.add(socket);
      const lease = capture ? setTimeout(() => socket.disconnect(true), 6e4) : null;
      lease?.unref();
      socket.on("disconnect", () => {
        clients.delete(socket);
        waiting.delete(socket);
        if (lease) clearTimeout(lease);
      });
      await frame();
      waiting.delete(socket);
      if (!socket.connected) return;
      if (closed || error || !data.frame || Date.now() - lastFrameAt > 3e3) {
        socket.emit("viewerBusy", { reason: error ?? "Waiting for actual Java world" });
        socket.disconnect(true);
        return;
      }
      clients.add(socket);
      socket.emit("version", "1.20.6");
      const latest = data.frame, self = data.entity(latest.self, true);
      socket.emit("position", { pos: self.pos, yaw: self.yaw, pitch: self.pitch, teleport: true });
      socket.emit("playerEntity", self);
      socket.emit("entity", self);
      for (const c of data.columns.values()) socket.emit("loadChunk", c);
      socket.emit("time", (latest.time % 24e3 + 24e3) % 24e3);
      socket.emit("weather", { raining: latest.raining, thunder: latest.thunder });
      socket.emit("viewerControlState", { available: false, reason: "Read-only native data view" });
    });
  }
  await new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, "127.0.0.1", () => {
      activePort = http.address().port;
      resolve();
    });
  });
  timer = setInterval(() => void frame(), 50);
  chunkTimer = setInterval(() => void chunk(), 100);
  timer.unref();
  chunkTimer.unref();
  return { url: `http://127.0.0.1:${activePort}`, status, async close() {
    closed = true;
    clearInterval(timer);
    clearInterval(chunkTimer);
    for (const socket of [...clients, ...waiting]) socket.disconnect(true);
    for (const io of sockets) io.close();
    http.closeAllConnections();
    if (http.listening) await new Promise((resolve) => http.close(resolve));
    data.clear();
  } };
}
export {
  createJavaDataViewer
};
