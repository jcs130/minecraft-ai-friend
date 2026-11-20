import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {AincradResidenceStore} from '../src/aincrad-residence-store.mjs';

const ada = '7fa54de0-c402-4113-bff6-d95747a00001';
const bo = '7fa54de0-c402-4113-bff6-d95747a00002';
const name = {name: '栗灯', profession: '园艺师'};

function fixture() {
  const districtId = 'village';
  const site = (id, kind, x, options = {}) => ({id, districtId, kind, name: id,
    position: {x, y: 67, z: 80}, ...options});
  return {
    version: 1, world: 'minecraft:aincrad',
    districts: [{id: districtId, name: '营地'}], streets: [],
    places: [
      site('recorded-home', 'home', 75, {residents: [{name: '桐人'}]}),
      site('east-home', 'home', 80), site('west-home', 'home', 84, {residents: []}),
      site('attic', 'room', 80, {parentId: 'east-home', position: {x: 80, y: 71, z: 80}}),
      site('hall', 'building', 88), site('store-room', 'room', 88, {parentId: 'hall'}),
      site('dungeon', 'dungeon-room', 89, {parentId: 'hall'}), site('garden', 'garden', 92),
    ],
  };
}

function memory(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  return db;
}

function occupant(catalogue, id) {
  return catalogue.places.find(place => place.id === id).residents;
}

test('fixed residences project public labels and preserve static occupants', t => {
  const baseline = fixture();
  const store = new AincradResidenceStore(memory(t), baseline);
  assert.deepEqual(store.assign(ada, 'east-home', name), {homeId: 'east-home', created: true});
  assert.deepEqual(store.assign(bo, 'attic', {name: '次郎'}), {homeId: 'attic', created: true});
  const publicCatalogue = store.publicCatalogue();
  assert.deepEqual(occupant(publicCatalogue, 'east-home'), [name]);
  assert.deepEqual(occupant(publicCatalogue, 'attic'), [{name: '次郎'}]);
  assert.deepEqual(occupant(publicCatalogue, 'recorded-home'), [{name: '桐人'}]);
  assert.deepEqual(occupant(publicCatalogue, 'west-home'), []);
  assert.equal(occupant(baseline, 'east-home'), undefined);
  assert.doesNotMatch(JSON.stringify(publicCatalogue), /character_id|characterId|bodyId|7fa54de0/);
  occupant(publicCatalogue, 'recorded-home')[0].name = '恶意改名';
  assert.deepEqual(occupant(store.publicCatalogue(), 'recorded-home'), [{name: '桐人'}]);
});

test('identical retries keep their residence and conflicts leave both addresses intact', t => {
  const db = memory(t);
  const store = new AincradResidenceStore(db, fixture());
  store.assign(ada, 'east-home', name);
  assert.deepEqual(store.assign(ada.toUpperCase(), 'east-home', {...name}), {homeId: 'east-home', created: false});
  assert.throws(() => store.assign(ada, 'west-home', name), {code: 'AINCRAD_CHARACTER_ALREADY_HOUSED'});
  assert.throws(() => store.assign(bo, 'east-home', {name: '次郎'}), {code: 'AINCRAD_ADDRESS_ALREADY_OCCUPIED'});
  assert.throws(() => store.assign(ada, 'east-home', {name: '栗灯'}), {code: 'AINCRAD_RESIDENCE_DETAILS_CHANGED'});
  assert.deepEqual(store.assign(bo, 'west-home', {name: '次郎'}), {homeId: 'west-home', created: true});
  assert.deepEqual(occupant(store.publicCatalogue(), 'east-home'), [name]);
  assert.deepEqual(occupant(store.publicCatalogue(), 'west-home'), [{name: '次郎'}]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM aincrad_residence_assignments').get().count, 2);
});

test('only empty homes and rooms in homes may be assigned to vetted identities', t => {
  const store = new AincradResidenceStore(memory(t), fixture());
  assert.throws(() => store.assign(ada, 'recorded-home', name), {code: 'AINCRAD_STATIC_OCCUPANCY'});
  for (const id of ['hall', 'store-room', 'dungeon', 'garden', 'missing']) {
    assert.throws(() => store.assign(ada, id, name), {code: 'AINCRAD_ADDRESS_NOT_RESIDENTIAL'});
  }
  assert.throws(() => store.assign('栗灯', 'east-home', name), {code: 'AINCRAD_CHARACTER_ID_INVALID'});
  for (const fields of [{name: '栗灯', bodyId: bo}, {name: ' 栗灯'}, {name: '栗灯', profession: null}, {name: '一\n行'}]) {
    assert.throws(() => store.assign(ada, 'east-home', fields), {code: 'AINCRAD_RESIDENT_LABELS_INVALID'});
  }
  assert.equal(occupant(store.publicCatalogue(), 'east-home'), undefined);
});

test('saved assignments are durable and a later static entry remains authoritative', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aincrad-residences-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const filename = path.join(dir, 'housing.sqlite');
  const first = new DatabaseSync(filename);
  try { new AincradResidenceStore(first, fixture()).assign(ada, 'east-home', name); } finally { first.close(); }
  const second = new DatabaseSync(filename, {readOnly: true});
  try {
    assert.deepEqual(occupant(new AincradResidenceStore(second, fixture()).publicCatalogue(), 'east-home'), [name]);
    const revised = fixture();
    revised.places.find(place => place.id === 'east-home').residents = [{name: '才录入的静态住户'}];
    const current = new AincradResidenceStore(second, revised);
    assert.deepEqual(occupant(current.publicCatalogue(), 'east-home'), [{name: '才录入的静态住户'}]);
    assert.throws(() => current.assign(ada, 'east-home', name), {code: 'AINCRAD_STATIC_OCCUPANCY'});
  } finally { second.close(); }
});

test('the operator command assigns privately and writes only a new public export', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aincrad-housing-cli-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const db = path.join(dir, 'housing.sqlite'), input = path.join(dir, 'request.json');
  const output = path.join(dir, 'public.json'), catalogue = path.join(dir, 'catalogue.json');
  await writeFile(catalogue, JSON.stringify(fixture()));
  await writeFile(input, JSON.stringify({characterId: ada, homeId: 'east-home', resident: name}));
  const script = fileURLToPath(new URL('../scripts/aincrad-housing.mjs', import.meta.url));
  function run(command, ...args) {
    return spawnSync(process.execPath, [script, command, '--db', db, '--catalogue', catalogue, ...args], {encoding: 'utf8'});
  }
  const assigned = run('assign', '--request', input);
  assert.equal(assigned.status, 0, assigned.stderr);
  assert.deepEqual(JSON.parse(assigned.stdout), {homeId: 'east-home', created: true});
  const exported = run('export', '--out', output);
  assert.equal(exported.status, 0, exported.stderr);
  const exportedText = await readFile(output, 'utf8');
  assert.deepEqual(occupant(JSON.parse(exportedText), 'east-home'), [name]);
  assert.doesNotMatch(exportedText, /7fa54de0|characterId|bodyId/);
  const repeated = run('export', '--out', output);
  assert.notEqual(repeated.status, 0);
  assert.equal(await readFile(output, 'utf8'), exportedText);
});
