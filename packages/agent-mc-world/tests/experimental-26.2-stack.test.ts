import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import officialData from 'minecraft-data';
import {
  EXPERIMENTAL_26_2_STACK,
  JAVA_26_2_PROTOCOL,
  JAVA_26_2_VERSION,
  installExperimentalMinecraftDataResolution,
  isJava26_2Version,
  resolveJavaProtocolStack,
  uninstallExperimentalMinecraftDataResolution,
} from '../core/experimental-26.2.ts';

const require = createRequire(import.meta.url);
const officialNmd = require('minecraft-data') as typeof officialData & { (v: string): { protocol: unknown; version: { version: number; minecraftVersion: string } } | null };
const overlayNmd = require('../vendor/experimental-26.2/minecraft-data') as typeof officialNmd;

afterEach(() => {
  uninstallExperimentalMinecraftDataResolution();
});

function protocolHash(version: string, loader: typeof officialNmd): string {
  const data = loader(version);
  if (!data) throw new Error(`missing ${version}`);
  return createHash('sha256').update(JSON.stringify(data.protocol)).digest('hex');
}

it('treats official minecraft-data as still unaware of 26.2', () => {
  expect(officialNmd('26.2')).toBeNull();
  expect(officialNmd('26.1')?.version.version).toBe(775);
});

it('loads the locked 26.2 overlay without changing official 1.21.1, 1.21.11, or 26.1 schemas', () => {
  const data = overlayNmd(JAVA_26_2_VERSION);
  expect(data?.version.minecraftVersion).toBe(JAVA_26_2_VERSION);
  expect(data?.version.version).toBe(JAVA_26_2_PROTOCOL);
  expect(data?.supportFeature('hasConfigurationState')).toBe(true);
  expect(data?.protocol.login.toClient.types.packet_success).toEqual(expect.arrayContaining([
    'container',
  ]));
  const success = JSON.stringify(data!.protocol.login.toClient.types.packet_success);
  expect(success).toContain('sessionId');
  const login = JSON.stringify(data!.protocol.play.toClient.types.packet_login);
  expect(login).toContain('onlineMode');
  const settings = JSON.stringify(data!.protocol.types.packet_common_settings);
  expect(settings).toContain('particleStatus');
  for (const version of ['1.21.1', '1.21.11', '26.1'] as const) {
    expect(protocolHash(version, overlayNmd)).toBe(protocolHash(version, officialNmd));
    expect(overlayNmd(version)?.version.version).toBe(officialNmd(version)?.version.version);
  }
  expect(officialNmd('26.2')).toBeNull();
});

it('keeps 26.2-only login and play fields in the overlay schema, not in official 26.1', () => {
  const overlay = overlayNmd(JAVA_26_2_VERSION)!.protocol;
  const official = officialNmd('26.1')!.protocol;
  const success26 = JSON.stringify(overlay.login.toClient.types.packet_success);
  const success21 = JSON.stringify(official.login.toClient.types.packet_success);
  expect(success26).toContain('sessionId');
  expect(success21).not.toContain('sessionId');
  expect(JSON.stringify(overlay.play.toClient.types.packet_login)).toContain('onlineMode');
  expect(JSON.stringify(official.play.toClient.types.packet_login)).not.toContain('onlineMode');
  expect(JSON.stringify(overlay.types.packet_common_settings)).toContain('particleStatus');
  // Client Information already has particleStatus in 26.1 data; official nmp still omits it when writing.
  expect(JSON.stringify(official.types.packet_common_settings)).toContain('particleStatus');
});

it('selects the experimental stack only for 26.2, including auto after a 776 ping', async () => {
  expect(isJava26_2Version('26.2')).toBe(true);
  expect(isJava26_2Version('26.1')).toBe(false);
  expect(isJava26_2Version('1.21.11')).toBe(false);
  const explicit = await resolveJavaProtocolStack({ requestedVersion: '26.2', host: '127.0.0.1', port: 25565 });
  expect(explicit.kind).toBe(EXPERIMENTAL_26_2_STACK);
  expect(explicit.experimental).toBe(true);
  expect(explicit.minecraftVersion).toBe('26.2');
  const official = await resolveJavaProtocolStack({ requestedVersion: '26.1', host: 'mc.example.test', port: 25565 });
  expect(official.kind).toBe('official');
  expect(official.experimental).toBe(false);
  const loopbackAuto = await resolveJavaProtocolStack({ requestedVersion: 'auto', host: '127.0.0.1', port: 25565 });
  expect(loopbackAuto.kind).toBe('official');
  const reservedAuto = await resolveJavaProtocolStack({ requestedVersion: 'auto', host: 'example.test', port: 25565 });
  expect(reservedAuto.kind).toBe('official');
  expect(reservedAuto.experimental).toBe(false);
  const remoteAuto = await resolveJavaProtocolStack({
    requestedVersion: 'auto',
    host: 'mc.example.test',
    port: 25565,
    ping: async () => ({ name: 'Velocity 1.7.2-26.2', protocol: 776 }),
  });
  expect(remoteAuto.kind).toBe(EXPERIMENTAL_26_2_STACK);
  const remoteOld = await resolveJavaProtocolStack({
    requestedVersion: 'auto',
    host: 'mc.example.test',
    port: 25565,
    ping: async () => ({ name: 'Paper 1.21.1', protocol: 767 }),
  });
  expect(remoteOld.kind).toBe('official');
});

it('resolves the locked vendor tree from the package root', () => {
  const { experimental26_2VendorRoot } = require('../core/experimental-26.2.ts') as typeof import('../core/experimental-26.2.ts');
  const root = experimental26_2VendorRoot();
  expect(root.replaceAll('\\', '/')).toContain('/vendor/experimental-26.2');
  expect(existsSync(join(root, 'SOURCE-LOCK.json'))).toBe(true);
  expect(existsSync(join(root, 'mineflayer/package.json'))).toBe(true);
});

it('loads the experimental mineflayer factory against 26.2 data', () => {
  const { loadExperimentalMineflayer } = require('../core/experimental-26.2.ts') as typeof import('../core/experimental-26.2.ts');
  const factory = loadExperimentalMineflayer();
  expect(typeof factory.createBot).toBe('function');
  const overlay = require('../vendor/experimental-26.2/minecraft-data') as typeof officialNmd;
  expect(overlay('26.2')?.version.version).toBe(JAVA_26_2_PROTOCOL);
  expect(officialNmd('26.2')).toBeNull();
});

const probeLookup = (async (name: string, type: 'A' | 'AAAA' | 'SRV') => {
  if (type === 'SRV' && name === '_minecraft._tcp.mc.kkwmc.cn') return { srv: { name: 'w35.kkwmc.cn', port: 7562 } };
  if (type === 'A' && name === 'w35.kkwmc.cn') return { addresses: ['203.0.113.40'] };
  if (type === 'SRV') return { srv: null };
  return { addresses: [] };
}) as import('../core/connect-endpoint.ts').EndpointLookup;

it('retries the default auto status ping twice and includes the resolved endpoint in the error', async () => {
  let calls = 0;
  await expect(resolveJavaProtocolStack({
    requestedVersion: 'auto',
    host: 'mc.kkwmc.cn',
    port: 25565,
    publicDnsFallback: false,
    lookup: probeLookup,
    statusPing: async () => {
      calls += 1;
      throw new Error('status ping timeout');
    },
  })).rejects.toThrow(/status ping failed after 2 attempts via .*203\.0\.113\.40:7562: status ping timeout/);
  expect(calls).toBe(2);
});

it('selects the experimental stack after a retried auto ping reports protocol 776', async () => {
  let calls = 0;
  const stack = await resolveJavaProtocolStack({
    requestedVersion: 'auto',
    host: 'mc.kkwmc.cn',
    port: 25565,
    publicDnsFallback: false,
    lookup: probeLookup,
    statusPing: async () => {
      calls += 1;
      if (calls === 1) throw new Error('status ping timeout');
      return { name: 'Velocity 1.7.2-26.2', protocol: 776 };
    },
  });
  expect(calls).toBe(2);
  expect(stack.kind).toBe(EXPERIMENTAL_26_2_STACK);
  expect(stack.experimental).toBe(true);
});
