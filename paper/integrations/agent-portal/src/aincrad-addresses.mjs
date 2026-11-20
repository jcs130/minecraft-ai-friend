import {readFile} from 'node:fs/promises';

export const aincradAddressesFile = new URL('../public/aincrad-addresses.json', import.meta.url);
const kinds = new Set(['home', 'building', 'room', 'garden', 'market', 'fishing', 'dungeon-room', 'landmark']);
const addressNumber = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,23}$/u;
const identifier = /^[a-z][a-z0-9_-]{0,79}$/;
const world = 'minecraft:aincrad';

function fail(path, reason) {
  throw new TypeError(`${path} ${reason}`);
}

function exactKeys(value, required, optional, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || required.some(key => !Object.hasOwn(value, key))
      || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    fail(path, 'contains invalid fields');
  }
}

function list(value, maximum, path) {
  if (!Array.isArray(value) || value.length > maximum) fail(path, 'must be an array within its limit');
}

function label(value, max, path) {
  if (typeof value !== 'string' || !value || value.length > max
      || value.trim() !== value || /[<>\p{C}\p{Zl}\p{Zp}]/u.test(value)) {
    fail(path, 'must be a short visible label');
  }
}

function position(value, path) {
  exactKeys(value, ['x', 'y', 'z'], [], path);
  for (const [axis, limit] of [['x', 30_000_000], ['y', 2048], ['z', 30_000_000]]) {
    if (!Number.isFinite(value[axis]) || Math.abs(value[axis]) > limit) {
      fail(`${path}.${axis}`, 'is outside the mapped coordinate range');
    }
  }
}

function index(values, maximum, path) {
  list(values, maximum, path);
  const byId = new Map();
  for (const [i, value] of values.entries()) {
    if (typeof value?.id !== 'string' || !identifier.test(value.id) || byId.has(value.id)) {
      fail(`${path}[${i}].id`, 'must be a unique address identifier');
    }
    byId.set(value.id, value);
  }
  return byId;
}

export function validateAincradAddresses(catalogue) {
  exactKeys(catalogue, ['version', 'world', 'districts', 'streets', 'places'], [], 'catalogue');
  if (catalogue.version !== 1 || catalogue.world !== world) fail('catalogue', 'has an unsupported version or world');
  const districts = index(catalogue.districts, 250, 'districts');
  const streets = index(catalogue.streets, 2500, 'streets');
  const places = index(catalogue.places, 12_000, 'places');
  const streetNames = new Set();
  const numbers = new Set();
  for (const [id, district] of districts) {
    exactKeys(district, ['id', 'name'], [], id);
    label(district.name, 80, `${id}.name`);
  }
  for (const [id, street] of streets) {
    exactKeys(street, ['id', 'name', 'districtId', 'path'], [], id);
    label(street.name, 80, `${id}.name`);
    if (!districts.has(street.districtId)) fail(id, 'references an unknown district');
    const name = JSON.stringify([street.districtId, street.name]);
    if (streetNames.has(name)) fail(id, 'reuses a street name within the same district');
    streetNames.add(name);
    list(street.path, 400, `${id}.path`);
    if (street.path.length === 1) fail(id, 'needs at least two surveyed points to show a route');
    for (const [i, point] of street.path.entries()) {
      position(point, `${id}.path[${i}]`);
      const last = street.path[i - 1];
      if (last && last.x === point.x && last.y === point.y && last.z === point.z) {
        fail(id, 'repeats a route point');
      }
    }
  }
  for (const [id, place] of places) {
    exactKeys(place, ['id', 'kind', 'districtId', 'name', 'position'],
      ['number', 'streetId', 'parentId', 'residents', 'activities'], id);
    if (!kinds.has(place.kind) || !districts.has(place.districtId)) fail(id, 'has an unknown place type or district');
    label(place.name, 100, `${id}.name`);
    position(place.position, `${id}.position`);
    if (Object.hasOwn(place, 'streetId') && streets.get(place.streetId)?.districtId !== place.districtId) {
      fail(id, 'references a street outside its district');
    }
    if (Object.hasOwn(place, 'parentId')) {
      const parent = places.get(place.parentId);
      if (!parent || parent.districtId !== place.districtId || !['home', 'building'].includes(parent.kind) || parent.parentId) {
        fail(id, 'requires a top-level building in the same district');
      }
      if (place.streetId && parent.streetId !== place.streetId) fail(id, 'cannot have a different street from its building');
    }
    if (['room', 'dungeon-room'].includes(place.kind) && !place.parentId) fail(id, 'requires a building');
    if (Object.hasOwn(place, 'number')) {
      if (typeof place.number !== 'string' || !addressNumber.test(place.number)) fail(id, 'has an invalid door or room number');
      const scope = JSON.stringify([place.parentId ? 'parent' : place.streetId ? 'street' : 'district',
        place.parentId ?? place.streetId ?? place.districtId, place.number]);
      if (numbers.has(scope)) fail(id, 'duplicates a number in its building or street');
      numbers.add(scope);
    }
    if (Object.hasOwn(place, 'residents')) {
      if (!['home', 'room'].includes(place.kind)) fail(id, 'cannot contain a resident listing');
      list(place.residents, 12, `${id}.residents`);
      for (const [i, resident] of place.residents.entries()) {
        exactKeys(resident, ['name'], ['profession'], `${id}.residents[${i}]`);
        label(resident.name, 40, `${id}.residents[${i}].name`);
        if (Object.hasOwn(resident, 'profession')) label(resident.profession, 40, `${id}.residents[${i}].profession`);
      }
    }
    if (Object.hasOwn(place, 'activities')) {
      list(place.activities, 12, `${id}.activities`);
      for (const [i, activity] of place.activities.entries()) label(activity, 60, `${id}.activities[${i}]`);
    }
  }
  return catalogue;
}

export async function readAincradAddresses(file = aincradAddressesFile) {
  return validateAincradAddresses(JSON.parse(await readFile(file, 'utf8')));
}

export function withNativeResidences(catalogue, residences) {
  list(residences, 128, 'residences');
  const streets = new Map(catalogue.streets.map(street => [street.id, street]));
  const places = new Map(catalogue.places.map(place => {
    const {residents: _, ...survey} = place;
    return [place.id, survey];
  }));
  const published = new Set();
  for (const residence of residences) {
    exactKeys(residence, ['id', 'kind', 'name', 'streetId', 'streetName', 'number', 'position', 'residents'],
      ['parentId'], 'residence');
    const {streetName, ...place} = residence;
    const street = streets.get(place.streetId), previous = places.get(place.id);
    if (!street || street.name !== streetName || !['home', 'room'].includes(place.kind)
        || published.has(place.id) || !Array.isArray(place.residents) || place.residents.length !== 1
        || !['x', 'y', 'z'].every(key => Number.isSafeInteger(place.position?.[key]))
        || (place.kind === 'room') !== Object.hasOwn(place, 'parentId')
        || (previous && !['home', 'room', 'building'].includes(previous.kind))) fail('residence', 'invalid registered address');
    published.add(place.id);
    places.set(place.id, {...place, districtId:street.districtId, ...(previous?.activities ? {activities:previous.activities} : {})});
  }
  return validateAincradAddresses({...catalogue, places:[...places.values()]});
}
