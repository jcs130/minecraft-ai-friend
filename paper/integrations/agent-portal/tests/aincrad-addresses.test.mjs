import test from 'node:test';
import assert from 'node:assert/strict';
import {readAincradAddresses, validateAincradAddresses} from '../src/aincrad-addresses.mjs';

const point = (x, y, z) => ({x, y, z});
function fixture() {
  const districtId = 'town';
  return {
    version: 1,
    world: 'minecraft:aincrad',
    districts: [{id: districtId, name: '起始之城'}],
    streets: [{id: 'district-lane', districtId, name: '营地巷', path: [point(60, 67, 98), point(68, 67, 97)]}],
    places: [
      {id: 'west-house', districtId, streetId: 'district-lane', kind: 'home',
        number: '01', name: '测试住处', position: point(65, 67, 97), residents: [{name: '测试居民', profession: '游侠'}]},
      {id: 'upper-room', districtId, parentId: 'west-house', kind: 'room',
        number: '01', name: '阁楼', position: point(65, 72, 97)},
    ],
  };
}

test('the measured catalogue allows fixed addresses and uses Y to distinguish levels', async () => {
  const input = fixture();
  assert.equal(validateAincradAddresses(input), input);
  const published = await readAincradAddresses();
  assert(published.places.some(place => place.kind === 'home' && place.residents?.length));
  assert(published.places.some(place => place.kind === 'dungeon-room'));
});

test('ambiguous addresses and unsupported public fields are rejected', () => {
  const duplicate = fixture();
  duplicate.places.push({...duplicate.places[0], id: 'east-house'});
  assert.throws(() => validateAincradAddresses(duplicate), /duplicates a number/);
  const unknown = fixture();
  unknown.places[1].parentId = 'absent';
  assert.throws(() => validateAincradAddresses(unknown), /requires a top-level building/);
  const privateField = fixture();
  privateField.places[0].residents[0].bodyId = 'internal-id';
  assert.throws(() => validateAincradAddresses(privateField), /contains invalid fields/);
  const markup = fixture();
  markup.places[0].name = '<strong>住宅</strong>';
  assert.throws(() => validateAincradAddresses(markup), /must be a short visible label/);
});
