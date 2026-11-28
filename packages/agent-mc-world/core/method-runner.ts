import { createHash, randomUUID } from 'node:crypto';
import { nativeCallSource, type NativeInvocation } from './mineflayer-call.ts';
import { Worker } from 'node:worker_threads';
import { PROCEDURE_LIMITS, type ProcedureGraph, type ProcedureInvocation, type ProcedureReference } from './support/procedure.ts';
import { compactWorkExecutionEvidence } from '../src/contracts/continuation-evidence.ts';

export const METHOD_ADAPTER = 'minecraft-method/v1';

export const METHOD_LIMITS = Object.freeze({ sourceChars: 12_000, paramsChars: 4_096,
  calls: 32, actions: 16, messageChars: 24_000, durationMs: 60_000, maxDurationMs: 120_000 });

export type MethodOperation = 'capabilities' | 'state' | 'do' | 'flightPlan' | 'swimPlan' | 'mineflayer' | 'mindcraft';
export interface MethodTrace {
  call: number; method: MethodOperation; args: unknown; startedAt: string;
  endedAt?: string; result?: unknown; error?: string;
  procedure?: { revision: string; invocation: number };
}
export interface MethodRun {
  id: number; name: string; sourceHash: string; startedAt: string; endedAt?: string;
  mode?: 'validation' | 'execution';
  status: 'running' | 'validated' | 'completed' | 'failed' | 'cancelled';
  trace: MethodTrace[]; result?: unknown; error?: string;
  executionNote?: string;
  routine?: { id: string; version: number };
  procedure?: { executionId: string; reference: ProcedureReference; adapter: string; mode: 'validation' | 'execution';
    invocations: ProcedureInvocation[]; versions: Array<{ id: string; revision: string; sourceHash: string; parent: string | null; author: unknown }> };
}
export interface MethodRequest {
  name?: string; code: string; params?: Record<string, unknown>; durationMs?: number; validate?: boolean;
  procedure?: { reference: ProcedureReference; graph: ProcedureGraph };
  routine?: { id: string; version: number };
}
export interface MethodHost {
  nativeMethods?: string[];
  gameLibrary?: boolean;
  call: (method: MethodOperation, args: Record<string, unknown>, signal: AbortSignal) => unknown | Promise<unknown>;
  onFinish: (run: MethodRun) => void;
}

/** Each program has one revocable capability set and at most one outstanding World call. */
export class MethodRunner {
  private serial = 0;
  private active: { run: MethodRun; validation: boolean; stop: (reason?: string) => void } | null = null;
  private validating: { run: MethodRun; stop: (reason?: string) => void } | null = null;
  private readonly runs = new Map<number, MethodRun>();
  private readonly waiters = new Map<number, Set<() => void>>();

  constructor(private readonly host: MethodHost) {}

  get current(): Pick<MethodRun, 'id' | 'name' | 'sourceHash' | 'startedAt' | 'routine'> | null {
    const run = this.active?.run;
    return run ? { id: run.id, name: run.name, sourceHash: run.sourceHash, startedAt: run.startedAt,
      ...(run.routine ? { routine: { ...run.routine } } : {}) } : null;
  }

  /** Wait for an original run; a cancelled/expired wait never cancels the program. */
  async wait(id: number, waitMs: number, signal?: AbortSignal): Promise<void> {
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30000) throw new Error('waitMs must be 0..30000');
    signal?.throwIfAborted();
    const run = this.runs.get(id);
    if (!run) throw new Error(`Unknown method run ${id}`);
    if (run.status !== 'running' || waitMs === 0) return;
    await new Promise<void>((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(signal?.reason ?? new Error('Method wait cancelled')); };
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort);
        this.waiters.get(id)?.delete(done); if (!this.waiters.get(id)?.size) this.waiters.delete(id); };
      const timer = setTimeout(done, waitMs);
      const waiting = this.waiters.get(id) ?? new Set<() => void>(); waiting.add(done); this.waiters.set(id, waiting);
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    });
  }

  read(id?: number): MethodRun[] {
    return structuredClone(id === undefined ? [...this.runs.values()] : [this.runs.get(id)].filter((r): r is MethodRun => !!r));
  }

  inspect(id?: number, call?: number): unknown {
    const summary = (run: MethodRun) => ({ id: run.id, name: run.name, sourceHash: run.sourceHash, mode: run.mode,
      startedAt: run.startedAt, endedAt: run.endedAt, status: run.status, calls: run.trace.length, error: run.error,
      ...(run.procedure ? { procedure: run.procedure } : {}), ...(run.routine ? { routine: run.routine } : {}) });
    if (id === undefined) return [...this.runs.values()].map(summary);
    const run = this.runs.get(id);
    if (!run) throw new Error(`方法#${id}不在本次进程的最近八次记录中`);
    if (call !== undefined) {
      const trace = run.trace.find(trace => trace.call === call);
      if (!trace) throw new Error(`方法#${id}没有SDK调用#${call}；状态 ${run.status}；可用调用 ${run.trace.map(t => t.call).join(',') || '无'}${run.error ? `；原错误 ${run.error.slice(0, 1000)}` : ''}。读取原 runId 的完整终态，不要猜调用编号或重开同一程序。`);
      return structuredClone({ ...summary(run), trace });
    }
    const result = JSON.stringify(run.result ?? null);
    return { ...summary(run), ...(run.executionNote ? {executionNote:run.executionNote} : {}), ...(result.length > 2000 && !run.routine
      ? { resultExcerpt: result.slice(0, 2000), resultTruncated: true }
      : { result: run.result }),
    trace: run.trace.map(trace => {
      const reply = trace.result as Record<string, unknown> | undefined;
      const steps = Array.isArray(reply?.steps) ? reply.steps : undefined;
      const compactSteps = steps ? compactWorkExecutionEvidence({steps:steps.slice(0,8)})?.steps as Array<Record<string,unknown>> : undefined;
      return { call: trace.call, method: trace.method, startedAt: trace.startedAt, endedAt: trace.endedAt,
        procedure: trace.procedure,
        error: trace.error, accepted: reply?.accepted, taskId: reply?.taskId, kind: reply?.kind, done: reply?.done,
        ...(steps ? { stepCount: steps.length, steps: steps.slice(0, 8).map((step, index) => ({
          step: step?.step, outcome: step?.outcome,
          why: typeof step?.why === 'string' ? step.why.slice(0, 160) : step?.why,
          ...(compactSteps?.[index]?.detail ? {detail:compactSteps[index].detail} : {}),
        })), ...(steps.length > 8 ? { stepsTruncated: true } : {}) } : {}),
        receiptExcerpt: typeof reply?.receipt === 'string' ? reply.receipt.slice(0, 500) : undefined };
    }) };
  }

  stop(reason = '外部取消'): boolean {
    const active=this.active,validating=this.validating;
    active?.stop(reason);validating?.stop(reason);
    return !!(active||validating);
  }

  /** Static validation has no world coordinates or capabilities to revoke.
   * Explicit stop still cancels it; a dropped game connection only stops execution. */
  cancelForDisconnect(reason: string): boolean {
    if(!this.active)return false;
    this.active.stop(reason);return true;
  }

  start(request: MethodRequest): MethodRun { return this.launch(request); }

  startNative(native:NativeInvocation, options:{name?:string; durationMs?:number}={}):MethodRun {
    if (!this.host.nativeMethods?.includes(native.name)) throw new Error('Native method unavailable: '+native.name);
    return this.launch({...options,code:nativeCallSource(native.name),params:{args:native.args}},native.name);
  }

  private launch(request: MethodRequest, native?:NativeInvocation['name']): MethodRun {
    const occupied=request.validate===true?this.validating:this.active;
    if (occupied) throw new Error(`方法#${occupied.run.id}仍在运行；先读取结果或明确取消`);
    if (typeof request.code !== 'string' || !request.code.trim() || request.code.length > METHOD_LIMITS.sourceChars) throw new Error(`code须为1至${METHOD_LIMITS.sourceChars}字符的JavaScript函数体`);
    const name = request.name ?? `inline-${createHash('sha256').update(request.code).digest('hex').slice(0,12)}`;
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('name须为1至80字符；可以省略以使用稳定的源码哈希名称');
    const params = jsonValue(request.params ?? {}, METHOD_LIMITS.paramsChars);
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('params须为JSON对象');
    const durationMs = request.durationMs ?? METHOD_LIMITS.durationMs;
    if (!Number.isInteger(durationMs) || durationMs < 1_000 || durationMs > METHOD_LIMITS.maxDurationMs) throw new Error(`durationMs须为1000至${METHOD_LIMITS.maxDurationMs}`);
    const run: MethodRun = { id: ++this.serial, name, mode: request.validate === true ? 'validation' : 'execution',
      sourceHash: createHash('sha256').update(request.code).digest('hex'),
      startedAt: new Date().toISOString(), status: 'running', trace: [] };
    if (request.routine) run.routine = structuredClone(request.routine);
    if (request.procedure) {
      const { reference, graph } = request.procedure;
      if (graph.root !== reference.revision || graph.versions[graph.root]?.code !== request.code) throw new Error('procedure request identity mismatch');
      run.procedure = { executionId: randomUUID(), reference, adapter: METHOD_ADAPTER,
        mode: request.validate ? 'validation' : 'execution', invocations: [],
        versions: Object.values(graph.versions).map(v => ({ id: v.id, revision: v.revision, sourceHash: v.sourceHash, parent: v.parent, author: v.author })) };
    }
    const controller = new AbortController();
    const worker = native ? null : new Worker(new URL('./method-worker.mjs', import.meta.url), {
      workerData: { code: request.code, params, validate: request.validate === true, nativeMethods: this.host.nativeMethods, gameLibrary: this.host.gameLibrary === true,
        graph: request.procedure?.graph, maxInvocations: PROCEDURE_LIMITS.invocations },
      env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
    });
    let finished = false;
    let outstanding = false;
    let actions = 0;
    const finish = (status: MethodRun['status'], error?: string, result?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      run.status = status;
      run.endedAt = new Date().toISOString();
      if (error) run.error = error;
      for (const trace of run.trace) if (!trace.endedAt) {
        trace.endedAt = run.endedAt;
        trace.error = '调用等待已撤销；未取得正常终态';
      }
      for (const invocation of run.procedure?.invocations ?? []) if (invocation.status === 'running') {
        invocation.status = 'failed'; invocation.endedAt = run.endedAt; invocation.error = error ?? 'procedure capability revoked';
      }
      if (result !== undefined) run.result = result;
      if (status === 'completed' && !run.trace.length && result == null) {
        run.executionNote = '程序没有调用游戏，也没有返回结果。如果只声明了函数，请在函数体末尾实际调用并返回结果。';
      }
      controller.abort(new Error(error ?? '方法结束'));
      void worker?.terminate();
      if(this.active?.run.id===run.id)this.active=null;
      if(this.validating?.run.id===run.id)this.validating=null;
      this.host.onFinish(structuredClone(run));
      for (const done of [...(this.waiters.get(run.id) ?? [])]) done();
    };
    const timer = setTimeout(() => finish('failed', `方法超过${durationMs}毫秒；已撤销它自己的未完成任务`), durationMs);
    if(request.validate===true)this.validating={run,stop:reason=>finish('cancelled',reason)};
    else this.active = { run, validation: false, stop: (reason) => finish('cancelled', reason) };
    this.runs.set(run.id, run);
    while (this.runs.size > 8) {
      const old=[...this.runs.values()].find(r=>r.status!=='running');
      if(!old)break;this.runs.delete(old.id);
    }
    worker?.on('error', (error) => finish('failed', String(error)));
    worker?.on('exit', (code) => { if (!finished) finish('failed', `脚本线程退出(${code})`); });
    const dispatch = (id: number, method: MethodOperation, rawArgs: unknown, scope?: MethodTrace['procedure'], sync?: SharedArrayBuffer) => {
      if (request.validate) { finish('failed', '语法校验不可调用World'); return; }
      if (outstanding) { finish('failed', 'World调用必须逐个await；连续身体动作请放入同一mc.do'); return; }
      if (run.trace.length >= METHOD_LIMITS.calls || (method === 'do' && ++actions > METHOD_LIMITS.actions)) {
        finish('failed', '方法已达到调用上限；请读取终态后修订方法'); return;
      }
      const reply = (message: {value?: unknown; error?: string}) => {
        if (!worker) return;
        if (!sync) { worker.postMessage({id,...message}); return; }
        const state = new Int32Array(sync,0,2);
        const bytes = new Uint8Array(sync,8);
        const encoded = new TextEncoder().encode(JSON.stringify(message));
        if (encoded.length > bytes.length) throw new Error('Mindcraft read exceeds reply budget');
        bytes.set(encoded);
        Atomics.store(state,1,encoded.length);
        Atomics.store(state,0,1);
        Atomics.notify(state,0);
      };
      let args: Record<string, unknown>;
      try {
        args = jsonValue(rawArgs) as Record<string, unknown>;
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('调用参数须为JSON对象');
      } catch (error) { finish('failed', String(error)); return; }
      const trace: MethodTrace = { call: id, method, args, startedAt: new Date().toISOString() };
      if (scope) trace.procedure = { revision: scope.revision, invocation: scope.invocation };
      run.trace.push(trace);
      outstanding = true;
      void Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return this.host.call(method, args, controller.signal);
      }).then((value) => {
        if (finished) return;
        trace.result = jsonValue(value);
        trace.endedAt = new Date().toISOString();
        outstanding = false;
        if (worker) reply({value:trace.result});
        else finish('completed', undefined, (trace.result as { value?: unknown })?.value ?? null);
      }).catch((error) => {
        if (finished) return;
        trace.error = String(error).slice(0, 1600);
        trace.endedAt = new Date().toISOString();
        outstanding = false;
        if (worker) reply({error:trace.error});
        else finish('failed', trace.error);
      });
    };
    worker?.on('message', (message) => {
      if (finished) return;
      if (message.kind === 'error') {
        let error = String(message.error);
        if (error === 'TypeError: setTimeout is not a function') {
          error += '。方法沙箱不提供全局 setTimeout。';
          if (this.host.nativeMethods?.includes('waitForTicks')) error += '等待物理刻可用 await bot.waitForTicks(ticks)，ticks 为 1..200 的整数。';
          if (run.trace.length) error += `先读 {runId:${run.id}} 的调用回执和当前身体位置；已发出的动作或施法命令不会随脚本失败回滚。`;
        }
        finish('failed', error);
        return;
      }
      if (message.kind === 'procedure') {
        const invocation = run.procedure?.invocations.find(i => i.invocation === message.invocation);
        if (!run.procedure || request.validate || !request.procedure?.graph.versions[message.revision]
          || !Number.isInteger(message.invocation) || message.invocation < 1 || message.invocation > PROCEDURE_LIMITS.invocations) {
          finish('failed', 'invalid procedure invocation identity'); return;
        }
        if (message.status === 'running' && !invocation) {
          run.procedure.invocations.push({ invocation: message.invocation, revision: message.revision,
            ...(message.parent === undefined ? {} : { parent: message.parent }), startedAt: new Date().toISOString(), status: 'running' });
        } else if (invocation?.status === 'running' && ['completed', 'failed'].includes(message.status)) {
          invocation.status = message.status; invocation.endedAt = new Date().toISOString();
          if (message.error) invocation.error = String(message.error).slice(0, 1600);
        } else finish('failed', 'invalid procedure invocation transition');
        return;
      }
      if (message.kind === 'done') {
        if (outstanding) { finish('failed', '脚本结束时仍有未await的World调用；已撤销该任务'); return; }
        try { finish(request.validate ? 'validated' : 'completed', undefined, jsonValue(message.value)); }
        catch (error) { finish('failed', String(error)); }
        return;
      }
      if (message.kind !== 'call' || !['capabilities', 'state', 'do', 'flightPlan', 'swimPlan', 'mineflayer', 'mindcraft'].includes(message.method)) {
        finish('failed', '脚本协议包含未知操作'); return;
      }
      const syncRead = (message.method === 'mindcraft' && message.args?.family === 'world')
        || (message.method === 'mineflayer' && this.host.nativeMethods?.includes('read') && message.args?.name === 'read'
          && Array.isArray(message.args.args) && message.args.args.length === 1 && message.args.args[0] === 'entity');
      if (message.method === 'mindcraft' && !this.host.gameLibrary ||
        message.sync && (!syncRead ||
        !(message.sync instanceof SharedArrayBuffer) || message.sync.byteLength !== 96_008)) {
        finish('failed', 'Mindcraft unavailable on this body or invalid read buffer'); return;
      }
      dispatch(message.id, message.method, message.args, message.scope, message.sync);
    });
    if (native) dispatch(1, 'mineflayer', { name: native, args: (params as { args: unknown[] }).args });
    return structuredClone(run);
  }
}

function jsonValue(value: unknown, max: number = METHOD_LIMITS.messageChars): unknown {
  const text = JSON.stringify(value ?? null);
  if (text.length > max) throw new Error(`JSON数据超过${max}字符`);
  return JSON.parse(text);
}
