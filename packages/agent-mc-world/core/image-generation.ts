import type { PhotographyConfig, ImageGenerationPort, ImageGenerationRequest, ImageGenerationResult, PhotoImage } from '../src/contracts/photography.ts';

export const PHOTOGRAPHY_DEFAULTS: PhotographyConfig = {
  provider: 'none', endpoint: '', model: '', apiKeyEnv: '',
  generate: true, edit: true, maxReferences: 3, timeoutMs: 600_000, resultHosts: '',
};
const MAX_IMAGE = 24 * 1024 * 1024;
const MAX_INPUT = 10 * 1024 * 1024;
export class ImageGenerationError extends Error {
  constructor(message: string, readonly providerRequestId?: string) { super(message); this.name = 'ImageGenerationError'; }
}
function safeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\w-]{1,160}$/.test(value) ? value : undefined;
}

/** Reject mislabeled error pages; do not save HTML/JSON as an image. */
export function imageMime(bytes: Uint8Array): string {
  const b = Buffer.from(bytes);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('Image response is not PNG, JPEG or WebP');
}
export function validatePhotoImage(image: PhotoImage, max = MAX_INPUT): void {
  if (!image.bytes.length || image.bytes.length > max) throw new Error('Image exceeds the configured input/output byte limit');
  if (imageMime(image.bytes) !== image.mime) throw new Error('Image MIME does not match its bytes');
}
async function boundedBody(response: Response, max: number, signal: AbortSignal): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('Image response too large'); }
  if (!response.body) throw new Error('Empty image response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const next = await reader.read(); signal.throwIfAborted();
      if (next.done) break;
      size += next.value.length;
      if (size > max) throw new Error('Image response too large');
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); }
}
function apiUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search)
    throw new Error('Image API endpoint must be an explicit HTTPS URL without credentials or query');
  return url;
}

/** Native provider adapters. No retry, model discovery, ComfyUI, VLM or planner calls. */
export function createImageGenerationPort(config: Partial<PhotographyConfig> | undefined,
  options: { fetch?: typeof fetch; env?: Record<string, string | undefined> } = {}): ImageGenerationPort | null {
  const cfg = { ...PHOTOGRAPHY_DEFAULTS, ...config };
  if (cfg.provider === 'none') return null;
  if (!['bailian', 'volcengine'].includes(cfg.provider)) throw new Error('Unsupported image provider');
  const endpoint = apiUrl(cfg.endpoint);
  if (!cfg.model.trim() || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(cfg.apiKeyEnv)) throw new Error('Image model and API key environment variable are required');
  if (!Number.isInteger(cfg.maxReferences) || cfg.maxReferences < 1 || cfg.maxReferences > 14) throw new Error('Invalid maximum image references');
  if (!Number.isInteger(cfg.timeoutMs) || cfg.timeoutMs < 1000 || cfg.timeoutMs > 1_800_000) throw new Error('Invalid image timeout');
  const http = options.fetch ?? globalThis.fetch;
  const allowed = new Set(cfg.resultHosts.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  return {
    capabilities: { generate: cfg.generate, edit: cfg.edit, maxReferences: cfg.maxReferences },
    async generate(request: ImageGenerationRequest, parent: AbortSignal): Promise<ImageGenerationResult> {
      const signal = AbortSignal.any([parent, AbortSignal.timeout(cfg.timeoutMs)]);
      signal.throwIfAborted();
      if (!request.prompt.trim() || request.prompt.length > 16000) throw new Error('A nonempty image prompt of at most 16000 characters is required');
      if (request.images.length ? !cfg.edit : !cfg.generate) throw new Error('Selected image capability is disabled');
      if (request.images.length > cfg.maxReferences) throw new Error('Too many image references for this model');
      if (request.size && !/^(?:[1-4]K|\d{3,4}x\d{3,4})$/.test(request.size)) throw new Error('Invalid image size');
      if (cfg.provider === 'bailian' && request.size && !/^\d{3,4}x\d{3,4}$/.test(request.size)) throw new Error('Bailian size must use width x height pixels');
      const key = (options.env ?? process.env)[cfg.apiKeyEnv];
      if (!key || /[\r\n]/.test(key)) throw new Error('Image API key environment variable is missing or invalid');
      const images = request.images.map(image => {
        validatePhotoImage(image);
        return `data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}`;
      });
      const body = cfg.provider === 'bailian' ? {
        model: cfg.model,
        input: { messages: [{ role: 'user', content: [...images.map(image => ({ image })), { text: request.prompt }] }] },
        // The host already planned the prompt. Do not ask the provider to run an extra prompt agent.
        parameters: { n: 1, prompt_extend: false, watermark: false,
          ...(request.size ? { size: request.size.replace('x', '*') } : {}) },
      } : { model: cfg.model, prompt: request.prompt, ...(images.length ? { image: images } : {}),
        response_format: 'b64_json', stream: false, watermark: false,
        // Pro/flash are single-image models and reject sequential_image_generation.
        ...(/(?:4[-.]0|4[-.]5|5[-.]0[-.]lite)/.test(cfg.model) ? { sequential_image_generation: 'disabled' } : {}),
        ...(request.size ? { size: request.size } : {}) };
      // Errors deliberately omit remote text/URLs/headers, which may echo keys or reference data.
      let response: Response;
      try { response = await http(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal, redirect: 'error' }); }
      catch { signal.throwIfAborted(); throw new Error('Image provider transport failed; remote acceptance is unknown. Do not automatically resubmit.'); }
      const headerRequestId = safeRequestId(response.headers.get('x-request-id'));
      if (!response.ok) { await response.body?.cancel(); throw new ImageGenerationError(`Image provider HTTP ${response.status}; no automatic retry`, headerRequestId); }
      let data: any;
      try { data = JSON.parse(Buffer.from(await boundedBody(response, 40 * 1024 * 1024, signal)).toString('utf8')); }
      catch { signal.throwIfAborted(); throw new ImageGenerationError('Invalid image provider JSON response', headerRequestId); }
      const requestId = safeRequestId(data.request_id) ?? headerRequestId;
      const fail = (message: string): never => { throw new ImageGenerationError(message, requestId); };
      if (data.error || data.code) fail('Image provider reported failure; inspect provider request logs');
      const outputs = cfg.provider === 'bailian'
        ? data.output?.choices?.flatMap((choice: any) => choice.message?.content?.filter((part: any) => typeof part.image === 'string').map((part: any) => ({ url: part.image })) ?? [])
        : data.data;
      if (!Array.isArray(outputs) || outputs.length !== 1 || outputs[0]?.error) fail('Image provider did not return exactly one successful image');
      const output = outputs[0];
      let bytes: Uint8Array;
      if (typeof output.b64_json === 'string') {
        if (output.b64_json.length > MAX_IMAGE * 1.4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output.b64_json)) throw new Error('Invalid image base64');
        bytes = Buffer.from(output.b64_json, 'base64');
      } else if (typeof output.url === 'string') {
        let url: URL;
        try { url = new URL(output.url); } catch { return fail('Invalid generated image URL'); }
        if (url.protocol !== 'https:' || url.username || url.password)
          fail('Image result URL must use HTTPS without embedded credentials');
        if (!allowed.has(url.hostname.toLowerCase()))
          // Report the configuration fact, never the signed path/query or provider body.
          fail(`Image result host is not explicitly configured: ${url.hostname}. No download attempted; do not resubmit generation`);
        let downloaded: Response;
        try { downloaded = await http(url, { signal, redirect: 'error' }); }
        catch { signal.throwIfAborted(); return fail('Generated image download failed; do not resubmit generation'); }
        if (!downloaded.ok) { await downloaded.body?.cancel(); fail(`Image download HTTP ${downloaded.status}`); }
        bytes = await boundedBody(downloaded, MAX_IMAGE, signal);
      } else throw new Error('Image response has neither bytes nor a download URL');
      signal.throwIfAborted();
      const mime = imageMime(bytes); validatePhotoImage({ bytes, mime }, MAX_IMAGE);
      const usage: Record<string, unknown> = {};
      for (const field of ['output_width', 'output_height', 'input_image_count', 'output_image_count', 'image_count', 'width', 'height',
        'generated_images', 'output_tokens', 'total_tokens']) {
        const value = data.usage?.[field]; if (typeof value === 'number' && Number.isFinite(value) && value >= 0) usage[field] = value;
      }
      return { bytes, mime, model: cfg.model,
        ...(requestId ? { providerRequestId: requestId } : {}),
        ...(Object.keys(usage).length ? { usage } : {}) };
    },
  };
}
