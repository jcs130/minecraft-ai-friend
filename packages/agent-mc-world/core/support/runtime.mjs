// Maintained host utilities. Imported MIT origin and hashes: provenance/import-20261013.json.
import { AsyncLocalStorage } from "node:async_hooks";
var storage = new AsyncLocalStorage();
function withAnchors(anchors, fn) {
  return storage.run({ ...storage.getStore(), ...anchors }, fn);
}
function currentAnchors() {
  return storage.getStore() ?? {};
}

function nowIso(timezone, d = /* @__PURE__ */ new Date()) {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = `${fmt.format(d).replace(" ", "T")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  const offMin = -getTimezoneOffsetMinutes(timezone, d);
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${parts}${sign}${hh}:${mm}`;
}
function getTimezoneOffsetMinutes(timezone, d) {
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  const loc = new Date(d.toLocaleString("en-US", { timeZone: timezone }));
  return (utc.getTime() - loc.getTime()) / 6e4;
}
var ROTATE_BYTES = 64 * 1024 * 1024;
function normalizeError(value) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, ...value.stack ? { stack: value.stack } : {} };
  }
  if (typeof value === "string") return { name: "Error", message: value };
  if (value && typeof value === "object") {
    const v = value;
    if (typeof v.message === "string") {
      return {
        name: typeof v.name === "string" ? v.name : "Error",
        message: v.message,
        ...typeof v.stack === "string" ? { stack: v.stack } : {}
      };
    }
  }
  return { name: "Error", message: String(value) };
}
function nullLogger() {
  const l = {
    trace: () => {
    },
    debug: () => {
    },
    info: () => {
    },
    warn: () => {
    },
    error: () => {
    },
    emit: () => {
    },
    child: () => l
  };
  return l;
}

var ANCHOR_KEYS = ["sess", "round", "resp", "call", "ev", "task"];
function createIpcLogger(send, area = "") {
  const emit = (level, msg, opts) => {
    const anchors = currentAnchors();
    const note = { kind: "log", level, area, msg, atMs: Date.now(), pid: process.pid };
    if (opts?.event !== void 0) note.event = opts.event;
    if (opts?.durMs !== void 0) note.durMs = opts.durMs;
    if (opts?.incident) note.incident = true;
    for (const key of ANCHOR_KEYS) {
      const value = opts?.[key] ?? anchors[key];
      if (value !== void 0) note[key] = value;
    }
    let data = opts?.data;
    let err = opts?.err;
    if (data instanceof Error) {
      err ??= data;
      data = void 0;
    } else if (data && typeof data === "object" && !Array.isArray(data)) {
      const bag = data;
      const carried = bag.err instanceof Error ? bag.err : bag.error instanceof Error ? bag.error : void 0;
      if (carried) {
        err ??= carried;
        const { err: _e, error: _error, ...rest } = bag;
        data = Object.keys(rest).length ? rest : void 0;
      }
    }
    if (data !== void 0) {
      try {
        JSON.stringify(data);
      } catch {
        data = String(data);
      }
      note.data = data;
    }
    if (err !== void 0) note.err = normalizeError(err);
    send(note);
  };
  return {
    trace: (m, d) => emit("trace", m, { data: d }),
    debug: (m, d) => emit("debug", m, { data: d }),
    info: (m, d) => emit("info", m, { data: d }),
    warn: (m, d) => emit("warn", m, { data: d }),
    error: (m, d) => emit("error", m, { data: d }),
    emit,
    child: (sub) => createIpcLogger(send, area ? `${area}.${sub}` : sub)
  };
}
function emitLogNote(root, note, timezone) {
  const target = note.area ? root.child(note.area) : root;
  const { kind: _kind, level, area: _area, msg, atMs, ...rest } = note;
  target.emit(level, msg, { ...rest, ts: nowIso(timezone, new Date(atMs)) });
}
function logLines(stream, log, level, event) {
  if (!stream) return;
  let carry = "";
  stream.on("data", (chunk) => {
    const text = carry + chunk.toString();
    const lines = text.split(/\r?\n/);
    carry = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) log.emit(level, trimmed, { event });
    }
  });
  stream.on("end", () => {
    const trimmed = carry.trim();
    carry = "";
    if (trimmed) log.emit(level, trimmed, { event });
  });
}
function logChildStdio(child, log) {
  const stdio = log.child("stdio");
  logLines(child.stdout, stdio, "debug", "stdout");
  logLines(child.stderr, stdio, "warn", "stderr");
}

var PLACEHOLDER = /\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g;
function renderTemplate(template, vars) {
  return template.replace(PLACEHOLDER, (whole, name, fallback) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return whole;
    const value = vars[name] ?? "";
    if (value !== "") return value;
    return fallback === void 0 ? "" : fallback.trim();
  });
}
export {
  createIpcLogger,
  emitLogNote,
  logChildStdio,
  logLines,
  nowIso,
  nullLogger,
  renderTemplate,
  withAnchors
};
