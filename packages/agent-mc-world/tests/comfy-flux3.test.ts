import { describe, expect, it, vi } from 'vitest';
import { createImageGenerationPort } from '../core/image-generation.ts';
import { buildFlux3Graph } from '../core/comfy-flux3.ts';
import type { PhotographyConfig } from '../src/contracts/photography.ts';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6NQAAAABJRU5ErkJggg==', 'base64');
const image = { bytes: png, mime: 'image/png' };
const cfg: PhotographyConfig = { provider: 'comfyui-flux3', endpoint: 'http://127.0.0.1:8191', model: 'FLUX.3-Klein', apiKeyEnv: '', generate: true, edit: true,
  maxReferences: 3, timeoutMs: 10000, resultHosts: '', flux3: { unet: 'flux3.safetensors', clip: 'qwen3vl.safetensors', vae: 'flux2-vae.safetensors', width: 1280, height: 704, steps: 16, pollMs: 50 } };
const json = (value: unknown) => new Response(JSON.stringify(value));
function fixture() {
  let graph: any, polls = 0;
  const paths: string[] = [], forms: FormData[] = [];
  const http = vi.fn(async (url: any, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname; paths.push(path);
    if (path.endsWith('/UNETLoader')) return json({ UNETLoader: { input: { required: { unet_name: [[cfg.flux3!.unet]] } } } });
    if (path.endsWith('/CLIPLoader')) return json({ CLIPLoader: { input: { required: { clip_name: [[cfg.flux3!.clip]], type: [['flux2', 'flux3']] } } } });
    if (path.endsWith('/VAELoader')) return json({ VAELoader: { input: { required: { vae_name: [[cfg.flux3!.vae]] } } } });
    if (path.endsWith('/ReferenceMultiLatent')) return json({ ReferenceMultiLatent: {} });
    if (path === '/upload/image') { forms.push(init.body as FormData); return json({ name: 'ref-' + forms.length + '.png', subfolder: '' }); }
    if (path === '/prompt') { graph = JSON.parse(String(init.body)); return json({ prompt_id: 'owned-prompt' }); }
    if (path === '/history/owned-prompt') { polls++; return json({ 'owned-prompt': { status: { completed: true, status_str: 'success' }, outputs: { '10': { images: [{ filename: 'result.png', subfolder: 'agent_mc_flux3', type: 'output' }] } } } }); }
    if (path === '/view') return new Response(png);
    throw new Error('Unexpected request: ' + path);
  });
  return { http, paths, forms, graph: () => graph, polls: () => polls };
}
describe('FLUX 3 explicit native provider', () => {
  it('makes no network request on construction or capability read', () => { const f = fixture(); const port = createImageGenerationPort(cfg, { fetch: f.http })!; expect(port.capabilities.edit).toBe(true); expect(f.http).not.toHaveBeenCalled(); });
  it('preflights exact models, preserves reference order and final host prompt without a VLM', async () => {
    const f = fixture(), port = createImageGenerationPort(cfg, { fetch: f.http })!;
    const result = await port.generate({ prompt: 'Host composition, scene first; back-facing identity only.', images: [image, image], requestId: 'stable-photo' }, new AbortController().signal);
    expect(result).toMatchObject({ bytes: png, providerRequestId: 'owned-prompt', model: cfg.model, usage: { steps: 16, input_image_count: 2 } });
    expect(f.graph()).toMatchObject({ client_id: 'stable-photo', prompt: { '2': { inputs: { type: 'flux3' } }, '6': { inputs: { text: 'Host composition, scene first; back-facing identity only.' } },
      '20': { inputs: { 'images.image0': ['40', 0], 'images.image1': ['41', 0] } }, '40': { inputs: { image: 'ref-1.png' } }, '41': { inputs: { image: 'ref-2.png' } } } });
    expect(f.paths.some(p => /interrupt|free|TextGenerate|\/queue/.test(p))).toBe(false);
    expect(f.http.mock.calls.every(([, init]) => (init as any)?.redirect === 'error')).toBe(true);
  });
  it('supports original text-to-image, rejects the old four-step schedule and invalid canvas before I/O', async () => {
    const graph = buildFlux3Graph(cfg.flux3!, { prompt: 'imagined orchard', images: [] }, []);
    expect(graph['20']).toBeUndefined(); expect(graph['8'].inputs.positive).toEqual(['6', 0]);
    const f = fixture(), port = createImageGenerationPort(cfg, { fetch: f.http })!;
    await expect(port.generate({ prompt: 'bad size', images: [], size: '1279x704' }, new AbortController().signal)).rejects.toThrow('multiples');
    expect(f.http).not.toHaveBeenCalled(); expect(() => createImageGenerationPort({ ...cfg, flux3: { ...cfg.flux3!, steps: 4 as any } })).toThrow('sixteen');
  });
  it('refuses missing FLUX 3 support before upload/submission and does not try another endpoint', async () => {
    const f = fixture(); f.http.mockImplementationOnce(async () => json({ UNETLoader: { input: { required: { unet_name: [[]] } } } }));
    await expect(createImageGenerationPort(cfg, { fetch: f.http })!.generate({ prompt: 'x', images: [image] }, new AbortController().signal)).rejects.toThrow('exact FLUX 3');
    expect(f.paths).toHaveLength(0); expect(f.http).toHaveBeenCalledOnce();
    expect(() => createImageGenerationPort({ ...cfg, endpoint: 'http://192.0.2.1:8191' })).toThrow('protected');
  });
  it('cancels waiting without a global GPU interrupt and retains the accepted provider ID', async () => {
    const f = fixture(), base = f.http.getMockImplementation()!;
    f.http.mockImplementation(async (url, init) => String(url).includes('/history/') ? json({}) : base(url, init));
    const controller = new AbortController(); const task = createImageGenerationPort(cfg, { fetch: f.http })!.generate({ prompt: 'x', images: [] }, controller.signal);
    await vi.waitFor(() => expect(f.paths).toContain('/prompt')); controller.abort();
    await expect(task).rejects.toMatchObject({ providerRequestId: 'owned-prompt' }); expect(f.paths.some(p => p.includes('interrupt'))).toBe(false);
  });
});
