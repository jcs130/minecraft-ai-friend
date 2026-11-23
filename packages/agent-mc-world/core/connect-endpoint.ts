/**
 * Resolve a Minecraft host for createBot. Some environments return a fake
 * 198.18.0.0/15 address; retry with public DNS and pass the original domain
 * as fakeHost / handshake host. Never hardcodes a particular game server IP.
 */
import { Resolver, resolve4, resolve6, resolveSrv } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';

export interface ConnectEndpoint {
  host: string;
  port: number;
  fakeHost?: string;
  source: string;
}

export type EndpointLookup = (name: string, type: 'A' | 'AAAA' | 'SRV') => Promise<LookupResult>;

export interface EndpointFallback {
  /** Short source label, such as `public-dns` or `doh-dns.google`. */
  source: string;
  lookup: EndpointLookup;
}

export interface ResolveEndpointOptions {
  host: string;
  port: number;
  handshakeHost?: string;
  publicDnsFallback?: boolean;
  lookup?: EndpointLookup;
  /** Optional public/DoH (or test) lookups used when `publicDnsFallback` is on. */
  fallbackLookups?: EndpointFallback[];
}

/** Raised when public fallback is enabled but no usable A/AAAA/SRV target is found. */
export class MinecraftEndpointUnresolvedError extends Error {
  readonly code = 'ENOTFOUND';
  constructor(host: string, port: number) {
    super(`Minecraft host ${host}:${port} could not be resolved to a usable public address`);
    this.name = 'MinecraftEndpointUnresolvedError';
  }
}

export interface LookupResult {
  addresses?: string[];
  srv?: { port: number; name: string } | null;
}

const PUBLIC_DNS = ['8.8.8.8', '1.1.1.1'];

/** RFC 2544 benchmarking net, often used as a fake/captive DNS answer. */
export function isUnusableResolvedAddress(ip: string): boolean {
  if (isIP(ip) === 0) return true;
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts[0] === 198 && (parts[1] === 18 || parts[1] === 19);
}

function isLocalName(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
}

async function lookupSystem(name: string, type: 'A' | 'AAAA' | 'SRV'): Promise<LookupResult> {
  if (type === 'SRV') {
    try {
      const records = await resolveSrv(name);
      const first = records.sort((a: { priority: number; weight: number; port: number; name: string }, b: { priority: number; weight: number; port: number; name: string }) => a.priority - b.priority || b.weight - a.weight)[0];
      return { srv: first ? { port: first.port, name: first.name.replace(/\.$/, '') } : null };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ESERVFAIL') return { srv: null };
      throw error;
    }
  }
  try {
    return { addresses: await (type === 'AAAA' ? resolve6(name) : resolve4(name)) };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ESERVFAIL' || code === 'ENOTIMP') return { addresses: [] };
    throw error;
  }
}

async function lookupResolver(servers: string[], name: string, type: 'A' | 'AAAA' | 'SRV'): Promise<LookupResult> {
  const resolver = new Resolver();
  resolver.setServers(servers);
  if (type === 'SRV') {
    try {
      const records = await resolver.resolveSrv(name);
      const first = records.sort((a: { priority: number; weight: number; port: number; name: string }, b: { priority: number; weight: number; port: number; name: string }) => a.priority - b.priority || b.weight - a.weight)[0];
      return { srv: first ? { port: first.port, name: first.name.replace(/\.$/, '') } : null };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ESERVFAIL') return { srv: null };
      throw error;
    }
  }
  const method = type === 'AAAA' ? 'resolve6' : 'resolve4';
  try {
    return { addresses: await resolver[method](name) };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ESERVFAIL' || code === 'ENOTIMP') return { addresses: [] };
    throw error;
  }
}

async function lookupDoh(name: string, type: 'A' | 'AAAA' | 'SRV'): Promise<LookupResult> {
  const qtype = type === 'SRV' ? 'SRV' : type;
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${qtype}`;
  const body = await new Promise<string>((resolve, reject) => {
    const req = httpsRequest(url, { headers: { accept: 'application/dns-json' }, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
  const parsed = JSON.parse(body) as { Answer?: Array<{ type: number; data: string }> };
  if (type === 'SRV') {
    const answer = (parsed.Answer || []).find((row) => row.type === 33);
    if (!answer || typeof answer.data !== 'string') return { srv: null };
    const parts = answer.data.trim().split(/\s+/);
    if (parts.length < 4) return { srv: null };
    return { srv: { port: Number.parseInt(parts[2], 10) || 0, name: parts[3].replace(/\.$/, '') } };
  }
  const recordType = type === 'AAAA' ? 28 : 1;
  const addresses = (parsed.Answer || []).filter((row) => row.type === recordType).map((row) => row.data);
  return { addresses };
}

async function firstAddress(
  lookup: EndpointLookup,
  name: string,
): Promise<string | undefined> {
  const a = await lookup(name, 'A');
  const usable = (a.addresses ?? []).find((ip) => !isUnusableResolvedAddress(ip));
  if (usable) return usable;
  const aaaa = await lookup(name, 'AAAA');
  return (aaaa.addresses ?? []).find((ip) => !isUnusableResolvedAddress(ip));
}

function usableSrv(srv: LookupResult['srv']): { port: number; name: string } | null {
  if (!srv?.name || !Number.isInteger(srv.port) || srv.port <= 0 || srv.port > 65535) return null;
  return { name: srv.name.replace(/\.$/, ''), port: srv.port };
}

async function lookupSrv(lookup: EndpointLookup, srvName: string): Promise<{ port: number; name: string } | null> {
  try {
    return usableSrv((await lookup(srvName, 'SRV')).srv);
  } catch {
    // SRV is optional discovery: a timeout or resolver failure must not block A/AAAA.
    return null;
  }
}

function defaultFallbackLookups(): EndpointFallback[] {
  return [
    { source: 'public-dns', lookup: (name, type) => lookupResolver(PUBLIC_DNS, name, type) },
    { source: 'doh-dns.google', lookup: lookupDoh },
  ];
}

export async function resolveMinecraftConnectEndpoint(options: ResolveEndpointOptions): Promise<ConnectEndpoint> {
  const host = options.host.trim();
  const port = options.port;
  const handshake = options.handshakeHost?.trim() || undefined;
  if (!host) throw new Error('missing Minecraft host');
  if (isIP(host) !== 0 || isLocalName(host)) {
    return { host, port, ...(handshake ? { fakeHost: handshake } : {}), source: 'literal' };
  }

  const lookup = options.lookup ?? lookupSystem;
  const useFallback = options.publicDnsFallback !== false;
  const fallbacks = useFallback ? (options.fallbackLookups ?? defaultFallbackLookups()) : [];
  const srvName = `_minecraft._tcp.${host}`;
  let target = host;
  let resolvedPort = port;
  let srvSource: string | null = null;
  // Match minecraft-protocol: an explicit port must never be replaced by SRV.
  // SRV is optional discovery, so a timeout must not block a valid direct A/AAAA route.
  if (port === 25565) {
    const systemSrv = await lookupSrv(lookup, srvName);
    if (systemSrv) {
      target = systemSrv.name;
      resolvedPort = systemSrv.port;
      srvSource = 'system-srv';
    } else {
      for (const fallback of fallbacks) {
        const discovered = await lookupSrv(fallback.lookup, srvName);
        if (!discovered) continue;
        target = discovered.name;
        resolvedPort = discovered.port;
        srvSource = `${fallback.source}-srv`;
        break;
      }
    }
  }

  let address = await firstAddress(lookup, target);
  let source = srvSource ?? 'system-a';
  if ((!address || isUnusableResolvedAddress(address)) && fallbacks.length) {
    for (const fallback of fallbacks) {
      try {
        address = await firstAddress(fallback.lookup, target);
      } catch {
        continue;
      }
      if (address && !isUnusableResolvedAddress(address)) {
        source = srvSource && srvSource.endsWith('-srv') ? srvSource : fallback.source;
        break;
      }
      address = undefined;
    }
  }
  if (!address || isUnusableResolvedAddress(address)) {
    // With public fallback on, do not silently dial the configured name: box
    // resolvers may map it to a fake 198.18.0.0/15 intercept (HTTP 400).
    if (useFallback) throw new MinecraftEndpointUnresolvedError(host, port);
    return { host, port, fakeHost: handshake ?? host, source: 'unresolved-use-configured-host' };
  }
  return { host: address, port: resolvedPort, fakeHost: handshake ?? host, source };
}
