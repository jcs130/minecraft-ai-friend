// 护花双卫决策回归（2026-08-30 造物主谕：萌萌上线后桐人/鸣人跟随她）：
//  对 src/guard-follow.mjs 的 decideGuardFollow 做运行时断言（node --test 原生跑 mjs），
//  另锚定 mc-god.ts 两处接线（60s sweep + playerJoined 即时触发）在位——防误删静默失效。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  GUARD_FOLLOW_TARGET,
  GUARD_FOLLOW_UUID,
  GUARD_FOLLOW_SPEC,
  decideGuardFollow,
} from "../../src/guard-follow.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const god = readFileSync(join(here, "..", "..", "src", "mc-god.ts"), "utf8");

const ALL_ON = ["MengMeng", "Kirito", "Naruto", "Goddess", "Taro"];

test("decideGuardFollow: 萌萌离线 → 一律不干预（守卫自由）", () => {
  assert.deepEqual(decideGuardFollow(["Kirito", "Naruto"], { Kirito: "", Naruto: "" }), []);
  assert.deepEqual(decideGuardFollow(null, { Kirito: "", Naruto: "" }), []);
  assert.deepEqual(decideGuardFollow(new Set(["Goddess"]), {}), []);
});

test("decideGuardFollow: 守卫空闲 → 补发（含各自跟随距离）", () => {
  const out = decideGuardFollow(ALL_ON, { Kirito: "", Naruto: "" });
  assert.deepEqual(out, [
    { name: "Kirito", distance: 4 },
    { name: "Naruto", distance: 6 },
  ]);
});

test("decideGuardFollow: 已在 follow → 不重复补发", () => {
  const out = decideGuardFollow(ALL_ON, { Kirito: "follow", Naruto: "follow" });
  assert.deepEqual(out, []);
});

test("decideGuardFollow: 守卫在忙（attack/mine 等非空任务）→ 绝不打断", () => {
  // 正在战斗的守卫绝不能被 sweep 的补发顶掉任务（护花不能以打断护村为代价）
  const out = decideGuardFollow(ALL_ON, { Kirito: "attack", Naruto: "mine" });
  assert.deepEqual(out, []);
  // 半忙半闲：只补闲的那个
  const half = decideGuardFollow(ALL_ON, { Kirito: "attack", Naruto: "" });
  assert.deepEqual(half, [{ name: "Naruto", distance: 6 }]);
});

test("decideGuardFollow: 守卫离线 → 跳过（不在补发名单）", () => {
  const out = decideGuardFollow(["MengMeng", "Naruto"], { Naruto: "" });
  assert.deepEqual(out, [{ name: "Naruto", distance: 6 }]);
});

test("decideGuardFollow: taskByGuard 缺键/传 null → 视为空闲", () => {
  const out = decideGuardFollow(ALL_ON, {});
  assert.equal(out.length, 2);
  const out2 = decideGuardFollow(ALL_ON, null);
  assert.equal(out2.length, 2);
});

test("常量: 萌萌 UUID 为离线档案 UUID（usercache 权威）", () => {
  assert.equal(GUARD_FOLLOW_TARGET, "MengMeng");
  assert.equal(GUARD_FOLLOW_UUID, "1949104d-60e2-3a33-9bfe-d2e897b60dfb");
  assert.deepEqual(GUARD_FOLLOW_SPEC, [
    { name: "Kirito", distance: 4 },
    { name: "Naruto", distance: 6 },
  ]);
});

test("接线锚: mc-god.ts 的 sweep 与 playerJoined 即时触发在位", () => {
  // 60s sweep：收集 taskByGuard 后交给 decideGuardFollow 决策
  assert.ok(god.includes("for (const g of decideGuardFollow(online, taskByGuard))"), "sweep 必须走 decideGuardFollow 纯函数");
  assert.ok(/setInterval\([\s\S]{0,1600}decideGuardFollow/.test(god), "decideGuardFollow 必须挂在 60s sweep 内");
  // playerJoined 即时触发（上线 15s 后护驾，不等 sweep 首轮）
  assert.ok(god.includes("username === GUARD_FOLLOW_TARGET"), "playerJoined 需识别萌萌");
  assert.ok(god.includes("guard-follow on-join:"), "playerJoined 需即时下 follow");
  // follow 经 entity_uuid 直连（不受视距限制）
  assert.ok(god.includes('"entity_uuid":"${GUARD_FOLLOW_UUID}"'), "follow 必须钉 entity_uuid");
});
