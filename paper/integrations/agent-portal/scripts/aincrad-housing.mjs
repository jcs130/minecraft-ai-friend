import {open, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {parseArgs} from 'node:util';
import {readAincradAddresses} from '../src/aincrad-addresses.mjs';
import {AincradResidenceStore} from '../src/aincrad-residence-store.mjs';

const usage = `node scripts/aincrad-housing.mjs assign --db <private.sqlite> --request <private.json> [--catalogue <public.json>]
node scripts/aincrad-housing.mjs export --db <private.sqlite> --out <new-public.json> [--catalogue <public.json>]`;

async function run() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    db: {type: 'string'}, request: {type: 'string'}, catalogue: {type: 'string'},
    out: {type: 'string'}, help: {type: 'boolean'},
  }});
  if (values.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const [command] = positionals;
  if (!values.db || values.db === ':memory:' || positionals.length !== 1
      || (command === 'assign' ? !values.request || values.out !== undefined
        : command !== 'export' || !values.out || values.request !== undefined)) {
    throw new Error(usage);
  }
  const dbPath = path.resolve(values.db);
  const catalogue = await readAincradAddresses(values.catalogue && path.resolve(values.catalogue));
  let request;
  if (command === 'assign') {
    request = JSON.parse(await readFile(path.resolve(values.request), 'utf8'));
    const keys = ['characterId', 'homeId', 'resident'];
    if (!request || typeof request !== 'object' || Array.isArray(request)
        || Object.keys(request).length !== keys.length || !keys.every(key => Object.hasOwn(request, key))) {
      throw new Error('AINCRAD_ASSIGNMENT_REQUEST_INVALID');
    }
    const file = await open(dbPath, 'a', 0o600);
    await file.close();
  }
  const db = new DatabaseSync(dbPath, {readOnly: command === 'export'});
  try {
    db.exec('PRAGMA busy_timeout=3000');
    const store = new AincradResidenceStore(db, catalogue);
    if (command === 'assign') {
      const result = store.assign(request.characterId, request.homeId, request.resident);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      const contents = `${JSON.stringify(store.publicCatalogue(), null, 2)}\n`;
      await writeFile(path.resolve(values.out), contents, {flag: 'wx'});
    }
  } finally {
    db.close();
  }
}

run().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
