// 光环家族回归锚(2026-08-29 两坑各配闸):
//  坑A:bootstrap 转发 lambda 只搬 4 参,吞掉第 5 参 atomId → 光环元素分派恒空
//       →「此法术未通」静默失败。闸:禁止逐参转发 lambda 回归。
//  坑B:新 7 环词表与旧 53 术互含(『迅捷光环』被 swift『迅捷』截胡等 11 处)
//       → 念新环咏的是旧术。闸:全 atoms 两两词表互含检查,零容忍。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bootstrap = readFileSync(join(root, "bootstrap-world.mts"), "utf8");
const god = readFileSync(join(root, "src", "mc-god.ts"), "utf8");
const magic = readFileSync(join(root, "src", "mc-magic.ts"), "utf8");
const atomsRaw = JSON.parse(readFileSync(join(root, "ops", "docker", "shadow", "data", "magic-atoms.json"), "utf8"));
const atoms = Array.isArray(atomsRaw) ? atomsRaw : atomsRaw.atoms;

// 光环名册随 2026-08-30 技能瘦身更迭：砍旧四元素/吸血咏唱光环（water/wind/earth/vampire，
// 功能被装备光环体系取代），现役 = 4 咏唱光环（fire/thunder/heal/speed）+ 2 附魔光环
// （ench_aura_bloodlust/healing，武器主动技族）+ 2 装备光环（aura_bloodlust/healing，穿着即生效）。
const AURA_IDS = ["fire_aura", "thunder_aura", "heal_aura", "speed_aura",
                  "ench_aura_bloodlust", "ench_aura_healing",
                  "aura_bloodlust", "aura_healing"];

test("坑A闸:specialExecutor 直传函数引用,不得回归逐参转发 lambda", () => {
  assert.ok(
    bootstrap.includes("magic.setSpecialExecutor(god.service.execSpecial)"),
    "必须直传 god.service.execSpecial(5 参含 atomId);逐参转发会吞 atomId",
  );
});

test("坑A闸:mc-god execSpecial 签名含第 5 参 atomId", () => {
  assert.ok(/execSpecial\(\s*special:[^)]*atomId = ''/m.test(god), "execSpecial 第 5 参 atomId 默认值签名被改");
});

test("坑A闸:mc-magic cast/castByGod 调用 specialExecutor 均传 atom.id", () => {
  const calls = magic.match(/specialExecutor\(atom\.special,[^)]*\)/g) ?? [];
  assert.ok(calls.length >= 2, `specialExecutor 调用点应≥2(cast+castByGod),现 ${calls.length}`);
  for (const c of calls) assert.ok(c.includes("atom.id"), `调用点丢 atom.id: ${c}`);
});

test("坑B闸:光环 8 环注册齐;非被动法术零同词;matchSpell 词长优先+跳过被动", () => {
  const byId = new Map(atoms.map((a) => [a.id, a]));
  for (const id of AURA_IDS) assert.ok(byId.has(id), `光环 ${id} 未注册`);
  // 2026-08-30 语义升级（二）：matchSpell 已改「词长优先 + 跳过 type:passive」——
  // 长咒词赢过短前缀子串（『闪电』⊂『附魔闪电链』）；被动装备系不经咏唱匹配（参悟走
  // CLI learn 分支，向量降级命中后由 cast 层给参悟指引）。闸语义随之：
  // ① 非被动 atoms 零同词（等长真歧义词长优先也救不了）；② 两处引擎实现锚防回退。
  const dup = [];
  const seen = new Map();
  for (const a of atoms) {
    if (a.type === "passive") continue;
    for (const w of a.words) {
      const prev = seen.get(w);
      if (prev && prev !== a.id) dup.push(`${w} 由 ${prev} 与 ${a.id} 同时认领`);
      seen.set(w, a.id);
    }
  }
  assert.deepEqual(dup, [], `非被动法术同一咒语被多家认领，真歧义:\n${dup.join("\n")}`);
  // 引擎锚①：词长优先（防回退成首中即返的截胡行为）
  assert.ok(
    /matchSpell[\s\S]{0,1100}hitLen > best\.len/.test(magic),
    "matchSpell 必须词长优先（hitLen > best.len）——首中即返会截胡长咒（闪电⊂附魔闪电链）",
  );
  // 引擎锚②：跳过 type:passive（防被动抢走咏唱版匹配：『夜视』『铁肤』『鱼鳃』『防火』）
  assert.ok(
    /matchSpell[\s\S]{0,1100}type === 'passive'\) continue/.test(magic),
    "matchSpell 必须跳过 type:passive——否则被动词撞咏唱版时文件序在前的被动会抢走匹配",
  );
});

test("光环系:咏唱光环 special 统一 'aura',元素由 atomId 分派;附魔/装备光环在册", () => {
  // 咏唱光环（fire/thunder/heal/speed）走 special='aura' 引擎；附魔光环（ench_aura_*）
  // 走武器主动技、装备光环（aura_bloodlust/healing）走 passiveId 装备化——只要求在册。
  const CHANT_AURAS = ["fire_aura", "thunder_aura", "heal_aura", "speed_aura"];
  for (const id of CHANT_AURAS) {
    const a = atoms.find((x) => x.id === id);
    assert.ok(a, `咏唱光环 ${id} 未注册`);
    assert.equal(a.special, "aura", `${id}.special 必须为 'aura'`);
  }
  for (const id of ["ench_aura_bloodlust", "ench_aura_healing", "aura_bloodlust", "aura_healing"]) {
    assert.ok(atoms.some((x) => x.id === id), `光环 ${id} 未注册`);
  }
  assert.ok(god.includes("AURA_SPECS"), "AURA_SPECS 表驱动引擎丢失");
});
