import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { PROCEDURE_LIMITS, type ProcedureGraph, type ProcedureInvocation, type ProcedureReference } from './support/procedure.ts';

export const METHOD_ADAPTER = 'minecraft-method/v1';

export const METHOD_LIMITS = Object.freeze({ sourceChars: 12_000, paramsChars: 4_096,
  calls: 32, actions: 16, messageChars: 24_000, durationMs: 60_000, maxDurationMs: 120_000 });

export type MethodOperation = 'state' | 'do' | 'flightPlan' | 'mineflayer';
export interface MethodTrace {
  call: number; method: MethodOperation; args: unknown; startedAt: string;
  endedAt?: string; result?: unknown; error?: string;
  procedure?: { revision: string; invocation: number };
}
export interface MethodRun {
  id: number; name: string; sourceHash: string; startedAt: string; endedAt?: string;
  status: 'running' | 'validated' | 'completed' | 'failed' | 'cancelled';
  trace: MethodTrace[]; result?: unknown; error?: string;
  procedure?: { executionId: string; reference: ProcedureReference; adapter: string; mode: 'validation' | 'execution';
    invocations: ProcedureInvocation[]; versions: Array<{ id: string; revision: string; sourceHash: string; parent: string | null; author: unknown }> };
}
export interface MethodRequest {
  name: string; code: string; params?: Record<string, unknown>; durationMs?: number; validate?: boolean;
  procedure?: { reference: ProcedureReference; graph: ProcedureGraph };
}
export interface MethodHost {
  nativeMethods?: string[];
  call: (method: MethodOperation, args: Record<string, unknown>, signal: AbortSignal) => unknown | Promise<unknown>;
  onFinish: (run: MethodRun) => void;
}

/** Each program has one revocable capability set and at most one outstanding World call. */
export class MethodRunner {
  private serial = 0;
  private active: { run: MethodRun; stop: (reason?: string) => void } | null = null;
  private readonly runs = new Map<number, MethodRun>();

  constructor(private readonly host: MethodHost) {}

  get current(): Pick<MethodRun, 'id' | 'name' | 'sourceHash' | 'startedAt'> | null {
    const run = this.active?.run;
    return run ? { id: run.id, name: run.name, sourceHash: run.sourceHash, startedAt: run.startedAt } : null;
  }

  read(id?: number): MethodRun[] {
    return structuredClone(id === undefined ? [...this.runs.values()] : [this.runs.get(id)].filter((r): r is MethodRun => !!r));
  }

  inspect(id?: number, call?: number): unknown {
    const summary = (run: MethodRun) => ({ id: run.id, name: run.name, sourceHash: run.sourceHash,
      startedAt: run.startedAt, endedAt: run.endedAt, status: run.status, calls: run.trace.length, error: run.error,
      ...(run.procedure ? { procedure: run.procedure } : {}) });
    if (id === undefined) return [...this.runs.values()].map(summary);
    const run = this.runs.get(id);
    if (!run) throw new Error(`方法#${id}不在本次进程的最近八次记录中`);
    if (call !== undefined) {
      const trace = run.trace.find(trace => trace.call === call);
      if (!trace) throw new Error(`方法#${id}没有SDK调用#${call}`);
      return structuredClone({ ...summary(run), trace });
    }
    const result = JSON.stringify(run.result ?? null);
    return { ...summary(run), ...(result.length > 2000
      ? { resultExcerpt: result.slice(0, 2000), resultTruncated: true }
      : { result: run.result }),
    trace: run.trace.map(trace => {
      const reply = trace.result as Record<string, unknown> | undefined;
      const steps = Array.isArray(reply?.steps) ? reply.steps : undefined;
      return { call: trace.call, method: trace.method, startedAt: trace.startedAt, endedAt: trace.endedAt,
        procedure: trace.procedure,
        error: trace.error, accepted: reply?.accepted, taskId: reply?.taskId, kind: reply?.kind, done: reply?.done,
        ...(steps ? { stepCount: steps.length, steps: steps.slice(0, 8).map(step => ({
          step: step?.step, outcome: step?.outcome,
          why: typeof step?.why === 'string' ? step.why.slice(0, 160) : step?.why,
        })), ...(steps.length > 8 ? { stepsTruncated: true } : {}) } : {}),
        receiptExcerpt: typeof reply?.receipt === 'string' ? reply.receipt.slice(0, 500) : undefined };
    }) };
  }

  stop(reason = '外部取消'): boolean {
    if (!this.active) return false;
    this.active.stop(reason);
    return true;
  }

  start(request: MethodRequest): MethodRun {
    if (this.active) throw new Error(`方法#${this.active.run.id}仍在运行；先读取结果或明确取消`);
    if (typeof request.name !== 'string' || !request.name.trim() || request.name.length > 80) throw new Error('name须为1至80字符');
    if (typeof request.code !== 'string' || !request.code.trim() || request.code.length > METHOD_LIMITS.sourceChars) throw new Error(`code须为1至${METHOD_LIMITS.sourceChars}字符的JavaScript函数体`);
    const params = jsonValue(request.params ?? {}, METHOD_LIMITS.paramsChars);
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('params须为JSON对象');
    const durationMs = request.durationMs ?? METHOD_LIMITS.durationMs;
    if (!Number.isInteger(durationMs) || durationMs < 1_000 || durationMs > METHOD_LIMITS.maxDurationMs) throw new Error(`durationMs须为1000至${METHOD_LIMITS.maxDurationMs}`);
    const run: MethodRun = { id: ++this.serial, name: request.name,
      sourceHash: createHash('sha256').update(request.code).digest('hex'),
      startedAt: new Date().toISOString(), status: 'running', trace: [] };
    if (request.procedure) {
      const { reference, graph } = request.procedure;
      if (graph.root !== reference.revision || graph.versions[graph.root]?.code !== request.code) throw new Error('procedure request identity mismatch');
      run.procedure = { executionId: randomUUID(), reference, adapter: METHOD_ADAPTER,
        mode: request.validate ? 'validation' : 'execution', invocations: [],
        versions: Object.values(graph.versions).map(v => ({ id: v.id, revision: v.revision, sourceHash: v.sourceHash, parent: v.parent, author: v.author })) };
    }
    const controller = new AbortController();
    const worker = new Worker(new URL('./method-worker.mjs', import.meta.url), {
      workerData: { code: request.code, params, validate: request.validate === true, nativeMethods: this.host.nativeMethods,
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
      controller.abort(new Error(error ?? '方法结束'));
      void worker.terminate();
      this.active = null;
      this.host.onFinish(structuredClone(run));
    };
    const timer = setTimeout(() => finish('failed', `方法超过${durationMs}毫秒；已撤销它自己的未完成任务`), durationMs);
    this.active = { run, stop: (reason) => finish('cancelled', reason) };
    this.runs.set(run.id, run);
    while (this.runs.size > 8) this.runs.delete(this.runs.keys().next().value!);
    worker.on('error', (error) => finish('failed', String(error)));
    worker.on('exit', (code) => { if (!finished) finish('failed', `脚本线程退出(${code})`); });
    worker.on('message', (message) => {
      if (finished) return;
      if (message.kind === 'error') { finish('failed', String(message.error)); return; }
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
      if (message.kind !== 'call' || !['state', 'do', 'flightPlan', 'mineflayer'].includes(message.method)) {
        finish('failed', '脚本协议包含未知操作'); return;
      }
      if (request.validate) { finish('failed', '语法校验不可调用World'); return; }
      if (outstanding) { finish('failed', 'World调用必须逐个await；连续身体动作请放入同一mc.do'); return; }
      if (run.trace.length >= METHOD_LIMITS.calls || (message.method === 'do' && ++actions > METHOD_LIMITS.actions)) {
        finish('failed', '方法已达到调用上限；请读取终态后修订方法'); return;
      }
      let args: Record<string, unknown>;
      try {
        args = jsonValue(message.args) as Record<string, unknown>;
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('调用参数须为JSON对象');
      } catch (error) { finish('failed', String(error)); return; }
      const trace: MethodTrace = { call: message.id, method: message.method, args, startedAt: new Date().toISOString() };
      if (message.scope) trace.procedure = { revision: message.scope.revision, invocation: message.scope.invocation };
      run.trace.push(trace);
      outstanding = true;
      void Promise.resolve().then(() => this.host.call(trace.method, args, controller.signal)).then((value) => {
        if (finished) return;
        trace.result = jsonValue(value);
        trace.endedAt = new Date().toISOString();
        outstanding = false;
        worker.postMessage({ id: message.id, value: trace.result });
      }).catch((error) => {
        if (finished) return;
        trace.error = String(error).slice(0, 1600);
        trace.endedAt = new Date().toISOString();
        outstanding = false;
        worker.postMessage({ id: message.id, error: trace.error });
      });
    });
    return structuredClone(run);
  }
}

function jsonValue(value: unknown, max: number = METHOD_LIMITS.messageChars): unknown {
  const text = JSON.stringify(value ?? null);
  if (text.length > max) throw new Error(`JSON数据超过${max}字符`);
  return JSON.parse(text);
}
