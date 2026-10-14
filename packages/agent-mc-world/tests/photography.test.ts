import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PhotographyService, PHOTO_TOOL, preparePhotoContext } from '../core/photography.ts';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';
import { PHOTOGRAPHY_PROTOCOL, type ImageGenerationPort, type PhotoCapture } from '../src/contracts/photography.ts';
import type { WorldHost, ToolCallContext } from '../src/contracts/host.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6NQAAAABJRU5ErkJggg==', 'base64');
const image = { bytes: png, mime: 'image/png' };
const ctx: ToolCallContext = { role: 'Test', log: nullLogger(), callId: 'capture-1' };
const directories: string[] = [];
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'mc-photo-')); directories.push(path); return path; };
afterEach(() => { vi.restoreAllMocks(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const stamp = new Date().toISOString();
  return { ...image, capturedAt: stamp, sampledAt: stamp, captureId: 'paired-capture', facts: { position: [1, 65, 3], held: 'stone' } } satisfies PhotoCapture;
}
function host() {
  return { blob: vi.fn(() => image), pushEvent: vi.fn(async event => ({ ...event, cursor: 1 })), log: nullLogger() } as unknown as WorldHost;
}
function setup(provider: ImageGenerationPort | null = null) {
  const capture = vi.fn(async () => fixture()), attached = host();
  const service = new PhotographyService({ directory: directory(), capture, provider: () => provider });
  service.start(attached);
  return { service, capture, attached };
}
async function finished(service: PhotographyService, id: string) {
  await vi.waitFor(async () => expect((await service.execute({ action: 'status', id }, ctx)).execution?.terminal).toBe(true));
  return service.execute({ action: 'read', id }, ctx);
}

describe('generic photography/art lifecycle', () => {
  it('works without any model, preserves paired originals and reports explicit enhancement fallback', async () => {
    const { service, capture } = setup();
    expect(JSON.parse((await service.execute({ action: 'capabilities' }, ctx)).text)).toMatchObject({ capture: true, generate: false, enhance: false, planner: 'host' });
    const raw = await service.execute({ action: 'capture' }, ctx), record = JSON.parse(raw.text);
    expect(raw.execution).toMatchObject({ phase: 'completed', terminal: true, goalCompleted: false });
    expect(raw.blobs?.[0]).toMatchObject({ bytes: png, mime: 'image/png' });
    expect(record).toMatchObject({ captureId: 'paired-capture', facts: { position: [1, 65, 3] } });
    expect(await service.execute({ action: 'capture' }, ctx)).toEqual(raw); expect(capture).toHaveBeenCalledOnce();
    const fallback = await service.execute({ action: 'enhance', source_id: record.id, prompt: 'Warm village' }, { ...ctx, callId: 'enhance-1' });
    expect(JSON.parse(fallback.text)).toMatchObject({ enhanced: false, fallback: 'original' });
    expect(fallback.blobs?.[0]).toMatchObject({ bytes: png, mime: 'image/png' });
    expect(await service.execute({ action: 'create', prompt: 'A forest' }, { ...ctx, callId: 'create-1' })).toMatchObject({ failed: true });
    service.stop();
  });
  it('does not turn a deduplicated fallback into a paid generation when configuration changes', async () => {
    const generate = vi.fn(async () => ({ ...image, model: 'paid-fixture' }));
    let provider: ImageGenerationPort | null = null;
    const service = new PhotographyService({ capture: async () => fixture(), provider: () => provider }); service.start(host());
    const raw = await service.execute({ action: 'capture' }, ctx);
    const request = { action: 'enhance', prompt: 'test', source_id: raw.execution!.id };
    const fallback = await service.execute(request, { ...ctx, callId: 'fallback' });
    provider = { capabilities: { generate: true, edit: true, maxReferences: 3 }, generate };
    const repeated = await service.execute(request, { ...ctx, callId: 'fallback' });
    expect(repeated.execution).toEqual(fallback.execution); expect(JSON.parse(repeated.text).enhanced).toBe(false);
    expect(generate).not.toHaveBeenCalled(); service.stop();
  });
  it('keeps the screenshot first, multiple references next and emits an actual terminal result', async () => {
    const generate = vi.fn(async () => ({ ...image, model: 'fixture', providerRequestId: 'native-req', usage: { image_count: 1 } }));
    const { service, attached } = setup({ capabilities: { generate: true, edit: true, maxReferences: 10 }, generate });
    const raw = await service.execute({ action: 'capture' }, ctx);
    const args = { action: 'enhance', source_id: raw.execution!.id, prompt: 'Natural stone village, identifiable anime character', reference_handles: ['mem:front', 'mem:back'] };
    const accepted = await service.execute(args, { ...ctx, callId: 'enhance' });
    expect(accepted.execution).toMatchObject({ phase: 'accepted', terminal: false, goalCompleted: false });
    const result = await finished(service, accepted.execution!.id);
    expect(result.execution).toMatchObject({ phase: 'completed', terminal: true, goalCompleted: false });
    expect(generate.mock.calls[0][0]).toMatchObject({ prompt: args.prompt, images: [image, image, image] });
    expect(attached.pushEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'minecraft.photo', blobs: expect.any(Array),
      execution: expect.objectContaining({ terminal: true, goalCompleted: false }) }), { trigger: 'interrupt' });
    await service.execute(args, { ...ctx, callId: 'enhance' }); expect(generate).toHaveBeenCalledOnce();
    expect(await service.execute({ ...args, prompt: 'changed' }, { ...ctx, callId: 'enhance' })).toMatchObject({ failed: true });
    service.stop();
  });
  it('cancels HTTP waiting and never revives a stopped job, even if the backend ignores abort', async () => {
    let release!: (value: any) => void, signal!: AbortSignal;
    const generate = vi.fn((_request, abort: AbortSignal) => { signal = abort; return new Promise<any>(resolve => { release = resolve; }); });
    const { service, attached } = setup({ capabilities: { generate: true, edit: true, maxReferences: 3 }, generate });
    const accepted = await service.execute({ action: 'create', prompt: 'Imagined forest' }, ctx);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    const cancelled = await service.execute({ action: 'cancel', id: accepted.execution!.id }, ctx);
    expect(cancelled.execution).toMatchObject({ phase: 'cancelled', terminal: true }); expect(signal.aborted).toBe(true);
    service.stop(); service.start(attached);
    release({ ...image, model: 'late' });
    await new Promise(resolve => setTimeout(resolve, 10));
    const final = await service.execute({ action: 'read', id: accepted.execution!.id }, ctx);
    expect(final.execution?.phase).toBe('cancelled'); expect(final.blobs).toBeUndefined(); expect(attached.pushEvent).not.toHaveBeenCalled();
    service.stop();
  });
  it('rejects stale paired readings, missing/too many references and concurrent submissions', async () => {
    const attached = host();
    const service = new PhotographyService({ capture: async () => ({ ...fixture(), sampledAt: '2000-01-01T00:00:00Z' }), provider: () => null });
    service.start(attached);
    expect((await service.execute({ action: 'capture' }, ctx)).text).toContain('paired'); service.stop();
    const generate = vi.fn(() => new Promise<any>(() => {}));
    const rig = setup({ capabilities: { generate: true, edit: true, maxReferences: 1 }, generate });
    expect(await rig.service.execute({ action: 'create', prompt: 'test', reference_handles: ['mem:1', 'mem:2'] }, ctx)).toMatchObject({ failed: true });
    const accepted = await rig.service.execute({ action: 'create', prompt: 'test' }, { ...ctx, callId: 'create' });
    expect(accepted.execution?.terminal).toBe(false);
    expect((await rig.service.execute({ action: 'create', prompt: 'again' }, { ...ctx, callId: 'another' })).text).toContain('draining');
    rig.service.stop();
  });
  it('archives raw facts/prompts, recovers uncertain jobs without resubmission, and keeps stable budgeted prefixes', async () => {
    const path = directory(), attached = host();
    const service = new PhotographyService({ directory: path, capture: async () => fixture(), provider: () => null }); service.start(attached);
    const raw = await service.execute({ action: 'capture' }, ctx), record = JSON.parse(raw.text);
    const budget = { contextTokens: 30000, reservedOutputTokens: 2000, imageInputTokens: 1000, toolDescriptions: JSON.stringify(PHOTO_TOOL) };
    const a = preparePhotoContext(record, 'A warm village', budget), b = preparePhotoContext(record, 'A rainy village', budget);
    expect(a.system).toBe(b.system); expect(a.user).not.toBe(b.user); expect(a.user).toContain('held');
    expect(() => preparePhotoContext(record, 'test', { ...budget, contextTokens: 1000 })).toThrow('budget');
    expect(() => preparePhotoContext(record, 'test', { ...budget, imageInputTokens: 0 })).toThrow('budget');
    const disk = JSON.parse(readFileSync(join(path, record.id + '.json'), 'utf8'));
    expect(disk.facts).toEqual(record.facts);
    disk.phase = 'running'; disk.action = 'create'; disk.prompt = 'Unknown remote submission';
    writeFileSync(join(path, record.id + '.json'), JSON.stringify(disk)); service.stop();
    const capture = vi.fn(async () => fixture());
    const restored = new PhotographyService({ directory: path, capture, provider: () => null }); restored.start(attached);
    const outcome = await restored.execute({ action: 'capture' }, ctx);
    expect(outcome.execution?.phase).toBe('blocked'); expect(outcome.text).toContain('unknown remote outcome'); expect(capture).not.toHaveBeenCalled(); restored.stop();
  });
});

describe('photography SDK / MCP parity', () => {
  it('keeps a fast background terminal receipt when the admission RPC returns later', async () => {
    let attached!: WorldHost;
    const terminal = { kind: 'observation' as const, id: 'fast-photo', phase: 'completed' as const, terminal: true, goalCompleted: false as const };
    const runtime = new MinecraftAgentClient({ dataDir: directory(), cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'offline.invalid', username: 'Test' }, log: nullLogger() }, {
      id: 'minecraft', envPromptVars: () => ({}), start: async host => { attached = host; }, stop: async () => {},
      tools: () => [{ ...PHOTO_TOOL, handler: async () => {
        await attached.pushEvent({ type: 'minecraft.photo', source: 'minecraft', ts: new Date().toISOString(), text: 'done', execution: terminal });
        return { text: 'admitted earlier', execution: { ...terminal, phase: 'accepted', terminal: false } };
      } }],
    });
    await runtime.connect();
    try {
      expect((await runtime.call('mc_photo', { action: 'create', prompt: 'test' })).execution?.phase).toBe('accepted');
      expect(runtime.task('observation', terminal.id)).toEqual(terminal);
    } finally { await runtime.disconnect(); }
  });
  it('passes image blobs, paired facts, task identity and true decision boundaries through both APIs', async () => {
    const service = new PhotographyService({ directory: directory(), capture: async () => fixture(), provider: () => null });
    const runtime = new MinecraftAgentClient({ dataDir: directory(), cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'offline.invalid', username: 'Test' }, log: nullLogger() }, {
      id: 'minecraft', envPromptVars: () => ({}), tools: () => [{ ...PHOTO_TOOL, handler: (args, ctx) => service.execute(args, ctx) }],
      start: async host => service.start(host), stop: async () => service.stop(),
    });
    const server = createMinecraftMcpServer(runtime, 'test'), client = new Client({ name: 'photo-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b); await runtime.connect();
    try {
      runtime.beginTurn('turn-photo');
      const response = await client.callTool({ name: 'mc_photo', arguments: { action: 'capture', request_id: 'paired' } });
      const structured = response.structuredContent as any;
      expect(structured.control).toMatchObject({ barrierAfter: true, turnEnded: false, turnId: 'turn-photo' });
      expect(structured.execution).toMatchObject({ kind: 'observation', phase: 'completed', goalCompleted: false });
      expect(structured.meta.photography).toMatchObject({ schema: PHOTOGRAPHY_PROTOCOL, captureId: 'paired-capture' });
      expect((response.content as any[]).find(part => part.type === 'image')?.data).toBe(png.toString('base64'));
      expect(runtime.task('observation', structured.execution.id)).toEqual(structured.execution);
      const control = await client.callTool({ name: 'mc_protocol', arguments: { protocol: 'agent-mc/v1', action: 'ack_barrier', id: structured.control.requestId } });
      expect(control.isError).not.toBe(true);
      const sdk = await runtime.call('mc_photo', { action: 'read', id: structured.execution.id });
      expect(sdk.execution).toEqual(structured.execution); expect(sdk.meta).toEqual(structured.meta);
      expect(runtime.beginTurn('turn-photo').phase).toBe('open');
    } finally { await runtime.disconnect(); await client.close(); await server.close(); }
  });
});
