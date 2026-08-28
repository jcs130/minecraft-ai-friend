# T006-a1 定位报告＋供奉回执机制设计稿

**交付人**：天神（mc-god）｜**交付时点**：2026-08-28 08:15（按 22:15 谕承诺）
**结论**：引擎真身已定位，悬空病根全案告破，设计稿如下。

---

## 一、考古定位（六层排除＋一层实锤）

| 层 | 嫌疑 | 结果 |
|---|---|---|
| 1 | B仓 sidecar/*.py（司灯 08-27 08:23 简报方案靶） | 零命中，方案作废 |
| 2 | settlementsfix-src（气泡 mixin mod） | 只有 5 个村民气泡类 mixin，无关 |
| 3 | settlements-1.0.0-beta.1+godfix.3.jar | 解包 2141 class 零 offering |
| 4 | shadow-qwenpaw 进程树 | 仅 qwenpaw app＋mcp_god/mcp_numen，无 bot |
| 5 | shadow-npc mc_npc.py（容器版 2183 行） | 零 offering |
| 6 | mineflayer-ecosystem | 零命中 |
| **7** | **packaging/mc-world/assets/world/src/mc-god.ts** | **实锤：CLI 供奉唯一入口** |

**引擎真身**：mc-god.ts（Goddess 世界侧裁决引擎 TS，随 goddess bot 运行）。

## 二、病根全案（R010 三分歧＋R009 深层根因）

1. **供奉唯一正规语法**＝`/cli pray <愿望>｜供奉：<物>x<n>`（mc-god.ts:1320-1326，`splitWishOffering` L198 按 `[｜|]\s*供奉[:：]` 拆分）；私聊渠道同管道（L2983）。
2. **`/cli offering <物> <n>` 是不存在的命令**：CLI 分发 default 分支（L1395-1396）只回「[CLI] 未知命令『offering』」——有回执但**非终局信号**（守卫期待"收讫"，收到的是错误提示，低思考档不理解为终局，继续按册重发）。
3. **offerings 恒 0 的机理**：这些帧从未进供奉计数器——引擎在等『｜供奉：』语法。
4. **指路话术自污染**：女神侧指路（含天神 08-27 15:13 裁决「带铁锭来，/cli offering iron_ingot…」与 04:22 tellraw）**教了不存在的命令格式**；Kirito 忠实执行→悬空→重发。天神一边下终止令堵他，一边自己的神谕又给他指错路——**此为本案最大教训：神谕教命令前必须核对引擎真实语法**。
5. 「铁锭换口诀交易达成」＝goddess LLM 裁决的**口头承诺**（verdict 流），非结构化入账，无物品转移。

## 三、回执机制设计稿

### 方案 A（推荐，最小改动）：CLI 增加 `offering` 子命令
```ts
case 'offering': {
  // 语法：/cli offering <物品id或中文名> [数量=1]
  // 1) 物品白名单校验（同造物白名单域：diamond/emerald/gold_ingot/iron_ingot/enchanted_book/ender_pearl…）
  //    不在白名单 → reply(`[神库] 此物神不受：<item>。可献：钻石/绿宝石/金锭/铁锭/附魔书。`)  // 终局拒绝信号
  // 2) 数量校验 1-16，超出截断并提示
  // 3) 结构化入账：offerings 计数 + 编年史「供奉｜<subject>：<item>x<n>」行 + 供奉史登记
  // 4) 物品转移：RCON clear 该物品（或先 give 收条后 clear），失败则回执「收讫失败，物品仍在你手」
  // 5) 终局回执：reply(`[神库] 已收讫：<item>×<n>。供奉史 +1。`)  // 守卫拿到确定终局，无重发理由
}
```
- 改动点唯一：mc-god.ts CLI 分发（goddess bot 部署链重启即生效）。
- default 分支回执文案追加指路：`未知命令「${verb}」。欲供奉：/cli pray <愿望>｜供奉：<物>x<n>`。

### 方案 B（零代码伴生，立即生效）：话术勘误
- goddess 指路/裁决话术模板统一改正规语法：`/cli pray 求炼食口诀｜供奉：铁锭x4`；
- 禁止在任何神谕/tellraw/guard-order 中出现 `/cli offering` 字样；
- Kirito LESSONS.md 终止令补一行正规语法示例（会话自然重载后生效）。

### 验收判据
- 供一次白名单物品 → 收到「[神库] 已收讫」→ offerings 计数 +1 → 编年史供奉行；
- 供非白名单 → 收到终局拒绝；
- 守卫侧 0 重发（同物品同数量不再二次发出）。

## 四、遗留
- guardian-link 0.1.0→0.1.1 热更手术操作者仍待认领（若今日无人认领，呈造物主）；
- pray 管道的供奉尾缀是否转移物品（submitPrayerCli 内部）待 a1 实施时顺验；
- a2（passive 升阶/觉醒帧时序三型归一＋三口径比对＋同帧双陨观察点）独立排期。

——天神 mc-god，08:15 交付
