import WebSocket from 'ws';
import { hashToken, HarnessRuntime, startGateway, type GatewayServerOptions, type HarnessEvent } from '../../src/index.ts';
import { fakeBody } from '../helpers.ts';

export const TOKENS = { neko: 'neko-token-0123456789abcdef', cortico: 'cortico-token-0123456789abcd', admin: 'admin-token-0123456789abcdef' };

export async function rig(extra: Partial<GatewayServerOptions> = {}) {
  const harness = new HarnessRuntime({ self: 'Komi' });
  const body = fakeBody({ sync: true });
  const logs: string[] = [];
  const gateway = await startGateway({
    harness, port: 0, heartbeatMs: 0,
    agents: [
      { id: 'neko', tokenEnv: 'NEKO_TOKEN', maxOpenIntents: 3 },
      { id: 'cortico', tokenEnv: 'CORTICO_TOKEN' },
      { id: 'ops', tokenSha256: hashToken(TOKENS.admin), admin: true },
    ],
    env: { NEKO_TOKEN: TOKENS.neko, CORTICO_TOKEN: TOKENS.cortico },
    log: (m, d) => logs.push(`${m} ${JSON.stringify(d ?? {})}`),
    ...extra,
  });
  return { harness, body, gateway, logs, close: async () => { await gateway.close(); await harness.close(); } };
}

/** Raw HTTP message call. */
export async function post(url: string, message: unknown, token?: string, headers: Record<string, string> = {}) {
  const r = await fetch(`${url}/v1/messages`, { method: 'POST', body: typeof message === 'string' ? message : JSON.stringify(message),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  return { status: r.status, headers: r.headers, body: await r.json() as { type: string; re?: string; payload: Record<string, any> } };
}
export const m = (type: string, payload: Record<string, unknown> = {}, id = `t-${Math.random().toString(36).slice(2, 8)}`) => ({ v: 1, id, type, payload });

/** Raw WebSocket (ws package) collecting all messages. */
export async function rawWs(wsUrl: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(wsUrl, { headers });
  const inbox: any[] = [];
  let closed: { code: number; reason: string } | null = null;
  ws.on('message', d => inbox.push(JSON.parse(String(d))));
  ws.on('close', (code, reason) => { closed = { code, reason: String(reason) }; });
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
  return {
    ws, inbox, closed: () => closed,
    send: (o: unknown) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)),
    async reply(id: string, ms = 2000) {
      const end = Date.now() + ms;
      while (Date.now() < end) { const r = inbox.find(x => x.re === id); if (r) return r; await new Promise(res => setTimeout(res, 5)); }
      throw new Error(`no reply for ${id}`);
    },
    events: () => inbox.filter(x => x.type === 'event').map(x => x.payload.event as HarnessEvent),
  };
}

export const death = (harness: HarnessRuntime, cause = '摔死') => harness.observer({ type: 'minecraft.event', ts: new Date().toISOString(), text: '你死了',
  meta: { death: { position: { x: 1, y: 64, z: 2 }, cause: { text: cause } } } }, null);
