#!/usr/bin/env node
// Explicit offline resource preparation only. Never starts a game, host or model.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { MINECRAFT_CLIENT_DEFAULTS, prepareMinecraftViewerAssets } from 'agent-mc-world/client';

const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const { values } = parseArgs({ options: { resources: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help || !values.resources) {
  console.log('用法：node bin/qiandengji-offline-prepare.mjs --resources <公共资源包解压目录>\n将音频包和 Windows 截图浏览器包解压到同一个目录。此命令只校验、准备本机资源，不进服、不调用模型、不改宿主配置。');
} else {
  const root = await fs.realpath(values.resources);
  const inside = async name => {
    if (typeof name !== 'string' || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..')) throw Error('资源路径无效。');
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep)) throw Error('资源路径越界。');
    const info = await fs.lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || !((await fs.realpath(target)).startsWith(root + path.sep))) throw Error('资源必须是包内普通文件。');
    return target;
  };
  const readJson = async name => {
    const file = await inside(name);
    if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw Error('资源目录过大。');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  };
  const audio = await readJson('shared-audio.json'), browser = await readJson('shared-browser.json');
  if (audio.schema !== 'qiandengji-offline-audio/v1' || browser.schema !== 'qiandengji-offline-browser/v1'
      || !audio.objects || Object.keys(audio.objects).length > 20000) throw Error('资源包版本不匹配。');
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('此截图浏览器包适用于 Windows x64；其他平台请自行安装配套 Chromium。');
  if (!/^[a-f0-9]{64}$/.test(browser.executable.sha256)) throw Error('浏览器目录无效。');
  const browserFile = await inside(browser.executable.file);
  if (hash(await fs.readFile(browserFile)) !== browser.executable.sha256) throw Error('截图浏览器校验失败，请重新解压浏览器包。');
  let supplied = 0;
  const prepared = await prepareMinecraftViewerAssets({ templateDir: MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir,
    cacheDir: path.join(root, 'prepared-viewer'), fetch: async url => {
      const match = /^https:\/\/resources\.download\.minecraft\.net\/([a-f0-9]{2})\/([a-f0-9]{40})$/.exec(String(url));
      if (!match || match[1] !== match[2].slice(0, 2)) throw Error('拒绝非原版资源地址。');
      const row = audio.objects[match[2]];
      if (!row || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > 100 * 1024 * 1024) throw Error('音频包缺少所需资源，请下载配套音频包。');
      const bytes = await fs.readFile(await inside(row.file));
      if (bytes.length !== row.bytes || hash(bytes) !== row.sha256 || hash(bytes, 'sha1') !== match[2]) throw Error('音频资源校验失败，请重新解压音频包。');
      supplied++; return new Response(bytes);
    } });
  const result = { viewerAssetsDir: prepared.directory, browserExecutable: browserFile, offline: true, localAudioObjects: supplied,
    next: '在宿主高级设置填入 viewerAssetsDir；启动宿主前设置 AGENT_MC_BROWSER_EXECUTABLE 为 browserExecutable。选择千灯纪资料包后再使用本人的账号进服。' };
  await fs.writeFile(path.join(root, 'prepared-resources.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('离线资源已准备完成。没有发出网络请求，也没有启动游戏。');
  console.log(JSON.stringify(result, null, 2));
}
