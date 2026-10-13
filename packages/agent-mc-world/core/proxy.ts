/** 主进程中的 Minecraft World 代理。游戏连接、执行器和客户端管理在引擎子进程；此处转发工具、事件、控制台及存储请求，并每秒推送配置。 */
import { fork, type ChildProcess } from 'node:child_process';
import { nowIso } from './support/runtime.mjs';
import { emitLogNote, logChildStdio } from './support/runtime.mjs';
import { childExecArgv } from './support/child-process.ts';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  World,
  WorldHost,
  WorldConsoleDecl,
  StoragePart,
  ToolDef,
  ToolOutcome,
  WorldRequestFacts,
} from './support/host-contract.ts';
import { MINECRAFT_PANEL_DECLS, MINECRAFT_STORAGE_DECLS, minecraftToolDecls, type MinecraftWorldOptions } from './world.ts';
import { MINECRAFT_CLIENT_CONFIG_GROUP, MINECRAFT_CONFIG_GROUP, MINECRAFT_PLAYER_CONFIG_GROUP, MINECRAFT_RHYTHM_CONFIG_GROUP } from './config.ts';
import type {
  ChildToMain,
  EngineCast,
  EngineNote,
  EngineRequest,
  HostRequest,
  IpcToolOutcome,
  StorageStat,
} from './engine-ipc.ts';
import { roundTokenOf } from './round.ts';
import { loadExplored, renderExploredLedger } from './explored.ts';
import { loadPolicy, renderPolicyEnv } from './policy.ts';
import { worldEnvLine, worldIdentityOf } from './server-config.ts';
import { decodeBlobs } from './engine-blobs.ts';
import { resolveProcedure, procedureReference } from './support/procedure.ts';
import { METHOD_ADAPTER } from './method-runner.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const CAMERA_NOTE_FILE = fileURLToPath(new URL('./ENV_PROMPT_CAMERA.md', import.meta.url));
const CHILD_ENTRY = fileURLToPath(new URL('./engine-child.ts', import.meta.url));
/** 引擎子进程 `--import` 它,依赖的源码补丁在 mineflayer 加载前装好 */
const DEPENDENCY_PATCHES_URL = new URL('./dependency-patches.ts', import.meta.url).href;

const CONFIG_SAMPLE_MS = 1000;
const RESTART_DELAY_MS = 3000;
/** Windows STATUS_CONTROL_C_EXIT。 */
const CONSOLE_KILL_EXIT_CODE = 3221225786;
/** 工具 RPC 超时。 */
const RPC_TIMEOUT_MS = 150_000;
/** 延迟事件渲染的 RPC 超时须短于主循环的 3 秒等待上限。 */
const DEFERRED_RENDER_TIMEOUT_MS = 2500;
const PANEL_RPC_TIMEOUT_MS = 150_000;
/** 初始化确认只表示请求已受理，不等待游戏连接完成。 */
const INIT_TIMEOUT_MS = 30_000;

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanup?: () => void;
}

/** 子进程发来的工具回执:base64 图片还原成字节(见 engine-child 的 toolOutcomeOverIpc) */
function ipcToolOutcome(out: string | IpcToolOutcome): string | ToolOutcome {
  if (typeof out === 'string' || !out.blobs) return out as string | ToolOutcome;
  return {
    ...out,
    blobs: decodeBlobs(out.blobs),
  };
}

export class MinecraftWorldProxy implements World {
  readonly id = 'minecraft';

  private host: WorldHost | null = null;
  private child: ChildProcess | null = null;
  private ready = false;
  private stopping = false;
  private stoppingPromise: Promise<void> | null = null;
  private nextReqId = 1;
  private readonly pending = new Map<number, PendingRpc>();
  private declCache: Pick<WorldConsoleDecl, 'lamps' | 'badges' | 'links'> = {};
  private storageCache: StorageStat[] = [];
  private requestFactsCache: WorldRequestFacts | null = null;
  private promptVars: Record<'minecraft.current_task' | 'minecraft.goals', string> = {
    'minecraft.current_task': '(引擎尚未报告任务状态；用 mc_queue 现查)',
    'minecraft.goals': '(引擎尚未报告目标状态；用 mc_goal 现查)',
  };
  private lastConfigJson = '';
  private lastCaps: boolean | null = null;
  private configTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: MinecraftWorldOptions) {}

  /**
   * 前缀从子进程持有的落盘文件读取探索摘要与常驻规则，并从 server.properties 读取世界身份。
   * 快照锚点由子进程设置。
   */
  envPromptVars(): Record<string, string> {
    return {
      'minecraft.version': this.opts.cfg.version,
      'minecraft.world': worldEnvLine(worldIdentityOf(
        this.opts.cfg.local.serverDir,
        `${this.opts.cfg.host}:${this.opts.cfg.port}`,
      )),
      'minecraft.explored': renderExploredLedger(loadExplored(this.storageFileOf('minecraft-explored'))),
      'minecraft.policy': renderPolicyEnv(loadPolicy(this.storageFileOf('minecraft-policy'))),
      'minecraft.camera': this.opts.cfg.client.enabled
        ? readFileSync(CAMERA_NOTE_FILE, 'utf8').trim()
        : '',
      ...this.promptVars,
    };
  }

  /** 引擎已有采样的同步缓存；不发 RPC，也不读取存储。 */
  requestFacts(): WorldRequestFacts | null {
    if (!this.ready || !this.child?.connected || !this.requestFactsCache) return null;
    return { ...this.requestFactsCache, snapshotTypes: [...this.requestFactsCache.snapshotTypes] };
  }

  tools(): ToolDef[] {
    return [...minecraftToolDecls(), ...(this.opts.extension?.tools ?? [])].map((decl) => ({
      ...decl,
      handler: async (args, ctx) => {
        const selected = new Map<string, {handle: string; b64: string; mime: string}>();
        if (decl.name === 'mc_script' && args.procedure !== undefined) {
          try {
            resolveProcedure(procedureReference(args.procedure), METHOD_ADAPTER, handle => {
              const got = this.host?.blob(handle);
              if (got) selected.set(handle, {handle, b64: Buffer.from(got.bytes).toString('base64'), mime: got.mime});
              return got ?? null;
            });
          } catch (error) { return {text: `[${decl.name} 失败] ${String(error)}`, failed: true}; }
        }
        try {
          return ipcToolOutcome((await this.rpc(
            {
              kind: 'tool', name: decl.name, args, role: ctx.role,
              callId: ctx.callId ?? null,
              round: roundTokenOf(ctx),
              turnId: ctx.turnId,
              ...(selected.size ? {selectedBlobs: [...selected.values()]} : {}),
            },
            RPC_TIMEOUT_MS,
            ctx.signal,
          )) as string | IpcToolOutcome);
        } catch (err) {
          return { text: `[${decl.name} 失败] 引擎进程不可用:${err instanceof Error ? err.message : String(err)}`, failed: true };
        }
      },
    }));
  }

  console(): WorldConsoleDecl {
    return {
      lamps: this.declCache.lamps ?? [this.child
        ? { label: '引擎', state: 'loading' as const, hint: '启动中' }
        : { label: '引擎', state: 'offline' as const, hint: '未启动' }],
      badges: this.declCache.badges ?? [
        { label: '引擎', value: this.child ? '启动中' : '未启动', tone: 'off' },
      ],
      panels: [...MINECRAFT_PANEL_DECLS],
      invoke: (panel, method, args) => {
        // 路径选择保存后紧接着会读状态或启动；同一 IPC 通道先投最新配置，
        // 让这次面板调用看到刚写入的值。
        this.pushConfigIfChanged();
        return this.rpc({ kind: 'panel', panel, method, args }, PANEL_RPC_TIMEOUT_MS);
      },
      promptDocs: [
        {
          key: 'worlds.minecraft.envPrompt',
          title: 'Minecraft · 环境提示词',
          description: 'Minecraft World 的常驻事实（技能序列、世界观察、反射层）。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            {
              name: 'minecraft.world',
              description: '世界身份:本地托管=「当前存档:名字」,外部服务器=「当前服务器:地址」。她的位置类记忆按它划界。',
            },
            {
              name: 'minecraft.explored',
              description: '探索覆盖摘要(8 方向历史最远与末端群系);一处没探过时为空。',
            },
            {
              name: 'minecraft.policy',
              description: 'mc_policy 六格里与默认不同的那几条;全默认时为空。',
            },
            {
              name: 'minecraft.camera',
              description: '观察者摄像机说明;没开客户端时为空。措辞在「摄像机说明」那份里改。',
              multiline: true,
            },
            {
              name: 'minecraft.current_task',
              description: '引擎同步的当前任务;引擎未就绪时提示用 mc_queue 现查。',
            },
            {
              name: 'minecraft.goals',
              description: '引擎同步的 mc_goal 目标摘要;引擎未就绪时提示用 mc_goal 现查。',
            },
          ],
        },
        {
          key: 'worlds.minecraft.cameraNote',
          title: 'Minecraft · 摄像机说明',
          description: '开了观察者客户端时,追加到环境提示词末尾的那一段。',
          path: CAMERA_NOTE_FILE,
        },
      ],
      storage: MINECRAFT_STORAGE_DECLS.map((d): StoragePart => ({
        ...d,
        stat: () =>
          this.storageCache.find((s) => s.key === d.key)?.stat ?? this.storageStatOffline(d.key),
        clear: async () => this.storageClear(d.key),
      })),
      links: this.declCache.links ?? [],
      config: [
        MINECRAFT_CONFIG_GROUP,
        MINECRAFT_RHYTHM_CONFIG_GROUP,
        MINECRAFT_CLIENT_CONFIG_GROUP,
        MINECRAFT_PLAYER_CONFIG_GROUP,
      ],
    };
  }

  private storageFileOf(key: string): string | null {
    if (!this.opts.dataDir) return null;
    if (key === 'minecraft-chests') return join(this.opts.dataDir, 'minecraft-chests.json');
    if (key === 'minecraft-deaths') return join(this.opts.dataDir, 'minecraft-deaths.json');
    if (key === 'minecraft-explored') return join(this.opts.dataDir, 'minecraft-explored.json');
    if (key === 'minecraft-policy') return join(this.opts.dataDir, 'minecraft-policy.json');
    if (key === 'minecraft-blueprints') return join(this.opts.dataDir, 'minecraft-blueprints.json');
    return null;
  }

  private storageStatOffline(key: string): string {
    const file = this.storageFileOf(key);
    if (!file || !existsSync(file)) return '(无文件)';
    try {
      return `${(statSync(file).size / 1024).toFixed(1)}KB(引擎未启动)`;
    } catch {
      return '(读不了)';
    }
  }

  /** 在线存储操作经 RPC 转发；引擎启动中拒绝操作，离线时直接清理文件。 */
  private async storageClear(key: string): Promise<string> {
    if (this.child?.connected) {
      if (!this.ready) throw new Error('引擎子进程正在启动,稍后再清');
      return String(await this.rpc({ kind: 'storage-clear', key }, RPC_TIMEOUT_MS));
    }
    const file = this.storageFileOf(key);
    if (!file || !existsSync(file)) return '没有落盘文件,无需清除';
    writeFileSync(file, '{}\n', 'utf8');
    return '已清空(引擎未启动,直清文件)';
  }

  async start(host: WorldHost): Promise<void> {
    if (this.stoppingPromise) throw new Error('Engine is stopping');
    if (this.child) throw new Error('Engine is already running or starting');
    this.host = host;
    this.stopping = false;
    await this.spawn();
    if (this.stopping) throw new Error('Engine startup cancelled');
    this.configTimer = setInterval(() => this.pushConfigIfChanged(), CONFIG_SAMPLE_MS);
    this.configTimer.unref?.();
  }

  async onTurnEnded(): Promise<void> { await this.rpc({ kind: 'turn-ended' }, RPC_TIMEOUT_MS); }

  stop(): Promise<void> {
    if (this.stoppingPromise) return this.stoppingPromise;
    this.stoppingPromise = this.stopEngine().finally(() => { this.stoppingPromise = null; });
    return this.stoppingPromise;
  }
  private async stopEngine(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.configTimer) clearInterval(this.configTimer);
    this.configTimer = null;
    const child = this.child;
    if (child) {
      try {
        await this.rpc({ kind: 'shutdown' }, 15_000);
      } catch {
        /** shutdown RPC 超时后终止子进程。 */
      }
      await waitExit(child, 5000);
      if (child.exitCode === null && !child.killed) child.kill();
    }
    this.teardownChild();
    this.host = null;
  }


  private async spawn(): Promise<void> {
    const child = fork(CHILD_ENTRY, [], {
      execArgv: [...childExecArgv(), '--import', DEPENDENCY_PATCHES_URL],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      // ToolOutcome may contain screenshot bytes. JSON IPC turns a Buffer into
      // a plain object, which Core cannot persist as a BlobInput.
      serialization: 'advanced',
    });
    this.child = child;
    if (this.host) logChildStdio(child, this.host.log);
    child.on('message', (msg) => { if (this.child === child) this.onMessage(msg as ChildToMain); });
    child.on('exit', (code) => { if (this.child === child) this.onExit(code); });
    child.on('error', (err) => this.host?.log.error('Minecraft 引擎子进程出错', { err: String(err) }));
    this.lastConfigJson = JSON.stringify(this.opts.cfg);
    await this.rpc(
      {
        kind: 'init',
        init: {
          timezone: this.opts.timezone ?? 'Asia/Shanghai',
          botName: this.opts.botName ?? 'bot',
          dataDir: this.opts.dataDir ?? null,
          extension: this.opts.extension,
          cfg: JSON.parse(this.lastConfigJson) as MinecraftWorldOptions['cfg'],
        },
      },
      INIT_TIMEOUT_MS,
    );
    if (this.stopping || this.child !== child) return;
    this.ready = true;
    this.lastCaps = null;

    this.host?.log.info(`Minecraft 引擎子进程已就绪 pid=${child.pid}`);
  }

  private teardownChild(): void {
    this.child = null;
    this.ready = false;
    this.declCache = {};
    this.storageCache = [];
    this.requestFactsCache = null;
    this.promptVars = {
      'minecraft.current_task': '(引擎尚未报告任务状态；用 mc_queue 现查)',
      'minecraft.goals': '(引擎尚未报告目标状态；用 mc_goal 现查)',
    };
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.cleanup?.();
      p.reject(new Error('Minecraft 引擎子进程已退出'));
    }
    this.pending.clear();
  }

  private onExit(code: number | null): void {
    const wasStopping = this.stopping;
    this.teardownChild();
    if (wasStopping) return;
    if (code === CONSOLE_KILL_EXIT_CODE) {
      this.host?.log.warn('Minecraft 引擎子进程收到 0xC000013A 退出状态，宿主退出');
      this.stopping = true; // A child interrupt must not terminate its host or restart the game.
      this.host?.pushEvent({ts:nowIso(this.opts.timezone ?? 'UTC'),source:this.id,type:'minecraft.lifecycle',text:'Engine interrupted; reconnect explicitly.'},{trigger:'flush'}).catch(()=>{});
      return;
    }
    this.host?.log.error(`Minecraft 引擎子进程意外退出(code=${code}),${RESTART_DELAY_MS / 1000}s 后重启`);
    this.host?.pushEvent(
      {
        ts: nowIso(this.opts.timezone ?? 'Asia/Shanghai'),
        source: this.id,
        type: 'minecraft.event',
        text: '[Minecraft] 游戏引擎崩了,正在自动重启;重新连上之前,游戏里的动作都不会生效。',
        senderKey: 'minecraft',
      },
      { trigger: 'flush' },
    ).catch(() => {  });
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.restartTimer || this.stopping) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopping) return;
      void this.spawn().catch((err: unknown) => {
        this.host?.log.error('Minecraft 引擎子进程重启失败,继续重试', { err: String(err) });
        this.teardownChild();
        this.scheduleRestart();
      });
    }, RESTART_DELAY_MS);
    this.restartTimer.unref?.();
  }


  private onMessage(msg: ChildToMain): void {
    if (msg.t === 'rep') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      p.cleanup?.();
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error ?? '子进程报错'));
      return;
    }
    if (msg.t === 'hreq') {
      void this.onHostRequest(msg.id, msg.req);
      return;
    }
    this.onNote(msg.note);
  }

  private async onHostRequest(id: number, req: HostRequest): Promise<void> {
    const child = this.child;
    try {
      const host = this.host;
      if (!host) throw new Error('宿主未接线');
      let value: unknown;
      if (req.kind === 'push') {
        value = await host.pushEvent({ ...req.evt, blobs: decodeBlobs(req.evt.blobs) }, req.opts);
      } else if (req.kind === 'drain') {
        value = await host.drainPendingEvents((e) => e.source === this.id);

      }
      child?.send({ t: 'hrep', id, ok: true, value });
    } catch (err) {
      child?.send({ t: 'hrep', id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private onNote(note: EngineNote): void {
    const host = this.host;
    if (!host) return;
    switch (note.kind) {
      case 'log':
        emitLogNote(host.log, note, this.opts.timezone ?? 'Asia/Shanghai');
        return;
      case 'usage':
        host.reportUsage(note.usage, note.opts);
        return;
      case 'arm-deferred': {
        /** 事件消费时请求子进程渲染；RPC 失败返回 null。 */
        const type = note.type;
        host.pushDeferred(
          {
            type,
            ...(note.senderKey !== undefined ? { senderKey: note.senderKey } : {}),
            ...(note.meta !== undefined ? { meta: note.meta } : {}),
            ...(note.tags !== undefined ? { tags: note.tags } : {}),
            render: async (signal) => {
              try {
                const result = await this.rpc(
                  { kind: 'render-deferred', type, renderId: note.renderId },
                  DEFERRED_RENDER_TIMEOUT_MS,signal,
                ) as string | null | IpcToolOutcome;
                return result && typeof result === 'object' ? ipcToolOutcome(result) : result;
              } catch {
                return null;
              }
            },
          },
          note.trigger !== undefined ? { trigger: note.trigger } : undefined,
        );
        return;
      }
      case 'status':
        this.declCache = note.decl;
        this.storageCache = note.storage;
        this.promptVars = note.promptVars;
        this.requestFactsCache = note.requestFacts;
        return;
    }
  }

  private rpc(req: EngineRequest, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const child = this.child;
    if (!child || !child.connected) return Promise.reject(new Error('Minecraft 引擎子进程未运行'));
    const id = this.nextReqId++;
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const abort = () => {
        this.pending.delete(id); clearTimeout(timer); cleanup();
        this.cast({ kind: 'cancel', requestId: id, reason: 'Host cancelled request' });
        reject(new Error('Engine request cancelled'));
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        cleanup();
        this.cast({ kind: 'cancel', requestId: id, reason: 'RPC deadline exceeded' });
        reject(new Error(`子进程 ${timeoutMs / 1000}s 未回执(${req.kind})`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      child.send({ t: 'req', id, req });
    });
  }

  private cast(cast: EngineCast): void {
    const child = this.child;
    if (!child || !child.connected) return;
    child.send({ t: 'cast', cast });
  }

  /** 每秒采样并推送配置。 */
  private pushConfigIfChanged(): void {
    if (!this.ready) return;

    const json = JSON.stringify(this.opts.cfg);
    if (json === this.lastConfigJson) return;
    this.lastConfigJson = json;
    this.cast({ kind: 'config', cfg: JSON.parse(json) as MinecraftWorldOptions['cfg'] });
  }


}

function waitExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
