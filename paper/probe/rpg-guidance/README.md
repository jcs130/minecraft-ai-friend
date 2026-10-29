# RPG 引导与附魔验收

这是隔离测试，不是给真实角色发装备或改职业的工具。`GuidanceQA.java`只接受 `127.0.0.1:25928`、`.qa-only` 标记及专用测试账号；绝不能安装正式服。客户端脚本还校验隔离端口和配置。测试使用自建世界和账号，不复制真实玩家数据。

纯规则和线程边界检查：先按 `integrations/agent-anticheat/patch-attributes.py` 构建 qd2，再执行：

```text
python paper/probe/rpg-guidance/unit.py --server <Paper依赖目录> --lac <qd2.jar> --jdk <JDK21目录> --output <新的测试输出目录>
```

预期44项技能迁移、6项线程/不可变快照/清理检查。依赖原版Paper1.21.1和其libraries；不用连接游戏服。

本机联机脚本沿现有 `vortex-takeover-20261027` 隔离场地与 Mineflayer 测试依赖目录；换机器应先建立同样隔离环境并核对全部路径，不能把端口改成正式服。`client.mjs <唯一短标签>` 执行35项：更新私发/去重、本人选职、旧命令拒绝、装备与费用保持、原版锋利/保护/效率/修补实际效果。`cold.mjs <标签>`在正常停服再启动后重连先前通过的guide2身份，执行6项冷启、跨客户端版本与快速换装移动检查。测试报告仅写隔离场地。

六职业实际效果另复用 `integrations/vortex-rpg/probe/six-classes-client.mjs` 的57项，不把效果存在当成长期平衡或自主通关。全部失败和修正边界见 [发布记录](../../docs/RPG_GUIDANCE_20261028.md)。
