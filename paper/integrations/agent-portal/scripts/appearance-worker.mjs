#!/usr/bin/env node
// Outbound HTTPS only. Typed appearance requests never become remote shell or
// arbitrary console commands. A durable journal precedes every game mutation.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { pngInfo, ysmArchive, modelSourceHash } from '../src/appearance-files.mjs';
import { portalOrigin } from '../public/agent-register.mjs';

const uuid = /^[a-f0-9-]{36}$/, sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function json(file) { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
async function save(file, value) { const temp = file + '.' + randomUUID() + '.tmp'; await fs.writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await fs.rename(temp, file); }
export function identifier(job) { return job.kind === 'skin' ? `web_${job.sha256.slice(0, 20)}_${job.variant}` : `qd_${job.playerUuid.replaceAll('-', '').slice(0, 12)}_${job.sha256.slice(0, 12)}`; }
function validJob(job) {
  return uuid.test(job.id || '') && uuid.test(job.playerUuid || '') && /^ag_[A-Za-z0-9_]{1,13}$/.test(job.username || '') && !/eye$/i.test(job.username) && /^[a-f0-9]{64}$/.test(job.sha256 || '') &&
    ['skin', 'ysm'].includes(job.kind) && (job.kind === 'skin' ? ['classic', 'slim'].includes(job.variant) : /^[A-Za-z0-9_.-]{1,96}$/.test(job.texture || ''));
}
async function existingModel(root, sourceHash) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9_.-]{1,96}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name), files = new Map(); let size = 0;
    const walk = async (folder, depth = 0) => {
      if (depth > 8) throw Error('YSM_EXISTING_BUDGET');
      for (const child of await fs.readdir(folder, { withFileTypes: true })) {
        if (child.isSymbolicLink()) throw Error('YSM_EXISTING_LINK');
        const file = path.join(folder, child.name);
        if (child.isDirectory()) await walk(file, depth + 1);
        else if (child.isFile()) { if (files.size >= 128 || (size += (await fs.stat(file)).size) > 8 * 1024 * 1024) throw Error('YSM_EXISTING_BUDGET'); files.set(path.relative(directory, file).replaceAll('\\', '/'), await fs.readFile(file)); }
      }
    };
    try { const definition = await json(path.join(directory, 'ysm.json')); if (definition.spec !== 2 || definition.properties?.free !== true) continue; await walk(directory); if (modelSourceHash(files) === sourceHash) return entry.name; } catch { /* An unrelated unavailable model is not reused. */ }
  }
  return null;
}
export async function ysmControl(configFile, command) {
  const config = await json(configFile);
  // The local supervisor separately enforces its own command allowlist.
  return new Promise((resolve, reject) => {
    const socket = net.connect(config.controlPort, '127.0.0.1'); let body = '';
    socket.setTimeout(5000, () => socket.destroy(Error('YSM_CONTROL_TIMEOUT')));
    socket.once('connect', () => socket.write(JSON.stringify({ action: 'console', service: 'proxy', command, token: config.controlToken }) + '\n'));
    socket.on('data', bytes => { body += bytes; if (body.length > 4096) socket.destroy(Error('YSM_CONTROL_REPLY')); });
    socket.once('error', reject); socket.once('end', () => { try { const result = JSON.parse(body); if (result.accepted !== true) throw Error('YSM_CONTROL_UNAVAILABLE'); resolve(result); } catch { reject(Error('YSM_CONTROL_UNAVAILABLE')); } });
  });
}
export class AppearanceWorker {
  constructor(config, dependencies = {}) { Object.assign(this, { config, dependencies }); this.origin = portalOrigin(config.endpoint); }
  async initialize() {
    for (const key of ['journalDirectory', 'serverDir', 'modelRoot', 'appearanceStateFile', 'ysmServicesConfig', 'rconClientModule', 'tokenFile']) if (!path.isAbsolute(this.config[key] || '')) throw Error('ABSOLUTE_OPERATOR_PATHS_REQUIRED');
    if (path.basename(this.config.modelRoot) !== 'custom') throw Error('YSM_CUSTOM_ROOT_REQUIRED');
    await fs.mkdir(this.config.journalDirectory, { recursive: true, mode: 0o700 });
    this.root = await fs.realpath(this.config.journalDirectory); this.modelRoot = await fs.realpath(this.config.modelRoot);
    if (path.parse(this.root).root !== path.parse(this.modelRoot).root) throw Error('YSM_JOURNAL_SAME_VOLUME_REQUIRED');
    if ((await fs.lstat(this.config.journalDirectory)).isSymbolicLink() || (await fs.lstat(this.config.modelRoot)).isSymbolicLink()) throw Error('APPEARANCE_SYMLINK_REJECTED');
    this.command = this.dependencies.command || (await import(pathToFileURL(this.config.rconClientModule))).command;
    this.control = this.dependencies.control || (text => ysmControl(this.config.ysmServicesConfig, text));
    return this;
  }
  result(job, state, reason, message, extra = {}) { return { id: job.id, playerUuid: job.playerUuid, sha256: job.sha256, state, reason, message, ...extra }; }
  async online(job) {
    // Verify the actual live entity UUID, not an offline name-to-UUID guess.
    const text = await this.command(`minecraft:data get entity ${job.username} UUID`, 5000, { properties: path.join(this.config.serverDir, 'server.properties'), port: this.config.rconPort || 25575 });
    const values = /\[I;\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\s*\]/.exec(text);
    if (!values) return false;
    const bytes = Buffer.alloc(16); for (let i = 0; i < 4; i++) bytes.writeInt32BE(Number(values[i + 1]), i * 4);
    return bytes.toString('hex') === job.playerUuid.replaceAll('-', '').toLowerCase();
  }
  async process(job) {
    if (!validJob(job)) throw Error('INVALID_APPEARANCE_JOB');
    const directory = path.join(this.root, job.id); await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    if (await fs.realpath(directory) !== directory || (await fs.lstat(directory)).isSymbolicLink()) throw Error('APPEARANCE_SYMLINK_REJECTED');
    const journalFile = path.join(directory, 'journal.json'); let journal;
    try { journal = await json(journalFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!journal) {
      if (job.reconciliationOnly) return this.result(job, 'unknown', 'LOCAL_JOURNAL_MISSING', '请求曾送达，但本机缺少原记录；未重复执行，请服主核对。');
      if (typeof job.base64 !== 'string' || job.base64.length > 12 * 1024 * 1024) throw Error('APPEARANCE_ASSET_MISSING');
      const bytes = Buffer.from(job.base64, 'base64');
      if (sha(bytes) !== job.sha256) throw Error('APPEARANCE_HASH_MISMATCH');
      if (job.kind === 'skin') pngInfo(bytes, true); else if (!ysmArchive(bytes).textures.some(row => row.name === job.texture)) throw Error('YSM_TEXTURE_UNKNOWN');
      await fs.writeFile(path.join(directory, 'asset.' + (job.kind === 'skin' ? 'png' : 'zip')), bytes, { flag: 'wx', mode: 0o600 });
      journal = { schemaVersion: 1, job: { id: job.id, playerUuid: job.playerUuid, username: job.username, kind: job.kind, sha256: job.sha256, variant: job.variant, texture: job.texture }, phase: 'prepared', createdAt: Date.now() };
      await save(journalFile, journal);
    }
    if (JSON.stringify(journal.job) !== JSON.stringify({ id: job.id, playerUuid: job.playerUuid, username: job.username, kind: job.kind, sha256: job.sha256, variant: job.variant, texture: job.texture })) throw Error('APPEARANCE_JOURNAL_CONFLICT');
    const report = async (state, reason, message, extra) => { journal.result = this.result(job, state, reason, message, extra); await save(journalFile, journal); return journal.result; };
    if (['applied', 'failed'].includes(journal.result?.state)) return journal.result;
    try { if (!await this.online(job)) return report('waiting_player', 'PLAYER_OFFLINE', '文件已保存，等待这个原 UUID 的角色在线后应用。'); }
    catch { return report('waiting_player', 'GAME_UNAVAILABLE', '游戏暂时不可查询；文件保留，没有重复执行外观命令。'); }
    let name = journal.modelIdentifier || identifier(job);
    if (job.kind === 'skin') {
      const custom = path.join(this.config.serverDir, 'plugins/SkinsRestorer/skins', name + '.customskin'); let signed;
      try { signed = await json(custom); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!signed && journal.phase === 'prepared') {
        journal.phase = 'generating'; journal.dispatchedAt = Date.now(); await save(journalFile, journal);
        try { await this.command(`skinsrestorer:sr createcustom ${name} "${this.origin}/appearance/skins/${job.sha256}.png" ${job.variant}`, 10000, { properties: path.join(this.config.serverDir, 'server.properties'), port: this.config.rconPort || 25575 }); }
        catch { return report('unknown', 'SKIN_GENERATION_UNKNOWN', '签名请求结果未知；保留原请求，等待查询，不会重复提交。'); }
      }
      if (!signed) return report(Date.now() - journal.dispatchedAt > 180000 ? 'unknown' : 'applying', 'SKIN_SIGNING', '正在等待原版皮肤签名服务；尚未确认应用，不会重复提交。');
      let texture;
      try { texture = JSON.parse(Buffer.from(signed.value, 'base64').toString('utf8')).textures?.SKIN; } catch { throw Error('SKIN_SIGNATURE_INVALID'); }
      if (typeof signed.signature !== 'string' || signed.signature.length < 64 || !/^https?:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]+$/i.test(texture?.url || '') || (texture.metadata?.model || 'classic') !== job.variant) throw Error('SKIN_SIGNATURE_INVALID');
      let binding;
      try { binding = await json(path.join(this.config.serverDir, 'plugins/SkinsRestorer/players', job.playerUuid + '.player')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (binding?.uniqueId === job.playerUuid && binding.skinIdentifier?.identifier === name && binding.skinIdentifier?.type === 'CUSTOM') return report('applied', 'SKIN_BOUND', '原版签名皮肤与本人 UUID 的持久绑定已核对；客户端将收到皮肤刷新。', { identifier: name });
      if (journal.phase !== 'binding') {
        journal.phase = 'binding'; journal.dispatchedAt = Date.now(); await save(journalFile, journal);
        try { await this.command(`skinsrestorer:skin set ${name} ${job.username} ${job.variant}`, 10000, { properties: path.join(this.config.serverDir, 'server.properties'), port: this.config.rconPort || 25575 }); }
        catch { return report('unknown', 'SKIN_BINDING_UNKNOWN', '换肤请求结果未知；等待实际 UUID 绑定确认，不重复执行。'); }
      }
      return report(Date.now() - journal.dispatchedAt > 120000 ? 'unknown' : 'applying', 'SKIN_BINDING', '签名已生成，等待核对角色的实际皮肤绑定。');
    }
    const model = path.join(this.modelRoot, name);
    if (journal.phase === 'prepared') {
      const source = ysmArchive(await fs.readFile(path.join(directory, 'asset.zip')), { includeFiles: true });
      if (job.sourceSha256 && source.sourceSha256 !== job.sourceSha256) throw Error('YSM_SOURCE_HASH_MISMATCH');
      const existing = await existingModel(this.modelRoot, source.sourceSha256);
      if (existing) {
        journal.modelIdentifier = name = existing; journal.sourceSha256 = source.sourceSha256;
        journal.phase = 'source_installed'; journal.installedAt = Date.now() - 45000; await save(journalFile, journal);
        return report('applying', 'YSM_EXISTING_SOURCE', '已核对完全相同的公开模型源，复用现有资源，不重复安装。');
      }
      try {
        const stat = await fs.lstat(model); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('YSM_SOURCE_CONFLICT');
        for (const [relative, raw] of source.files) { const target = path.join(model, relative); if ((await fs.lstat(target)).isSymbolicLink() || sha(await fs.readFile(target)) !== sha(raw)) throw Error('YSM_SOURCE_CONFLICT'); }
      }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const models = await fs.readdir(this.modelRoot, { withFileTypes: true });
        if (models.filter(entry => entry.isDirectory() || /\.(zip|ysm)$/i.test(entry.name)).length >= 60) return report('failed', 'YSM_CATALOG_FULL', '模型目录接近现有转换上限，未安装；请服主整理旧资源后重试。');
        // Native YSM 2.4.1 may derive a ZIP ID from its internal wrapper rather
        // than the archive filename. Install a validated plaintext directory
        // under OUR identifier. Preserve every original resource byte; never
        // unpack unchecked user paths into the shared model directory.
        const temp = path.join(directory, 'validated-' + randomUUID()); await fs.mkdir(temp);
        for (const [relative, raw] of source.files) { const target = path.join(temp, relative); if (!target.startsWith(temp + path.sep)) throw Error('YSM_PATH_INVALID'); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, raw, { flag: 'wx' }); }
        await fs.rename(temp, model);
      }
      journal.phase = 'source_installed'; journal.installedAt = Date.now(); await save(journalFile, journal);
    }
    if (journal.phase === 'source_installed' && Date.now() - journal.installedAt < 45000) return report('applying', 'YSM_CONVERTING', '模型源已安装，等待稳定扫描、Web 转换与原生目录更新。');
    let state;
    try { const snapshot = await json(this.config.appearanceStateFile); const writtenAt = typeof snapshot.writtenAt === 'number' ? snapshot.writtenAt : Date.parse(snapshot.writtenAt); if (Math.abs(Date.now() - writtenAt) < 10000) state = snapshot.players?.find(row => row.playerUuid === job.playerUuid && row.playerName === job.username); } catch { /* Actual worker state remains unknown. */ }
    if (state?.stateStatus === 'confirmed' && state.available === true && state.modelId === name && state.texture === job.texture && state.webAvailable === true) return report('applied', 'YSM_BOUND', '原生模型、贴图与 Web 资源已由模型服务确认；基岩按该模型支持范围投影。', { identifier: name, texture: job.texture, webAvailable: true, ...(journal.modelIdentifier ? { reusedExisting: true, sourceSha256: journal.sourceSha256 } : {}) });
    if (journal.phase === 'source_installed') {
      journal.phase = 'binding'; journal.dispatchedAt = Date.now(); await save(journalFile, journal);
      try { await this.control(`appearance admin set ${job.username} ${name} ${job.texture}`); }
      catch { return report('unknown', 'YSM_BINDING_UNKNOWN', '模型绑定请求结果未知，等待实际 Worker 状态；不会重复发送。'); }
    }
    return report(Date.now() - journal.dispatchedAt > 120000 ? 'unknown' : 'applying', 'YSM_CONFIRMING', '等待原生模型与 Web 转换的实际确认，尚未报告应用成功。');
  }
  async poll() {
    const token = (await fs.readFile(this.config.tokenFile, 'utf8')).trim(); if (!/^app_[A-Za-z0-9_-]{43}$/.test(token)) throw Error('INVALID_APPEARANCE_CREDENTIAL');
    const results = [];
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) if (entry.isDirectory() && uuid.test(entry.name)) {
      const journal = await json(path.join(this.root, entry.name, 'journal.json')).catch(() => null);
      if (journal?.result && !journal.acknowledged) results.push(journal.result);
      if (results.length >= 8) break;
    }
    const response = await fetch(this.origin + '/api/v1/internal/appearance/poll', { method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ at: Date.now(), ready: true, results }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) { const failed = await response.json().catch(() => ({})); const reason = /^[A-Z_]{3,80}$/.test(failed.error?.reason || '') ? failed.error.reason : 'UNAVAILABLE'; throw Error('APPEARANCE_SYNC_' + response.status + '_' + reason); }
    const data = await response.json();
    if (!Array.isArray(data.acknowledged) || !Array.isArray(data.requests) || data.requests.length > 1) throw Error('APPEARANCE_SYNC_INVALID');
    for (const id of data.acknowledged) if (results.some(result => result.id === id)) { const file = path.join(this.root, id, 'journal.json'), journal = await json(file); journal.acknowledged = true; await save(file, journal); }
    for (const job of data.requests) {
      const result = await this.process(job), file = path.join(this.root, job.id, 'journal.json');
      let journal = await json(file).catch(() => null);
      if (!journal) { journal = { schemaVersion: 1, job: { id: job.id, playerUuid: job.playerUuid, username: job.username, kind: job.kind, sha256: job.sha256, variant: job.variant, texture: job.texture }, phase: 'unknown' }; }
      journal.result = result; journal.acknowledged = false; await save(file, journal);
    }
    return { ok: true, requests: data.requests.length, results: results.length };
  }
}
export async function main(file, once = false) {
  const worker = await new AppearanceWorker(await json(file)).initialize(), lock = path.join(worker.root, 'worker.lock');
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); await handle.writeFile(String(process.pid)); } catch { throw Error('APPEARANCE_WORKER_ALREADY_RUNNING_CHECK_LOCK'); }
  let stopped = false; process.once('SIGINT', () => { stopped = true; }); process.once('SIGTERM', () => { stopped = true; });
  try { do { try { await worker.poll(); } catch { console.error('外观同步暂不可用，保留原请求，稍后查询。'); } if (once || stopped) break; await new Promise(resolve => setTimeout(resolve, 5000)); } while (!stopped); }
  finally { await handle.close(); await fs.unlink(lock); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv[2], process.argv.includes('--once')).catch(() => { console.error('外观同步未启动，请检查私有配置与原进程状态。'); process.exitCode = 1; });
