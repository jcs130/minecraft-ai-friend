// 鸣人·轻量版 —— A/B 对照身体：单循环、零中间层（无 JEV/信箱/执行器/MCP）。
// 链路：看(世界快照) -> 想(阿福 LLM via 127.0.0.1:8010 decision-proxy) -> 做(mineflayer 原生) -> 记(thinking.jsonl/status.json)。
// 设计纪律：一切错误都被吞进日志并继续下一轮；每个动作有硬超时；不存在"等一个永远不来的回执"的状态。卡住=不可能，慢了=一眼可见。
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const pfPlugin = require('mineflayer-pathfinder').pathfinder;
const { goals } = require('mineflayer-pathfinder');

const ENV = process.env;
const CFG = {
  name: ENV.NARUTO_NAME || 'ag_naruto',
  host: ENV.NARUTO_HOST || '127.0.0.1',
  port: Number(ENV.NARUTO_PORT || 25702),          // 外门（25701 停发宿主；本机 Agent 一律 ag_ 走外门）
  version: ENV.NARUTO_VERSION || '1.21.1',
  llmBase: (ENV.NARUTO_LLM_BASE || 'http://127.0.0.1:8010/v1').replace(/\/$/, ''),
  llmKey: ENV.NARUTO_LLM_KEY || 'sk-local',
  model: ENV.NARUTO_MODEL || 'qwen3.8-27b-fast',
  voice: ENV.NARUTO_VOICE || 'cosy_male',          // 8191 shim 参考音别名
  ttsBase: ENV.NARUTO_TTS_BASE || 'http://127.0.0.1:8191',
  turnSeconds: Number(ENV.NARUTO_TURN_SECONDS || 90),   // 每轮总预算（想+做）
  restSeconds: Number(ENV.NARUTO_REST_SECONDS || 4),
  stateDir: ENV.NARUTO_STATE || path.join(__dirname, 'state'),
};
fs.mkdirSync(CFG.stateDir, { recursive: true });
fs.mkdirSync(path.join(CFG.stateDir, 'voice'), { recursive: true });
const THINK = path.join(CFG.stateDir, 'thinking.jsonl');
const STATUS = path.join(CFG.stateDir, 'status.json');
const GOALS = path.join(CFG.stateDir, 'goals.md');
const log = (m, extra) => {
  const line = JSON.stringify({ t: new Date().toISOString(), m, ...extra });
  console.log(line);
};
const append = (file, obj) => fs.appendFile(file, JSON.stringify(obj) + '\n', () => {});

const PERSONA = `你是鸣人，MC 异世界的穿越者。性格：直爽、行动派、先干再说、不矫情。
你这轮只做一件事：观察、决定一个动作、用一句话说清你为什么这么做。
输出必须是严格 JSON（不要 markdown 围栏）：
{"think":"一句内心判断","say":"游戏里喊的话(可空)","action":"动作名","params":{...}}
可用动作：
{"action":"goto","params":{"x":数,"z":数}}    走到坐标
{"action":"wander"}                             随机探索一段
{"action":"mine","params":{"what":"stone|coal_ore|iron_ore|oak_log","n":1到8}}  挖最近的某种方块
{"action":"chop"}                               砍最近的树
{"action":"eat","params":{"what":"golden_apple|apple|cooked_beef|bread"}}  吃东西
{"action":"craft","params":{"what":"stone_pickaxe|planks|stick|crafting_table"}}  合成(需材料齐)
{"action":"fight"}                              打最近的敌对生物
{"action":"flee"}                               向远离最近敌人的方向撤 30 格
{"action":"place_torch"}                        插一支火把
{"action":"sleep"}                              找床睡觉
{"action":"set_goal","params":{"goal":"一句话阶段目标"}}
{"action":"rest"}                               原地观望几秒
不确定就 wander 或 rest。距离坐标不超过 64 格。say 保持口语短句。`;

let bot = null;
let turnCount = 0;
let errCount = 0;
const recent = [];

function snapshot() {
  const p = bot.entity ? bot.entity.position : null;
  const inv = bot.inventory.items().slice(0, 18).map(i => i.name + 'x' + i.count);
  const under = p ? bot.blockAt(p.offset(0, -1, 0)) : null;
  let hostiles = [];
  try {
    hostiles = bot.entities.filter(e => e.position && bot.entity &&
      e.position.distanceTo(bot.entity.position) < 20 &&
      ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'drowned', 'pillager'].some(k => e.name && e.name.includes(k)))
      .map(e => e.name + '@' + Math.round(e.position.distanceTo(bot.entity.position)));
  } catch (e) { /* 实体视图有洞不影响主循环 */ }
  const t = bot.time ? bot.time.dayTime : 0;
  return {
    pos: p ? { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) } : null,
    hp: bot.health === undefined ? -1 : bot.health,
    food: bot.food === undefined ? -1 : bot.food,
    time: t < 6000 ? '黎明' : t < 12000 ? '白天' : t < 18000 ? '黄昏' : '夜',
    under: under ? under.name : '?',
    inv, hostiles,
  };
}

async function llmDecide(snap) {
  const goal = fs.existsSync(GOALS) ? fs.readFileSync(GOALS, 'utf-8').slice(-500) : '（还没有阶段目标）';
  const user = `目标：${goal}
状态：HP ${snap.hp}/20 饱 ${snap.food}/20 时间 ${snap.time} 脚下 ${snap.under} 位置 ${JSON.stringify(snap.pos)}
背包：${snap.inv.join(', ') || '空'}
20格内敌人：${snap.hostiles.join(', ') || '无'}
上几轮：${recent.slice(-3).map(r => r.action + (r.result ? '(' + r.result.slice(0, 20) + ')' : '')).join(' → ') || '无'}
请决定这一轮。只输出 JSON。`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(30, CFG.turnSeconds - 5) * 1000);
  try {
    const res = await fetch(CFG.llmBase + '/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CFG.llmKey },
      body: JSON.stringify({ model: CFG.model, messages: [{ role: 'system', content: PERSONA }, { role: 'user', content: user }], temperature: 0.8, max_tokens: 600 }),
    });
    if (!res.ok) throw new Error('llm_http_' + res.status);
    const d = await res.json();
    const text = (d.choices[0].message.content || '').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('llm_no_json');
    return JSON.parse(m[0]);
  } finally { clearTimeout(timer); }
}

function timeout(ms) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; }

let noPathStreak = 0;
async function lostEscape() {
  // 连续无路 = 被困在台地/墙角。不求解了：朝随机方向直跑两秒，撞树撞墙就停，交给下一轮再想。
  try { bot.look(bot.entity.yaw + (Math.random() - 0.5) * 3, 0, true); } catch (e) {}
  bot.setControlState('sprint', true);
  bot.setControlState('forward', true);
  await new Promise(r => setTimeout(r, 2500));
  bot.setControlState('forward', false);
  bot.setControlState('sprint', false);
}

async function exec(dec) {
  const a = dec.action || 'rest';
  const P = dec.params || {};
  const hard = timeout(CFG.turnSeconds * 1000);
  try {
    if (a === 'goto' && Number.isFinite(P.x) && Number.isFinite(P.z)) {
      await bot.pathfinder.goto(new goals.GoalXZ(P.x, P.z)); return 'ok';
    }
    if (a === 'wander') {
      const c = bot.entity.position;
      await bot.pathfinder.goto(new goals.GoalXZ(Math.round(c.x + (Math.random() - .5) * 60), Math.round(c.z + (Math.random() - .5) * 60)));
      return 'ok';
    }
    if (a === 'mine') {
      const b = bot.findBlock({ matching: x => x.name === P.what || x.name === 'minecraft:' + P.what, maxDistance: 24 });
      if (!b) return 'no_target';
      await bot.dig(b, 'ignoreDistance');
      return 'ok';
    }
    if (a === 'chop') {
      const b = bot.findBlock({ matching: x => x.name.includes('log'), maxDistance: 20 });
      if (!b) return 'no_tree';
      await bot.dig(b, 'ignoreDistance'); return 'ok';
    }
    if (a === 'eat') {
      const it = bot.inventory.items().find(i => i.name === P.what || i.name.includes(P.what || 'apple'));
      if (!it) return 'no_food';
      await bot.equip(it, 'hand'); await bot.consume(); return 'ok';
    }
    if (a === 'craft') {
      const item = bot.registry.itemsByName[P.what] || bot.registry.itemsByName['minecraft:' + P.what];
      if (!item) return 'no_item';
      const rs = bot.recipesFor(item.id, null, 1, null);   // null 桌子=只用背包 2x2
      if (!rs.length) return 'no_recipe_or_mat';
      await bot.craft(rs[0], 1, null); return 'ok';
    }
    if (a === 'fight') {
      const e = bot.nearestEntity(x => x.position && ['zombie', 'skeleton', 'creeper', 'spider', 'drowned', 'pillager'].some(k => x.name && x.name.includes(k)));
      if (!e) return 'no_enemy';
      await bot.pathfinder.goto(new goals.GoalFollow(e, 1));
      try { await bot.attack(e); } catch (err) { return 'attack_fail'; }
      return 'ok';
    }
    if (a === 'flee') {
      const e = bot.nearestEntity(x => x.position && (x.name || '').match(/zombie|skeleton|creeper|spider|drowned/));
      const dir = e ? e.position.minus(bot.entity.position) : { x: 1, y: 0, z: 0 };
      const g = bot.entity.position.offset(-dir.x * 2, 0, -dir.z * 2).normalize().times(30);
      await bot.pathfinder.goto(new goals.GoalNear((bot.entity.position.x + g.x) | 0, (bot.entity.position.z + g.z) | 0, 4));
      return 'ok';
    }
    if (a === 'place_torch') {
      const it = bot.inventory.items().find(i => i.name.includes('torch'));
      if (!it) return 'no_torch';
      const ref = bot.blockAt(bot.entity.position);
      if (ref) await bot.placeBlock(ref, vec3up);
      return 'ok';
    }
    if (a === 'sleep') {
      const bed = bot.findBlock({ matching: x => x.name.includes('bed'), maxDistance: 30 });
      if (!bed) return 'no_bed';
      await bot.sleep(bed); return 'ok';
    }
    if (a === 'set_goal' && P.goal) {
      fs.appendFile(GOALS, `# ${new Date().toISOString().slice(0, 16)}\n${String(P.goal).slice(0, 200)}\n`, () => {});
      return 'ok';
    }
    if (a === 'chat' && (dec.say || P.say)) { bot.chat(String(dec.say || P.say).slice(0, 100)); return 'ok'; }
    return 'idle';
  } catch (e) {
    try { bot.pathfinder.stop(); } catch (_) {}
    return 'fail:' + String(e.message || e).slice(0, 60);
  } finally { hard.done(); }
}

const vec3up = { x: 0, y: 1, z: 0 };

async function speak(text) {
  if (!text) return;
  try {
    const u = `${CFG.ttsBase}/tts?text=${encodeURIComponent(text)}&voice=${CFG.voice}&format=mp3`;
    const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(CFG.stateDir, 'voice', 'latest.mp3'), buf);
      append(THINK, { t: new Date().toISOString(), kind: 'voice', bytes: buf.length, text });
    }
  } catch (e) { append(THINK, { t: new Date().toISOString(), kind: 'voice_fail', err: String(e.message).slice(0, 60) }); }
}

async function turn() {
  const startedAt = Date.now();
  let dec = null, snap = null, result = 'skipped';
  try {
    snap = snapshot();
    dec = await llmDecide(snap);
    if (dec.say) bot.chat(String(dec.say).slice(0, 100));
    if (dec.say) speak(dec.say);
    result = await exec(dec);
    if (/No path|stopped before/i.test(result)) {
      noPathStreak++;
      if (noPathStreak >= 2) { await lostEscape(); noPathStreak = 0; result += '+escape'; }
    } else noPathStreak = 0;
    recent.push({ action: dec.action || '?', result });
    if (recent.length > 8) recent.shift();
  } catch (e) {
    errCount++;
    result = 'turn_error:' + String(e.message || e).slice(0, 60);
  }
  turnCount++;
  const rec = { t: new Date().toISOString(), n: turnCount, think: dec && dec.think, say: dec && dec.say, action: dec && dec.action, result, ms: Date.now() - startedAt, snap };
  append(THINK, rec);
  fs.writeFileSync(STATUS, JSON.stringify({ name: CFG.name, alive: true, turn: turnCount, errCount, deaths, last: rec, at: new Date().toISOString() }, null, 1));
}

async function mainLoop() {
  while (true) {
    try {
      if (bot && bot.entity) await turn();
      else await new Promise(r => setTimeout(r, 5000));
    } catch (e) { log('loop_swallow', { err: String(e).slice(0, 80) }); }
    await new Promise(r => setTimeout(r, CFG.restSeconds * 1000));
  }
}

function connect() {
  log('connect', { host: CFG.host, port: CFG.port, name: CFG.name, llm: CFG.llmBase, model: CFG.model });
  bot = mineflayer.createBot({ host: CFG.host, port: CFG.port, username: CFG.name, version: CFG.version, auth: 'offline', checkVersion: false });
  bot.on('spawn', () => log('spawn', { pos: bot.entity.position.jsonable ? bot.entity.position.toString() : String(bot.entity.position) }));
  bot.on('death', () => {
    deaths++;
    log('death', { n: deaths });
    append(THINK, { t: new Date().toISOString(), kind: 'death', count: deaths });
    setTimeout(() => { try { bot.respawn(); } catch (e) { log('respawn_fail', { err: String(e).slice(0, 80) }); } }, 4000);
  });
  bot.on('error', e => { errCount++; log('bot_error', { err: String(e.message).slice(0, 100) }); });
  bot.on('end', reason => { log('bot_end', { reason }); setTimeout(connect, 15000); });
  bot.on('kicked', r => log('kicked', { r: String(r).slice(0, 120) }));
  bot.loadPlugin(pfPlugin);
}
let deaths = 0;
process.on('unhandledRejection', e => log('unhandled_rejection', { err: String(e).slice(0, 120) }));
process.on('uncaughtException', e => {
  errCount++;
  log('uncaught_swallowed', { err: String(e && e.message || e).slice(0, 140) });
  try { if (bot && bot._client) bot._client.end(); } catch (_) {}   // 触发 end→重连，别带病挂机
});
connect();
mainLoop();
