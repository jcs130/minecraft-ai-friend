import puppeteer from 'puppeteer-core';
import { installCaptureHook, captureCanvas } from '../src/capture-canvas.mjs';

// Usage: node scripts/publish-live.mjs --portal https://... --channel UUID
// --source http://192.168.x.x:7793/ --browser ".../msedge.exe"
// Secret is read only from QD_LIVE_PUBLISH_TOKEN. Never put it in a URL/argument.
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const portal = new URL(args.get('--portal') || 'http://127.0.0.1:8790');
const source = new URL(args.get('--source') || 'http://127.0.0.1:7793');
const channel = args.get('--channel');
const token = process.env.QD_LIVE_PUBLISH_TOKEN;
const browserPath = args.get('--browser') || process.env.QD_LIVE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const isLocal = host => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
for (const url of [portal, source]) if (url.username || url.password || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) throw Error('Use HTTPS or a trusted private HTTP origin, without URL credentials');
if (portal.pathname !== '/' || portal.search || !/^[a-f0-9-]{36}$/.test(channel || '') || !/^pub_[A-Za-z0-9_-]{43}$/.test(token || '')) throw Error('Configure portal, channel and QD_LIVE_PUBLISH_TOKEN before starting');
if (source.searchParams.has('obs') || /token|password|key/i.test(source.search)) throw Error('Use the normal read-only viewer page; secrets and OBS are not capture sources');

let stopping = false, browser, epoch, sequence = 0, latestReason = null;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; void browser?.close(); });
const report = reason => { if (reason !== latestReason) { console.log(reason); latestReason = reason; } };
const send = async (path, options) => {
  const response = await fetch(new URL(path, portal), { ...options, headers: { Authorization: 'Bearer ' + token, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) { const error = new Error('LIVE_PUBLISH_' + response.status); error.status = response.status; throw error; }
  return response.json();
};
try {
  browser = await puppeteer.launch({ executablePath: browserPath, headless: true, pipe: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(installCaptureHook, source.origin);
  // No credentials/cookies from a person's desktop browser are imported.
  await page.goto(source.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
  while (!stopping) {
    try {
      const frame = await page.evaluate(captureCanvas);
      if (!frame.available) { report(frame.reason); }
      else {
        if (!epoch) { const opened = await send(`/api/v1/live/${channel}/open`, { method: 'POST' }); epoch = opened.epoch; sequence = 0; }
        const bytes = Buffer.from(frame.jpeg.slice('data:image/jpeg;base64,'.length), 'base64');
        await send(`/api/v1/live/${channel}/frame`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'X-Stream-Epoch': epoch, 'X-Frame-Sequence': String(++sequence) }, body: bytes });
        report('直播画面已连接，仅发布游戏画布。');
      }
    } catch (error) {
      if ([401, 403, 404].includes(error.status)) throw error;
      if (error.status === 409) epoch = null;
      report('直播暂不可用；等待恢复，不发布旧画面。');
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} catch (error) {
  // Do not print URLs, request headers, tokens or browser page contents.
  console.error('直播发布器已停止：' + (error.status ? `HTTP ${error.status}` : error.name));
  process.exitCode = stopping ? 0 : 1;
} finally { await browser?.close(); }
