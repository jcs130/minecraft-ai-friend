// Register an offline-mode Java Agent by exact username, without granting OP.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [action, name] = process.argv.slice(2);
if (!['add', 'remove'].includes(action) || !/^[A-Za-z0-9_]{3,16}$/.test(name ?? '')) {
  throw new Error('Usage: node register-lan-agent.mjs <add|remove> <JavaName3to16>');
}
const serverDir = 'E:/MC/server';
const opsDir = 'E:/MC/ops';
const whitelistPath = `${serverDir}/whitelist.json`;
const properties = readFileSync(`${serverDir}/server.properties`, 'utf8');
if (!/^online-mode=false\r?$/m.test(properties) || !/^white-list=true\r?$/m.test(properties) ||
    !/^server-ip=127\.0\.0\.1\r?$/m.test(properties)) {
  throw new Error('Server auth/bind settings differ from the audited LAN Agent setup');
}
const ops = JSON.parse(readFileSync(`${serverDir}/ops.json`, 'utf8'));
if (ops.some(entry => entry.name.toLowerCase() === name.toLowerCase())) {
  throw new Error('Reserved OP name; do not manage it through Agent registration');
}
const uuidBytes = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x30;
uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
const hex = uuidBytes.toString('hex');
const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
const command = text => execFileSync(process.execPath, ['E:/MC/probe/rcon.mjs', text], { timeout: 12_000, encoding: 'utf8' });
command('list'); // Check Paper/RCON before editing.
const original = readFileSync(whitelistPath, 'utf8');
const entries = JSON.parse(original);
const exact = entries.find(entry => entry.name === name);
const collision = entries.find(entry => entry.name.toLowerCase() === name.toLowerCase() && entry.name !== name);
if (collision) throw new Error(`Name differs only by case from ${collision.name}`);
if (action === 'add' && exact) {
  if (exact.uuid !== uuid) throw new Error(`Existing UUID for ${name} differs from offline UUID`);
  console.log(`${name} already registered: ${uuid}`);
  process.exit(0);
}
if (action === 'remove' && !exact) {
  console.log(`${name} is not registered`);
  process.exit(0);
}
const updated = action === 'add'
  ? [...entries, { uuid, name }]
  : entries.filter(entry => entry.name !== name);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${opsDir}/whitelist.before-agent-${stamp}.json`;
copyFileSync(whitelistPath, backup);
try {
  writeFileSync(whitelistPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  const response = command('whitelist reload');
  if (!response.includes('Reloaded the whitelist')) throw new Error(`Unexpected reload response: ${response}`);
  const current = JSON.parse(readFileSync(whitelistPath, 'utf8'));
  if (current.some(entry => entry.name === name && entry.uuid === uuid) !== (action === 'add')) {
    throw new Error('Whitelist verification failed after reload');
  }
  console.log(`${action === 'add' ? 'Registered' : 'Removed'} ${name} (${uuid}); no OP granted. Backup: ${backup}`);
} catch (error) {
  writeFileSync(whitelistPath, original, 'utf8');
  try { command('whitelist reload'); } catch {}
  throw error;
}
