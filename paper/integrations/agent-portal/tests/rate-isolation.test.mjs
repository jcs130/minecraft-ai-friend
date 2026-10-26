import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { siteFixture } from './helpers.mjs';
import { digest } from '../src/store.mjs';

async function fixture(t) {
  const tokens = Object.fromEntries(['acc', 'srv', 'app'].map(kind => [kind, kind + '_' + randomBytes(32).toString('base64url')]));
  const f = await siteFixture(t, { sourceMode: 'cloud', cloudSync: { enabled: true, tokenHash: digest(tokens.srv) },
    cloudAccounts: { enabled: true, tokenHash: digest(tokens.acc), keyFile: '' },
    appearance: { bridgeEnabled: true, tokenHash: digest(tokens.app) } });
  f.config.cloudAccounts.keyFile = path.join(f.root, 'isolated-account.key');
  await fs.writeFile(f.config.cloudAccounts.keyFile, randomBytes(32).toString('hex'));
  async function request(route, method = 'GET', token, body, headers = {}) {
    const response = await fetch(f.origin + '/api/v1/' + route, { method,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, retry: response.headers.get('retry-after'), text };
  }
  async function exhaust() {
    for (let i = 0; i < 305; i++) if ((await request('health')).status === 429) return;
    assert.fail('Public API quota did not apply');
  }
  return { ...f, tokens, request, exhaust };
}

test('public browsing cannot starve authenticated account heartbeats; the 30/minute bridge cap remains', async t => {
  const f = await fixture(t); await f.exhaust();
  for (let i = 0; i < 30; i++) assert.equal((await f.request('internal/accounts/poll', 'POST', f.tokens.acc,
    { heartbeat: { ready: true, at: Date.now() }, results: [] })).status, 200);
  const limited = await f.request('internal/accounts/poll', 'POST', f.tokens.acc, {});
  assert.equal(limited.status, 429); assert.ok(Number(limited.retry) > 0);
  assert.equal(f.portal.store.db.prepare('SELECT ready FROM account_bridge_heartbeat WHERE id=1').get().ready, 1);
  assert.equal((await f.request('health')).status, 429);
});

test('invalid credentials, browser context and other methods cannot borrow trusted synchronization budgets', async t => {
  const f = await fixture(t), poll = 'internal/accounts/poll';
  for (let i = 0; i < 35; i++) assert.equal((await f.request(poll, 'POST', 'acc_' + 'x'.repeat(43), {})).status, 401);
  assert.equal((await f.request(poll, 'POST', f.tokens.acc, { heartbeat: { ready: true, at: Date.now() }, results: [] })).status, 200);
  await f.exhaust();
  for (const headers of [{ Origin: f.origin }, { Cookie: 'untrusted=1' }]) {
    assert.equal((await f.request(poll, 'POST', f.tokens.acc, {}, headers)).status, 429);
  }
  assert.equal((await f.request(poll, 'POST', 'acc_' + 'x'.repeat(43), {})).status, 429);
  assert.equal((await f.request(poll, 'GET', f.tokens.acc)).status, 429);
  assert.equal((await f.request('internal/accounts/unknown', 'POST', f.tokens.acc, {})).status, 429);
});

test('world snapshots, photographs and archive uploads keep their own bounded quotas after public saturation', async t => {
  const f = await fixture(t); await f.exhaust();
  const snapshot = { schemaVersion: 1, sequence: 1, observedAt: new Date().toISOString(),
    summary: { version: 'Paper 1.21.1 fixture', online: true, playersOnline: 0, playersMax: 40, authHealthy: true },
    roster: [], players: [], states: {}, events: [] };
  for (let i = 0; i < 12; i++) assert.equal((await f.request('internal/snapshot', 'PUT', f.tokens.srv, snapshot)).status, 200);
  assert.equal((await f.request('internal/snapshot', 'PUT', f.tokens.srv, snapshot)).status, 429);
  for (let i = 0; i < 12; i++) assert.equal((await f.request('internal/archives', 'PUT', f.tokens.srv, {})).status, 400);
  assert.equal((await f.request('internal/archives', 'PUT', f.tokens.srv, {})).status, 429);
  assert.equal((await f.request('internal/challenges', 'PUT', f.tokens.srv, {})).status, 400);
  assert.equal((await f.request('internal/photos/11111111-1111-4111-8111-111111111111', 'PUT', f.tokens.srv, {})).status, 415);
  assert.equal((await f.request('internal/snapshot', 'POST', f.tokens.srv, snapshot)).status, 429);
});

test('appearance synchronization survives a busy shared IP without raising its 24/minute limit', async t => {
  const f = await fixture(t); await f.exhaust();
  for (let i = 0; i < 24; i++) assert.equal((await f.request('internal/appearance/poll', 'POST', f.tokens.app,
    { at: Date.now(), ready: true, results: [] })).status, 200);
  assert.equal((await f.request('internal/appearance/poll', 'POST', f.tokens.app, {})).status, 429);
});
