// Goddess act: the smallest possible "hands" for Sticia (in-game account Goddess).
// Design contract (agreed with 扛枪 2026-09-28):
//   * fixed action enum only — no free-form command string ever reaches RCON
//   * every generated command must ALSO match the per-action allow-pattern (defence in depth)
//   * default is --dry-run; nothing is sent unless --commit is given
//   * targets must be online and match a strict player-name shape (Floodgate "." prefix allowed)
//   * read-only actions (peek) never need --commit and never hit the cooldown
//   * every attempted action is appended to E:\MC\ops\goddess-admin-audit.jsonl
// Forbidden by construction: op deop gamemode ban pardon whitelist stop reload difficulty
// gamerule kill setblock fill clone datapack schedule forceload tag scoreboard summon enchant.
// Credentials: read locally from server.properties, never printed, never taken from argv/env.

import net from 'node:net';
import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { deliverGift } from './goddess-delivery.mjs';

const HOST = '127.0.0.1';
const PORT = 25575;
const PROPS = 'E:/MC/server/server.properties';
const AUDIT = 'E:/MC/ops/goddess-admin-audit.jsonl';
const STATE = 'E:/MC/ops/goddess-act-state.json';
const VILLAGE = { x: -544, y: 67, z: -440 }; // spawn village, from ops/FAMILY_WORLD.md
const COOLDOWN_MS = 30_000;
// Write actions that need a live target: refuse politely if that player is offline.
const NEEDS_TARGET = new Set(['guide', 'relight', 'feather', 'heal', 'bread', 'bed', 'sword', 'mendingbook', 'wonder', 'knight', 'charm']);
const ACTOR = 'qwenpaw:mc_godness:goddess-act';

const NAME = /^[A-Za-z0-9_.-]{1,17}$/; // 3-16 vanilla + optional Floodgate dot prefix
const nameOk = (n) => typeof n === 'string' && NAME.test(n) && n.replace(/^\./, '').length >= 3 && n.length <= 17;
const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f\u00a7"'`;|&$\\]/g, '');

const DURATION = { relight: 120, feather: 45 };
const EFFECT = { relight: 'minecraft:night_vision', feather: 'minecraft:slow_falling' };

// 神迹文案：只允许这几个预设（--say 选一个），没有自由文本入口
const SAY = {
  bed: ['{"text":"女神在看着你","color":"light_purple","bold":true}',
        '{"text":"粉色床和会冒火的剑，是女神送你的","color":"aqua"}'],
  gift: ['{"text":"女神在看着你","color":"light_purple","bold":true}',
         '{"text":"这一身装备是女神送你的，别怕黑","color":"aqua"}'],
  heal: ['{"text":"女神把你的血补满了","color":"light_purple","bold":true}',
         '{"text":"天黑前回村，或者放床睡一觉","color":"green"}'],
  welcome: ['{"text":"欢迎回家，萌萌","color":"light_purple","bold":true}',
            '{"text":"村里很安全，女神一直在看着你","color":"gold"}'],
};

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 骑士礼包：全部是写死的物品+附魔字面量（原版合法等级），一行动作一次发完
const KNIGHT_KIT = [
  'minecraft:diamond_helmet[enchantments={levels:{"minecraft:protection":4,"minecraft:unbreaking":3,"minecraft:mending":1}}] 1',
  'minecraft:diamond_chestplate[enchantments={levels:{"minecraft:protection":4,"minecraft:unbreaking":3,"minecraft:mending":1}}] 1',
  'minecraft:diamond_leggings[enchantments={levels:{"minecraft:protection":4,"minecraft:unbreaking":3,"minecraft:mending":1}}] 1',
  'minecraft:diamond_boots[enchantments={levels:{"minecraft:protection":4,"minecraft:feather_falling":4,"minecraft:unbreaking":3,"minecraft:mending":1}}] 1',
  'minecraft:diamond_sword[enchantments={levels:{"minecraft:sharpness":5,"minecraft:fire_aspect":1,"minecraft:unbreaking":3,"minecraft:mending":1}}] 1',
  'minecraft:bow[enchantments={levels:{"minecraft:power":4,"minecraft:infinity":1,"minecraft:unbreaking":3}}] 1',
  'minecraft:arrow 1',
  'minecraft:shield 1',
  'minecraft:golden_apple 3',
  'minecraft:milk_bucket 1',
];

// action -> { cmds(target, opts), pattern }
const ACTIONS = {
  peek: {
    readOnly: true,
    build: (t, opts) => ({
      list: ['minecraft:list'],
      tps: ['tps'],          // Paper built-in, not namespaced under minecraft:
      mspt: ['mspt'],
      uptime: ['uptime'],
      time: ['minecraft:time query day'],
    })[opts.sub || 'list'] || null,
    pattern: /^(minecraft:(list|time query day)|tps|mspt|uptime)$/,
  },
  watch: {
    readOnly: true, // safety telemetry only — no --commit, no cooldown, nothing is written to the world
    checkOnline: true,
    // Deliberately limited to 4 survival-relevant fields. No Inventory, no EnderItems, no block/chest
    // contents: a child's private things are not telemetry. (authorized by 扛枪 2026-09-28, read-only)
    build: (t) => (!nameOk(t) ? null : [
      `minecraft:data get entity ${t} Health`,
      `minecraft:data get entity ${t} XpLevel`,
      `minecraft:data get entity ${t} Pos`,
      `minecraft:data get entity ${t} Dimension`,
    ]),
    pattern: /^minecraft:data get entity [A-Za-z0-9_.-]{3,17} (Health|XpLevel|Pos|Dimension)$/,
  },
  mood: {
    readOnly: false,
    build: (t, opts) => {
      const v = opts.sub;
      // Paper 1.20.6 accepts the literal `day` but rejects `sunset` ("Expected float"),
      // so dusk goes through the tick value. Verified live 2026-09-28.
      if (v === 'day') return ['minecraft:time set day'];
      if (v === 'sunset') return ['minecraft:time set 12000'];
      if (v === 'clear' || v === 'rain') return [`minecraft:weather ${v}`];
      return null;
    },
    pattern: /^minecraft:(time set (day|12000)|weather (clear|rain))$/,
  },
  guide: {
    readOnly: false,
    build: (t, opts) => {
      if (!opts.to) return null;
      if (opts.to === 'village') return [`minecraft:tp ${t} ${VILLAGE.x} ${VILLAGE.y} ${VILLAGE.z}`];
      if (!nameOk(opts.to) || opts.to === t) return null;
      return [`minecraft:tp ${t} ${opts.to}`];
    },
    pattern: /^minecraft:tp [A-Za-z0-9_.-]{3,17} (-?\d+ \d+ -?\d+|[A-Za-z0-9_.-]{3,17})$/,
  },
  relight: {
    readOnly: false,
    build: (t) => [`minecraft:effect give ${t} ${EFFECT.relight} ${DURATION.relight} 1 true`],
    pattern: /^minecraft:effect give [A-Za-z0-9_.-]{3,17} minecraft:night_vision 120 1 true$/,
  },
  feather: {
    readOnly: false,
    build: (t) => [`minecraft:effect give ${t} ${EFFECT.feather} ${DURATION.feather} 1 true`],
    pattern: /^minecraft:effect give [A-Za-z0-9_.-]{3,17} minecraft:slow_falling 45 1 true$/,
  },
  heal: {
    readOnly: false,
    build: (t) => [`minecraft:effect give ${t} minecraft:instant_health 1 1 true`],
    pattern: /^minecraft:effect give [A-Za-z0-9_.-]{3,17} minecraft:instant_health 1 1 true$/,
  },
  bread: {
    readOnly: false,
    build: (t) => [`minecraft:give ${t} minecraft:bread 4`],
    pattern: /^minecraft:give [A-Za-z0-9_.-]{3,17} minecraft:bread 4$/,
  },
  // 给萌萌的礼物类：物件写死在模板里，只接受校验过的在线目标。
  bed: {
    readOnly: false,
    build: (t) => [`minecraft:give ${t} minecraft:pink_bed 1`],
    pattern: /^minecraft:give [A-Za-z0-9_.-]{3,17} minecraft:pink_bed 1$/,
  },
  sword: {
    readOnly: false,
    // 1.20.5+ data-component form: enchantments go in the item, not a separate /enchant call.
    // 火焰附加 = minecraft:fire_aspect, level 1 (enough for a kid; not a god-slaying blade).
    build: (t) => [`minecraft:give ${t} minecraft:diamond_sword[enchantments={levels:{"minecraft:fire_aspect":1}}] 1`],
    pattern: /^minecraft:give [A-Za-z0-9_.-]{3,17} minecraft:diamond_sword\[enchantments=\{levels:\{"minecraft:fire_aspect":1\}\}\] 1$/,
  },
  // Books store transferable enchants separately from equipment enchants.
  mendingbook: {
    readOnly: false,
    gift: 'mending_book',
    build: (t) => [`minecraft:give ${t} minecraft:enchanted_book[stored_enchantments={levels:{"minecraft:mending":1}}] 1`],
    pattern: /^minecraft:give [A-Za-z0-9_.-]{3,17} minecraft:enchanted_book\[stored_enchantments=\{levels:\{"minecraft:mending":1\}\}\] 1$/,
  },
  // 女神的"神迹"：屏幕大字 + 一行小字 + 光点 + 一声轻响。全部字面量写死，目标名是唯一变量。
  wonder: {
    readOnly: false,
    build: (t, opts) => {
      const say = SAY[opts.say || 'bed'];
      if (!say) return null;
      return [
        `minecraft:title ${t} times 5 80 20`,
        `minecraft:title ${t} title ${say[0]}`,
        `minecraft:title ${t} subtitle ${say[1]}`,
        `minecraft:execute as ${t} at ${t} run particle minecraft:end_rod ~ ~1 ~ 0.5 0.8 0.5 0.02 220`,
        `minecraft:execute as ${t} at ${t} run playsound minecraft:entity.player.levelup master @s ~ ~ ~ 1 1.3`,
      ];
    },
    pattern: [
      /^minecraft:title [A-Za-z0-9_.-]{3,17} times 5 80 20$/,
      ...Object.values(SAY).flatMap(([a, b]) => [
        new RegExp(`^minecraft:title [A-Za-z0-9_.-]{3,17} title ${escRe(a)}$`),
        new RegExp(`^minecraft:title [A-Za-z0-9_.-]{3,17} subtitle ${escRe(b)}$`),
      ]),
      /^minecraft:execute as [A-Za-z0-9_.-]{3,17} at [A-Za-z0-9_.-]{3,17} run particle minecraft:end_rod ~ ~1 ~ 0\.5 0\.8 0\.5 0\.02 220$/,
      /^minecraft:execute as [A-Za-z0-9_.-]{3,17} at [A-Za-z0-9_.-]{3,17} run playsound minecraft:entity\.player\.levelup master @s ~ ~ ~ 1 1\.3$/,
    ],
  },
  // 一整套"骑士礼包"：钻石甲四件（保护IV+耐久III+修补）、锋利V钻石剑、无限弓、盾、金苹果、牛奶
  knight: {
    readOnly: false,
    build: (t) => KNIGHT_KIT.map((line) => `minecraft:give ${t} ${line}`),
    pattern: KNIGHT_KIT.map((line) => new RegExp(`^minecraft:give [A-Za-z0-9_.-]{3,17} ${escRe(line)}$`)),
  },
  // 护身符 = 不死图腾：手里拿着时，致死的伤害会免掉一次（左手或右手都算）
  charm: {
    readOnly: false,
    build: (t) => [`minecraft:give ${t} minecraft:totem_of_undying 1`],
    pattern: /^minecraft:give [A-Za-z0-9_.-]{3,17} minecraft:totem_of_undying 1$/,
  },
};

const FORBIDDEN = /^(op|deop|gamemode|defaultgamemode|ban|ban-ip|pardon|pardon-ip|whitelist|stop|restart|reload|difficulty|gamerule|kill|setblock|fill|clone|datapack|schedule|forceload|tag|scoreboard|summon|enchant|recipe|team|permission|backpack|ess)$/i;
// second net: scan the whole command too, so a sub-command hidden behind `execute ... run` can't slip in
const FORBIDDEN_INLINE = /\b(op|deop|gamemode|defaultgamemode|ban|ban-ip|pardon|whitelist|stop|reload|difficulty|gamerule|kill|setblock|fill|clone|forceload|summon|clear)\b/i;

function record(event) {
  const line = JSON.stringify({ at: new Date().toISOString(), actor: ACTOR, ...event });
  try { appendFileSync(AUDIT, line + '\n', 'utf8'); } catch { /* audit must not break a rescue */ }
}

function loadState() {
  try { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}; } catch { return {}; }
}

function noteCooldown(key) {
  const st = loadState();
  st[key] = Date.now();
  try { writeFileSync(STATE, JSON.stringify(st), 'utf8'); } catch { /* best effort */ }
}

async function rconBatch(commands) {
  const password = readFileSync(PROPS, 'utf8').match(/^rcon\.password=(.*)$/m)?.[1]?.trim();
  if (!password) throw new Error('local RCON credential unavailable');
  const pkt = (id, type, body) => {
    const b = Buffer.from(body, 'utf8');
    const out = Buffer.alloc(12 + b.length + 2);
    out.writeInt32LE(10 + b.length, 0);
    out.writeInt32LE(id, 4);
    out.writeInt32LE(type, 8);
    b.copy(out, 12);
    return out;
  };
  return await new Promise((resolve, reject) => {
    const sock = net.connect(PORT, HOST);
    sock.setTimeout(8000);
    let buf = Buffer.alloc(0), authed = false, idx = 0;
    const results = [];
    const replyId = new Map();
    const done = (err) => {
      sock.destroy();
      err ? reject(err) : resolve(results);
    };
    sock.on('error', done);
    sock.on('timeout', () => done(new Error('RCON timeout')));
    sock.on('connect', () => sock.write(pkt(901, 3, password)));
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 12) return;
        const len = buf.readInt32LE(0);
        if (buf.length < 4 + len) return;
        const id = buf.readInt32LE(4), type = buf.readInt32LE(8);
        const body = buf.subarray(12, 4 + len - 2).toString('utf8');
        buf = buf.subarray(4 + len);
        if (!authed) {
          if (id === -1) return done(new Error('RCON auth rejected'));
          if (id === 901 && type === 2) { authed = true; sock.write(pkt(902, 2, commands[0])); replyId.set(902, 0); }
          continue;
        }
        if (type !== 0) continue;
        results[id - 902] = body || '(empty response)';
        idx = id - 902;
        if (idx + 1 < commands.length) { const nid = 902 + idx + 1; replyId.set(nid, idx + 1); sock.write(pkt(nid, 2, commands[idx + 1])); }
        else done();
      }
    });
  });
}

export function namesFromList(text) {
  const m = text.match(/There (?:are|is) \d+ of a max of \d+ players online:\s*(.*)$/i);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().match(/(?:^|\s)([A-Za-z0-9_.-]{3,17})\s+\([a-f0-9-]{36}\)$/i)?.[1]).filter(Boolean);
}

async function onlineNames() {
  const out = await rconBatch(['minecraft:list uuids']);
  const text = (out[0] || '') + ' ' + (out[1] || '');
  const names = namesFromList(text.trim());
  return { count: names.length, names, raw: text.trim() };
}

const WORLD_ACTIONS = new Set(['peek', 'mood']); // second positional is a mode, not a player

function parseArgv(argv) {
  const positional = [], opts = { commit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--commit') opts.commit = true;
    else if (a === '--to') { i += 1; opts.to = argv[i]; }
    else if (a === '--say') { i += 1; opts.say = argv[i]; }
    else positional.push(a);
  }
  const action = positional[0];
  const isWorld = WORLD_ACTIONS.has(action);
  return { action, sub: isWorld ? positional[1] : undefined, target: isWorld ? undefined : positional[1], opts };
}

export async function run(argv = process.argv.slice(2)) {
  const { action, sub, target, opts } = parseArgv(argv);
  if (sub !== undefined) opts.sub = sub;
  const spec = action && ACTIONS[action];
  if (!spec) {
    const msg = `unknown or unavailable action: ${clean(action || '(none)')}; allowed: ${Object.keys(ACTIONS).join(' ')}`;
    record({ action: clean(action || '(none)'), target: clean(target || ''), commit: false, error: msg });
    return { ok: false, code: 64, message: msg };
  }
  const key = `${action}:${target || opts.sub || ''}`;
  if (!spec.readOnly && target !== undefined && !nameOk(target)) {
    return { ok: false, code: 65, message: `invalid target name: ${clean(target)}` };
  }
  const commands = spec.build(target ?? '', opts);
  if (!commands || !commands.length) {
    return { ok: false, code: 66, message: `missing or invalid argument for ${action} (see header comment)` };
  }
  const patterns = Array.isArray(spec.pattern) ? spec.pattern : [spec.pattern];
  for (const c of commands) {
    const verb = c.replace(/^minecraft:/, '').trim().split(/\s+/)[0];
    if (FORBIDDEN.test(verb) || FORBIDDEN_INLINE.test(c) || !patterns.some((re) => re.test(c))) {
      record({ action, target: target ?? opts.sub, commit: false, error: 'command rejected by policy' });
      return { ok: false, code: 67, message: `policy rejection: generated command did not match the allow-pattern` };
    }
  }
  if (!spec.readOnly && !opts.commit) {
    if (spec.gift) return { ok: true, dryRun: true,
      commands: [`mycli admin gift <request16> ${target} gift:${spec.gift} 1 <recipe-hash>`],
      message: 'dry-run only; pass --commit to use the verified delivery service' };
    return { ok: true, dryRun: true, commands, message: 'dry-run only; pass --commit to send' };
  }
  if (!spec.readOnly) {
    const st = loadState()[key];
    if (st && Date.now() - st < COOLDOWN_MS) {
      return { ok: false, code: 68, message: `cooldown: ${Math.ceil((COOLDOWN_MS - (Date.now() - st)) / 1000)}s left for ${key}` };
    }
  }
  if (spec.checkOnline || NEEDS_TARGET.has(action)) {
    const who = await onlineNames();
    if (!who.names.includes(target)) {
      record({ action, target, commit: true, error: 'target not online', online: who.names });
      return { ok: false, code: 69, message: `${target} is not online; nothing sent (online: ${who.names.join(', ') || 'none'})` };
    }
  }
  if (spec.gift) {
    const request = randomBytes(8).toString('hex');
    noteCooldown(key);
    record({ action, target, request, commit: true, phase: 'requested' });
    try {
      const result = await deliverGift(target, { decision: 'approve', gift: spec.gift, amount: 1 }, request);
      record({ action, target, request, commit: true, result });
      return { ok: result.ok, code: result.ok ? 0 : 71, results: [JSON.stringify(result)], requestId: request };
    } catch (error) {
      record({ action, target, request, commit: true, error: error.message });
      return { ok: false, code: 71, message: `Unconfirmed gift request=${request}; check mycli admin giftstatus before retrying: ${clean(error.message)}` };
    }
  }
  const results = await rconBatch(commands);
  if (!spec.readOnly) noteCooldown(key);
  record({ action, target: target ?? null, sub: opts.sub ?? null, commit: true, commands, result: String(results.join(' | ')).slice(0, 400) });
  return { ok: true, dryRun: false, commands, results, requestId: randomUUID().slice(0, 8) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().then((r) => {
    const out = r.results ? r.results.join('\n') : r.message;
    console.log(`${r.ok ? (r.dryRun ? 'DRY-RUN' : 'OK') : 'DENIED'} ${r.commands ? r.commands.join(' ;; ') : ''}\n${out}`);
    process.exit(r.ok ? 0 : r.code || 1);
  }).catch((e) => { console.log('ERROR ' + clean(e.message)); process.exit(70); });
}
