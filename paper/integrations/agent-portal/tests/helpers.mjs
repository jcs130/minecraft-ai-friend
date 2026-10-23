import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig, projectRoot } from '../src/config.mjs';
import { createPortal } from '../src/server.mjs';

export const testPassword = 'isolated-portal-password-2026';
export async function siteFixture(t, overrides = {}, options = {}) {
  const base = path.join(projectRoot, '.local', 'tests'), root = path.join(base, randomUUID());
  const uuid = '11111111-1111-3111-8111-111111111111';
  const agent = { id: 'a'.repeat(24), name: 'ag_Alpha', playerUuid: uuid, kind: 'agent', available: true, online: true };
  const documents = { 'config.yml': { 'guild-players': { [uuid]: { joined: '2026-10-01', fame: 48, completed: 3, everDone: { tm_test: '2026-10-20' } } } },
    'profession-ledger.json': { players: { [uuid]: { combat: 'warrior', academy: { grade: 4, certificates: { inventory_basic: {} } }, secret: 'private-profile-value' } } },
    'task-market.yml': { tasks: { test: { title: '营地补给' } } } };
  await fs.mkdir(path.join(root, 'game', 'logs'), { recursive: true });
  const game = { cached: async (_key, _ttl, fn) => fn(), roster: async () => [agent],
    publicAgent: row => ({ id: row.id, name: row.name, kind: row.kind, online: row.online, available: row.available }),
    plugin: async file => ({ data: documents[file] || null, savedAt: '2026-10-20T04:00:00Z' }),
    playerNbt: async () => ({ data: { XpLevel: 21, Inventory: ['private-inventory-value'], Pos: [99, 64, 888] }, savedAt: '2026-10-20T04:00:00Z' }),
    serverSummary: async () => ({ online: true, playersOnline: 1 }),
  };
  const config = loadConfig({ skipLocalConfig: true, port: 0, host: '127.0.0.1', dataDir: path.join(root, 'data'), serverDir: path.join(root, 'game'), emailAuth: { registrationMode: 'username' }, ...overrides });
  const portal = createPortal(config, { game, emailSender: overrides.emailSender, ...options });
  await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + portal.server.address().port;
  function client() {
    let cookie = '', csrf = '';
    const request = async (endpoint, method = 'GET', body, extra = {}) => {
      const response = await fetch(origin + '/api/v1' + endpoint, { method, headers: { Cookie: cookie, ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const incoming = response.headers.get('set-cookie'); if (incoming) cookie = incoming.split(';')[0];
      const data = await response.json(); if (data.csrfToken) csrf = data.csrfToken;
      return { response, status: response.status, data };
    };
    const binary = async (endpoint, method, bytes, type = 'image/png', extra = {}) => fetch(origin + '/api/v1' + endpoint, { method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': type, 'X-CSRF-Token': csrf, ...extra }, body: bytes });
    return { request, binary, init: () => request('/session') };
  }
  const admin = client(); await admin.init();
  const setup = await admin.request('/setup', 'POST', { username: 'fixture-admin', password: testPassword });
  if (setup.status !== 201) throw Error('Isolated website setup failed');
  t.after(async () => { await portal.close(); if (!path.resolve(root).startsWith(base + path.sep)) throw Error('Unsafe fixture cleanup'); await fs.rm(root, { recursive: true, force: true }); });
  return { portal, root, game, documents, uuid, agent, origin, admin, client, config };
}

// Deliberately minimal SOF fixture for ingress validation tests. It is not a
// rendered Minecraft frame, nor evidence of successful browser decoding.
export function jpegFixture(width = 1280, height = 720) {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  bytes.writeUInt16BE(height, 7); bytes.writeUInt16BE(width, 9); return bytes;
}
