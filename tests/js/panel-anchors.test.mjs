// web-panel.mjs 静态锚点断言(CI 无本机服务,守护源码级回归)。
// 背景:背包卡被修为榜顶出「满高不滚」视口(2026-08-29),live 冒烟只在生产机跑,
// CI 侧用源码锚点兜住同类回归——锚点失守=有人改动了可见性关键逻辑,先红了再说。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(here, "..", "..", "web-panel.mjs"), "utf8");
const world = readFileSync(join(here, "..", "..", "bootstrap-world.mts"), "utf8");

test("背包卡可见性:beings 组序=状态→背包(修为榜不许压过背包)", () => {
  assert.ok(panel.includes("'状态', '背包'"), "beings h2s 序必须是 状态,背包 在前");
});

test("背包卡可见性:组内按 h2s 声明序重排的归位循环在", () => {
  assert.ok(panel.includes("声明序重排"), "归位循环(按声明序)被移除/改坏");
});

test("背包卡可见性:side-sec 允许纵向滚动兜底", () => {
  assert.ok(panel.includes("overflow-y:auto"), "overflow-y:auto 兜底被移除");
});

test("背包卡本体:inv 容器与实查网格样式在", () => {
  assert.ok(panel.includes('id="inv"'), "#inv 容器丢了");
  assert.ok(panel.includes(".invgrid"), ".invgrid 网格样式丢了");
});

test("inspect API:RCON 实查路由在(众生通用行囊)", () => {
  assert.ok(panel.includes("/api/inspect"), "/api/inspect 路由丢了");
});

test("天眼快照:web-entities 轮询与实体补录在(9090 断流回归锚)", () => {
  assert.ok(world.includes("web-entities.json"), "world 侧 web-entities 写出丢了");
  assert.ok(world.includes("settleNpc") || world.includes("settle"), "村民实体补录丢了");
});
