# 背包与个人箱整理候选

本批为 AF `0.4.47.63-inventory-tidy-rpg` 的独立候选。正式仍为 `0.4.47.62-entry-guide-rpg`；未安装新 JAR、热重载、重启或接管原客户端。新命令不能当作现役能力，正式发布及原客户端采用分别验收。

## 问题与行为

个人箱十页共 540 格。旧 `putslot` 在满箱时只返回 `moved=0`，背包满提示又不查兼容堆叠余量，会重复推荐不可能的存入。候选只读取已有页面/配置，按完整物品组件检查容量，不开界面、不生成或领取奖励。满箱返回 `stash_full`、部分成功返回 `partial` 和实际数量；没有源物品单独说明。绑定限制、原物品元数据和成功操作的 2 魔力成本保持。

回收继续复用 `trade recycle list → quote → sell` 和 Vortex 金币事务。帮助及原版确认菜单统一为真实的五分钟，实际期限以 `expiresAt` 为准；石头、泥土和黏土不能按装备回收换币。

| 命令 | 行为 |
| --- | --- |
| `/mycli inventory tidy --dry-run --json` | 只预览主背包堆叠合并 |
| `/mycli inventory tidy --json` | 合并主背包 9–35 槽普通相同物品 |
| `/mycli inventory tidy --discard-common --json` | 合并后销毁白名单普通杂物 |
| `/mycli inventory tidy stash --dry-run --discard-common --json` | 预览全部十页个人箱整理 |
| `/mycli inventory tidy stash --discard-common --json` | 整理全部个人箱，不出售装备 |
| `/mycli inventory tidy auto on --json` | 本人背包满时自动合并，默认不销毁 |
| `/mycli inventory tidy auto on --discard-common --json` | 本人明确选择自动销毁普通杂物 |
| `/mycli inventory tidy auto status --json` | 只读查看本人设置、白名单和间隔 |
| `/mycli inventory tidy auto off --json` | 关闭本人自动整理 |

自动开关默认关闭，按原 UUID 持久保存。仅背包满且收到拾取、登录或物品交互通知时触发，无新轮询、模型或身体控制循环。每角色最多一分钟一次，短暂断线也不能绕过间隔。个人箱整理是独立显式动作，不由自动背包开关触发。

销毁白名单为圆石、深板岩圆石、石头、泥土、安山岩、闪长岩、花岗岩、沙砾、黏土块/球、腐肉、小麦/甜菜种子、毒马铃薯。普通材料也可能是委托或建造所需，所以必须明确选择 `--discard-common` 才会销毁。

随身快捷栏 0–8、穿戴装备、副手和其他容器不修改。名称、附魔、自定义数据及其他物品元数据均受保护；装备不销毁。个人箱额外报告完整组件相同、每组保留两件后的可回收冗余数量，供逐笔报价复核，不等于已经出售。不按基础材质混同不同耐久/附魔的装备。

真人可点背包满提示中的“合并背包”和“装备回收”，后者仍用既有原版箱子菜单，无新增客户端模组要求。Java/Mineflayer 原生命令链已隔离验证；手机触控、Eye/网页显示和原主人格采用需正式后另验。

## 保存与错误边界

`MC_INVENTORY_TIDY` 返回 `playerUuid/action/success/reason/changed/freedSlots/discarded/nextCommand`。预览 `changed=false`。箱子跨十页合并通过共享 `saveConfig` 一次提交，不直接写正式 YAML。背包使用原生 `saveData` 和独立随机标签确认实际玩家存档，不能把 void 调用没有抛错当作保存成功。

GUI/光标持物、PvP/恢复中、旁观、倒地或死亡均拒绝整理，原 PvP 指令锁保持。保存不明返回 `changed=null/outcomeUnknown=true/retrySameAction=false` 并暂停该角色后续整理；后续拒绝的 `changed=false` 仅指本次未执行，另有 `previousOutcomeUnknown=true`，不改变前次事实。联系管理员核对原请求、当前物品和持久记录，不自动重放。

控制台 `mycli admin inventorytidy <核对过的原在线UUID> ...` 使用相同保护及回执；不能生成离线替身，普通玩家不能代别人整理。先 `stash --dry-run --discard-common` 核对当前清单，再执行明确授权的杂物清理。不开放控制台绕过报价卖装备的能力。

## 四阶段与回退

代码合并、候选验证、正式部署、真实游戏验收独立记录。发布需当次正常维护授权、安全窗口、180/60/10 秒预告、原 JVM 退出及 E/F 当前恢复点。只回退代码/关闭新增开关，保留最新箱子、背包、金币、任务、身份、认证、动作及生命记录。明确销毁的垃圾不能通过回灌旧全服数据恢复；纠错先核对私有逐项审计。

`tests/run_cli_tests.py` 收录新目录回归；原报价账本继续运行 `run_recycle_quotes.py`。`paper/probe/inventory-tidy/` 强制回环地址、独立端口、合成离线身份和 `FRESH_RPG_SHOP_QA_NO_PLAYER_DATA` 标记，fixture 不进入正式包。

原正式包先复现三项失败：满箱缺明确原因/下一步、背包满提示仍推荐无容量存入、报价帮助错误显示 30 秒。候选覆盖十页预览/合并/清理、特殊组件及六槽装备、重复执行、部分存入、账号隔离、PvP/容器门禁、自动触发/限频/重连、正常重启设置保留，以及真实玩家文件保存失败后恢复运行时背包并阻止重放。私有日志和完整制品摘要见候选清单；不把这些当作原客户端的正式采用回执。
