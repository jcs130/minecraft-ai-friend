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
import { captureVoxelScene } from '../core/voxel-scene.ts';
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
  it('keeps ordinary photos ordinary, archives optional voxel evidence, and selects it only when requested', async () => {
    const dir = directory(), proxy = { ...image, bytes: Buffer.concat([png, Buffer.from('proxy-fixture')]) };
    const scene = captureVoxelScene({ source: { kind: 'client-loaded-chunks', minecraftVersion: '1.21.1', dimension: 'overworld', username: 'Test', uuid: 'fixture', realmVerified: false },
      feet: [1, 65, 3], yaw: 0, pitch: 0, eyeHeight: 1.62, fovDegrees: 75, bounds: { min: [1, 64, 3], max: [1, 65, 3] },
      blockAt: (_x, y) => y === 64 ? { name: 'stone', properties: { fixture: true } } : null });
    const generate = vi.fn(async () => ({ ...image, model: 'flux3' }));
    const service = new PhotographyService({ directory: dir, voxelAvailable: () => true,
      capture: async args => ({ ...fixture(), ...(args.scene === 'voxel' ? { scene: { ...scene, sampledAt: new Date().toISOString() }, proxy, sceneRender: { visible: [{ name: 'minecraft:stone' }] } } : {}) }),
      provider: () => ({ capabilities: { generate: true, edit: true, maxReferences: 3 }, generate }) }); service.start(host());
    const caps = JSON.parse((await service.execute({ action: 'capabilities' }, ctx)).text);
    expect(caps).toMatchObject({ voxel: true, voxelDefault: false, enhancementDefault: false });
    const ordinary = JSON.parse((await service.execute({ action: 'capture', request_id: 'ordinary' }, ctx)).text);
    expect(ordinary.scene).toBeUndefined(); expect(generate).not.toHaveBeenCalled();
    const rejected = await service.execute({ action: 'enhance', source_id: ordinary.id, scene_input: 'voxel', prompt: 'x', request_id: 'bad-voxel' }, ctx);
    expect(rejected.failed).toBe(true); expect(generate).not.toHaveBeenCalled();
    const captured = JSON.parse((await service.execute({ action: 'capture', scene: 'voxel', request_id: 'voxel' }, ctx)).text);
    expect(captured.scene.coverage).toMatchObject({ known: 1, unknown: 1, complete: false });
    expect(captured.sceneRender.proxySha256).toMatch(/^[a-f0-9]{64}$/);
    const rawScene = await service.execute({ action: 'scene', id: captured.id }, ctx);
    expect(JSON.parse(Buffer.from((rawScene.blobs![0] as any).bytes).toString()).cells).toEqual([0, -1]);
    const regularEdit = await service.execute({ action: 'enhance', source_id: captured.id, prompt: 'Polish the ordinary photo', request_id: 'edit-original' }, ctx);
    await finished(service, regularEdit.execution!.id); expect(generate.mock.calls[0][0].images[0].bytes).toEqual(png);
    const voxelEdit = await service.execute({ action: 'enhance', source_id: captured.id, scene_input: 'voxel', prompt: 'Polish the supplied voxel layout', request_id: 'edit-voxel' }, ctx);
    const done = await finished(service, voxelEdit.execution!.id);
    expect(JSON.parse(done.text).sceneInput).toBe('voxel'); expect(generate.mock.calls[1][0].images[0].bytes).toEqual(proxy.bytes);
    expect(generate.mock.calls[1][0].requestId).toBe(voxelEdit.execution!.id);
    service.stop();
    const restored = new PhotographyService({ directory: dir, capture: async () => fixture(), provider: () => null }); restored.start(host());
    expect((await restored.execute({ action: 'scene', id: captured.id }, ctx)).blobs?.[0]).toHaveProperty('mime', 'application/json');
    expect((await restored.execute({ action: 'read', id: captured.id }, ctx)).blobs?.[0]).toHaveProperty('bytes', png); restored.stop();
  });
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
  it('exposes optional raw voxel evidence and its separate proxy through SDK and MCP without generation', async () => {
    const scene = captureVoxelScene({ source: { kind: 'client-loaded-chunks', minecraftVersion: '1.21.1', dimension: 'overworld', username: 'Test', uuid: 'fixture', realmVerified: false },
      feet: [0, 65, 0], yaw: 0, pitch: 0, eyeHeight: 1.62, fovDegrees: 75, bounds: { min: [0, 64, 0], max: [0, 65, 0] }, blockAt: () => null });
    const service = new PhotographyService({ directory: directory(), voxelAvailable: () => true, provider: () => null,
      capture: async () => ({ ...fixture(), scene: { ...scene, sampledAt: new Date().toISOString() }, proxy: image, sceneRender: { self: null } }) });
    const runtime = new MinecraftAgentClient({ dataDir: directory(), cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'offline.invalid', username: 'Test' }, log: nullLogger() }, {
      id: 'minecraft', envPromptVars: () => ({}), tools: () => [{ ...PHOTO_TOOL, handler: (args, ctx) => service.execute(args, ctx) }],
      start: async h => service.start(h), stop: async () => service.stop(),
    });
    const server = createMinecraftMcpServer(runtime, 'voxel-photo-test'), client = new Client({ name: 'voxel-photo-test', version: '1' });
    const [a,b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b); await runtime.connect();
    try {
      const capture = await runtime.call('mc_photo', { action: 'capture', scene: 'voxel', request_id: 'voxel-sdk' });
      const id = capture.execution!.id;
      if (capture.control?.requestId) await client.callTool({ name: 'mc_protocol', arguments: { protocol: 'agent-mc/v1', action: 'ack_barrier', id: capture.control.requestId } });
      const viaMcp = await client.callTool({ name: 'mc_photo', arguments: { action: 'scene', id } });
      expect(viaMcp, JSON.stringify(viaMcp.content)).not.toHaveProperty('isError', true);
      const meta = viaMcp.structuredContent as any;
      expect(meta.control.turnEnded).toBe(false);
      expect((viaMcp.content as any[]).some(v => v.type === 'image')).toBe(true);
      expect(JSON.parse((viaMcp.content as any[]).find(v => v.type === 'text').text)).toMatchObject({ scene: { coverage: { unknown: 2, complete: false } }, historical: true });
      if (meta.control?.requestId) await client.callTool({ name: 'mc_protocol', arguments: { protocol: 'agent-mc/v1', action: 'ack_barrier', id: meta.control.requestId } });
      const sdk = await runtime.call('mc_photo', { action: 'scene', id });
      expect(sdk.blobs).toHaveLength(2);
      expect(JSON.parse(sdk.text)).toMatchObject({ photoId: id, scene: { source: { realmVerified: false } } });
    } finally { await runtime.disconnect(); await client.close(); await server.close(); }
  });
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
