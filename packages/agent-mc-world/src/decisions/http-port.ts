import {randomUUID} from 'node:crypto';
import type {DecisionPort} from '../contracts/decision.ts';
import {parseTypedChoice} from '../../core/support/typed-decision.ts';

export interface HttpDecisionSettings {endpoint: string; model?: string; apiKeyEnv?: string; timeoutMs?: number}
export interface HttpDecisionObservation {
  id: string; state: 'started' | 'completed' | 'failed'; at: string; elapsedMs?: number; model?: string;
  usage?: NonNullable<Awaited<ReturnType<DecisionPort['request']>>['usage']>;
  answers?: Record<string, unknown>; error?: string;
}
/** Explicit host-side transport; no endpoint discovery, saved-provider access or automatic loop. */
export function createHttpDecisionPort(settings: () => HttpDecisionSettings, options: {
  secret?: (name: string) => string; fetch?: typeof fetch; signal?: AbortSignal;
  observe?: (value: HttpDecisionObservation) => void;
} = {}): DecisionPort {
  const observe = (value: HttpDecisionObservation) => { try { options.observe?.(value); } catch { /* Observation cannot change execution. */ } };
  return {async request(input, request = {}) {
    const cfg = {...settings()}, version = JSON.stringify(cfg), url = new URL(cfg.endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
      throw Error('Invalid explicit decision endpoint');
    if (request.provider) throw Error('Named host providers are not part of this explicit decision port');
    if (cfg.apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(cfg.apiKeyEnv)) throw Error('Invalid credential reference');
    const secret = cfg.apiKeyEnv ? options.secret?.(cfg.apiKeyEnv) : undefined;
    if (cfg.apiKeyEnv && !secret) throw Error('Decision credential unavailable');
    const timeoutMs = Math.min(request.timeoutMs ?? 60000, cfg.timeoutMs ?? 1000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw Error('Invalid decision timeout');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = AbortSignal.any([controller.signal, ...(request.signal ? [request.signal] : []), ...(options.signal ? [options.signal] : [])]);
    const id = randomUUID(), start = Date.now();
    observe({id, state: 'started', at: new Date().toISOString(), model: cfg.model});
    try {
      signal.throwIfAborted();
      const response = await (options.fetch ?? fetch)(url, {method: 'POST', redirect: 'error', signal,
        headers: {'content-type': 'application/json', ...(secret ? {authorization: `Bearer ${secret}`} : {})},
        body: JSON.stringify({...input, ...(cfg.model ? {model: cfg.model} : {})})});
      if (!response.ok) throw Error('Decision HTTP ' + response.status);
      const chunks: Uint8Array[] = []; let size = 0;
      if (!response.body) throw Error('Decision response is empty');
      const reader = response.body.getReader();
      try { while (true) { const {done, value} = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 262144) throw Error('Decision response exceeds its bound'); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      signal.throwIfAborted();
      if (JSON.stringify(settings()) !== version) throw Error('Decision configuration changed');
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value.answers !== 'object' || !value.answers || Array.isArray(value.answers)) throw Error('Invalid decision answers');
      const answers: Record<string, unknown> = {};
      for (const [name, question] of Object.entries(input.questions)) {
        const parsed=parseTypedChoice(value.answers[name], Object.keys(question.criteria));
        if (!parsed) throw Error('Invalid decision choice');
        answers[name] = {type:'choice',choice:parsed.choice,confidence:parsed.confidence,probabilities:parsed.probabilities};
      }
      const count = (n: unknown): number | null => Number.isSafeInteger(n) && Number(n) >= 0 ? Number(n) : null;
      const usage = {input_tokens: count(value.usage?.input_tokens), output_tokens: count(value.usage?.output_tokens), cached_input_tokens: count(value.usage?.cached_input_tokens)};
      if(usage.input_tokens!==null&&usage.cached_input_tokens!==null&&usage.cached_input_tokens>usage.input_tokens)usage.cached_input_tokens=null;
      const model = typeof value.model === 'string' && value.model.length <= 200 ? value.model : cfg.model;
      const elapsedMs = Date.now() - start;
      observe({id, state: 'completed', at: new Date().toISOString(), elapsedMs, model, usage, answers});
      return {answers, model, latency_ms: elapsedMs, usage};
    } catch {
      // A provider body/error can contain a credential or untrusted text; do not copy it into logs or receipts.
      const error = signal.aborted ? 'Decision cancelled or timed out' : 'Decision request failed or returned an invalid response';
      observe({id, state: 'failed', at: new Date().toISOString(), elapsedMs: Date.now() - start, model: cfg.model, error});
      throw Error(error);
    } finally { clearTimeout(timer); controller.abort(); }
  }};
}
