import { parseTypedChoice } from '../../core/support/typed-decision.ts';

export type DecisionChoice = 'inspect' | 'replan' | 'resupply' | 'pause';

export interface DecisionAdvice {
  choice: DecisionChoice;
  /** Probability of the selected option, independent of the service confidence convention. */
  confidence: number;
  probabilities: Record<DecisionChoice, number>;
  riskScore: number;
  riskProbabilities?: Record<'0' | '1' | '2' | '3', number>;
  latencyMs: number;
}

export type DecisionAdviserResult =
  | { kind: 'advice'; advice: DecisionAdvice }
  | { kind: 'skipped'; reason: 'busy' | 'duplicate' | 'throttled'; retryAfterMs?: number }
  | { kind: 'skipped'; reason: 'uncertain'; advice: DecisionAdvice }
  | { kind: 'error'; reason: 'invalid-state' | 'timeout' | 'transport' | 'http' | 'invalid-response'; status?: number };

export interface DecisionAdviserOptions {
  endpoint: string;
  timeoutMs?: number;
  minIntervalMs?: number;
  /** Minimum selected-option probability. */
  minConfidence?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export const DECISION_TIMEOUT_MS = 2_000;
export const DECISION_MIN_INTERVAL_MS = 5_000;
export const DECISION_MIN_CONFIDENCE = 0.75;

export const DECISION_QUESTIONS = {
  next: {
    type: 'choice',
    instructions: '结合当前目标、已有资源和真实失败回执，选择最有帮助的下一步建议。缺少材料证据不能推定需要补给；暂缓只针对受阻分支，不代表停止全部活动。建议不会自动执行。',
    criteria: {
      inspect: '先观察现场或补充事实，再决定如何行动。',
      replan: '当前目标、顺序或路线需要重新规划。',
      resupply: '先补足当前任务需要的资源或装备。',
      pause: '暂缓当前任务，等待风险降低或条件明确。',
    },
  },
  risk: {
    type: 'score',
    instructions: '评估按当前状态继续任务的风险，从低到高评分。',
    criteria: ['低', '可控', '困难', '危险'],
  },
} as const;

const CHOICES: readonly DecisionChoice[] = ['inspect', 'replan', 'resupply', 'pause'];
const RISK_LEVELS = ['0', '1', '2', '3'] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseAdvice(value: unknown): DecisionAdvice | null {
  const root = record(value);
  const answers = record(root?.answers);
  const next = parseTypedChoice(answers?.next, CHOICES);
  const risk = record(answers?.risk);
  if (!root || !next || !risk) return null;
  if (typeof risk.score !== 'number' || !Number.isFinite(risk.score)
    || risk.score < 0 || risk.score > RISK_LEVELS.length - 1) return null;
  const riskProbabilities = risk.probabilities === undefined ? null : record(risk.probabilities);
  if (risk.probabilities !== undefined
    && (!riskProbabilities || !RISK_LEVELS.every((level) => probability(riskProbabilities[level])))) return null;
  if (typeof root.latency_ms !== 'number' || !Number.isFinite(root.latency_ms) || root.latency_ms < 0) return null;
  return {
    choice: next.choice,
    confidence: next.choiceProbability,
    probabilities: next.probabilities,
    riskScore: risk.score,
    ...(riskProbabilities ? {
      riskProbabilities: Object.fromEntries(RISK_LEVELS.map((level) => [level, riskProbabilities[level]])) as Record<'0' | '1' | '2' | '3', number>,
    } : {}),
    latencyMs: root.latency_ms,
  };
}

function duration(value: number | undefined, fallback: number, allowZero: boolean): number {
  return value !== undefined && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0)
    ? value
    : fallback;
}

/** Advice is observational. The caller decides whether and how to use it. */
export function createDecisionAdviser(options: DecisionAdviserOptions): {
  advise(state: Record<string, unknown>, sceneKey: string): Promise<DecisionAdviserResult>;
} {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => performance.now());
  const timeoutMs = duration(options.timeoutMs, DECISION_TIMEOUT_MS, false);
  const minIntervalMs = duration(options.minIntervalMs, DECISION_MIN_INTERVAL_MS, true);
  const minConfidence = options.minConfidence ?? DECISION_MIN_CONFIDENCE;
  let lastStartedAtMs = -Infinity;
  let lastAdvisedSceneKey: string | null = null;
  let inFlight: { sceneKey: string; promise: Promise<DecisionAdviserResult> } | null = null;

  async function request(body: string): Promise<DecisionAdviserResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<DecisionAdviserResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: 'error', reason: 'timeout' });
      }, timeoutMs);
    });
    const operation = (async (): Promise<DecisionAdviserResult> => {
      let response: Response;
      try {
        response = await fetchImpl(options.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: controller.signal,
        });
      } catch {
        return { kind: 'error', reason: 'transport' };
      }
      if (!response.ok) return { kind: 'error', reason: 'http', status: response.status };
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { kind: 'error', reason: 'invalid-response' };
      }
      const advice = parseAdvice(payload);
      if (!advice) return { kind: 'error', reason: 'invalid-response' };
      return advice.confidence < minConfidence
        ? { kind: 'skipped', reason: 'uncertain', advice } : { kind: 'advice', advice };
    })();
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  function advise(state: Record<string, unknown>, sceneKey: string): Promise<DecisionAdviserResult> {
    if (inFlight) {
      return inFlight.sceneKey === sceneKey
        ? inFlight.promise
        : Promise.resolve({ kind: 'skipped', reason: 'busy' });
    }
    if (sceneKey === lastAdvisedSceneKey) return Promise.resolve({ kind: 'skipped', reason: 'duplicate' });
    const remainingMs = lastStartedAtMs + minIntervalMs - now();
    if (remainingMs > 0) return Promise.resolve({ kind: 'skipped', reason: 'throttled', retryAfterMs: remainingMs });
    let body: string;
    try {
      body = JSON.stringify({ state, questions: DECISION_QUESTIONS });
    } catch {
      return Promise.resolve({ kind: 'error', reason: 'invalid-state' });
    }
    lastStartedAtMs = now();
    const promise = request(body).then((result) => {
      if (result.kind === 'advice') lastAdvisedSceneKey = sceneKey;
      return result;
    });
    inFlight = { sceneKey, promise };
    void promise.then(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    return promise;
  }

  return { advise };
}
