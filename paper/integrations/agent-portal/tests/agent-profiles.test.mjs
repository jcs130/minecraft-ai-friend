import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { siteFixture, testPassword } from './helpers.mjs';
import { referenceImage, AgentProfiles } from '../src/agent-profiles.mjs';
import { Store } from '../src/store.mjs';

const sourceImage = new URL('../public/assets/scenes/lantern-village-960.webp', import.meta.url);
test('reference uploads validate file bytes, dimensions, content type and per-agent counts; duplicate saves are harmless', async t => {
  const f = await siteFixture(t), endpoint = '/agents/' + f.agent.id, bytes = await fs.readFile(sourceImage);
  assert.equal(referenceImage(bytes).mime, 'image/webp');
  assert.equal((await f.admin.binary(endpoint + '/references', 'POST', bytes, 'image/png')).status, 415);
  assert.equal((await f.admin.binary(endpoint + '/references', 'POST', Buffer.from('<svg onload="unsafe()"></svg>'), 'image/webp')).status, 400);
  assert.equal((await f.admin.binary(endpoint + '/references', 'POST', Buffer.alloc(4 * 1024 * 1024 + 1), 'image/webp')).status, 413);
  const upload = await f.admin.binary(endpoint + '/references', 'POST', bytes, 'image/webp'); assert.equal(upload.status, 201);
  const profile = await upload.json(); assert.equal(profile.references.length, 1); assert.equal(profile.availableForGeneration, true);
  const repeated = await f.admin.binary(endpoint + '/references', 'POST', bytes, 'image/webp'); assert.equal((await repeated.json()).references.length, 1);
  for (const name of ['morning-in-the-fields', 'afternoon-by-the-river']) assert.equal((await f.admin.binary(endpoint + '/references', 'POST', await fs.readFile(new URL('../public/assets/scenes/' + name + '.webp', import.meta.url)), 'image/webp')).status, 201);
  assert.equal((await f.admin.binary(endpoint + '/references', 'POST', await fs.readFile(new URL('../public/assets/scenes/together-into-ruins.webp', import.meta.url)), 'image/webp')).status, 409);
});

test('only the verified owner reads or edits a character reference; public pages contain no private bio', async t => {
  const f = await siteFixture(t), endpoint = '/agents/' + f.agent.id;
  const user = f.client(); await user.init(); await user.request('/accounts', 'POST', { username: 'profile-owner', password: testPassword });
  const outsider = f.client(); await outsider.init(); await outsider.request('/accounts', 'POST', { username: 'profile-other', password: testPassword });
  assert.equal((await user.request(endpoint + '/profile')).status, 404);
  const owner = f.portal.store.ownerByName('profile-owner');
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, f.uuid, 'Isolated verified fixture owner', Date.now());
  const saved = await user.request(endpoint + '/profile', 'PUT', { displayName: '小旅人', bio: 'only-my-private-character-story', useReferences: true });
  assert.equal(saved.status, 200);
  const upload = await user.binary(endpoint + '/references', 'POST', await fs.readFile(sourceImage), 'image/webp');
  const image = (await upload.json()).references[0], imageEndpoint = image.url.slice('/api/v1'.length);
  assert.equal((await outsider.request(endpoint + '/profile')).status, 404);
  assert.equal((await outsider.binary(imageEndpoint, 'DELETE')).status, 404);
  assert.equal((await fetch(f.origin + image.url)).status, 401);
  assert.ok(!JSON.stringify((await user.request('/roster')).data).includes('only-my-private-character-story'));
  const token = await user.request('/client-credentials', 'POST', { agentId: f.agent.id, label: 'isolated-no-profile-scope', scopes: ['state.read'] });
  const connection = await fetch(f.origin + '/api/v1' + endpoint + '/connection-config', { headers: { Authorization: 'Bearer ' + token.data.token } });
  assert.equal(connection.status, 200); const settings = await connection.json(); assert.equal(settings.username, f.agent.name); assert.equal(settings.gamePasswordEnv, 'MC_GAME_PASSWORD'); assert.ok(!JSON.stringify(settings).includes(testPassword));
  assert.equal((await fetch(f.origin + image.url, { headers: { Authorization: 'Bearer ' + token.data.token } })).status, 403);
  const permitted = await user.request('/client-credentials', 'POST', { agentId: f.agent.id, label: 'isolated-profile-reader', scopes: ['state.read', 'profile.read'] });
  const downloaded = await fetch(f.origin + image.url, { headers: { Authorization: 'Bearer ' + permitted.data.token } });
  assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get('cache-control'), 'private, no-store'); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), await fs.readFile(sourceImage));
  assert.equal((await user.request(imageEndpoint, 'DELETE')).status, 200);
});

test('character art and text survive a closed database and can be excluded from later generation', async t => {
  const f = await siteFixture(t), directory = path.join(f.root, 'isolated-profile-persistence');
  let store = new Store(directory), profiles = new AgentProfiles(store);
  try {
  const owner = store.createOwner('profile-storage-fixture', 'not-an-authentication-test');
  profiles.save(f.agent, owner, { displayName: '旅人', bio: 'A persistent role story', useReferences: false });
  profiles.upload(f.agent, owner, await fs.readFile(sourceImage), 'image/webp');
  store.close(); store = new Store(directory); profiles = new AgentProfiles(store);
  const profile = profiles.get(f.agent); assert.equal(profile.bio, 'A persistent role story'); assert.equal(profile.references.length, 1); assert.equal(profile.availableForGeneration, false);
  assert.deepEqual(profiles.image(f.agent, profile.references[0].id).bytes, await fs.readFile(sourceImage));
  } finally { store.close(); }
});
