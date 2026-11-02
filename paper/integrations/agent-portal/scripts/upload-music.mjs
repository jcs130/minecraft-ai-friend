import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { uploadMusic } from '../public/music-client.mjs';

// Paths, not tokens/lyrics/invite links, belong in arguments. The caller creates
// this directory as private to their OS account (including Windows ACLs).
export async function uploadFromFiles({ manifestFile, tokenFile, receiptFile }) {
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')), origin = new URL(manifest.origin ?? 'https://mc.kangqiang.site');
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:')) throw Error('网站地址需为 HTTPS 来源；隔离测试仅允许本机 HTTP。');
  const { metadata, audioFile, mime, publish = false } = manifest;
  if (typeof publish !== 'boolean') throw Error('publish 必须明确为布尔值，默认只保存私有作品。');
  const stat = await fs.stat(audioFile);
  if (!stat.isFile() || stat.size > 134217728) throw Error('请选择128MiB以内的本机音频成品。');
  const audio = await fs.readFile(audioFile), descriptor = { sha256: createHash('sha256').update(audio).digest('hex'), bytes: audio.length, mime };
  const tokenText = (await fs.readFile(tokenFile, 'utf8')).trim();
  const token = tokenText.startsWith('{') ? JSON.parse(tokenText).token : tokenText;
  if (typeof token !== 'string' || !/^(qda_|pat_)[A-Za-z0-9_-]+$/.test(token)) throw Error('请使用原本机私有文件中的本人 qda_ 会话，或带 music.write 的单角色 PAT。');
  await fs.mkdir(path.dirname(path.resolve(receiptFile)), { recursive: true, mode: 0o700 });
  const lock = await fs.open(receiptFile + '.lock', 'wx', 0o600).catch(() => { throw Error('这个回执已有上传进程，请先查询原进程。'); });
  try {
    let state = {};
    try { state = JSON.parse(await fs.readFile(receiptFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const save = async value => { const temporary = receiptFile + '.next'; await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); await fs.rename(temporary, receiptFile); };
    const capability = await fetch(origin + 'api/v1/music/capabilities').then(async r => r.ok ? r.json() : null);
    if (!capability?.enabled) throw Error('官网歌曲接口尚未启用；请保留本机成品和回执，不要改走图片接口。');
    const api = async (route, method = 'GET', body) => {
      let response;
      try { response = await fetch(origin + 'api/v1/self/music' + route, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error' }); }
      catch { throw Error('官网请求结果未知，请保留原回执继续查询，不要重新建作品。'); }
      const value = await response.json();
      if (!response.ok) throw Error(`${value.error?.reason ?? response.status}: ${value.error?.message ?? '请求失败'} ${value.error?.nextAction ?? ''}`);
      return value;
    };
    const result = await uploadMusic({ api, state, save, metadata, descriptor, audio, publish, allowLoopback: loopback });
    return { id: result.id, title: result.title, state: result.state, published: result.published, revision: result.revision };
  } finally { await lock.close(); await fs.unlink(receiptFile + '.lock'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), values = new Map();
  for (let i = 0; i < args.length; i += 2) values.set(args[i], args[i + 1]);
  if (!['--manifest-file', '--token-file', '--receipt-file'].every(key => values.get(key)) || values.size !== 3) { console.error('用法：node scripts/upload-music.mjs --manifest-file /私有目录/作品.json --token-file /私有目录/本人会话.txt --receipt-file /私有目录/上传回执.json'); process.exitCode = 1; }
  else try { console.log(JSON.stringify(await uploadFromFiles({ manifestFile: values.get('--manifest-file'), tokenFile: values.get('--token-file'), receiptFile: values.get('--receipt-file') }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
