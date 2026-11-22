# 结衣未跟随桐人 · 根因与回退修复（2026-11-22）

## 结论先行

- **跟随 / expedition 相关代码已上线**，不是"代码没部署"：
  - 现役 `mods/qiandengji-maid-brain-0.1.0.jar` 含 `mixin/ResidentFollowOwnerMixin`、
    `ResidentExpedition`、`ExpeditionSpacing`、`CompanionFollow`。
  - 现役 `plugins/qiandengji-maid-native-0.1.12-conversation.jar` 含
    `NativeMaidFollowSupport`、`MaidCompanionActions`、`CompanionRespawn`、`GuideCompanions`。
- **结衣没有冻结**：日志显示她 2026-11-22 仍在 overworld 活跃（公共聊天、试炼入场、被救援），
  ownerName=Goddess（ownerId `b2f9ceb0…`）。
- **真正根因**：桐人的 numen 躯体自 2026-11-17 起 destroyed / 未恢复（接力点 1 / PR #415 未收敛），
  世界里没有桐人实体；结衣的 expedition leader 指向桐人（`8ae995f9…`）但 leader 不可用。
  同时结衣当前在 overworld（`-597,91,-313`），桐人 home/最后观察在 aincrad（`-670,68,827`），跨维度。

## 卡死机制（代码层缺陷，本次修复）

`ResidentFollowOwnerMixin` 在 `MaidAgentsMod.hasExpeditionLeader(maid)` 为真时**禁用原生
MaidFollowOwnerTask**，把移动交给 expedition 控制器。旧实现 `hasExpeditionLeader` 仅判断
`expeditionDelegated`（配置+外部护卫开关），**不检查 leader 实体是否可用/同维度**。
于是当桐人躯体缺失或跨维度时：原生 follow-owner 被抑制 + `ResidentExpedition.tick` 因
`leader_unavailable` 暂停 → 结衣**既不跟主人也不跟桐人**，原地卡住。

## 本次修复（隔离开发 + 纯逻辑测试）

- 新增 `ExpeditionFollowGate.suppressNativeFollow(delegated, leaderAvailable, sameDimension)`：
  三者全真才抑制原生 follow-owner。
- `MaidResidents.expeditionSuppressesNativeFollow(id)`：用 `companions.actor(leaderId)` 取 leader
  实体、`CompanionFollow.available` 判可用、`maid.level()==leader.level()` 判同维度，代入 gate。
- `MaidAgentsMod.hasExpeditionLeader` 改调 `expeditionSuppressesNativeFollow`（该函数仅 mixin 一个
  调用点，改语义影响面可控）。
- `ResidentExpedition` 增加包内 `leaderId()` 访问器。
- 效果：leader 缺失/跨维度 → 恢复原生 follow-owner（结衣跟主人 Goddess，不再卡死）；
  leader 在场+同维度+已委托 → 仍由 expedition 跟随桐人。

## 验证

- `ExpeditionFollowGateTest`（纯 main 真值表）：通过（`ExpeditionFollowGateTest ok`）。
- 既有 `ExpeditionSpacingTest`：通过（无回归）。
- **边界**：MC 依赖类（MaidResidents/MaidAgentsMod/ResidentExpedition）本机缺编译类路径，未在此
  全量编译；改动为最小增量、复用既有 `body/actor/available/level` 模式。需操作者用 brain `build.py`
  编译并隔离实测后再上线。未对生产做任何写入。

## 让结衣真正"跟在桐人旁边"的部署步骤（操作者侧）

1. **恢复桐人 numen 躯体**（接力点 1 / PR #415 controller handoff 收敛后部署），使 leader 实体存在。
2. 将结衣召回/移动到与桐人**同维度**（aincrad home `-672,67,825` 附近），消除 different_dimension。
3. 启用 expedition 外部护卫委托（externalGuard），使 `ResidentExpedition` 驱动结衣跟随桐人
   （默认距离 walk8/stop4/recover64）。
4. 部署含本回退修复的 brain jar，保证 leader 再次缺失时结衣不卡死。
5. 观察 `expedition.describe` 的 state 应为 nearby/walking，distanceBlocks 收敛到 stop 以内。

## 回滚

恢复 `MaidAgentsMod.hasExpeditionLeader` 旧实现（仅 `expeditionDelegated`）并移除 gate 调用即可；
gate 为新增纯函数，删除不影响其它路径。