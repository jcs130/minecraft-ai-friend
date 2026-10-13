/** Optional host-owned typed choice service. Core never resolves URLs, credentials or models. */
export interface DecisionPort {
  request(input: { state: unknown; questions: Record<string, {
    type: 'choice'; instructions: string; criteria: Record<string, string>;
  }> }, options?: { provider?: string; signal?: AbortSignal; timeoutMs?: number }): Promise<{
    answers: Record<string, unknown>; model?: string; latency_ms?: number;
    usage?: { input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null };
  }>;
}
