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

const AURA_IDS = ["fire_aura", "water_aura", "wind_aura", "earth_aura", "thunder_aura", "vampire_aura", "heal_aura", "speed_aura"];

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

test("坑B闸:光环 8 环注册齐,全库法术两两词表零互含", () => {
  const byId = new Map(atoms.map((a) => [a.id, a]));
  for (const id of AURA_IDS) assert.ok(byId.has(id), `光环 ${id} 未注册`);
  const clashes = [];
  for (const a of atoms) {
    for (const b of atoms) {
      if (a.id >= b.id) continue // 每对只查一次
      for (const w of a.words) {
        for (const ow of b.words) {
          if (w !== ow && (w.includes(ow) || ow.includes(w))) clashes.push(`${a.id}『${w}』<->${b.id}『${ow}』`);
        }
      }
    }
  }
  assert.deepEqual(clashes, [], `词表互含会致咏唱截胡(短词先中):\n${clashes.join("\n")}`);
});

test("光环系:special 统一走 'aura',元素由 atomId 分派", () => {
  for (const id of AURA_IDS) {
    const a = atoms.find((x) => x.id === id);
    assert.equal(a.special, "aura", `${id}.special 必须为 'aura'`);
  }
  assert.ok(god.includes("AURA_SPECS"), "AURA_SPECS 表驱动引擎丢失");
});
