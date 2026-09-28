// spectate-watcher.mjs — B′: auto re-attach camera possession on rejoin (loopback RCON only)
// Usage: node spectate-watcher.mjs [--dry] [--once] [--camera NAME] [--target NAME]
// Stop:  create E:\MC\ops\spectate-watcher.stop  (checked every poll)  — or kill the node process.
import { command } from './rcon-client.mjs';
import fs from 'node:fs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ONCE = args.includes('--once');
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const CAMERA = argVal('--camera', 'CortiEye');
const TARGET = argVal('--target', 'CortiLan');
const POLL_MS = 30000;
const STOP = 'E:/MC/ops/spectate-watcher.stop';
const LOG = 'E:/MC/ops/spectate-watcher.log';
const log = (m) => { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`); } catch {} };

const strip = (s) => String(s).replace(/§[0-9a-fk-or]/gi, '');
async function roster() {
  const out = strip(await command('list', 15000));
  const m = out.match(/：([^\r\n]+)$/m) || out.match(/:\s*([^\r\n]+)$/m);
  if (!m) return null;
  return m[1].split(',').map((x) => x.trim()).filter(Boolean);
}

let camWasOnline = false;
let tgtWasOnline = false;
let retries = 0;

async function attach(reason) {
  if (DRY) { log(`DRY would run: spectate ${TARGET} ${CAMERA} (${reason})`); retries = 0; return; }
  try {
    const resp = strip(await command(`spectate ${TARGET} ${CAMERA}`, 15000));
    if (resp.includes('Now spectating')) { retries = 0; log(`ATTACHED (${reason}): ${resp.trim()}`); }
    else {
      retries++;
      log(`attach unexpected (retry ${retries}, ${reason}): ${resp.trim().slice(0, 120)}`);
      if (retries > 10) { retries = 0; camWasOnline = true; tgtWasOnline = true; log('too many retries; wait for next rejoin'); }
    }
  } catch (e) { retries++; log(`attach error (${reason}): ${e.message}`); }
}

async function tick() {
  if (fs.existsSync(STOP)) { log('stop file present; exiting'); process.exit(0); }
  let names;
  try { names = await roster(); } catch (e) { log(`roster error: ${e.message}`); return; }
  if (!names) { log('roster parse failed; skip tick'); return; }
  const camOn = names.includes(CAMERA);
  const tgtOn = names.includes(TARGET);
  if (ONCE) {
    if (camOn && tgtOn) await attach('once'); else log(`once: camera=${camOn} target=${tgtOn} -> skip`);
    process.exit(0);
  }
  const rejoined = (camOn && !camWasOnline) || (tgtOn && !tgtWasOnline);
  if (camOn && tgtOn && (rejoined || retries > 0)) await attach(rejoined ? 'rejoin' : 'retry');
  camWasOnline = camOn; tgtWasOnline = tgtOn;
  if (!camOn || !tgtOn) retries = 0;
}

if (fs.existsSync(STOP)) { try { fs.unlinkSync(STOP); } catch {} }  // fresh start clears stale stop flag
log(`start camera=${CAMERA} target=${TARGET} poll=${POLL_MS}ms dry=${DRY} once=${ONCE}`);
await tick();
setInterval(tick, POLL_MS);
