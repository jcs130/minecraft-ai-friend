/**
 * Optional Java 26.2 (protocol 776) stack.
 *
 * Official packed dependencies (minecraft-data 3.119.0 / mineflayer 4.39.0 /
 * minecraft-protocol 1.68.0) list 26.2 in protocolVersions but ship no data
 * and no protocol adapters. This module loads a locally locked, unpublished
 * vendor tree and must not replace the default official stack used by 1.21.1,
 * 1.21.11, 26.1 and other supported versions.
 *
 * Support is experimental. See vendor/experimental-26.2/SOURCE-LOCK.json.
 */
import { createRequire } from 'node:module';
import Module from 'node:module';

type ResolveFilename = (this: unknown, request: string, parent: NodeModule | undefined, ...rest: unknown[]) => string;
type ModuleWithHooks = typeof Module & { _resolveFilename: ResolveFilename };
const ModuleHooks = Module as ModuleWithHooks;
import net from 'node:net';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import type { Bot, BotOptions } from 'mineflayer';
import officialMineflayer from 'mineflayer';
import { resolveMinecraftConnectEndpoint } from './connect-endpoint.ts';

const requireFromHere = createRequire(import.meta.url);

function resolveExperimentalVendorRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'vendor/experimental-26.2');
    if (existsSync(join(candidate, 'SOURCE-LOCK.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(dirname(fileURLToPath(import.meta.url)), '../vendor/experimental-26.2');
}

const VENDOR_ROOT = resolveExperimentalVendorRoot();
const VENDOR_DATA = join(VENDOR_ROOT, 'minecraft-data');
const VENDOR_MINEFLAYER = join(VENDOR_ROOT, 'mineflayer');

export const JAVA_26_2_VERSION = '26.2';
export const JAVA_26_2_PROTOCOL = 776;
export const EXPERIMENTAL_26_2_STACK = 'experimental-26.2' as const;

export type ProtocolStackKind = 'official' | typeof EXPERIMENTAL_26_2_STACK;

export interface JavaProtocolStack {
  kind: ProtocolStackKind;
  minecraftVersion: string;
  protocol?: number;
  mineflayer: { createBot: (options: BotOptions) => Bot };
  experimental: boolean;
}

export interface StackResolutionOptions {
  requestedVersion: string;
  host: string;
  port: number;
  handshakeHost?: string;
  publicDnsFallback?: boolean;
  /** Test seam: skip network and return this ping result. */
  ping?: () => Promise<{ name?: string; protocol?: number } | null>;
  /** Test seam: replace only the TCP status ping inside the default auto probe (retries still apply). */
  statusPing?: (options: { host: string; port: number; handshakeHost: string; timeoutMs?: number }) => Promise<{ name?: string; protocol?: number }>;
  lookup?: import('./connect-endpoint.ts').EndpointLookup;
  fallbackLookups?: import('./connect-endpoint.ts').EndpointFallback[];
}

let dataHookInstalled = false;
let originalResolveFilename: ResolveFilename | undefined;

export function experimental26_2VendorRoot(): string {
  return VENDOR_ROOT;
}

export function isJava26_2Version(version: string | number | undefined | null): boolean {
  if (version == null) return false;
  if (typeof version === 'number') return version === JAVA_26_2_PROTOCOL;
  const text = String(version);
  if (text === JAVA_26_2_VERSION || text === String(JAVA_26_2_PROTOCOL)) return true;
  return /(?:^|[^\d])26\.2(?:[^\d]|$)/.test(text) && !/1\.26\.2/.test(text);
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
}

/** Loopback plus RFC 2606 reserved names. Auto must not probe these, so unit fixtures stay offline. */
export function skipsAutoProtocolProbe(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (isLoopbackHost(h)) return true;
  if (isIP(h) === 4 && (h.startsWith('127.') || h === '0.0.0.0')) return true;
  if (isIP(h) === 6 && (h === '::' || h === '::1')) return true;
  if (h === 'test' || h === 'example' || h === 'invalid' || h === 'localhost') return true;
  if (h.endsWith('.test') || h.endsWith('.example') || h.endsWith('.invalid')) return true;
  if (h === 'example.com' || h === 'example.net' || h === 'example.org') return true;
  if (h.endsWith('.example.com') || h.endsWith('.example.net') || h.endsWith('.example.org')) return true;
  return false;
}

export function installExperimentalMinecraftDataResolution(): void {
  if (dataHookInstalled) return;
  originalResolveFilename = ModuleHooks._resolveFilename;
  ModuleHooks._resolveFilename = function (this: unknown, request: string, parent: NodeModule | undefined, ...rest: unknown[]) {
    const parentFile = parent?.filename ? parent.filename.replaceAll('\\', '/') : '';
    const fromOverlay = parentFile.includes('/vendor/experimental-26.2/minecraft-data/');
    const fromVendor = parentFile.includes('/vendor/experimental-26.2/');
    if (!fromOverlay && (request === 'minecraft-data' || request.startsWith('minecraft-data/'))) {
      const target = request === 'minecraft-data' ? join(VENDOR_DATA, 'index.js') : join(VENDOR_DATA, request.slice('minecraft-data/'.length));
      return originalResolveFilename!.call(this, target, parent, ...rest as []);
    }
    if (fromVendor && (request === 'minecraft-protocol' || request.startsWith('minecraft-protocol/'))) {
      const target = request === 'minecraft-protocol'
        ? join(VENDOR_ROOT, 'minecraft-protocol/src/index.js')
        : join(VENDOR_ROOT, 'minecraft-protocol', request.slice('minecraft-protocol/'.length));
      return originalResolveFilename!.call(this, target, parent, ...rest as []);
    }
    return originalResolveFilename!.call(this, request, parent, ...rest as []);
  };
  dataHookInstalled = true;
}

/** For tests only: remove the process-wide minecraft-data hook. */
export function uninstallExperimentalMinecraftDataResolution(): void {
  if (!dataHookInstalled || !originalResolveFilename) return;
  ModuleHooks._resolveFilename = originalResolveFilename;
  dataHookInstalled = false;
  originalResolveFilename = undefined;
}

export function loadExperimentalMineflayer(): { createBot: (options: BotOptions) => Bot } {
  installExperimentalMinecraftDataResolution();
  return requireFromHere(VENDOR_MINEFLAYER) as { createBot: (options: BotOptions) => Bot };
}

function writeVarInt(n: number): Buffer {
  const out: number[] = [];
  let v = n >>> 0;
  while (true) {
    if ((v & ~0x7f) === 0) { out.push(v); break; }
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return Buffer.from(out);
}

function writeString(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([writeVarInt(b.length), b]);
}

function writeUShort(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}

function frame(...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function readVarInt(buf: Buffer, offset: number): { value: number; offset: number } | null {
  let n = 0, shift = 0, i = offset;
  while (i < buf.length) {
    const b = buf[i++];
    n |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: n, offset: i };
    shift += 7;
    if (shift > 35) throw new Error('varint too long');
  }
  return null;
}

/** Status ping that keeps handshake host separate from the TCP address. */
export function pingJavaStatus(options: {
  host: string;
  port: number;
  handshakeHost: string;
  timeoutMs?: number;
}): Promise<{ name?: string; protocol?: number }> {
  const { host, port, handshakeHost, timeoutMs = 10_000 } = options;
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    let settled = false;
    const done = (err: Error | null, value?: { name?: string; protocol?: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* already closed */ }
      if (err) reject(err);
      else resolve(value!);
    };
    const timer = setTimeout(() => done(new Error('status ping timeout')), timeoutMs);
    sock.on('error', (err) => done(err instanceof Error ? err : new Error(String(err))));
    sock.on('connect', () => {
      const handshake = frame(
        writeVarInt(0x00),
        writeVarInt(JAVA_26_2_PROTOCOL),
        writeString(handshakeHost),
        writeUShort(port),
        writeVarInt(1),
      );
      sock.write(Buffer.concat([handshake, frame(writeVarInt(0x00))]));
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === 'HTTP/') {
        done(new Error('status ping received an HTTP response'));
        return;
      }
      const len = readVarInt(buf, 0);
      if (!len || buf.length < len.offset + len.value) return;
      const id = readVarInt(buf, len.offset);
      if (!id) return;
      const strLen = readVarInt(buf, id.offset);
      if (!strLen) return;
      const end = strLen.offset + strLen.value;
      if (buf.length < end) return;
      try {
        const parsed = JSON.parse(buf.subarray(strLen.offset, end).toString('utf8')) as { version?: { name?: string; protocol?: number } };
        done(null, { name: parsed.version?.name, protocol: parsed.version?.protocol });
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)));
      }
    });
    sock.on('close', () => {
      if (!settled) done(new Error('status ping closed before a response'));
    });
  });
}

function officialStack(minecraftVersion: string, protocol?: number): JavaProtocolStack {
  return {
    kind: 'official',
    minecraftVersion,
    protocol,
    mineflayer: officialMineflayer as unknown as JavaProtocolStack['mineflayer'],
    experimental: false,
  };
}

function experimentalStack(): JavaProtocolStack {
  return {
    kind: EXPERIMENTAL_26_2_STACK,
    minecraftVersion: JAVA_26_2_VERSION,
    protocol: JAVA_26_2_PROTOCOL,
    mineflayer: loadExperimentalMineflayer(),
    experimental: true,
  };
}

/**
 * Choose the official or experimental 26.2 stack.
 * Explicit 26.2 uses the vendor tree immediately.
 * `auto` on a remote host pings first (handshake host preserved) and only then
 * loads the experimental tree. Loopback `auto` stays on the official stack so
 * existing fixtures do not hit the network.
 */
export async function resolveJavaProtocolStack(options: StackResolutionOptions): Promise<JavaProtocolStack> {
  const requested = options.requestedVersion || 'auto';
  if (isJava26_2Version(requested)) return experimentalStack();
  if (requested !== 'auto' && requested !== 'false') return officialStack(requested);

  if (!options.ping && skipsAutoProtocolProbe(options.host)) {
    return officialStack('auto');
  }

  const ping = options.ping ?? (async () => {
    const endpoint = await resolveMinecraftConnectEndpoint({
      host: options.host,
      port: options.port,
      handshakeHost: options.handshakeHost,
      publicDnsFallback: options.publicDnsFallback,
      lookup: options.lookup,
      fallbackLookups: options.fallbackLookups,
    });
    const target = {
      host: endpoint.host,
      port: endpoint.port,
      handshakeHost: endpoint.fakeHost ?? options.handshakeHost ?? options.host,
      timeoutMs: 15_000,
    };
    const attempts = 2;
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const status = await (options.statusPing ?? pingJavaStatus)(target);
        return { status, endpoint };
      } catch (err) {
        lastError = err;
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`status ping failed after ${attempts} attempts via ${endpoint.source ?? 'unknown'} ${endpoint.host}:${endpoint.port}: ${reason}`);
  });

  const result = await ping();
  const status = result && 'status' in result ? result.status : result;
  if (status && (status.protocol === JAVA_26_2_PROTOCOL || isJava26_2Version(status.name))) {
    return experimentalStack();
  }
  return officialStack('auto', status?.protocol);
}

export const experimental26_2Info = {
  experimental: true,
  officialSupport: false,
  version: JAVA_26_2_VERSION,
  protocol: JAVA_26_2_PROTOCOL,
  vendorRoot: VENDOR_ROOT,
};
