/** Minecraft 引擎子进程入口。创建 World 并通过 IPC 接收配置和工具请求，向主进程转发事件及 Core 请求。 */
import { createIpcLogger } from './support/runtime.mjs';
import { withAnchors } from './support/runtime.mjs';
import { MinecraftWorld } from './world.ts';
import { DeferredRenders } from './deferred-renders.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { encodeBlobs } from './engine-blobs.ts';
import type {
  ChildToMain,
  EngineInit,
  EngineRequest,
  HostRequest,
  IpcToolOutcome,
  MainToChild,
  StorageStat,
} from './engine-ipc.ts';
import type {
  EventEnvelope,
  EventStoreReader,
  WorldHost,
  Logger,
  StoragePart,
  ToolOutcome,
} from './support/host-contract.ts';

function send(msg: ChildToMain): void {
  process.send?.(msg);
}

const makeLogger = (area: string): Logger => createIpcLogger((note) => send({ t: 'note', note }), area);

const log = makeLogger('');

const HOST_RPC_TIMEOUT_MS = 10_000;
let nextHostReqId = 1;
const pendingHost = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function hostRpc(req: HostRequest, timeoutMs = HOST_RPC_TIMEOUT_MS): Promise<unknown> {
  const id = nextHostReqId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingHost.delete(id);
      reject(new Error(`主进程 ${timeoutMs / 1000}s 未回执宿主调用(${req.kind})`));
    }, timeoutMs);
    timer.unref?.();
    pendingHost.set(id, { resolve, reject, timer });
    send({ t: 'hreq', id, req });
  });
}

/** 同步 Core 接口不能经异步 IPC 调用，使用时抛错。 */
const unavailable = (what: string): never => {
  throw new Error(`${what} 在子进程宿主里不可用`);
};

const store: EventStoreReader = {
  get: () => unavailable('store.get'),
  latestCursor: () => unavailable('store.latestCursor'),
  range: () => unavailable('store.range'),
  around: () => unavailable('store.around'),
  grep: () => unavailable('store.grep'),
};

const deferredRenders = new DeferredRenders();

/** IPC 走 JSON:回执里的图片字节转成 base64,主进程 proxy 还原(见 ipcToolOutcome) */
function toolOutcomeOverIpc(out: string | ToolOutcome): string | IpcToolOutcome {
  if (typeof out === 'string') return out;
  const { blobs, ...plain } = out;
  if (!blobs) return plain;
  return {
    ...plain,
    blobs: encodeBlobs(blobs),
  };
}

const selectedBlobs = new AsyncLocalStorage<ReadonlyMap<string, {bytes: Uint8Array; mime: string}>>();
const host: WorldHost = {
  pushEvent: (e, opts) => hostRpc({ kind: 'push', evt: { ...e, blobs: encodeBlobs(e.blobs) }, opts }) as Promise<EventEnvelope>,
  pushDeferred: (e, opts) => {
    const renderId = deferredRenders.arm(e.type, e.render);
    send({
      t: 'note',
      note: {
        kind: 'arm-deferred',
        type: e.type,
        renderId,
        ...(e.senderKey !== undefined ? { senderKey: e.senderKey } : {}),
        ...(e.meta !== undefined ? { meta: e.meta } : {}),
        ...(e.tags !== undefined ? { tags: e.tags } : {}),
        ...(opts?.trigger !== undefined ? { trigger: opts.trigger } : {}),
      },
    });
  },
  store,
  drainPendingEvents: () => hostRpc({ kind: 'drain' }) as Promise<EventEnvelope[]>,
  modelFacts: {
    model: () => unavailable('modelFacts.model'),
    accepts: () => unavailable('modelFacts.accepts'),
    contextWindow: () => unavailable('modelFacts.contextWindow'),
  },
  blob: handle => selectedBlobs.getStore()?.get(handle) ?? null,
  reportUsage: (usage, opts) => send({ t: 'note', note: { kind: 'usage', usage, opts } }),
  log,
};

let mod: MinecraftWorld | null = null;
let cfg: EngineInit['cfg'] | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let lastStatus = '';
const activeRequests = new Map<number, AbortController>();
let stopping = false;

function applyCfg(target: Record<string, unknown>, next: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(next)) {
    const cur = target[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      applyCfg(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      target[k] = v;
    }
  }
}

function storageStats(parts: StoragePart[]): StorageStat[] {
  return parts.map((p) => {
    let stat = '';
    try {
      stat = p.stat();
    } catch {
      stat = '(取不到)';
    }
    return {
      key: p.key,
      label: p.label,
      kind: p.kind,
      location: p.location,
      danger: p.danger,
      note: p.note,
      order: p.order,
      stat,
    };
  });
}

function pushStatus(): void {
  if (!mod) return;
  const decl = mod.console();
  const note = {
    kind: 'status' as const,
    decl: { lamps: decl.lamps, badges: decl.badges, links: decl.links },
    storage: storageStats(decl.storage ?? []),
    promptVars: mod.envPromptRuntimeVars(),
    requestFacts: mod.requestFacts(),
  };
  const key = JSON.stringify(note);
  if (key === lastStatus) return;
  lastStatus = key;
  send({ t: 'note', note });
}

async function handleRequest(req: EngineRequest, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  if (stopping && req.kind !== 'shutdown') throw new Error('Engine stopped');
  if (req.kind === 'init') {
    if (mod) throw new Error('已经 init 过了');
    cfg = req.init.cfg;
    const extension = req.init.extension;
    if (extension && !extension.module.startsWith('file:')) throw new Error('Extension must be an explicit local file URL');
    const create = extension ? (await import(extension.module)).createEngine : (options: import('./world.ts').MinecraftWorldOptions) => new MinecraftWorld(options);
    if (typeof create !== 'function') throw new Error('Invalid server extension factory');
    mod = create({
      cfg,
      timezone: req.init.timezone,
      botName: req.init.botName,
      extension: req.init.extension,
      ...(req.init.dataDir ? { dataDir: req.init.dataDir } : {}),
    });
    if (!mod) throw new Error('Engine factory returned no engine');
    await mod.start(host);
    if (stopping) { await mod?.stop(); throw new Error('Engine startup cancelled'); }
    statusTimer = setInterval(pushStatus, 1000);
    statusTimer.unref?.();
    return null;
  }
  if (req.kind === 'shutdown') {
    stopping = true;
    for (const controller of activeRequests.values()) controller.abort(new Error('Engine stopped'));
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = null;
    await mod?.stop();
    mod = null;
    setImmediate(() => process.exit(0));
    return null;
  }
  if (req.kind === 'render-deferred') {
    /** 渲染失败返回 null。 */
    const out = await deferredRenders.render(req.type, req.renderId,signal);
    return out && typeof out === 'object' ? {...out,blobs:encodeBlobs(out.blobs)} : out;
  }
  if (!mod) throw new Error('Minecraft 引擎还没 init');
  if (req.kind === 'turn-ended') { await mod.onTurnEnded(); return null; }
  if (req.kind === 'tool') {
    const tool = mod.tools().find((t) => t.name === req.name);
    if (!tool) throw new Error(`未知工具「${req.name}」`);
    const blobs = new Map(req.selectedBlobs?.map(b => [b.handle, {bytes: Buffer.from(b.b64, 'base64'), mime: b.mime}]));
    const events: EventEnvelope[] = [];
    const out = await selectedBlobs.run(blobs, () => withAnchors({ sess: req.role, ...(req.callId ? { call: req.callId } : {}), ...(req.round !== null ? { round: req.round } : {}) }, () => tool.handler(req.args, {
      role: req.role,
      log,
      signal, turnId: req.turnId, queueExternalEvents: queued => events.push(...queued),
      ...(req.callId ? { callId: req.callId } : {}),
      ...(req.round !== null ? { round: req.round } : {}),
    })));
    signal.throwIfAborted();
    return toolOutcomeOverIpc(events.length ? { ...(typeof out === 'string' ? { text: out } : out), events } : out);
  }
  if (req.kind === 'storage-clear') {
    const part = (mod.console().storage ?? []).find((p) => p.key === req.key);
    if (!part) throw new Error(`未知存储部分: ${req.key}`);
    return part.clear();
  }
  const invoke = mod.console().invoke;
  if (!invoke) throw new Error('World 没有面板调用面');
  return invoke(req.panel, req.method, req.args);
}

process.on('message', (msg: MainToChild) => {
  if (msg.t === 'req') {
    const controller = new AbortController();
    activeRequests.set(msg.id, controller);
    void Promise.resolve()
      .then(() => handleRequest(msg.req, controller.signal))
      .then(
        (value) => send({ t: 'rep', id: msg.id, ok: true, value }),
        (err: unknown) =>
          send({ t: 'rep', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
      ).finally(() => activeRequests.delete(msg.id));
    return;
  }
  if (msg.t === 'hrep') {
    const p = pendingHost.get(msg.id);
    if (!p) return;
    pendingHost.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.value);
    else p.reject(new Error(msg.error ?? '宿主调用失败'));
    return;
  }
  const cast = msg.cast;
  if (cast.kind === 'cancel') { activeRequests.get(cast.requestId)?.abort(new Error(cast.reason)); return; }
  if (cast.kind === 'config' && cfg) {
    applyCfg(cfg as unknown as Record<string, unknown>, cast.cfg as unknown as Record<string, unknown>);
  }
});

/** 父进程关闭时停止 World 及其管理的进程。 */
process.on('disconnect', () => {
  const m = mod;
  if (!m) {
    process.exit(0);
  }
  void m.stop().finally(() => process.exit(0));
});

/** 未处理的 Promise 拒绝只记录日志。 */
process.on('unhandledRejection', (reason) => {
  log.emit('error', '引擎子进程未处理的 Promise 拒绝(已忽略)', { event: 'unhandled-rejection', err: reason });
});

/** 致命异常先尝试停止 World；8 秒后强制退出。 */
const FATAL_DRAIN_MS = 8_000;
let dying = false;
process.on('uncaughtException', (err) => {
  log.emit('error', '引擎子进程未捕获异常', { event: 'uncaught-exception', err });
  if (dying) return;
  dying = true;
  const m = mod;
  mod = null;
  if (!m) { process.exit(1); return; }
  log.emit('warn', '引擎子进程收尾中(给服务端存档 8 秒)', { event: 'fatal-drain' });
  const hard = setTimeout(() => process.exit(1), FATAL_DRAIN_MS);
  hard.unref?.();
  void m.stop().catch(() => undefined).finally(() => { clearTimeout(hard); process.exit(1); });
});
