/** FLUX 3's native Comfy graph. Only an explicit generate() performs I/O. */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Flux3Configuration, PhotographyConfig, ImageGenerationPort, ImageGenerationRequest } from '../src/contracts/photography.ts';
import { boundedBody, imageMime, validatePhotoImage, ImageGenerationError } from './image-generation.ts';

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const dimensions = (width: number, height: number) => [width, height].every(n => Number.isInteger(n) && n >= 256 && n <= 2048 && n % 16 === 0);
export function validateFlux3Configuration(value: Flux3Configuration | undefined): asserts value is Flux3Configuration {
  if (!value || ![value.unet, value.clip, value.vae].every(n => typeof n === 'string' && n.trim() && n.length <= 256 && !/[\r\n]/.test(n))
    || value.steps !== 16 || !dimensions(value.width, value.height)
    || value.seed !== undefined && (!Number.isSafeInteger(value.seed) || value.seed < 0)
    || value.pollMs !== undefined && (!Number.isInteger(value.pollMs) || value.pollMs < 50 || value.pollMs > 10000))
    throw new Error('Explicit FLUX 3 model filenames, sixteen steps and 16-aligned canvas (256..2048) required');
}

/** Pure, caller-captioned graph. Images are ordered scene then chosen identity references. */
export function buildFlux3Graph(config: Flux3Configuration, request: ImageGenerationRequest, uploads: readonly string[]): Graph {
  validateFlux3Configuration(config);
  const [width, height] = request.size ? request.size.split('x').map(Number) : [config.width, config.height];
  if (!dimensions(width, height)) throw new Error('FLUX 3 size must be width x height, multiples of 16 in 256..2048');
  const node = (class_type: string, inputs: Record<string, unknown>) => ({ class_type, inputs });
  const graph: Graph = {
    '1': node('UNETLoader', { unet_name: config.unet, weight_dtype: 'default' }),
    '2': node('CLIPLoader', { clip_name: config.clip, type: 'flux3', device: 'default' }),
    '3': node('VAELoader', { vae_name: config.vae }),
    '6': node('CLIPTextEncode', { clip: ['2', 0], text: request.prompt }),
    '7': node('CLIPTextEncode', { clip: ['2', 0], text: '' }),
    '23': node('EmptyFlux2LatentImage', { width, height, batch_size: 1 }),
    '8': node('KSampler', { model: ['1', 0], seed: config.seed ?? 7, steps: 16, cfg: 1,
      sampler_name: 'euler', scheduler: 'simple', denoise: 1,
      positive: uploads.length ? ['20', 0] : ['6', 0], negative: uploads.length ? ['20', 1] : ['7', 0], latent_image: ['23', 0] }),
    '9': node('VAEDecode', { samples: ['8', 0], vae: ['3', 0] }),
    '10': node('SaveImage', { images: ['9', 0], filename_prefix: 'agent_mc_flux3/' + randomUUID() }),
  };
  if (uploads.length) {
    const inputs: Record<string, unknown> = { positive: ['6', 0], negative: ['7', 0], vae: ['3', 0], resolution: 'keep resolution' };
    uploads.forEach((image, i) => { const id = String(40 + i); graph[id] = node('LoadImage', { image }); inputs[`images.image${i}`] = [id, 0]; });
    graph['20'] = node('ReferenceMultiLatent', inputs);
  }
  return graph;
}

export function createComfyFlux3Port(config: PhotographyConfig, options: { fetch?: typeof fetch; env?: Record<string, string | undefined> } = {}): ImageGenerationPort {
  validateFlux3Configuration(config.flux3);
  const models = structuredClone(config.flux3), endpoint = new URL(config.endpoint);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
  if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback))
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error('ComfyUI requires an explicit HTTPS base URL or loopback HTTP; remote access needs a protected endpoint');
  if (!config.model.trim() || !Number.isInteger(config.maxReferences) || config.maxReferences < 1 || config.maxReferences > 14
    || !Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 1800000)
    throw new Error('Invalid FLUX 3 capability configuration');
  if (config.apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.apiKeyEnv)) throw new Error('Invalid image key environment variable name');
  const http = options.fetch ?? globalThis.fetch, base = endpoint.href.replace(/\/$/, '') + '/';
  return {
    capabilities: { generate: config.generate, edit: config.edit, maxReferences: config.maxReferences },
    async generate(request, parent) {
      const signal = AbortSignal.any([parent, AbortSignal.timeout(config.timeoutMs)]);
      signal.throwIfAborted();
      if (!request.prompt.trim() || request.prompt.length > 16000) throw new Error('A host-written image prompt of at most 16000 characters is required');
      if (request.images.length ? !config.edit : !config.generate) throw new Error('Selected image capability is disabled');
      if (request.images.length > config.maxReferences) throw new Error('Too many image references');
      for (const image of request.images) validatePhotoImage(image);
      // Validate the canvas before any upload or service call.
      buildFlux3Graph(models, request, []);
      const key = config.apiKeyEnv ? (options.env ?? process.env)[config.apiKeyEnv] : undefined;
      if (config.apiKeyEnv && (!key || /[\r\n]/.test(key))) throw new Error('Image API key environment variable is missing or invalid');
      const auth: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
      let promptId: string | undefined;
      const api = async (route: string, init: RequestInit = {}) => {
        let response: Response;
        try { response = await http(new URL(route, base), { ...init, headers: { ...auth, ...init.headers }, signal, redirect: 'error' }); }
        catch { signal.throwIfAborted(); throw new ImageGenerationError('FLUX 3 transport outcome unknown; do not resubmit automatically', promptId); }
        if (!response.ok) { await response.body?.cancel(); throw new ImageGenerationError(`FLUX 3 HTTP ${response.status}; no automatic retry`, promptId); }
        try { return JSON.parse(Buffer.from(await boundedBody(response, 2 * 1024 * 1024, signal)).toString('utf8')); }
        catch { signal.throwIfAborted(); throw new ImageGenerationError('Invalid FLUX 3 response; inspect original request before retrying', promptId); }
      };
      // Exact configured node capabilities and model names; never scan other ports or choose another model.
      for (const [name, field, value] of [['UNETLoader', 'unet_name', models.unet], ['CLIPLoader', 'clip_name', models.clip], ['VAELoader', 'vae_name', models.vae]] as const) {
        const info = (await api('object_info/' + name))[name];
        if (!info?.input?.required?.[field]?.[0]?.includes(value)
          || name === 'CLIPLoader' && !info.input.required.type?.[0]?.includes('flux3')) throw new Error('Configured service lacks the exact FLUX 3 model/node capability: ' + name);
      }
      if (request.images.length && !(await api('object_info/ReferenceMultiLatent')).ReferenceMultiLatent)
        throw new Error('Configured service lacks FLUX 3 multi-reference support');
      const uploads: string[] = [];
      for (const image of request.images) {
        const form = new FormData();
        form.set('image', new Blob([Uint8Array.from(image.bytes)], { type: image.mime }), `agent-${randomUUID()}.${image.mime === 'image/png' ? 'png' : image.mime === 'image/jpeg' ? 'jpg' : 'webp'}`);
        form.set('type', 'input'); form.set('overwrite', 'false');
        const upload = await api('upload/image', { method: 'POST', body: form });
        if (typeof upload.name !== 'string' || upload.name.includes('..') || /[\\/]/.test(upload.name)
          || upload.subfolder && !/^[\w/-]+$/.test(upload.subfolder)) throw new Error('Invalid image upload receipt');
        uploads.push((upload.subfolder ? upload.subfolder + '/' : '') + upload.name);
      }
      const graph = buildFlux3Graph(models, request, uploads);
      const submitted = await api('prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: graph, client_id: request.requestId ?? randomUUID() }) });
      if (typeof submitted.prompt_id !== 'string' || !/^[\w-]{1,160}$/.test(submitted.prompt_id)) throw new Error('FLUX 3 acceptance is unknown; no automatic resubmission');
      promptId = submitted.prompt_id;
      try {
        for (;;) {
          signal.throwIfAborted();
          const history = (await api('history/' + promptId))[promptId!];
          if (history) {
            if (history.status?.status_str === 'error') throw new ImageGenerationError('FLUX 3 execution failed; inspect provider history', promptId);
            if (history.status?.completed === true && history.status?.status_str === 'success') {
              // Read only the output node we submitted, never an intermediate preview or arbitrary history URL.
              const images = history.outputs?.['10']?.images;
              if (!Array.isArray(images) || images.length !== 1) throw new ImageGenerationError('FLUX 3 did not finish with exactly one saved image', promptId);
              const file = images[0];
              if (typeof file.filename !== 'string' || /[\\/]|\.\./.test(file.filename) || file.type !== 'output'
                || typeof file.subfolder !== 'string' || !/^[\w/-]*$/.test(file.subfolder) || file.subfolder.includes('..'))
                throw new ImageGenerationError('Invalid FLUX 3 output receipt', promptId);
              const response = await http(new URL('view?' + new URLSearchParams(file), base), { headers: auth, signal, redirect: 'error' });
              if (!response.ok) { await response.body?.cancel(); throw new ImageGenerationError(`FLUX 3 output HTTP ${response.status}; no regeneration`, promptId); }
              const bytes = await boundedBody(response, 24 * 1024 * 1024, signal), mime = imageMime(bytes);
              signal.throwIfAborted();
              const [width, height] = request.size ? request.size.split('x').map(Number) : [models.width, models.height];
              return { bytes, mime, model: config.model, providerRequestId: promptId,
                usage: { image_count: 1, input_image_count: request.images.length, width, height, steps: 16 } };
            }
          }
          await delay(models.pollMs ?? 1000, undefined, { signal });
        }
      } catch (error) {
        // No global /interrupt or /free: other Agents may share the GPU. Cancellation closes this wait.
        if (signal.aborted) throw new ImageGenerationError('Local FLUX 3 wait cancelled; provider task may still be computing. Reconcile by providerRequestId', promptId);
        throw error;
      }
    },
  };
}
