import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { trialCapacity } from '../src/trial-capacity.mjs';

export function diagnoseTrialCapacity(database, { details = false, now = Date.now() } = {}) {
  // Do not construct Store/createPortal: their startup performs schema writes
  // and session cleanup. There is intentionally no repair/delete/apply mode.
  const db = new DatabaseSync(path.resolve(database), { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; BEGIN');
    const { clients, ...summary } = trialCapacity(db, now);
    db.exec('COMMIT');
    return { observedAt: new Date(now).toISOString(), ...summary, ...(details ? { clients } : {}) };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: node scripts/trial-capacity.mjs --database /path/to/portal.sqlite [--details]\nRead-only capacity diagnosis. Details include character names/UUIDs; keep the output private. No credentials are emitted.');
  } else if (args[0] !== '--database' || !args[1] || args[1].startsWith('--') || args.length > 3 || args[2] && args[2] !== '--details') {
    console.error('INVALID_ARGUMENTS'); process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(diagnoseTrialCapacity(args[1], { details: args[2] === '--details' }), null, 2)); }
    catch { console.error('CAPACITY_DIAGNOSIS_FAILED: use an existing readable portal database with the Agent access schema; nothing was changed.'); process.exitCode = 1; }
  }
}
