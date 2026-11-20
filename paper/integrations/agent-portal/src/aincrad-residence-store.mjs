import {validateAincradAddresses} from './aincrad-addresses.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const visibleLabel = value => typeof value === 'string' && value.length > 0 && value.length <= 40
  && value.trim() === value && !/[\p{C}\p{Zl}\p{Zp}]/u.test(value);

function conflict(code) {
  throw Object.assign(new Error(code), {code});
}

function residentFields(resident) {
  if (!resident || typeof resident !== 'object' || Array.isArray(resident)
      || Object.keys(resident).some(key => key !== 'name' && key !== 'profession')
      || !Object.hasOwn(resident, 'name') || !visibleLabel(resident.name)
      || (Object.hasOwn(resident, 'profession') && !visibleLabel(resident.profession))) {
    conflict('AINCRAD_RESIDENT_LABELS_INVALID');
  }
  return {name: resident.name, profession: Object.hasOwn(resident, 'profession') ? resident.profession : null};
}

/** Operator-only assignments to the vetted catalogue. Bodies may change independently. */
export class AincradResidenceStore {
  #db;
  #catalogue;
  #places;

  constructor(db, catalogue) {
    this.#db = db;
    this.#catalogue = structuredClone(validateAincradAddresses(catalogue));
    this.#places = new Map(this.#catalogue.places.map(place => [place.id, place]));
    db.exec(`CREATE TABLE IF NOT EXISTS aincrad_residence_assignments (
      character_id TEXT PRIMARY KEY NOT NULL,
      home_id TEXT UNIQUE NOT NULL,
      public_name TEXT NOT NULL,
      public_profession TEXT
    ) STRICT`);
  }

  #isResidence(place) {
    return place?.kind === 'home' || (place?.kind === 'room' && this.#places.get(place.parentId)?.kind === 'home');
  }

  assign(characterId, homeId, resident) {
    if (typeof characterId !== 'string' || !uuid.test(characterId)) conflict('AINCRAD_CHARACTER_ID_INVALID');
    const place = this.#places.get(homeId);
    if (!this.#isResidence(place)) conflict('AINCRAD_ADDRESS_NOT_RESIDENTIAL');
    if (place.residents?.length) conflict('AINCRAD_STATIC_OCCUPANCY');
    const {name, profession} = residentFields(resident);

    const db = this.#db;
    const id = characterId.toLowerCase();
    db.exec('BEGIN IMMEDIATE');
    try {
      const assigned = db.prepare(`SELECT home_id,public_name,public_profession
        FROM aincrad_residence_assignments WHERE character_id=?`).get(id);
      if (assigned) {
        if (assigned.home_id !== homeId) conflict('AINCRAD_CHARACTER_ALREADY_HOUSED');
        if (assigned.public_name !== name || assigned.public_profession !== profession) {
          conflict('AINCRAD_RESIDENCE_DETAILS_CHANGED');
        }
      } else {
        if (db.prepare('SELECT 1 FROM aincrad_residence_assignments WHERE home_id=?').get(homeId)) {
          conflict('AINCRAD_ADDRESS_ALREADY_OCCUPIED');
        }
        db.prepare(`INSERT INTO aincrad_residence_assignments (character_id,home_id,public_name,public_profession)
          VALUES (?,?,?,?)`).run(id, homeId, name, profession);
      }
      db.exec('COMMIT');
      return {homeId, created: !assigned};
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  publicCatalogue() {
    const occupants = new Map(this.#db.prepare(`SELECT home_id, public_name, public_profession
      FROM aincrad_residence_assignments`).all().map(row => [row.home_id, row]));
    const output = structuredClone(this.#catalogue);
    for (const place of output.places) {
      const occupant = occupants.get(place.id);
      if (!occupant || !this.#isResidence(place) || place.residents?.length) continue;
      const resident = {name: occupant.public_name};
      if (occupant.public_profession !== null) resident.profession = occupant.public_profession;
      place.residents = [resident];
    }
    return validateAincradAddresses(output);
  }
}
