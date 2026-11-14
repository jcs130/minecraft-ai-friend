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

export interface ResolveEndpointOptions {
  host: string;
  port: number;
  handshakeHost?: string;
  publicDnsFallback?: boolean;
  lookup?: (name: string, type: 'A' | 'AAAA' | 'SRV') => Promise<LookupResult>;
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
  lookup: ResolveEndpointOptions['lookup'],
  name: string,
): Promise<string | undefined> {
  const a = await lookup!(name, 'A');
  const usable = (a.addresses ?? []).find((ip) => !isUnusableResolvedAddress(ip));
  if (usable) return usable;
  const aaaa = await lookup!(name, 'AAAA');
  return (aaaa.addresses ?? []).find((ip) => !isUnusableResolvedAddress(ip));
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
  const srvName = `_minecraft._tcp.${host}`;
  let target = host;
  let resolvedPort = port;
  const srv = await lookup(srvName, 'SRV');
  if (srv.srv?.name && srv.srv.port) {
    target = srv.srv.name;
    resolvedPort = srv.srv.port;
  }

  const useFallback = options.publicDnsFallback !== false;
  let address = await firstAddress(lookup, target);
  let source = srv.srv ? 'system-srv' : 'system-a';
  if ((!address || isUnusableResolvedAddress(address)) && useFallback) {
    try {
      address = await firstAddress((name, type) => lookupResolver(PUBLIC_DNS, name, type), target);
      source = 'public-dns';
    } catch { /* try DoH next */ }
  }
  if ((!address || isUnusableResolvedAddress(address)) && useFallback) {
    try {
      address = await firstAddress(lookupDoh, target);
      source = 'doh-dns.google';
    } catch { /* keep previous failure */ }
  }
  if (!address || isUnusableResolvedAddress(address)) {
    return { host, port, fakeHost: handshake ?? host, source: 'unresolved-use-configured-host' };
  }
  return { host: address, port: resolvedPort, fakeHost: handshake ?? host, source };
}
