#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { portalOrigin, runAgentAccess } from './agent-register.mjs';

const ROOT = '/api/v1/agent-access/appearance';
const UUID = /^[a-f0-9-]{36}$/i;
const pending = new Set(['queued', 'waiting_player', 'applying', 'unknown']);
async function readPrivate(file) {
  if ((await fs.lstat(file)).isSymbolicLink()) throw Error('私有身份或换装记录不能使用符号链接');
  return fs.readFile(file, 'utf8');
}
async function save(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try { await fs.rename(temporary, file); } catch (error) { await fs.unlink(temporary); throw error; }
}
function options(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (['--public', '--json', '--retry'].includes(key)) { if (values[key]) throw Error('重复参数'); values[key] = true; continue; }
    if (!['--identity-file', '--token-file', '--portal', '--file', '--label', '--variant', '--texture', '--asset-id'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || values[key]) throw Error('参数不正确；用 --help 查看外观工具');
    values[key] = args[++i];
  }
  if (!!values['--identity-file'] === !!values['--token-file']) throw Error('提供 --identity-file，或 --token-file 二选一；不在参数中传密钥');
  return values;
}
export async function runAgentAppearance(args, output = console.log, { fetcher = fetch } = {}) {
  const [action = 'status', ...rest] = args;
  if (['help', '--help', '-h'].includes(action)) {
    output('本人外观：status 查询；skin --file 皮肤.png --variant classic|slim --public；ysm --file 模型.zip --public。\n每次带 --identity-file 私有身份文件；旧角色可用 --token-file 已获外观管理权限的单角色凭据。\n上传并提交应用，随后用 status 查询实际回执。未知结果不重复提交；明确终态后 --retry 可重新申请。'); return 0;
  }
  if (!['status', 'skin', 'ysm', 'remove'].includes(action)) throw Error('使用 status、skin、ysm，或 remove --asset-id 本人未使用的外观');
  const opts = options(rest), identityFile = opts['--identity-file'] && path.resolve(opts['--identity-file']);
  const credentialFile = identityFile || path.resolve(opts['--token-file']);
  let origin, token;
  async function refresh() {
    if (!identityFile) return;
    await runAgentAccess(['login', '--identity-file', identityFile], () => {});
    const identity = JSON.parse(await readPrivate(identityFile)); token = identity.token;
  }
  if (identityFile) {
    await readPrivate(identityFile);
    let state; await runAgentAccess(['status', '--identity-file', identityFile], text => { state = JSON.parse(text); });
    if (!state.gameAccountCreated) throw Error('先完成原 join 并确认游戏建号，再设置本人外观');
    const identity = JSON.parse(await readPrivate(identityFile)); origin = portalOrigin(identity.portal); token = identity.token;
    if (opts['--portal'] && portalOrigin(opts['--portal']) !== origin) throw Error('网站地址与原身份不同，保留原身份文件');
  } else {
    origin = portalOrigin(opts['--portal'] || 'https://mc.kangqiang.site'); token = (await readPrivate(credentialFile)).trim();
    if (!/^pat_[A-Za-z0-9_-]{43}$/.test(token)) throw Error('凭据文件需为带 appearance.write 权限的单角色 PAT；邀请码身份用 --identity-file');
  }
  async function call(suffix = '', method = 'GET', body, headers = {}, refreshed = false) {
    let response;
    try { response = await fetcher(origin + ROOT + suffix, { method, redirect: 'error', headers: { Authorization: 'Bearer ' + token, ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) }); }
    catch { throw Object.assign(Error('结果待确认，请用同一身份查询 status；不要重复提交换装'), { unknown: true }); }
    if (response.status === 401 && identityFile && method === 'GET' && !refreshed) { await refresh(); return call(suffix, method, body, headers, true); }
    let value; try { value = await response.json(); } catch { throw Object.assign(Error('回执格式未确认，请查询原请求'), { unknown: true }); }
    if (!response.ok) throw Object.assign(Error((value.error?.message || '外观请求未完成') + '（' + (value.error?.reason || response.status) + '）'), { status: response.status, reason: value.error?.reason });
    return value;
  }
  let listing = await call();
  if (!UUID.test(listing.subject?.playerUuid || '') || typeof listing.subject.username !== 'string') throw Error('本人角色身份未确认');
  const journalFile = credentialFile + '.appearance.json';
  let journal = { schemaVersion: 1, portal: origin, playerUuid: listing.subject.playerUuid, intents: {} };
  try { journal = JSON.parse(await readPrivate(journalFile)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (journal.schemaVersion !== 1 || journal.portal !== origin || journal.playerUuid !== listing.subject.playerUuid || !journal.intents) throw Error('换装记录属于另一身份，请保留原记录并给新角色使用独立身份文件');
  const show = job => {
    const value = { username: listing.subject.username, ...job };
    if (opts['--json']) output(JSON.stringify(value));
    else output(`[外观] ${value.username}：${({ queued: '已排队，等待应用', waiting_player: '等待本人角色在线', applying: '正在应用，等待核验', unknown: '结果待确认，请继续查询', applied: '原请求已核实应用', failed: '未能应用' })[job.state] || job.state}；请求 ${job.id}。${job.result?.message || ''}`);
    return job.state === 'applied' ? 0 : job.state === 'failed' ? 1 : 2;
  };
  if (action === 'status') {
    const jobs = [];
    for (const value of Object.values(journal.intents)) if (value.attempted && UUID.test(value.id || '')) {
      try { jobs.push(await call('/jobs/' + value.id)); } catch (error) { if (error.status !== 404) throw error; jobs.push({ id: value.id, state: 'unknown' }); }
    }
    if (!jobs.length) jobs.push(...listing.jobs.slice(0, 2));
    if (jobs.length) { const codes = jobs.map(show); return Math.max(...codes); }
    output(opts['--json'] ? JSON.stringify(listing) : `[外观] ${listing.subject.username}：皮肤 ${listing.assets.filter(a => a.kind === 'skin').length} 份，YSM ${listing.assets.filter(a => a.kind === 'ysm').length} 份；${listing.capabilities.message}`); return 0;
  }
  const lockFile = journalFile + '.lock';
  let lock; try { lock = await fs.open(lockFile, 'wx', 0o600); } catch (error) { if (error.code !== 'EEXIST') throw error; throw Error('已有外观操作占用。先用 status 查询；若原进程已退出，核对原请求后再移除本机 .appearance.json.lock 文件'); }
  const nonce = randomUUID(); await lock.writeFile(JSON.stringify({ pid: process.pid, nonce }));
  try {
    // Another invocation may have finished between the initial read and this
    // exclusive lock. Reload its original intent rather than overwriting it.
    try { journal = JSON.parse(await readPrivate(journalFile)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (journal.portal !== origin || journal.playerUuid !== listing.subject.playerUuid || journal.schemaVersion !== 1 || !journal.intents) throw Error('换装记录属于另一身份，请保留原记录');
    listing = await call();
    if (listing.subject.playerUuid !== journal.playerUuid) throw Error('本人身份已变化，停止外观操作');
    if (action === 'remove') {
      if (!UUID.test(opts['--asset-id'] || '')) throw Error('remove 需要 --asset-id 本人未使用的外观编号');
      await call('/assets/' + opts['--asset-id'], 'DELETE'); output('本人未使用的外观文件已移除，历史回执保留。'); return 0;
    }
    if (!opts['--public']) throw Error('加 --public 确认有权在游戏中公开展示该外观；普通皮肤将由签名服务生成原版材质');
    if (!opts['--file']) throw Error('请用 --file 指定本机皮肤 PNG 或原始 YSM ZIP');
    const stat = await fs.stat(opts['--file']); if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw Error('外观需为不超过 8MB 的普通文件');
    const bytes = await fs.readFile(opts['--file']), sha = createHash('sha256').update(bytes).digest('hex');
    if (action === 'skin' && bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || action === 'ysm' && bytes.subarray(0, 4).toString('hex') !== '504b0304') throw Error('文件格式不符：皮肤需 PNG，YSM 需公开原始 ZIP，不上传其他本机文件');
    const variant = action === 'skin' ? opts['--variant'] || 'classic' : null;
    if (variant && !['classic', 'slim'].includes(variant)) throw Error('皮肤手臂用 classic 或 slim');
    let asset = listing.assets.find(a => a.kind === action && a.sha256 === sha && (action !== 'skin' || a.variant === variant));
    if (!asset) {
      listing = await call('/' + action, 'POST', bytes, { 'Content-Type': action === 'skin' ? 'image/png' : 'application/zip', 'X-Appearance-Label': encodeURIComponent(opts['--label'] || (action === 'skin' ? '我的皮肤' : '我的 YSM 模型')), 'X-Skin-Variant': variant || '', 'X-Appearance-Consent': 'public-game-appearance' });
      asset = listing.assets.find(a => a.kind === action && a.sha256 === sha && (action !== 'skin' || a.variant === variant));
    }
    if (!asset) throw Error('上传结果未确认，请保留原文件并查询 status');
    const texture = action === 'ysm' ? opts['--texture'] || asset.textures?.[0]?.name : null;
    const previous = journal.intents[action];
    if (previous?.attempted) {
      let job; try { job = await call('/jobs/' + previous.id); } catch (error) { if (error.status !== 404) throw error; return show({ id: previous.id, state: 'unknown' }); }
      if (pending.has(job.state)) return show(job);
      if (!opts['--retry'] && previous.assetId === asset.id && previous.texture === texture) return show(job);
    }
    const intent = { id: randomUUID(), assetId: asset.id, texture, attempted: true };
    journal.intents[action] = intent; await save(journalFile, journal);
    let job;
    try { job = await call('/apply', 'POST', { requestId: intent.id, assetId: asset.id, ...(texture ? { texture } : {}) }); }
    catch (error) {
      if (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) { intent.attempted = false; await save(journalFile, journal); }
      if (error.unknown) return show({ id: intent.id, state: 'unknown', result: { message: error.message } });
      throw error;
    }
    if (job.id !== intent.id || job.subject?.playerUuid !== journal.playerUuid) throw Error('换装回执身份不一致，请查询原请求');
    return show(job);
  } finally {
    await lock.close();
    try { if (JSON.parse(await fs.readFile(lockFile, 'utf8')).nonce === nonce) await fs.unlink(lockFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await runAgentAppearance(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
