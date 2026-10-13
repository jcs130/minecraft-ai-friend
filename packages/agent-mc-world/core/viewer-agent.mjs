// ../../../mc-visual-console/packages/modern-viewer/renderer-src/host/viewer-agent.mjs
import { randomUUID } from "node:crypto";

// ../../../mc-visual-console/packages/modern-viewer/renderer-src/src/modern-viewer/agent-visual-protocol.js
var AGENT_VISUAL_COLORS = Object.freeze({
  path: "#4ee6b1",
  trail: "#63b8ff",
  candidate: "#a6b7d4",
  attack: "#ff697b",
  gather: "#ffbe55",
  interact: "#c59aff",
  info: "#b7e7ff"
});
var AGENT_VISUAL_LIMITS = Object.freeze({
  markers: 48,
  vertices: 1024,
  route: 128,
  candidates: 4,
  imageBytes: 512 * 1024,
  sceneNodes: 64,
  drawingBytes: 64 * 1024
});
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var finite = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
var visualText = (v, limit = 240) => typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, limit) : "";
var visualTtl = (v, fallback = 15e3, max = 12e4) => finite(v, 500, max) ? Math.round(v) : fallback;
function visualSubject(v) {
  return v && UUID.test(v.playerUuid ?? "") && /^[\w.]{1,32}$/.test(v.playerName ?? "") && Number.isSafeInteger(v.entityId) ? { playerUuid: v.playerUuid.toLowerCase(), playerName: v.playerName, entityId: v.entityId } : null;
}
var sameVisualSubject = (a, b) => !!a && !!b && a.playerUuid.toLowerCase() === b.playerUuid.toLowerCase() && a.entityId === b.entityId;
function visualPoint(v, space = "world") {
  if (space === "screen") return v && finite(v.x, 0, 1) && finite(v.y, 0, 1) ? { x: v.x, y: v.y } : null;
  return v && finite(v.x, -3e7, 3e7) && finite(v.y, -4096, 4096) && finite(v.z, -3e7, 3e7) ? { x: v.x, y: v.y, z: v.z } : null;
}
function visualPoints(values, max = 128, space = "world") {
  if (!Array.isArray(values) || !values.length) return [];
  const count = Math.min(max, values.length), result = [];
  for (let i = 0; i < count; i++) {
    const p = visualPoint(values[Math.floor(i * (values.length - 1) / Math.max(1, count - 1))], space);
    if (!p) return null;
    result.push(p);
  }
  return result;
}
function normalizeVisualIntent(v) {
  if (!v || typeof v !== "object") return null;
  const status = ["planning", "acting", "waiting", "blocked", "done"].includes(v.status) ? v.status : "acting";
  const goal = visualText(v.goal), step = visualText(v.step), summary = visualText(v.summary, 700);
  if (!goal && !step && !summary) return null;
  return { status, goal, step, summary, ...finite(v.progress, 0, 1) ? { progress: v.progress } : {}, ttlMs: visualTtl(v.ttlMs) };
}
function normalizeVisualRoute(v) {
  if (!v || typeof v !== "object") return null;
  const points = visualPoints(v.points ?? []);
  if (!points) return null;
  return {
    points,
    goal: visualPoint(v.goal),
    status: ["planning", "moving", "reached", "blocked", "stopped"].includes(v.status) ? v.status : "moving",
    source: v.source === "pathfinder" ? "pathfinder" : "agent",
    ttlMs: visualTtl(v.ttlMs, 1e4, 3e4)
  };
}
function normalizeVisualCandidates(v) {
  if (!Array.isArray(v) || v.length > AGENT_VISUAL_LIMITS.candidates) return null;
  const result = v.map((row, i) => {
    const route = normalizeVisualRoute(row);
    return route && route.points.length > 1 ? { id: visualText(row.id, 48) || `candidate-${i}`, label: visualText(row.label, 80), points: route.points } : null;
  });
  return result.every(Boolean) ? result : null;
}
var color = (v, fallback) => /^#[a-f0-9]{6}$/i.test(v ?? "") ? v : fallback;
function normalizeVisualMarkers(values) {
  if (!Array.isArray(values) || values.length > AGENT_VISUAL_LIMITS.markers) return null;
  let vertices = 0;
  const ids = /* @__PURE__ */ new Set(), result = [];
  for (const v of values) {
    if (!v || !["point", "line", "area", "label"].includes(v.kind)) return null;
    const id = visualText(v.id, 48), space = v.space === "screen" ? "screen" : "world";
    if (!id || ids.has(id)) return null;
    ids.add(id);
    const role = Object.hasOwn(AGENT_VISUAL_COLORS, v.role) ? v.role : "info";
    const points = ["line", "area"].includes(v.kind) ? visualPoints(v.points, v.kind === "area" ? 64 : 128, space) : [visualPoint(v.position ?? v.points?.[0], space)];
    if (!points || points.some((p) => !p) || points.length < (v.kind === "area" ? 3 : v.kind === "line" ? 2 : 1)) return null;
    vertices += points.length;
    if (vertices > AGENT_VISUAL_LIMITS.vertices) return null;
    result.push({
      id,
      kind: v.kind,
      space,
      role,
      points,
      label: visualText(v.label, 100),
      color: color(v.color, AGENT_VISUAL_COLORS[role]),
      width: finite(v.width, 1, 10) ? v.width : 3,
      radius: finite(v.radius, 2, 24) ? v.radius : 6,
      dashed: v.dashed === true || role === "candidate",
      flow: v.flow === true && v.kind === "line",
      ttlMs: visualTtl(v.ttlMs, 1e4, 3e4)
    });
  }
  return result;
}
function normalizeVisualPointer(v) {
  const p = visualPoint(v, "screen");
  return p ? { ...p, ttlMs: visualTtl(v.ttlMs, 1500, 3e3) } : null;
}
function normalizeVisualCamera(v) {
  return v && finite(v.verticalFov, 5, 170) ? { verticalFov: v.verticalFov, ttlMs: visualTtl(v.ttlMs, 1e3, 3e3) } : null;
}
function normalizeVisualPresentation(v) {
  if (!v || typeof v !== "object") return null;
  const base = { id: visualText(v.id, 48), title: visualText(v.title, 100), caption: visualText(v.caption, 300), ttlMs: visualTtl(v.ttlMs, 3e4) };
  if (!base.id) return null;
  if (v.kind === "image") {
    if (typeof v.src !== "string" || v.src.length > Math.ceil(AGENT_VISUAL_LIMITS.imageBytes * 4 / 3) + 100 || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(v.src)) return null;
    const encoded = v.src.slice(v.src.indexOf(",") + 1);
    if (encoded.length % 4 || encoded.length * 3 / 4 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0) > AGENT_VISUAL_LIMITS.imageBytes) return null;
    return { ...base, kind: "image", src: v.src };
  }
  if (v.kind === "card") {
    const text = visualText(v.text, 1500);
    if (!text) return null;
    return { ...base, kind: "card", text };
  }
  if (v.kind !== "scene" || !finite(v.width, 64, 1920) || !finite(v.height, 64, 1080) || !Array.isArray(v.nodes) || v.nodes.length > AGENT_VISUAL_LIMITS.sceneNodes) return null;
  const nodes = [];
  for (const node of v.nodes) {
    if (!node || !["rect", "circle", "line", "text"].includes(node.kind) || !finite(node.x, -4096, 4096) || !finite(node.y, -4096, 4096)) return null;
    const row = { kind: node.kind, x: node.x, y: node.y, color: color(node.color, "#b7e7ff") };
    if (node.kind === "rect") {
      if (!finite(node.width, 1, 4096) || !finite(node.height, 1, 4096)) return null;
      row.width = node.width;
      row.height = node.height;
    } else if (node.kind === "circle") {
      if (!finite(node.radius, 1, 1024)) return null;
      row.radius = node.radius;
    } else if (node.kind === "line") {
      if (!finite(node.x2, -4096, 4096) || !finite(node.y2, -4096, 4096)) return null;
      row.x2 = node.x2;
      row.y2 = node.y2;
      row.width = finite(node.width, 1, 10) ? node.width : 2;
    } else {
      row.text = visualText(node.text, 180);
      row.size = finite(node.size, 8, 96) ? node.size : 20;
    }
    if (node.motion) {
      if (!finite(node.motion.dx, -4096, 4096) || !finite(node.motion.dy, -4096, 4096) || !finite(node.motion.periodMs, 500, 2e4)) return null;
      row.motion = { dx: node.motion.dx, dy: node.motion.dy, periodMs: node.motion.periodMs };
    }
    nodes.push(row);
  }
  return { ...base, kind: "scene", width: v.width, height: v.height, background: color(v.background, "#142431"), nodes };
}
function normalizeAgentVisualUpdate(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, code: "AGENT_VISUAL_INVALID_UPDATE" };
  const validators = {
    intent: normalizeVisualIntent,
    route: normalizeVisualRoute,
    candidates: normalizeVisualCandidates,
    markers: normalizeVisualMarkers,
    presentation: normalizeVisualPresentation,
    pointer: normalizeVisualPointer,
    camera: normalizeVisualCamera
  };
  const value = {};
  for (const [key, validate] of Object.entries(validators)) if (Object.hasOwn(v, key)) {
    if (v[key] === null && !["candidates", "markers"].includes(key)) value[key] = null;
    else {
      value[key] = validate(v[key]);
      if (value[key] === null) return { ok: false, code: `AGENT_VISUAL_INVALID_${key.toUpperCase()}` };
    }
  }
  if (!Object.keys(value).length) return { ok: false, code: "AGENT_VISUAL_EMPTY_UPDATE" };
  const drawing = { ...value };
  delete drawing.presentation;
  if (JSON.stringify(drawing).length > AGENT_VISUAL_LIMITS.drawingBytes) return { ok: false, code: "AGENT_VISUAL_DRAWING_BUDGET" };
  return { ok: true, value };
}

// ../../../mc-visual-console/packages/modern-viewer/renderer-src/host/viewer-agent.mjs
function createViewerAgentHub({ maximum = 64 } = {}) {
  const records = /* @__PURE__ */ new Map();
  return {
    put(owner, record) {
      const key = record.subject.playerUuid, old = records.get(key);
      if (old && old.owner !== owner) return false;
      if (!old && records.size >= maximum) return false;
      records.set(key, { owner, record });
      return true;
    },
    get(subject) {
      const record = records.get(subject?.playerUuid)?.record;
      return sameVisualSubject(subject, record?.subject) ? record : null;
    },
    remove(owner) {
      for (const [key, row] of records) if (row.owner === owner) records.delete(key);
    },
    get size() {
      return records.size;
    }
  };
}
var viewerAgentHub = createViewerAgentHub();
var publishers = /* @__PURE__ */ new WeakMap();
var dispatchers = /* @__PURE__ */ new WeakMap();
function publishAgentVisualization(bot, update) {
  return publishers.get(bot)?.(update) ?? { ok: false, code: "AGENT_VISUAL_HOST_NOT_ATTACHED" };
}
function observeSentPackets(client, callback) {
  if (typeof client?.write !== "function") return () => {
  };
  let row = dispatchers.get(client);
  if (!row) {
    let write2 = function(...args) {
      const result = original.apply(this, args);
      for (const listener of listeners) {
        try {
          listener(...args);
        } catch {
        }
      }
      return result;
    };
    var write = write2;
    const original = client.write, listeners = /* @__PURE__ */ new Set();
    row = { original, write: write2, listeners };
    dispatchers.set(client, row);
    client.write = write2;
  }
  row.listeners.add(callback);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    row.listeners.delete(callback);
    if (!row.listeners.size) {
      if (client.write === row.write) client.write = row.original;
      dispatchers.delete(client);
    }
  };
}
var ownSubject = (bot) => visualSubject({
  playerUuid: bot.player?.uuid ?? bot.entity?.uuid ?? bot.uuid,
  playerName: bot.username,
  entityId: bot.entity?.id
});
var controls = ["forward", "back", "left", "right", "jump", "sprint", "sneak"];
function createViewerAgentBridge(bot, {
  hub = viewerAgentHub,
  getViewerSession = () => null,
  authorizePublish = null,
  now = Date.now,
  intervalMs = 100,
  timers = true
} = {}) {
  if (publishers.has(bot)) throw Error("AGENT_VISUAL_HOST_ALREADY_ATTACHED");
  const owner = {}, sockets = /* @__PURE__ */ new Map(), hooks = [];
  let record = null, closed = false, ended = false, sequence = 0, operationId = 0;
  const on = (event, handler) => {
    bot.on(event, handler);
    hooks.push([event, handler]);
  };
  const isBody = () => !ended && bot.entity && bot.game?.gameMode !== "spectator" && bot._client?.state === "play";
  function refreshRecord() {
    const subject = isBody() ? ownSubject(bot) : null;
    if (!subject) {
      hub.remove(owner);
      record = null;
      return null;
    }
    if (!sameVisualSubject(record?.subject, subject)) {
      hub.remove(owner);
      record = {
        subject,
        epoch: randomUUID(),
        dimension: bot.game?.dimension ?? null,
        intent: null,
        route: null,
        candidates: [],
        markers: [],
        pointer: null,
        camera: null,
        presentation: null,
        presentationRevision: 0,
        trail: [],
        operations: [],
        input: {}
      };
      if (!hub.put(owner, record)) {
        record = null;
        return null;
      }
    }
    return record;
  }
  function viewerSubject() {
    const session = getViewerSession();
    if (session) return session.attached ? visualSubject(session) : null;
    return isBody() ? ownSubject(bot) : null;
  }
  function expire(r, time) {
    for (const key of ["intent", "route", "pointer", "camera", "presentation"]) if (r[key]?.until <= time) r[key] = null;
    r.candidates = r.candidates.filter((v) => v.until > time);
    r.markers = r.markers.filter((v) => v.until > time);
    r.operations = r.operations.filter((v) => v.until > time);
    r.trail = r.trail.filter((v) => time - v.at <= 3e4);
  }
  function publish(update) {
    if (closed) return { ok: false, code: "AGENT_VISUAL_HOST_CLOSED" };
    const parsed = normalizeAgentVisualUpdate(update);
    if (!parsed.ok) return parsed;
    const r = refreshRecord();
    if (!r) return { ok: false, code: "AGENT_VISUAL_ACTION_PLAYER_UNAVAILABLE" };
    const time = now();
    for (const [key, value] of Object.entries(parsed.value)) {
      if (key === "candidates" || key === "markers") r[key] = value.map((v) => ({ ...v, until: time + (v.ttlMs ?? 1e4) }));
      else r[key] = value ? { ...value, until: time + value.ttlMs } : null;
      if (key === "presentation") r.presentationRevision++;
    }
    return { ok: true, code: "AGENT_VISUAL_ACCEPTED", subject: { ...r.subject }, accepted: Object.keys(parsed.value) };
  }
  publishers.set(bot, publish);
  on("viewer:agent", (update, acknowledge) => {
    const result = publish(update);
    if (typeof acknowledge === "function") acknowledge(result);
  });
  on("spawn", () => {
    ended = false;
    hub.remove(owner);
    record = null;
    refreshRecord();
    flush(true);
  });
  on("respawn", () => {
    hub.remove(owner);
    record = null;
    flush(true);
  });
  on("end", () => {
    ended = true;
    hub.remove(owner);
    record = null;
    flush(true);
  });
  on("path_update", (result) => {
    const r = refreshRecord();
    if (!r) return;
    const status = ["noPath", "timeout"].includes(result?.status) ? "blocked" : result?.status === "partial" ? "planning" : "moving";
    const route = normalizeVisualRoute({ points: result?.path ?? [], goal: bot.pathfinder?.goal, status, source: "pathfinder" });
    if (route) r.route = { ...route, until: now() + route.ttlMs };
  });
  for (const [event, status] of [["path_reset", "planning"], ["path_stop", "stopped"], ["goal_reached", "reached"]]) on(event, () => {
    const r = refreshRecord();
    if (!r?.route) return;
    r.route = { ...r.route, status, points: [], until: now() + 3e3 };
  });
  const stopPackets = observeSentPackets(bot._client, (name, data) => {
    const r = refreshRecord();
    if (!r || !data) return;
    let kind, target = null, detail = "";
    if (name === "use_entity") {
      kind = data.mouse === 1 ? "attack" : "interact";
      target = visualPoint(bot.entities?.[data.target]?.position);
      detail = `\u5B9E\u4F53 ${data.target}`;
    } else if (name === "block_dig" && [0, 1, 2].includes(data.status)) {
      kind = "gather";
      target = visualPoint(data.location);
      detail = data.status === 0 ? "\u5F00\u59CB\u91C7\u96C6" : data.status === 1 ? "\u53D6\u6D88\u91C7\u96C6" : "\u63D0\u4EA4\u91C7\u96C6";
    } else if (name === "block_place" || name === "use_item") {
      kind = "interact";
      target = visualPoint(data.location);
      detail = "\u4F7F\u7528\u7269\u54C1 / \u65B9\u5757";
    } else if (name === "window_click") {
      kind = "inventory";
      detail = `\u69FD\u4F4D ${Number.isSafeInteger(data.slot) ? data.slot : "?"} \xB7 ${data.mouseButton === 1 ? "\u53F3\u952E" : "\u5DE6\u952E"}`;
    } else return;
    r.operations.push({
      id: ++operationId,
      kind,
      button: kind === "attack" || kind === "gather" ? "left" : kind === "inventory" && data.mouseButton !== 1 ? "left" : "right",
      detail,
      target,
      from: visualPoint(bot.entity.position),
      until: now() + 1800
    });
    r.operations = r.operations.slice(-6);
  });
  function sample() {
    const r = refreshRecord();
    if (!r) return;
    const time = now(), position = visualPoint(bot.entity.position);
    if (r.dimension !== (bot.game?.dimension ?? null)) {
      r.dimension = bot.game?.dimension ?? null;
      r.epoch = randomUUID();
      r.trail = [];
      r.intent = null;
      r.route = null;
      r.candidates = [];
      r.markers = [];
      r.operations = [];
      r.pointer = null;
      r.camera = null;
      r.presentation = null;
    }
    const previous = r.trail.at(-1);
    if (position && (!previous || Math.hypot(previous.x - position.x, previous.y - position.y, previous.z - position.z) >= 0.3)) {
      if (previous && Math.hypot(previous.x - position.x, previous.y - position.y, previous.z - position.z) > 16) r.trail = [];
      r.trail.push({ ...position, at: time });
      r.trail = r.trail.slice(-64);
    }
    if (r.route?.source === "pathfinder" && r.route.status === "moving" && bot.pathfinder?.isMoving?.() === true) r.route.until = time + 1e4;
    r.input = {
      controls: controls.filter((key) => bot.controlState?.[key] === true),
      position,
      yaw: Number.isFinite(bot.entity.yaw) ? bot.entity.yaw : null,
      pitch: Number.isFinite(bot.entity.pitch) ? bot.entity.pitch : null
    };
    expire(r, time);
  }
  const remaining = (value, time) => value ? { ...value, remainingMs: Math.max(0, value.until - time), until: void 0 } : null;
  function flush(force = false) {
    if (closed) return;
    sample();
    const subject = viewerSubject(), r = subject ? hub.get(subject) : null, time = now();
    if (r) expire(r, time);
    const presentation = r?.presentation, presentationKey = presentation ? `${r.epoch}:${r.presentationRevision}` : "";
    const frame = {
      schemaVersion: 1,
      subject,
      available: !!r,
      reason: r ? null : subject ? "AGENT_VISUAL_SOURCE_UNAVAILABLE" : "AGENT_VISUAL_SUBJECT_UNATTACHED",
      epoch: r?.epoch ?? null,
      ttlMs: 3500
    };
    if (r) Object.assign(frame, {
      intent: remaining(r.intent, time),
      route: remaining(r.route, time),
      camera: remaining(r.camera, time),
      candidates: r.candidates.map((v) => remaining(v, time)),
      markers: r.markers.map((v) => remaining(v, time)),
      trail: r.trail.map(({ at, ...p }) => p),
      input: { ...r.input, operations: r.operations.map((v) => remaining(v, time)), pointer: remaining(r.pointer, time) },
      presentation: presentation ? {
        id: presentation.id,
        revision: r.presentationRevision,
        kind: presentation.kind,
        title: presentation.title,
        caption: presentation.caption,
        remainingMs: Math.max(0, presentation.until - time)
      } : null
    });
    const signature = JSON.stringify(frame);
    for (const [socket, sent] of sockets) {
      if (socket.connected === false) continue;
      if (force || sent.signature !== signature || time - sent.at >= 1e3) {
        socket.emit("agentVisualization", { ...frame, sequence: ++sequence });
        sent.signature = signature;
        sent.at = time;
      }
      if (presentationKey && sent.presentation !== presentationKey) socket.emit("agentPresentation", {
        schemaVersion: 1,
        subject,
        epoch: r.epoch,
        revision: r.presentationRevision,
        presentation: remaining(presentation, time)
      });
      sent.presentation = presentationKey;
    }
  }
  const timer = timers ? setInterval(flush, Math.max(100, intervalMs)) : null;
  timer?.unref?.();
  refreshRecord();
  return {
    publish,
    flush,
    subscribeSocket(socket) {
      if (closed) throw Error("AGENT_VISUAL_HOST_CLOSED");
      let lastPublish = -Infinity;
      const incoming = async (update, acknowledge) => {
        if (typeof acknowledge !== "function") return;
        const finish = (result) => {
          if (sockets.has(socket) && !closed) acknowledge(result);
        };
        if (now() - lastPublish < 200) {
          finish({ ok: false, code: "AGENT_VISUAL_RATE_LIMIT" });
          return;
        }
        lastPublish = now();
        let authorized = false;
        try {
          authorized = typeof authorizePublish === "function" && await authorizePublish({ socket, subject: ownSubject(bot) }) === true;
        } catch {
        }
        if (!authorized) {
          finish({ ok: false, code: "AGENT_VISUAL_PUBLISH_FORBIDDEN" });
          return;
        }
        if (closed || !sockets.has(socket)) return;
        finish(publish(update));
      };
      const off = () => {
        sockets.delete(socket);
        socket.off?.("disconnect", off);
        socket.off?.("agentVisualUpdate", incoming);
      };
      sockets.set(socket, { signature: "", at: -Infinity, presentation: "", off });
      socket.on("disconnect", off);
      socket.on("agentVisualUpdate", incoming);
      flush(true);
      return off;
    },
    dispose() {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      stopPackets();
      for (const [event, handler] of hooks) bot.off(event, handler);
      publishers.delete(bot);
      hub.remove(owner);
      record = null;
      for (const [socket, row] of sockets) {
        socket.emit("agentVisualization", { schemaVersion: 1, subject: null, available: false, reason: "AGENT_VISUAL_HOST_CLOSED", sequence: ++sequence, ttlMs: 3500 });
        row.off();
      }
      sockets.clear();
    }
  };
}
export {
  createViewerAgentBridge,
  createViewerAgentHub,
  publishAgentVisualization,
  viewerAgentHub
};
