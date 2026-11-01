/** Optional inline images supplied by the host; the core never fetches or captures them implicitly. */
export interface DecisionRequest {
  state: unknown;
  images?: readonly string[];
  questions: Record<string, {
    type: 'choice'; instructions: string; criteria: Record<string, string>;
  }>;
}
export interface DecisionInferenceStats {
  request_id: string | null; session_id: string | null;
  queue_ms: number | null; execution_ms: number | null; input_tokens: number | null;
  /** Provider-specific numeric/boolean vision measurements; hosts control redaction and persistence. */
  vision: unknown;
}
export interface DecisionResponse {
    answers: Record<string, unknown>; model?: string; latency_ms?: number;
    usage?: { input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null };
    inference_stats?: DecisionInferenceStats;
}
/** Optional host-owned typed choice service. Core never resolves URLs, credentials or models. */
export interface DecisionPort {
  request(input: DecisionRequest, options?: { provider?: string; signal?: AbortSignal; timeoutMs?: number }): Promise<DecisionResponse>;
}
