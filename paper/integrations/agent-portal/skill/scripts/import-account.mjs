#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runAgentAccess } from './agent-register.mjs';
import { main as setup, SKILL_ROOT, loadProfile } from './setup.mjs';

export async function importAccount(args) {
  const { values } = parseArgs({ args, options: { 'identity-file': { type: 'string' }, profile: { type: 'string' }, 'skip-install': { type: 'boolean' } } });
  if (!values['identity-file']) throw Error('IDENTITY_FILE_REQUIRED');
  const file = path.resolve(values['identity-file']), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384 || process.platform !== 'win32' && (stat.mode & 0o077)) throw Error('PRIVATE_IDENTITY_REQUIRED');
  let status;
  await runAgentAccess(['status', '--identity-file', file], value => { status = JSON.parse(value); });
  const identity = JSON.parse(await fs.readFile(file, 'utf8'));
  if (status?.state !== 'ready' || status.gameAccountCreated !== true || status.username !== identity.username) throw Error('GAME_ACCOUNT_NOT_READY_QUERY_STATUS');
  const address = /^([A-Za-z0-9._-]+):([0-9]{1,5})$/.exec(status.gameAddress || '');
  if (!address || status.gameVersion !== '1.21.1') throw Error('GAME_ADDRESS_OR_VERSION_UNSUPPORTED');
  const directory = path.resolve(values.profile || path.join(homedir(), '.qiandengji', 'players', identity.username));
  const relative = path.relative(SKILL_ROOT, directory);
  if (!relative || !relative.startsWith('..') && !path.isAbsolute(relative)) throw Error('PRIVATE_PROFILE_OUTSIDE_SKILL_REQUIRED');
  // Keep the original body after a lost local response. Never replace it.
  try {
    const existing = loadProfile(directory);
    if (existing.config.world.username !== identity.username || existing.config.world.host !== address[1] || existing.config.world.port !== Number(address[2])) throw Error('EXISTING_PROFILE_CONFLICT');
    const original = JSON.parse(await fs.readFile(path.join(directory, 'private/invitation-origin.json'), 'utf8'));
    if (original.clientId !== identity.clientId || original.portal !== identity.portal) throw Error('EXISTING_PROFILE_CONFLICT');
    return { profile: directory, mcpConfig: path.join(directory, 'mcp.json'), reused: true, gameConnected: false, modelCalled: false };
  } catch (error) { if (error.code !== 'ENOENT') throw error; try { await fs.access(directory); throw Error('EXISTING_PROFILE_REQUIRES_MANUAL_CHECK'); } catch (present) { if (present.code !== 'ENOENT') throw present; } }
  const privateDirectory = path.dirname(file), passwordFile = path.join(privateDirectory, '.' + randomUUID() + '.secret');
  await fs.writeFile(passwordFile, identity.gamePassword, { flag: 'wx', mode: 0o600 });
  try {
    const result = await setup(['init', '--username', identity.username, '--profile', directory, '--host', address[1], '--port', address[2], '--password-file', passwordFile, ...(values['skip-install'] ? ['--skip-install'] : [])]);
    await fs.writeFile(path.join(directory, 'private/invitation-origin.json'), JSON.stringify({ clientId: identity.clientId, portal: identity.portal }), { flag: 'wx', mode: 0o600 });
    return result;
  } finally { await fs.unlink(passwordFile); identity.gamePassword = undefined; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await importAccount(process.argv.slice(2)))); }
  catch (error) { console.error(JSON.stringify({ error: /^[A-Za-z0-9_]{3,100}$/.test(error.message) ? error.message : 'PRIVATE_IMPORT_FAILED', message: '保留原身份和身体目录；先查询 status，不重新建号。' })); process.exitCode = 1; }
}
