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
输出必须是严格 JSON（不要 markdown 围栏）。**第一个字符就必须是 {，禁止写任何分析过程、编号清单或开场白**：
{"think":"一句内心判断","say":"游戏里喊的话，**大多数轮留空**","action":"动作名","params":{...}}
话要少：只在发现稀有物、遇险、做出重要决定时开口，大约每 4-5 轮说一句； routine 砍树挖矿闷头干，别播报。
可用动作：
{"action":"goto","params":{"x":数,"z":数}}    走到坐标
{"action":"wander"}                             随机探索一段
{"action":"mine","params":{"what":"stone|coal_ore|iron_ore|oak_log","n":1到8}}  挖最近的某种方块
{"action":"chop"}                               砍最近的树
{"action":"eat","params":{"what":"golden_apple|apple|cooked_beef|bread"}}  吃东西
{"action":"craft","params":{"what":"stone_pickaxe|torch|planks|stick|crafting_table"}}  合成(需材料齐)
{"action":"fight"}                              打最近的敌对生物
{"action":"flee"}                               向远离最近敌人的方向撤 30 格
{"action":"place_torch"}                        插一支火把
{"action":"sleep"}                              找床睡觉
{"action":"set_goal","params":{"goal":"一句话阶段目标"}}
{"action":"rest"}                               原地观望几秒
不确定就 wander 或 rest。距离坐标不超过 120 格。say 保持口语短句。
找森林规矩：chop 返回 no_tree 或 chop_no_drop（保护区砍不了）连续出现，说明你脚下的地方采不出东西——**定一个固定方向，连着 goto 走远三四段（每段100格）**，中途别回头，直到脚下变草地/森林、看见树为止再干活；东南方向的河岸边就有树。
常识：挖不动石头(返回 dug_but_zero_drop)说明缺工具——先 craft "wooden_pickaxe"（3木板+2木棍，木板够的），不是 stone_pickaxe；镐子要工作台，放不下说明在别人的保护区，先 wander 离开 30 格再放。上一轮动作没让背包变多就是无用功，换思路别重复。
火把铁律：time=夜 或周围一暗，先看背包有没有 torch，没有就 craft "torch"（1煤或木炭+1木棍，2x2背包能造），然后 place_torch；夜里每走 8-10 格补一支——你在夜里干活必须自己照亮，也是替看直播的人照亮。白天不用插。
合成规矩：torch/planks/stick/crafting_table 都能背包2x2直接造，最省事；石镐石斧要3x3，返回 needs_crafting_table… 或 crafting_table_inaccessible… 就说明你在别人保护区里开不了桌子——别硬试，先 wander 60格到没围栏的空旷草地，再 craft crafting_table 摆下，然后才造镐。同一个动作连败两次就换别的活（挖掉落物、砍树、吃东西），绝不在原地死磕。结果带 protected/refused/no_drop 时系统会自动带你跑路(hardleave)，跑出去后专挑有树有石的野地干活，别回公会广场磨。`;

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
      body: JSON.stringify({ model: CFG.model, messages: [{ role: 'system', content: PERSONA }, { role: 'user', content: user }], temperature: 0.7, max_tokens: 1500 }),
    });
    if (!res.ok) throw new Error('llm_http_' + res.status);
    const d = await res.json();
    const msg = d.choices[0].message || {};
    // 推理型模型常把正文留空、答案塞进 reasoning_content；两处都捞。
    let text = ((msg.content || '') + '\n' + (msg.reasoning_content || '')).trim();
    const blocks = text.match(/```[\s\S]*?```/g) || [];
    for (const b of blocks) { const mm = b.match(/\{[\s\S]*\}/); if (mm) { try { return JSON.parse(mm[0]); } catch (e) { /* 继续找 */ } } }
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('llm_no_json:' + text.slice(0, 48).replace(/\s+/g, ' '));
    try { return JSON.parse(m[0]); }
    catch (e) {
      const m2 = text.match(/\{[\s\S]*?"action"[\s\S]*"params"[\s\S]*\}|\{[\s\S]*?"action"[\s\S]*\}/);
      if (m2) { try { return JSON.parse(m2[0]); } catch (e2) {} }
      throw new Error('llm_json_unparseable:' + text.slice(0, 48).replace(/\s+/g, ' '));
    }
  } finally { clearTimeout(timer); }
}

function timeout(ms) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; }

let noPathStreak = 0;
let selfCraftTable = null;   // 自己摆下的工作台（唯一可信、可开的）

function unstick() {
  try { bot.pathfinder.stop(); } catch (e) {}
  try { bot.setControlState('jump', false); bot.setControlState('forward', false); bot.setControlState('sprint', false); } catch (e) {}
}

// 寻路硬超时：mineflayer-pathfinder 撞墙时会原地无限跳着尝试爬墙，goto 永不返回。
// 每次 goto 都包一层死线，到点强制 stop+清控制键，把身体从卡死的寻路里拔出来。
function gotoHard(goal, ms) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      unstick();
      reject(new Error('goto_timeout_unstuck'));
    }, ms);
    bot.pathfinder.goto(goal).then(
      v => { if (!settled) { settled = true; clearTimeout(t); resolve(v); } },
      e => { if (!settled) { settled = true; clearTimeout(t); reject(e); } });
  });
}

async function lostEscape() {
  // 硬脱困：朝随机水平方向「啃着往前走」——挡路的栅栏/泥土/草甸挖开，1.x 格障碍跳。
  // 不依赖寻路（围栏内寻路必挂），纯控制流：前进+跳+挖面前方块，25 秒起步。
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]];
  const [dx, dz] = dirs[Math.floor(Math.random() * dirs.length)];
  let yaw = Math.atan2(-dx, dz);
  const start = bot.entity.position.clone();
  let stuckTicks = 0;
  bot.setControlState('sprint', true);
  bot.setControlState('forward', true);
  for (let i = 0; i < 40; i++) {
    try { await bot.look(yaw, 0, true); } catch (e) {}
    try { bot.setControlState('jump', true); } catch (e) {}
    // 面前腿高处的阻挡方块：能挖就挖（栅栏=可挖），石头挖不动就换向
    const fx = Math.round(Math.sin(yaw) * -1), fz = Math.round(Math.cos(yaw));
    const ahead = bot.blockAt(bot.entity.position.offset(fx, 0, fz)) || bot.blockAt(bot.entity.position.offset(fx, -1, fz));
    if (ahead && ahead.name !== 'air' && ahead.diggable) {
      try { await Promise.race([bot.dig(ahead, 'ignoreDistance'), new Promise(r => setTimeout(r, 2200))]); } catch (e) {}
    }
    await new Promise(r => setTimeout(r, 700));
    const moved = bot.entity.position.distanceTo(start);
    if (i > 2 && moved < 1.2) { stuckTicks++; if (stuckTicks > 3) { yaw += 1.3; stuckTicks = 0; } } else stuckTicks = 0;
    if (moved > 45) break;
  }
  bot.setControlState('forward', false);
  bot.setControlState('jump', false);
  bot.setControlState('sprint', false);
}

async function exec(dec) {
  const a = dec.action || 'rest';
  const P = dec.params || {};
  const hard = timeout(CFG.turnSeconds * 1000);
  try {
    if (a === 'goto' && Number.isFinite(P.x) && Number.isFinite(P.z)) {
      await gotoHard(new goals.GoalXZ(P.x, P.z), 40000); return 'ok';
    }
    if (a === 'wander') {
      const c = bot.entity.position;
      await gotoHard(new goals.GoalXZ(Math.round(c.x + (Math.random() - .5) * 60), Math.round(c.z + (Math.random() - .5) * 60)), 40000);
      return 'ok';
    }
    if (a === 'mine') {
      const b = bot.findBlock({ matching: x => x.name === P.what || x.name === 'minecraft:' + P.what, maxDistance: 24 });
      if (!b) return 'no_target';
      if (b.position.distanceTo(bot.entity.position) > 3) {   // 太远=挖了掉地上捡不到，先走过去
        try { await gotoHard(new goals.GoalNear(b.position.x, b.position.y, b.position.z, 2), 40000); } catch (e) { return 'walk_to_target_failed_nearby_only'; }
      }
      const t0 = bot.inventory.items().reduce((s, i) => s + i.count, 0);
      await bot.dig(b, 'ignoreDistance');
      await new Promise(r => setTimeout(r, 900));   // 等掉落物入包再算数
      const t1 = bot.inventory.items().reduce((s, i) => s + i.count, 0);
      return t1 > t0 ? 'ok' : 'dug_but_zero_drop_need_pickaxe_first';
    }
    if (a === 'chop') {
      const b = bot.findBlock({ matching: x => x.name.includes('log'), maxDistance: 20 });
      if (!b) return 'no_tree';
      if (b.position.distanceTo(bot.entity.position) > 3) {   // 走树下再砍，原木才掉脚边
        try { await gotoHard(new goals.GoalNear(b.position.x, b.position.y, b.position.z, 2), 30000); }
        catch (e) { return 'walk_to_tree_failed'; }
      }
      const before = bot.inventory.items().filter(i => i.name.includes('log')).reduce((s, i) => s + i.count, 0);
      await bot.dig(b, 'ignoreDistance');
      await new Promise(r => setTimeout(r, 1200));
      const after = bot.inventory.items().filter(i => i.name.includes('log')).reduce((s, i) => s + i.count, 0);
      // 只报诚实结果：挖了木头没进包 = 被服务端回滚（保护区）或够不到，绝不能说 ok
      return after > before ? 'ok' : 'chop_no_drop_protected_or_unreach_leave_area';
    }
    if (a === 'eat') {
      const it = bot.inventory.items().find(i => i.name === P.what || i.name.includes(P.what || 'apple'));
      if (!it) return 'no_food';
      await bot.equip(it, 'hand'); await bot.consume(); return 'ok';
    }
    if (a === 'craft') {
      const want = String(P.what || '').toLowerCase();
      let item = bot.registry.itemsByName[want] || bot.registry.itemsByName['minecraft:' + want];
      if (!item) {  // 模糊名兜底：planks→oak_planks、stick→oak_stick
        const cand = Object.keys(bot.registry.itemsByName).find(n => n === 'oak_' + want || n.endsWith('_' + want));
        if (cand) item = bot.registry.itemsByName[cand];
      }
      if (!item) return 'no_item';
      const withTimeout = (p, ms, tag) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(tag)), ms))]);
      // 1) 背包 2x2 优先（木板/木棍/火把/工作台本身都是 2x2，不需要桌子）
      let rs = bot.recipesFor(item.id, null, 1, null);
      if (rs.length) {
        try { await withTimeout(bot.craft(rs[0], 1, null), 12000, 'craft_2x2_hang'); return 'ok'; }
        catch (e) { try { bot.closeWindow(bot.currentWindow); } catch (_) {} return 'craft_2x2_failed_move_on'; }
      }
      // 2) 需要 3x3（镐/斧等）：只用自己的工作台，且硬超时；绝不去开别人/保护区内打不开的桌子
      let myTable = selfCraftTable;
      if (!myTable) {
        const tItem = bot.inventory.items().find(i => i.name === 'crafting_table');
        const ground = bot.blockAt(bot.entity.position.offset(0, -1, 0));
        if (tItem && ground && ground.name !== 'air') {
          try { await bot.placeBlock(ground, vec3up); } catch (e) {}
          await new Promise(r => setTimeout(r, 500));
          myTable = bot.findBlock({ matching: x => x.name === 'crafting_table', maxDistance: 4 }) || null;
          if (myTable) selfCraftTable = myTable;
        }
      }
      if (!myTable) return 'needs_crafting_table_place_one_on_open_ground';
      try {
        const ok2 = await withTimeout(bot.craft(bot.recipesFor(item.id, null, 1, myTable)[0], 1, myTable), 8000, 'table_unreachable');
        return 'ok';
      } catch (e) {
        try { bot.closeWindow(bot.currentWindow); } catch (_) {}
        selfCraftTable = null;   // 这张桌子开不了，别再信它
        return String(e.message).includes('table_unreachable')
          ? 'crafting_table_inaccessible_move_60_blocks_to_open_ground_and_place_new_table'
          : 'craft_failed_use_2x2_items_instead';
      }
    }
    if (a === 'fight') {
      const e = bot.nearestEntity(x => x.position && ['zombie', 'skeleton', 'creeper', 'spider', 'drowned', 'pillager'].some(k => x.name && x.name.includes(k)));
      if (!e) return 'no_enemy';
      await gotoHard(new goals.GoalFollow(e, 1), 40000);
      try { await bot.attack(e); } catch (err) { return 'attack_fail'; }
      return 'ok';
    }
    if (a === 'flee') {
      const e = bot.nearestEntity(x => x.position && (x.name || '').match(/zombie|skeleton|creeper|spider|drowned/));
      const dir = e ? e.position.minus(bot.entity.position) : { x: 1, y: 0, z: 0 };
      const g = bot.entity.position.offset(-dir.x * 2, 0, -dir.z * 2).normalize().times(30);
      await gotoHard(new goals.GoalNear((bot.entity.position.x + g.x) | 0, (bot.entity.position.z + g.z) | 0, 4), 30000);
      return 'ok';
    }
    if (a === 'place_torch') {
      const it = bot.inventory.items().find(i => i.name.includes('torch'));
      if (!it) return 'no_torch';
      await bot.equip(it, 'hand');
      try { await bot.look(0, -Math.PI / 4, true); } catch (e) {}
      const under = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (under && under.name !== 'air') { await bot.placeBlock(under, vec3up); return 'ok_underfoot'; }
      const p = bot.entity.position;
      const ref = bot.blockAt(p.offset(Math.round(Math.cos(bot.entity.yaw)), -1, Math.round(Math.sin(bot.entity.yaw))));
      if (ref && ref.name !== 'air') { await bot.placeBlock(ref, vec3up); return 'ok'; }
      return 'no_floor_to_place';
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
    // 环境拒绝(保护区/挖不动/寻路撞死)连撞两次 → 不等 LLM 开窍，直接物理跑路
    if (/Server refused|placement_refused|chop_no_drop|dug_but_zero|No path|Path was stopped|goto_timeout|walk_to_target_failed/i.test(result)) {
      noPathStreak++;
      if (noPathStreak >= 2) { await lostEscape(); noPathStreak = 0; result += '+hardleave'; }
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
