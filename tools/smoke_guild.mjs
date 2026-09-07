import {open, readFile, unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Rcon} from '/app/src/rcon.ts';
const QA = 'QDGuildProbe', DATA = '/app/data';
const report = {project: 'qiandengji', startedAt: new Date().toISOString(), ok: false, checks: [], cleanup: {}};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => {if (!value) throw new Error(message);};
const check = (name, detail = {}) => report.checks.push({name, ok: true, ...detail});
const hash = raw => createHash('sha256').update(raw).digest('hex');
let rcon, bot, lock, secret = '', timer, boardPath, boardBefore;
try {
  assert(process.env.SMOKE_EXECUTE === 'qiandengji' && process.env.SMOKE_PROJECT === 'qiandengji', 'Missing execution guards');
  assert((await readFile(`${DATA}/.qiandengji-smoke`, 'utf8')).trim() === 'qiandengji', 'Missing project marker');
  lock = await open(`${DATA}/.qiandengji-smoke.lock`, 'wx');
  await lock.writeFile(JSON.stringify({player: QA, at: report.startedAt}));
  const health = JSON.parse(await readFile('/mcdata/guild-health.json', 'utf8'));
  assert(health.basic_quests && !health.autogenerate && Date.now()/1000 - health.last_success_at < 100, 'Guild readiness not confirmed');
  boardPath = `/mcdata/village/guild-${health.board_date}.json`;
  const boardRaw = await readFile(boardPath), board = JSON.parse(boardRaw);
  const candidate = board.board.find(row => row.type === 'visit' && row.pos && row.status === 'open');
  assert(candidate, 'No open legacy location task available for this non-mutating regression');
  boardBefore = hash(boardRaw);
  secret = (await readFile(`${DATA}/rcon-secret.txt`, 'utf8')).trim();
  rcon = new Rcon('mc', 25575, secret); await rcon.connect(6000);
  assert(!(await rcon.send('list')).includes(QA), 'QA already online');
  const require = createRequire('/app/package.json');
  bot = require('mineflayer').createBot({host: 'mc', port: 25599, username: QA, version: '1.21.1', auth: 'offline', hideErrors: true});
  const messages = [];
  bot.on('messagestr', message => messages.push({at: Date.now(), text: String(message)}));
  bot.on('error', () => {});
  await new Promise((resolve, reject) => {timer = setTimeout(() => reject(new Error('QA login timeout')), 25000); bot.once('spawn', resolve); bot.once('error', reject);});
  clearTimeout(timer); await pause(1500); check('mineflayer-login');
  const start = Date.now(); bot.chat('公会 看板');
  let boardMessages = [];
  for (let i = 0; i < 80; i++) {
    boardMessages = messages.filter(row => row.at >= start);
    if (boardMessages.some(row => row.text.includes('今日看板')) && boardMessages.some(row => row.text.includes('暂停接取')) &&
        boardMessages.some(row => row.text.includes('可接') && (row.text.includes('地平线') || row.text.includes('白骨') || row.text.includes('噩梦') || row.text.includes('羊圈')))) break;
    await pause(250);
  }
  assert(boardMessages.some(row => row.text.includes('今日看板')), 'No real guild board reply');
  check('guild-board-reply');
  assert(boardMessages.some(row => row.text.includes('暂停接取')), 'Legacy pause state not visible');
  check('legacy-task-pause-visible');
  assert(boardMessages.some(row => row.text.includes('可接') && (row.text.includes('地平线') || row.text.includes('白骨') || row.text.includes('噩梦') || row.text.includes('羊圈'))), 'No basic hunt/travel tasks remain available');
  check('basic-tasks-visible');
  const rejectAt = Date.now(); bot.chat(`公会 接 ${candidate.no}`);
  let refusal;
  for (let i = 0; i < 60; i++) {
    refusal = messages.find(row => row.at >= rejectAt && row.text.includes('旧地点尚未') && row.text.includes('暂不能接'));
    if (refusal) break;
    await pause(250);
  }
  assert(refusal, 'Legacy location claim did not produce explicit refusal');
  check('legacy-task-claim-refused', {taskNumber: candidate.no, reply: refusal.text});
  assert(hash(await readFile(boardPath)) === boardBefore, 'A read/refused claim changed existing board progress');
  check('existing-board-byte-preserved');
  report.ok = true;
} catch (error) {
  report.error = String(error?.message || error).replaceAll(secret || '\0', '[redacted]').slice(0, 500);
} finally {
  clearTimeout(timer);
  if (boardPath && boardBefore) {
    report.cleanup.boardUnchanged = hash(await readFile(boardPath)) === boardBefore;
    if (!report.cleanup.boardUnchanged) report.ok = false;
  }
  if (bot) {bot.quit('Guild board verification complete'); await pause(300); bot._client?.end();}
  if (rcon?.isConnected()) {
    try {report.cleanup.probeDisconnected = !(await rcon.send('list')).includes(QA); if (!report.cleanup.probeDisconnected) report.ok = false;}
    catch {report.ok = false;}
  }
  rcon?.close();
  if (lock) {await lock.close(); await unlink(`${DATA}/.qiandengji-smoke.lock`);}
  report.finishedAt = new Date().toISOString();
  report.scope = 'Actual public chat board, available basic tasks and rejected legacy claim; no monster kill, task reward or merchant trade claimed';
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exit(report.ok ? 0 : 1);
