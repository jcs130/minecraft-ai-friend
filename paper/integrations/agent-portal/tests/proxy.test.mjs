import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { requestOrigin, rateAddress } from '../src/request-origin.mjs';
import { loadConfig } from '../src/config.mjs';
import { siteFixture, testPassword } from './helpers.mjs';

test('public HTTPS requires the configured Host and a trusted proxy; public proxies never grant local setup', () => {
  const config = loadConfig({ publicOrigin: 'https://world.example.test' });
  const req = (host, peer, forwarded = 'https') => ({ headers: { host, 'x-forwarded-proto': forwarded }, socket: { remoteAddress: peer } });
  assert.equal(requestOrigin(req('world.example.test', '127.0.0.1'), config, 8790).secure, true);
  assert.equal(requestOrigin(req('world.example.test', '127.0.0.1'), config, 8790).canSetup, false);
  assert.throws(() => requestOrigin(req('world.example.test', '10.1.2.3'), config, 8790));
  assert.throws(() => requestOrigin(req('evil.test', '127.0.0.1'), config, 8790));
  assert.throws(() => requestOrigin(req('world.example.test', '127.0.0.1', 'http'), config, 8790));
  assert.equal(requestOrigin(req('127.0.0.1:8790', '127.0.0.1'), config, 8790).canSetup, false);
  assert.throws(() => loadConfig({ publicOrigin: 'http://world.example.test' }));
  assert.throws(() => loadConfig({ publicOrigin: 'https://user:password@world.example.test/' }));
});

test('HTTPS proxy login issues Secure cookies, validates HTTPS Origin and hides administrator initialization', async t => {
  const f = await siteFixture(t, { publicOrigin: 'https://world.example.test' });
  const headers = { Host: 'world.example.test', 'X-Forwarded-Proto': 'https' };
  // Fetch controls Host itself; a real reverse proxy uses the HTTP Host header.
  let cookie = '', csrf = '';
  const request = (endpoint, method = 'GET', body, extra = {}) => new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const outgoing = http.request(f.origin + '/api/v1' + endpoint, { method, headers: { ...headers, Cookie: cookie, Origin: 'https://world.example.test', 'X-CSRF-Token': csrf, ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}), ...extra } }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        const data = JSON.parse(text); csrf = data.csrfToken || csrf;
        const incoming = response.headers['set-cookie']?.[0]; if (incoming) cookie = incoming.split(';')[0];
        resolve({ status: response.statusCode, data, headers: response.headers });
      });
    }); outgoing.on('error', reject); outgoing.end(encoded);
  });
  const session = await request('/session');
  assert.equal(session.status, 200); assert.equal(session.data.canSetup, false);
  assert.match(session.headers['set-cookie'][0], /; Secure/);
  assert.match(session.headers['strict-transport-security'], /max-age/);
  assert.equal((await request('/sessions', 'POST', { username: 'fixture-admin', password: testPassword }, { Origin: 'https://evil.test' })).status, 403);
  const login = await request('/sessions', 'POST', { username: 'fixture-admin', password: testPassword });
  assert.equal(login.status, 200); assert.match(login.headers['set-cookie'][0], /; Secure/);
  const setup = await request('/setup', 'POST', { username: 'takeover', password: testPassword });
  assert.equal(setup.status, 403);
});

test('rate limits distinguish real proxy visitors and do not trust an attacker-supplied XFF prefix or untrusted peer', () => {
  const config = loadConfig({ publicOrigin: 'https://world.example.test' });
  const request = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, portalOrigin: { origin: config.publicOrigin } };
  assert.equal(rateAddress(request, config), '5.6.7.8');
  request.socket.remoteAddress = '8.8.8.8'; assert.equal(rateAddress(request, config), '8.8.8.8');
});
