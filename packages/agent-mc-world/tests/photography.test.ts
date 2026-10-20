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

describe('Minecraft capture ownership and legacy archives', () => {
  it('captures and deduplicates originals without touching a legacy provider', async () => {
    const provider = vi.fn(() => { throw Error('must not construct a generator'); });
    const capture = vi.fn(async () => fixture());
    const service = new PhotographyService({ directory: directory(), capture, provider }); service.start(host());
    try {
      const a = await service.execute({ action: 'capture' }, ctx);
      const b = await service.execute({ action: 'capture' }, ctx);
      expect(a.execution).toEqual(b.execution); expect(a.blobs).toEqual(b.blobs); expect(capture).toHaveBeenCalledTimes(1);
      expect(JSON.parse((await service.execute({ action: 'capabilities' }, ctx)).text)).toMatchObject({ capture: true, generate: false, enhance: false, generationOwner: 'cortico-world-aigc' });
      expect(provider).not.toHaveBeenCalled();
    } finally { service.stop(); }
  });
  it('returns explicit relocation for creative calls before dispatch or hidden fallback', async () => {
    const rig = setup();
    try {
      for (const action of ['create', 'enhance']) {
        const out = await rig.service.execute({ action, prompt: 'a village', request_id: 'legacy-' + action }, ctx);
        expect(out.failed).toBe(true); expect(JSON.parse(out.text)).toMatchObject({ code: 'capability_moved', package: 'cortico-world-aigc', tool: 'aigc_create' });
      }
      expect(rig.capture).not.toHaveBeenCalled();
    } finally { rig.service.stop(); }
  });
  it('preserves raw capture, legacy unknown jobs and stable budgeted factual context', async () => {
    const dir = directory(), service = new PhotographyService({ directory: dir, capture: async () => fixture() }); service.start(host());
    const out = await service.execute({ action: 'capture' }, ctx), record = JSON.parse(out.text);
    const budget = { contextTokens: 30000, reservedOutputTokens: 2000, imageInputTokens: 1000, toolDescriptions: JSON.stringify(PHOTO_TOOL) };
    expect(preparePhotoContext(record, 'a', budget).system).toEqual(preparePhotoContext(record, 'b', budget).system);
    expect(() => preparePhotoContext(record, 'a', { ...budget, contextTokens: 10 })).toThrow('budget');
    service.stop(); record.action = 'create'; record.phase = 'running'; record.prompt = 'legacy original prompt';
    writeFileSync(join(dir, record.id + '.json'), JSON.stringify(record));
    const restored = new PhotographyService({ directory: dir, capture: async () => fixture() }); restored.start(host());
    try {
      const legacy = JSON.parse((await restored.execute({ action: 'read', id: record.id }, ctx)).text);
      expect(legacy).toMatchObject({ phase: 'blocked', prompt: 'legacy original prompt' }); expect(legacy.reason).toContain('unknown');
    } finally { restored.stop(); }
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
