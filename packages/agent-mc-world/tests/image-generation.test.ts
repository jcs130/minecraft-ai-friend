import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageGenerationPort } from '../core/image-generation.ts';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6NQAAAABJRU5ErkJggg==', 'base64');
const image = { bytes: png, mime: 'image/png' }, signal = () => new AbortController().signal;
const base = { endpoint: 'https://provider.invalid/native', model: 'fixture-model', apiKeyEnv: 'TEST_IMAGE_KEY' };
const env = { TEST_IMAGE_KEY: 'secret-fixture-only' };
const json = (value: unknown, init?: ResponseInit) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' }, ...init });
afterEach(() => vi.restoreAllMocks());

describe('native cloud image adapters, entirely offline fixtures', () => {
  it('performs zero discovery/network calls on import, disabled/default capability or missing key', async () => {
    const http = vi.fn();
    expect(createImageGenerationPort(undefined, { fetch: http })).toBeNull();
    expect(createImageGenerationPort({ provider: 'none' }, { fetch: http })).toBeNull();
    const port = createImageGenerationPort({ ...base, provider: 'volcengine' }, { fetch: http, env: {} })!;
    await expect(port.generate({ prompt: 'test', images: [] }, signal())).rejects.toThrow('environment variable'); expect(http).not.toHaveBeenCalled();
  });
  it('uses native Bailian multimodal messages, ordered references, pixel sizing and explicit output-only download', async () => {
    const http = vi.fn().mockResolvedValueOnce(json({ request_id: 'ali-request', usage: { image_count: 1, secret: 'must-not-store' }, output: { choices: [{ message: { content: [{ image: 'https://result.invalid/art.png?Expires=123' }] } }] } }))
      .mockResolvedValueOnce(new Response(png));
    const port = createImageGenerationPort({ ...base, provider: 'bailian', model: 'qwen-image-2.1-pro', maxReferences: 10, resultHosts: 'result.invalid' }, { fetch: http, env })!;
    const out = await port.generate({ prompt: 'Scene image 1, character image 2', images: [image, image], size: '1536x1024' }, signal());
    expect(out).toMatchObject({ bytes: png, mime: 'image/png', providerRequestId: 'ali-request', usage: { image_count: 1 } });
    const init = http.mock.calls[0][1], body = JSON.parse(init.body);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer secret-fixture-only' } });
    expect(body).toMatchObject({ model: 'qwen-image-2.1-pro', input: { messages: [{ role: 'user', content: [
      { image: expect.stringContaining('data:image/png;base64,') }, { image: expect.stringContaining('data:image/png;base64,') }, { text: 'Scene image 1, character image 2' },
    ] }] }, parameters: { n: 1, prompt_extend: false, size: '1536*1024' } });
    expect(http.mock.calls[1][1].headers).toBeUndefined(); expect(http).toHaveBeenCalledTimes(2);
  });
  it.each(['doubao-seedream-5-0-lite-260128', 'doubao-seedream-4-5-251128', 'doubao-seedream-5-0-pro'])('uses native Ark JSON and inline bytes for %s', async model => {
    const http = vi.fn(async () => json({ data: [{ b64_json: png.toString('base64') }], usage: { generated_images: 1 } }, { headers: { 'x-request-id': 'ark-request' } }));
    const port = createImageGenerationPort({ ...base, provider: 'volcengine', model }, { fetch: http, env })!;
    expect(await port.generate({ prompt: 'Original village', images: [], size: '2K' }, signal())).toMatchObject({ bytes: png, providerRequestId: 'ark-request' });
    const body = JSON.parse(http.mock.calls[0][1].body);
    expect(body).toMatchObject({ model, prompt: 'Original village', response_format: 'b64_json', stream: false, size: '2K' });
    expect(body).not.toHaveProperty('image');
    if (model.includes('pro')) expect(body).not.toHaveProperty('sequential_image_generation'); else expect(body.sequential_image_generation).toBe('disabled');
    expect(http).toHaveBeenCalledOnce();
  });
  it('rejects unsupported capabilities, references, size and mismatched image bytes before network', async () => {
    const http = vi.fn();
    const port = createImageGenerationPort({ ...base, provider: 'bailian', generate: false, maxReferences: 1 }, { fetch: http, env })!;
    await expect(port.generate({ prompt: 'test', images: [] }, signal())).rejects.toThrow('disabled');
    await expect(port.generate({ prompt: 'test', images: [image, image] }, signal())).rejects.toThrow('Too many');
    await expect(port.generate({ prompt: 'test', images: [image], size: '2K' }, signal())).rejects.toThrow('pixels');
    await expect(port.generate({ prompt: 'test', images: [{ bytes: Buffer.from('<html>'), mime: 'image/png' }] }, signal())).rejects.toThrow('not PNG');
    expect(http).not.toHaveBeenCalled();
  });
  it('never retries transport/HTTP failures and omits echoed keys/URLs from errors', async () => {
    const http = vi.fn().mockRejectedValueOnce(new Error('secret-fixture-only')).mockResolvedValueOnce(json({ message: 'secret-fixture-only' }, { status: 429, headers: { 'x-request-id': 'failed-request' } }));
    const port = createImageGenerationPort({ ...base, provider: 'volcengine' }, { fetch: http, env })!;
    await expect(port.generate({ prompt: 'test', images: [] }, signal())).rejects.toThrow('acceptance is unknown'); expect(http).toHaveBeenCalledOnce();
    await expect(port.generate({ prompt: 'test', images: [] }, signal())).rejects.toMatchObject({ message: 'Image provider HTTP 429; no automatic retry', providerRequestId: 'failed-request' }); expect(http).toHaveBeenCalledTimes(2);
  });
  it('blocks unconfigured result destinations and reports the already submitted native request id', async () => {
    const http = vi.fn(async () => json({ request_id: 'ali-saved', output: { choices: [{ message: { content: [{ image: 'https://unconfigured.invalid/image' }] } }] } }));
    const port = createImageGenerationPort({ ...base, provider: 'bailian' }, { fetch: http, env })!;
    await expect(port.generate({ prompt: 'test', images: [] }, signal())).rejects.toMatchObject({ providerRequestId: 'ali-saved', message: 'Image result host is not explicitly configured' });
    expect(http).toHaveBeenCalledOnce();
  });
  it('aborts in-flight HTTP requests promptly and does not submit again', async () => {
    const controller = new AbortController(); let received!: AbortSignal;
    const http = vi.fn(async (_url, init) => { received = init.signal; return new Promise<Response>((_resolve, reject) => received.addEventListener('abort', () => reject(received.reason), { once: true })); });
    const port = createImageGenerationPort({ ...base, provider: 'volcengine' }, { fetch: http, env })!;
    const work = port.generate({ prompt: 'test', images: [] }, controller.signal);
    controller.abort(new Error('cancelled by caller'));
    await expect(work).rejects.toThrow('cancelled by caller'); expect(received.aborted).toBe(true); expect(http).toHaveBeenCalledOnce();
  });
});
