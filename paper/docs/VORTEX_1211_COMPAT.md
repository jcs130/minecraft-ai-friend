# VortexRPG 1.21.1 局部兼容适配

状态：隔离候选，未装正式服，未接管现有生命、职业、经验或奖励。

官方 1.2.2-alpha 的下载元数据标注 1.21.1，但引用了较新 API 的 `Attribute.MAX_HEALTH`
等字段。实际 1.21.1 为 `GENERIC_MAX_HEALTH` 等枚举字段，角色加入即抛 NoSuchFieldError。
不能只看插件启用成功。官方原包及 SHA512 锁保留在资源清单。

`probe/conquest-stage/Vortex1211Compat.java` 使用 ASM，固定核验官方原包 SHA512，
从目标版本 API 读取实际字段，只允许唯一且同名语义的 GENERIC_/PLAYER_/ZOMBIE_
映射；歧义或缺失直接失败。只修改 Attribute 引用，并适配 interface 到 enum 的调用类型。
实际16个类、62处引用改变，其余资源/类原字节保留。输出不覆盖官方包，也不当官方发布分发。

原包 SHA512：
`736888d27b7d5e1de2a039c276984ef67be50f47c4fc78f7e3db2973fb60c5e171801a3a9fdf8d2b8ae27ee7327d5240abcaa71e79120e7abd0592e75592d501`

本机构建候选 SHA512：
`4cafc171905350e5a56e94239f4f247ad34141d965f93b71c6daf7f8b3af84f75d668fea7eff31eb783b57cd964aecb11a06a036a6c6d9ed64b9ed0a79741d7f`

## 实际验证

同一 Paper 1.21.1 / Java21，回环25928，新建空白世界。关闭外部NPC模型连接、自动
裂隙/网关生成和导演系统，不复制正式玩家或配置。

- 普通非OP Mineflayer进入、选 Knight，收到完成回执和一把骑士剑。
- 属性、技能、职业目录正常；Fortify实际返回两条防御施法回执。
- 新建队伍成功，但队伍不是跨重启持久队伍；重启查询如实显示未组队。
- 正常停止、冷启动后，原UUID、职业、经验、装备和Fortify仍在。
- 两次运行均无 NoSuchFieldError/NoSuchMethodError 或 ERROR 级插件异常。
- 官方包不带副本地图模板；进入 crypt_of_the_fallen 返回 Missing dungeon template，
  不把“能列出副本”称为完整攻略成功。正式地图、波次、等级准入、奖励仍需接入验证。
- `/vrp spell list` 不是合法统一入口；使用 `/vrp skills spells` 或 `/spell list`。
- 默认 stats 一次约70行英文且含种田专业，不直接当千灯纪 Agent 主入口；正式采用前
  须由现有 /mycli 提供精炼中文，并明确唯一数值/结算来源。

## 重现

使用 Java21 编译适配器，classpath 为 ASM9.7.1；运行参数为官方JAR、目标Paper API
JAR和不存在的输出路径。本机API位于 `libraries/com/destroystokyo/paper/paper-mojangapi/1.21.1-R0.1-SNAPSHOT/`。

运行 `vortex_boot.py`，传固定候选 `--compat-sha512` 和 `--client vortex_client.mjs`；
只允许 E:/MC/staging 直接子目录及回环测试端口。`--resume` 仅接受同一 QA MOTD 的
既有隔离存档，验证正常重启保持。不得用于正式服务器。

本机证据：`E:/MC/staging/vortex-rpg-fixed-20261026`，原始失败对照位于
`E:/MC/staging/vortex-rpg-client-20261026`；原包与本地候选在
`E:/MC/ops/repairs/conquest-rpg-20261026/vortex`。生产授权和备份另行执行。
