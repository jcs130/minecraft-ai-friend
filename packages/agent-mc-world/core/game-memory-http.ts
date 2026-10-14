/** Bounded transport shared by optional memory retrieval and learning services. */
import type { GameMemoryConfig } from './game-memory-service.ts';

export async function memoryRequest(request: typeof fetch, cfg: GameMemoryConfig, suffix: string,
  body: unknown, signal?: AbortSignal, method: 'POST' | 'GET' = 'POST', query: Record<string, string> = {}):
  Promise<{ data: Record<string, unknown>; etag: string | null; requestId: string | null }> {
  if (!cfg.endpoint.trim()) throw new Error('Memory endpoint is not configured');
  let url: URL;
  try { url = new URL(cfg.endpoint); } catch { throw new Error('Invalid memory endpoint'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Memory endpoint must be HTTP(S), without embedded credentials or query');
  if (!Number.isInteger(cfg.timeoutMs) || cfg.timeoutMs < 100 || cfg.timeoutMs > 30000) throw new Error('Invalid memory timeout');
  if (suffix) url.pathname = url.pathname.replace(/\/$/, '') + suffix;
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (cfg.apiKeyEnv) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cfg.apiKeyEnv)) throw new Error('Invalid API key environment variable name');
    const key = process.env[cfg.apiKeyEnv];
    if (!key) throw new Error('Configured memory API key environment variable is missing');
    if (cfg.mode === 'remote' && cfg.provider === 'mem0-oss') headers['X-API-Key'] = key;
    else headers.Authorization = `${cfg.mode === 'remote' && cfg.provider === 'mem0-platform' ? 'Token' : 'Bearer'} ${key}`;
  }
  const abort = AbortSignal.any([AbortSignal.timeout(cfg.timeoutMs), ...(signal ? [signal] : [])]);
  try {
    const response = await request(url, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), signal: abort, redirect: 'error' });
    const rawId = response.headers.get('X-PowerContext-Request-ID') ?? response.headers.get('X-Request-ID');
    const requestId = rawId && /^[\w.-]{1,128}$/.test(rawId) ? rawId : null;
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Memory service HTTP ${response.status}${requestId ? `; request ${requestId}` : ''}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty memory service response');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break; size += part.value.length;
        if (size > 1024 * 1024) { await reader.cancel(); throw new Error('Memory service response exceeds 1 MiB'); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid memory service response');
    return { data, etag: response.headers.get('ETag'), requestId };
  } catch (error) {
    if (signal?.aborted) throw new Error('Memory request cancelled');
    if (abort.aborted) throw new Error('Memory service timeout; write outcome may be unknown');
    if (error instanceof Error && /^Memory service (HTTP|response)/.test(error.message)) throw error;
    throw new Error('Memory service request failed; no automatic retry');
  }
}
