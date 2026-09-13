// Run in the isolated world image: /checks and /skins are read-only mounts.
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const QA_PROBE = 'QDSkinProbe';
export const QA_BODY = 'QDSkinBody';
const DATA = '/app/data';
const pause = ms => new Promise(done => setTimeout(done, ms));
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };
const uuidKey = value => String(value || '').replaceAll('-', '').toLowerCase();
const validUuid = value => /^[0-9a-f]{32}$/.test(uuidKey(value));

export function validateTarget(env) {
  requireCondition(env.SMOKE_EXECUTE === 'qiandengji' && env.SMOKE_PROJECT === 'qiandengji', 'Missing isolated project execution guards');
  requireCondition((env.MC_HOST || 'mc') === 'mc' && Number(env.MC_PORT || 25599) === 25599 &&
    (env.MC_RCON_HOST || 'mc') === 'mc' && Number(env.MC_RCON_PORT || 25575) === 25575 &&
    (env.MC_DATA_DIR || DATA) === DATA, 'Only the isolated Compose mc service and data mount are allowed');
  const timeoutMs = Number(env.SMOKE_TIMEOUT_MS || 90000);
  requireCondition(Number.isInteger(timeoutMs) && timeoutMs >= 30000 && timeoutMs <= 180000, 'Invalid smoke timeout');
  return { host: 'mc', port: 25599, rconPort: 25575, timeoutMs };
}

export function validateCatalog(catalog) {
  requireCondition(catalog?.schema_version === 1 && Array.isArray(catalog.skins) && catalog.skins.length === 2, 'Unexpected signed skin catalog');
  return ['Naruto', 'Kirito'].map(name => {
    const matches = catalog.skins.filter(row => row?.name === name);
    requireCondition(matches.length === 1, 'Catalog must contain exactly one Naruto and one Kirito');
    const row = matches[0];
    requireCondition(typeof row.value === 'string' && typeof row.signature === 'string' &&
      row.value.length <= 16384 && row.signature.length <= 4096 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(row.value) && /^[A-Za-z0-9+/]+={0,2}$/.test(row.signature) &&
      Buffer.from(row.signature, 'base64').length === 512, 'Malformed signed skin property');
    let textureUrl;
    try {
      textureUrl = new URL(JSON.parse(Buffer.from(row.value, 'base64').toString('utf8')).textures.SKIN.url);
    } catch { throw new Error('Invalid skin texture metadata'); }
    requireCondition(['http:', 'https:'].includes(textureUrl.protocol) && textureUrl.host === 'textures.minecraft.net' &&
      /^[0-9a-f]{40,64}$/i.test(row.texture) && textureUrl.pathname === `/texture/${row.texture}` &&
      !textureUrl.search && !textureUrl.hash && !textureUrl.username && !textureUrl.password, 'Unexpected original texture URL');
    return { name, value: row.value, signature: row.signature, textureUrl: textureUrl.href };
  });
}

// Only retain the reserved body's packets. Sequence numbers exclude stale receipts.
export function createProfileRecorder() {
  let sequence = 0;
  const events = [], knownUuids = new Set(), entityUuids = new Map();
  const record = event => {
    events.push({ ...event, sequence: ++sequence });
    if (events.length > 128) events.shift();
  };
  return {
    get sequence() { return sequence; },
    get events() { return events; },
    info(packet) {
      if (!packet.action?.add_player) return;
      for (const entry of packet.data || []) {
        if (entry.player?.name !== QA_BODY || !validUuid(entry.uuid)) continue;
        const uuid = uuidKey(entry.uuid);
        knownUuids.add(uuid);
        record({ kind: 'profile', uuid, name: entry.player.name, properties: entry.player.properties || [] });
      }
    },
    remove(packet) {
      for (const id of packet.players || []) {
        const uuid = uuidKey(id);
        if (knownUuids.has(uuid)) record({ kind: 'remove_profile', uuid });
      }
    },
    spawn(packet) {
      const uuid = uuidKey(packet.objectUUID);
      if (!knownUuids.has(uuid)) return;
      entityUuids.set(packet.entityId, uuid);
      record({ kind: 'spawn', uuid, entityId: packet.entityId });
    },
    destroy(packet) {
      for (const entityId of packet.entityIds || []) {
        const uuid = entityUuids.get(entityId);
        if (!uuid) continue;
        record({ kind: 'destroy', uuid, entityId });
        entityUuids.delete(entityId);
      }
    },
    latestSpawn(id) { return events.findLast(event => event.kind === 'spawn' && event.uuid === uuidKey(id)); },
  };
}

export function refreshEvidence(events, checkpoint, bodyUuid, previousEntityId, skin) {
  const uuid = uuidKey(bodyUuid);
  const fresh = events.filter(event => event.sequence > checkpoint && event.uuid === uuid);
  const profile = fresh.find(event => {
    if (event.kind !== 'profile' || event.name !== QA_BODY) return false;
    const textures = event.properties.filter(property => property.name === 'textures');
    return textures.length === 1 && textures[0].value === skin.value && textures[0].signature === skin.signature;
  });
  if (!profile) return null;
  const removed = fresh.some(event => event.kind === 'remove_profile' && event.sequence < profile.sequence);
  const destroyed = fresh.some(event => event.kind === 'destroy' && event.entityId === previousEntityId);
  const spawned = fresh.find(event => event.kind === 'spawn' && event.sequence > profile.sequence && event.entityId !== previousEntityId);
  return removed && destroyed && spawned ? {
    character: skin.name, textureUrl: skin.textureUrl, valueExactMatch: true, signatureExactMatch: true,
    sameCompanionUuid: true, playerInfoRemovedAndAdded: true, oldEntityRemoved: true, newEntitySpawned: true,
  } : null;
}

function bodyRows(reply) {
  requireCondition(/^count=\d+(?:\r?\n|$)/.test(reply), 'Unexpected Numen list response');
  return reply.split(/\r?\n/).filter(line => line.startsWith(`${QA_BODY}|`)).map(line => {
    const fields = Object.fromEntries(line.split('|').slice(1).map(part => {
      const split = part.indexOf('='); return [part.slice(0, split), part.slice(split + 1)];
    }));
    requireCondition(validUuid(fields.uuid) && validUuid(fields.owner), 'Invalid QA Numen identity');
    return fields;
  });
}

export async function runSmoke(env = process.env) {
  const report = { project: 'qiandengji', startedAt: new Date().toISOString(), ok: false, checks: [], cleanup: {} };
  let bot, rcon, lock, timer, aborted, password = '', skins = [], ownerUuid, bodyUuid;
  let creationAttempted = false, cleaning = false;
  const recorder = createProfileRecorder();
  const secrets = () => [password, ...skins.flatMap(row => [row.value, row.signature])].filter(Boolean);
  const safeError = error => {
    let message = String(error?.message || error);
    for (const secret of secrets()) message = message.replaceAll(secret, '[redacted]');
    return message.replace(/[A-Za-z0-9+/=]{80,}/g, '[redacted]').slice(0, 400);
  };
  const abort = message => { aborted ||= new Error(message); };
  const onSignal = () => abort('Skin smoke interrupted');
  const alive = () => { if (aborted) throw aborted; };
  const check = (name, details = {}) => report.checks.push({ name, ok: true, ...details });
  const command = async text => { alive(); const reply = await rcon.send(text, 7000); alive(); return reply; };
  async function waitFor(condition, label, milliseconds = 15000) {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      alive();
      const result = condition();
      if (result) return result;
      await pause(50);
    }
    throw new Error(`${label} timeout`);
  }
  async function confirmBody() {
    const rows = await readBodyRows();
    requireCondition(rows.length === 1 && uuidKey(rows[0].uuid) === uuidKey(bodyUuid) &&
      uuidKey(rows[0].owner) === uuidKey(ownerUuid), 'The current body does not match this QA creation');
    const status = JSON.parse(await command(`numen_act invoke ${QA_BODY} get_self_status {}`));
    requireCondition(status.name === QA_BODY && Number.isFinite(status.hp) && status.hp > 0, 'The QA body is not a live Numen companion');
  }
  async function readBodyRows(cleanup = false) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const reply = cleanup ? await rcon.send('numen_act list', 5000) : await command('numen_act list');
      try { return bodyRows(reply.trim()); }
      catch {
        // Only retry this read-only query. A skin mutation is never resubmitted.
        (report.readbackAnomalies ||= []).push({ query: 'numen_act list', attempt,
          empty: reply.trim().length === 0, responseBytes: Buffer.byteLength(reply),
          countMarkerPresent: /count=\d+/.test(reply) });
        if (attempt === 3) throw new Error('Numen list remained invalid after bounded read-only retries');
        await pause(150);
      }
    }
  }
  try {
    const target = validateTarget(env);
    requireCondition((await readFile(`${DATA}/.qiandengji-smoke`, 'utf8')).trim() === 'qiandengji', 'Missing isolated data marker');
    lock = await open(`${DATA}/.qiandengji-smoke.lock`, 'wx');
    await lock.writeFile(JSON.stringify({ task: 'character-skins', player: QA_PROBE, body: QA_BODY, at: report.startedAt }));
    timer = setTimeout(() => abort('Skin smoke total timeout'), target.timeoutMs);
    process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
    requireCondition((await stat('/skins/skins.json')).size <= 65536, 'Skin catalog exceeds the bounded read limit');
    skins = validateCatalog(JSON.parse(await readFile('/skins/skins.json', 'utf8')));
    check('original-signed-skin-catalog', { characters: skins.map(skin => skin.name) });
    password = (await readFile(`${DATA}/rcon-secret.txt`, 'utf8')).replace(/^\uFEFF/, '').trim();
    requireCondition(password.length > 0, 'Missing isolated RCON credential');
    const { Rcon } = await import('/app/src/rcon.ts');
    rcon = new Rcon(target.host, target.rconPort, password);
    await rcon.connect(6000);
    requireCondition((await readBodyRows()).length === 0 &&
      !(await command('list')).includes(QA_PROBE), 'Reserved QA identity is already online; refusing to replace it');
    const require = createRequire('/app/package.json');
    bot = require('mineflayer').createBot({ host: target.host, port: target.port, username: QA_PROBE,
      version: '1.21.1', auth: 'offline', hideErrors: true, checkTimeoutInterval: 20000 });
    bot.on('error', () => { if (!cleaning) abort('QA client protocol or network error'); });
    bot.on('kicked', () => { if (!cleaning) abort('QA client was kicked'); });
    bot.on('end', () => { if (!cleaning) abort('QA client disconnected during skin verification'); });
    let spawned = false;
    bot.once('spawn', () => { spawned = true; });
    bot._client.on('player_info', packet => recorder.info(packet));
    bot._client.on('player_remove', packet => recorder.remove(packet));
    bot._client.on('spawn_entity', packet => recorder.spawn(packet));
    bot._client.on('entity_destroy', packet => recorder.destroy(packet));
    await waitFor(() => spawned, 'QA login', 25000);
    ownerUuid = bot.player?.uuid || bot._client?.uuid;
    requireCondition(validUuid(ownerUuid), 'QA login has no valid owner UUID');
    await command(`gamemode creative ${QA_PROBE}`);
    await pause(1200); alive();
    // Owner login restores dormant companions; never adopt an earlier QA body.
    requireCondition((await readBodyRows()).length === 0, 'An earlier QA companion restored on owner login');
    check('probe-login', { player: QA_PROBE });
    creationAttempted = true;
    const summoned = await command(`numen_act summon ${ownerUuid} ${QA_BODY}`);
    const match = summoned.match(new RegExp(`summoned=${QA_BODY}\\|uuid=([0-9a-f-]{36})`, 'i'));
    requireCondition(match && validUuid(match[1]), 'Fresh QA Numen body creation was not confirmed');
    bodyUuid = match[1];
    await confirmBody();
    await command(`gamemode creative ${QA_BODY}`);
    await command(`execute at ${QA_PROBE} run tp ${QA_BODY} ~2 ~ ~`);
    await waitFor(() => recorder.latestSpawn(bodyUuid), 'Initial QA body entity spawn');
    check('fresh-numen-body', { player: QA_BODY, identityConfirmed: true });
    for (const skin of skins) {
      await confirmBody();
      const previous = recorder.latestSpawn(bodyUuid);
      requireCondition(previous, 'Missing initial body instance');
      const checkpoint = recorder.sequence;
      // Quote Brigadier string arguments; never log or return this command.
      const reply = await command(`numen_act skin ${QA_BODY} ${JSON.stringify(skin.value)} ${JSON.stringify(skin.signature)}`);
      requireCondition(reply.includes(`skin set for ${QA_BODY}|body_refreshed`), 'Skin command did not confirm a live body refresh');
      const evidence = await waitFor(() => refreshEvidence(recorder.events, checkpoint, bodyUuid, previous.entityId, skin),
        `${skin.name} signed profile and entity refresh`);
      check('signed-skin-protocol', evidence);
      await confirmBody();
      check('refreshed-numen-body', { character: skin.name, identityConfirmed: true });
    }
    alive();
    report.ok = true;
  } catch (error) {
    report.error = safeError(error);
    report.packetDiagnostics = {
      qaProfilePackets: recorder.events.filter(event => event.kind === 'profile').length,
      qaRemovePackets: recorder.events.filter(event => event.kind === 'remove_profile').length,
      qaSpawnPackets: recorder.events.filter(event => event.kind === 'spawn').length,
      qaDestroyPackets: recorder.events.filter(event => event.kind === 'destroy').length,
    };
  } finally {
    cleaning = true;
    clearTimeout(timer);
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    const cleanupError = error => { report.ok = false; (report.cleanup.errors ||= []).push(safeError(error)); };
    if (creationAttempted) {
      try {
        requireCondition(rcon && validUuid(ownerUuid), 'Cannot verify ownership for body cleanup');
        if (!rcon.isConnected()) await rcon.connect(3000);
        const rows = await readBodyRows(true);
        requireCondition(rows.length === 1 && uuidKey(rows[0].owner) === uuidKey(ownerUuid) &&
          (!bodyUuid || uuidKey(rows[0].uuid) === uuidKey(bodyUuid)), 'Body cleanup cannot safely identify this QA creation');
        const reply = await rcon.send(`numen_act dismiss ${QA_BODY}`, 5000);
        requireCondition(reply.includes(`dismissed=${QA_BODY}`), 'QA body dismissal was not acknowledged');
        requireCondition((await readBodyRows(true)).length === 0 &&
          !(await rcon.send('list', 5000)).includes(QA_BODY), 'QA body remains online after dismissal');
        report.cleanup.bodyDismissed = true;
      } catch (error) { report.cleanup.bodyDismissed = false; cleanupError(error); }
    }
    if (bot) {
      try {
        bot.quit('Character skin protocol verification complete'); await pause(200); bot._client?.end();
        requireCondition(rcon, 'Missing RCON for QA logout verification');
        if (!rcon.isConnected()) await rcon.connect(3000);
        let present = true;
        for (let i = 0; i < 8 && present; i++) {
          present = (await rcon.send('list', 3000)).includes(QA_PROBE);
          if (present) await pause(200);
        }
        requireCondition(!present, 'QA probe logout was not confirmed');
        report.cleanup.probeDisconnected = true;
      } catch (error) { report.cleanup.probeDisconnected = false; cleanupError(error); }
    }
    rcon?.close();
    if (lock) {
      try { await lock.close(); await unlink(`${DATA}/.qiandengji-smoke.lock`); report.cleanup.lockReleased = true; }
      catch (error) { report.cleanup.lockReleased = false; cleanupError(error); }
    }
    report.finishedAt = new Date().toISOString();
    report.scope = 'Actual Numen body refresh and Minecraft player_info signed texture equality, followed by replacement entity spawn. No visual-render or signature-cryptography claim; existing Naruto/Kirito identities untouched.';
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Third-party protocol diagnostics can contain packet bodies. Fail through the
  // explicit client error handlers and return only the redacted structured report.
  const diagnostics = { logs: 0, warnings: 0, errors: 0 };
  console.log = () => { diagnostics.logs++; };
  console.warn = () => { diagnostics.warnings++; };
  console.error = () => { diagnostics.errors++; };
  const report = await runSmoke();
  if (Object.values(diagnostics).some(Boolean)) report.libraryDiagnostics = diagnostics;
  if (diagnostics.warnings || diagnostics.errors) {
    report.ok = false;
    report.error ||= 'Unexpected library warning/error; packet details withheld to protect signed properties';
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.ok ? 0 : 1;
}
