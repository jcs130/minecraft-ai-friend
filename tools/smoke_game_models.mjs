// Reserved two-body YSM scene; run only after the real observer is connected.
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCatalog, validateTarget } from './smoke_character_skins.mjs';

const DATA = '/app/data';
const OBSERVER = 'QiandengTest';
const BODIES = [
  { name: 'QDModelNaruto', character: 'Naruto', model: 'qiandengji_naruto', side: -1.7 },
  { name: 'QDModelKirito', character: 'Kirito', model: 'qiandengji_kirito', side: 1.7 },
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const demand = (value, message) => { if (!value) throw new Error(message); };
const uuidKey = value => String(value || '').replaceAll('-', '').toLowerCase();
const validUuid = value => /^[0-9a-f]{32}$/.test(uuidKey(value));

export function parseRegistry(reply) {
  demand(/^count=\d+(?:\r?\n|$)/.test(reply.trim()), 'Unexpected Numen list receipt');
  return reply.trim().split(/\r?\n/).slice(1).filter(Boolean).map(line => {
    const [name, ...fields] = line.split('|');
    return { name, ...Object.fromEntries(fields.map(field => {
      const split = field.indexOf('='); return [field.slice(0, split), field.slice(split + 1)];
    })) };
  });
}

export function parseIntArrayUuid(reply) {
  const match = reply.match(/\[I;\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/);
  demand(match, 'Observer UUID is not a four-int NBT array');
  const hex = match.slice(1).map(value => (Number(value) >>> 0).toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function exactPlayer(uuid) {
  demand(validUuid(uuid), 'Invalid exact player UUID');
  const hex = uuidKey(uuid);
  const parts = [0, 8, 16, 24].map(offset => Number.parseInt(hex.slice(offset, offset + 8), 16) | 0);
  return `@a[nbt={UUID:[I;${parts.join(',')}]}]`;
}

export function modelEvidence(reply, expected) {
  const found = reply.match(/(?:^|[,{]\s*)model_id:\s*"([a-z0-9_/-]+)"/);
  demand(found && found[1] === expected, 'YSM attachment did not contain the exact model ID');
  const texture = reply.match(/(?:^|[,{]\s*)select_texture:\s*"([a-z0-9_./-]+)"/);
  demand(texture && texture[1] !== '-', 'YSM did not resolve its default texture');
  demand(/disabled:\s*0b/.test(reply), 'YSM model was disabled');
  return { modelId: found[1], textureId: texture[1], enabled: true };
}

export function vectorEvidence(reply, length) {
  const match = reply.match(/\[([^\]]+)\]\s*$/);
  demand(match, 'Missing entity vector');
  const values = match[1].split(',').map(x => Number(x.trim().replace(/[df]$/i, '')));
  demand(values.length === length && values.every(Number.isFinite), 'Invalid entity vector');
  return values;
}

export async function runSmoke(env = process.env) {
  const report = { project: 'qiandengji', startedAt: new Date().toISOString(), ok: false, checks: [], cleanup: {} };
  let lock, rcon, timer, aborted, password = '', skins = [], ownerUuid, observerBefore;
  let observerMoved = false;
  const attempted = [];
  const signal = () => { aborted ||= new Error('Model scene interrupted'); };
  const alive = () => { if (aborted) throw aborted; };
  const safe = error => {
    let text = String(error?.message || error);
    for (const secret of [password, ...skins.flatMap(s => [s.value, s.signature])].filter(Boolean)) text = text.replaceAll(secret, '[redacted]');
    return text.replace(/[A-Za-z0-9+/=]{80,}/g, '[redacted]').slice(0, 400);
  };
  const check = (name, details) => report.checks.push({ name, ok: true, ...details });
  const command = async text => { alive(); const result = await rcon.send(text, 7000); alive(); return result; };
  async function readValidated(text, parse, label) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const reply = await command(text);
      try { return parse(reply); }
      catch (error) {
        (report.readbackAnomalies ||= []).push({ query: label, attempt, bytes: Buffer.byteLength(reply) });
        if (attempt === 3) throw error;
        await pause(150);
      }
    }
  }
  async function registry(cleanup = false) {
    for (let i = 0; i < 3; i++) {
      const response = cleanup ? await rcon.send('numen_act list', 5000) : await command('numen_act list');
      try { return parseRegistry(response); }
      catch {
        (report.readbackAnomalies ||= []).push({ query: 'numen_act list', attempt: i + 1, bytes: Buffer.byteLength(response) });
        if (i === 2) throw new Error('Numen list remained invalid after bounded read-only retries');
        await pause(150);
      }
    }
  }
  async function identity(body) {
    const rows = (await registry()).filter(row => row.name === body.name);
    demand(rows.length === 1 && uuidKey(rows[0].uuid) === uuidKey(body.uuid) &&
      uuidKey(rows[0].owner) === uuidKey(ownerUuid), 'QA Numen UUID/owner mismatch');
    await readValidated(`numen_act invoke ${body.name} get_self_status {}`, reply => {
      const status = JSON.parse(reply);
      demand(status.name === body.name && status.hp > 0, 'QA Numen body is not alive');
      return status;
    }, 'QA get_self_status');
  }
  async function attachment(body) {
    return readValidated(`data get entity ${body.uuid} "neoforge:attachments"."yes_steve_model:model_id"`,
      reply => modelEvidence(reply, body.model), 'QA YSM attachment');
  }
  try {
    const target = validateTarget(env);
    demand((await readFile(`${DATA}/.qiandengji-smoke`, 'utf8')).trim() === 'qiandengji', 'Missing isolated data marker');
    const hold = Number(env.SMOKE_SCENE_HOLD_MS || 90000);
    demand(Number.isInteger(hold) && hold >= 0 && hold <= 540000, 'Invalid bounded scene hold');
    lock = await open(`${DATA}/.qiandengji-smoke.lock`, 'wx');
    await lock.writeFile(JSON.stringify({ task: 'game-models', observer: OBSERVER, at: report.startedAt }));
    try { await stat(`${DATA}/.qiandengji-model-scene-release`); throw new Error('Stale model scene release marker; refusing to start'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    timer = setTimeout(() => { aborted ||= new Error('Model scene total timeout'); }, Math.max(target.timeoutMs, hold + 60000));
    process.once('SIGINT', signal); process.once('SIGTERM', signal);
    password = (await readFile(`${DATA}/rcon-secret.txt`, 'utf8')).replace(/^\uFEFF/, '').trim();
    demand(password.length > 0, 'Missing isolated RCON credential');
    const { Rcon } = await import('/app/src/rcon.ts');
    rcon = new Rcon('mc', 25575, password); await rcon.connect(6000);
    demand((await command('list')).includes(OBSERVER), 'Real NeoForge observer is not connected');
    ownerUuid = parseIntArrayUuid(await command(`data get entity ${OBSERVER} UUID`));
    demand(validUuid(ownerUuid), 'Invalid observer owner UUID');
    const existing = await registry();
    demand(!existing.some(row => BODIES.some(body => body.name === row.name)), 'Reserved model QA body already exists');
    report.originalCompanions = existing.filter(row => row.name === 'Naruto' || row.name === 'Kirito')
      .map(({ name, uuid, owner }) => ({ name, uuid, owner }));
    demand((await stat('/skins/skins.json')).size <= 65536, 'Skin catalog is too large');
    skins = validateCatalog(JSON.parse(await readFile('/skins/skins.json', 'utf8')));
    check('observer-and-unique-QA-identities', { observer: OBSERVER });
    const origin = await readValidated(`data get entity ${OBSERVER} Pos`, s => vectorEvidence(s, 3), 'observer Pos');
    const rotation = await readValidated(`data get entity ${OBSERVER} Rotation`, s => vectorEvidence(s, 2), 'observer Rotation');
    const modeText = await command(`data get entity ${OBSERVER} playerGameType`);
    const mode = Number(modeText.trim().match(/: ([0-3])$/)?.[1]);
    demand(Number.isInteger(mode), 'Cannot record original observer game mode');
    observerBefore = { pos: origin, rotation, mode };
    report.observerBefore = observerBefore;
    // A common floor height did not guarantee line of sight in the first visual
    // attempt. Use the verified correction: a nearby open-air corridor, flying
    // bodies, and every voxel between the observer and bodies confirmed as air.
    let scenePosition = null;
    const conditions = [];
    for (let x = -2; x <= 2; x++) for (let z = 0; z <= 6; z++) for (let y = 0; y <= 3; y++) {
      conditions.push(`if block ~${x} ~${y} ~${z} minecraft:air`);
    }
    for (let lift = 32; lift <= 96; lift += 16) {
      const x = Math.floor(origin[0]) + .5, y = Math.ceil(origin[1] + lift), z = Math.floor(origin[2] + 12) + .5;
      if (y > 312) break;
      const reply = await command(`execute positioned ${x} ${y} ${z} ${conditions.join(' ')} run tp ${OBSERVER} ~ ~ ~ 0 0`);
      if (!reply.includes('Teleported')) continue;
      observerMoved = true;
      const pos = await readValidated(`data get entity ${OBSERVER} Pos`, s => vectorEvidence(s, 3), 'observer open-air Pos');
      if (pos.every((value, index) => Math.abs(value - [x, y, z][index]) < .1)) { scenePosition = pos; break; }
    }
    demand(scenePosition, 'No clear air corridor found above the nearby loaded QA area');
    // Spectator -> creative preserves the flying ability without a timed command
    // that could later revoke the observer's original spectator flight.
    await command(`gamemode spectator ${OBSERVER}`);
    await command(`gamemode creative ${OBSERVER}`);
    report.scenePosition = scenePosition;
    report.airCorridorVoxelsChecked = conditions.length;
    for (const definition of BODIES) {
      const body = { ...definition }; attempted.push(body);
      const response = await command(`numen_act summon ${ownerUuid} ${body.name}`);
      const match = response.match(new RegExp(`summoned=${body.name}\\|uuid=([0-9a-f-]{36})`, 'i'));
      demand(match && validUuid(match[1]), 'Fresh body creation was not confirmed'); body.uuid = match[1];
      await identity(body);
      await command(`gamemode creative ${exactPlayer(body.uuid)}`);
      const selected = await command(`ysm model set ${exactPlayer(body.uuid)} ${JSON.stringify(body.model)} -`);
      demand(selected.includes(body.model) && selected.includes(body.name) && !/not exist|need.*auth|不存在|需要.*授权/i.test(selected),
        `YSM set did not confirm ${body.model}: ${selected.slice(0, 180)}`);
      check('YSM-UUID-target-binding', { character: body.character, target: body.name, ...await attachment(body) });
      const skin = skins.find(row => row.name === body.character);
      const refresh = await command(`numen_act skin ${body.name} ${JSON.stringify(skin.value)} ${JSON.stringify(skin.signature)}`);
      demand(refresh.includes(`skin set for ${body.name}|body_refreshed`), 'QA skin refresh was not confirmed');
      await identity(body);
      check('YSM-survives-Numen-save-load-refresh', { character: body.character, sameUuid: true, ...await attachment(body) });
      await command(`gamemode creative ${exactPlayer(body.uuid)}`);
      await command(`effect clear ${body.uuid} minecraft:invisibility`);
      await command(`fly ${body.name} 600`);
      // Use local coordinates in front of the observer, preserving their current chunk.
      await command(`execute at ${OBSERVER} rotated ~ 0 run tp ${body.uuid} ^${body.side} ^ ^6`);
      await command(`execute as ${body.uuid} at @s run tp @s ~ ~ ~ facing entity ${OBSERVER} eyes`);
      const modeReceipt = await command(`data get entity ${body.uuid} playerGameType`);
      demand(/: 1\s*$/.test(modeReceipt), 'QA body is not in creative mode');
      const abilities = await command(`data get entity ${body.uuid} abilities`);
      demand(/flying:\s*1b/.test(abilities), 'QA body flight was not enabled');
      body.pos = await readValidated(`data get entity ${body.uuid} Pos`, s => vectorEvidence(s, 3), 'QA Pos');
      report.scene ||= []; report.scene.push({ target: body.name, uuid: body.uuid, character: body.character, modelId: body.model });
    }
    report.sceneReadyAt = new Date().toISOString();
    process.stdout.write(JSON.stringify({ event: 'model-scene-ready', scene: report.scene, holdMs: hold }) + '\n');
    const deadline = Date.now() + hold;
    while (Date.now() < deadline) {
      alive();
      demand((await command('list')).includes(OBSERVER), 'Observer disconnected before scene verification finished');
      try { await stat(`${DATA}/.qiandengji-model-scene-release`); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await pause(10000);
    }
    for (const body of attempted) { await identity(body); await attachment(body); }
    check('scene-bodies-still-alive-and-bound', { count: attempted.length });
    report.ok = true;
  } catch (error) { report.error = safe(error); }
  finally {
    clearTimeout(timer); process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal);
    const cleanupError = error => { report.ok = false; (report.cleanup.errors ||= []).push(safe(error)); };
    for (const body of attempted.reverse()) {
      try {
        if (!rcon.isConnected()) await rcon.connect(3000);
        const rows = (await registry(true)).filter(row => row.name === body.name);
        demand(rows.length === 1 && uuidKey(rows[0].owner) === uuidKey(ownerUuid) &&
          (!body.uuid || uuidKey(rows[0].uuid) === uuidKey(body.uuid)), 'Cannot safely identify this QA body for cleanup');
        await rcon.send(`fly off ${body.name}`, 5000);
        demand((await rcon.send(`numen_act dismiss ${body.name}`, 5000)).includes(`dismissed=${body.name}`), 'Dismiss receipt missing');
        demand(!(await registry(true)).some(row => row.name === body.name), 'QA body remained after dismiss');
        report.cleanup[body.name] = true;
      } catch (error) { report.cleanup[body.name] = false; cleanupError(error); }
    }
    if (observerMoved && observerBefore) {
      try {
        if (!rcon.isConnected()) await rcon.connect(3000);
        await rcon.send(`gamemode ${['survival', 'creative', 'adventure', 'spectator'][observerBefore.mode]} ${OBSERVER}`, 5000);
        await rcon.send(`tp ${OBSERVER} ${observerBefore.pos.join(' ')} ${observerBefore.rotation.join(' ')}`, 5000);
        report.cleanup.observerRestored = true;
      } catch (error) { report.cleanup.observerRestored = false; cleanupError(error); }
    }
    rcon?.close();
    if (lock) {
      try {
        await lock.close(); await unlink(`${DATA}/.qiandengji-smoke.lock`);
        try { await unlink(`${DATA}/.qiandengji-model-scene-release`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        report.cleanup.lockReleased = true;
      } catch (error) { report.cleanup.lockReleased = false; cleanupError(error); }
    }
    report.finishedAt = new Date().toISOString();
    report.scope = 'Actual YSM command, UUID target, Numen attachment and persistence round-trip. Rendering is verified separately by the real NeoForge client screenshots. Original character identities untouched.';
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const diagnostics = { logs: 0, warnings: 0, errors: 0 };
  console.log = () => diagnostics.logs++; console.warn = () => diagnostics.warnings++; console.error = () => diagnostics.errors++;
  const report = await runSmoke();
  if (Object.values(diagnostics).some(Boolean)) report.libraryDiagnostics = diagnostics;
  if (diagnostics.warnings || diagnostics.errors) { report.ok = false; report.error ||= 'Unexpected library diagnostic'; }
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exitCode = report.ok ? 0 : 1;
}
