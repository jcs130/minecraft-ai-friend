# 艾恩葛朗特第一层探索世界

当前部署在 Paper 千灯纪的独立 `aincrad` 世界。原主世界、玩家背包、技能和委托继续使用原来的数据。

- `/aincrad`：私有文字指引。
- `/warp aincrad`：进入起始之城，安全落点 `(-582.5, 69, 934.5)`。
- `/warp village`：返回原村庄。
- 两个传送都沿用现有传送点术学习检查和每次 6 魔力消耗。未学习时按提示使用 `/mycli skills learn travel`，花费 1 技能点。

普通非 OP 测试账号已实测进入和返回，四格初始物品保留，健康值正常。新世界也已在一次服务器启动后自动载入。不要把没有默认权限的 `/back` 写成通用返回指令。

## 地图来源与边界

使用公开的 [SAO Map - Floor 1](https://www.curseforge.com/minecraft/worlds/sao-map-floor-1)，作者 Alyaaa / Yoplay；原介绍感谢 jardinixz。原文件 [6729184](https://www.curseforge.com/minecraft/worlds/sao-map-floor-1/files/6729184)，SHA-256：

`0ddf2c3f8c767d2acdfa3be793293a47fd7cb3d45a34bb997ff9d5861970518f`

实际存档版本是 1.12.2 / DataVersion 1343，不能仅凭网页版本标签判断。已先在隔离 Paper 1.21.1 中读入并保存为 DataVersion 3955，核对起始之城脚下地面与头部空间，再以单独目录导入。

这是第一层探索地图，不包含 SAOMinecraft.com 的服务器源码、完整任务、百层副本或官方客户端。没有使用需要 Patreon Gold 的 PROJECT AINCRAD 付费地图。

## 安装与维护

`prepare-map.cjs SOURCE DESTINATION ABSOLUTE_NBT_MODULE` 只准备一个**不存在的新目标目录**。源世界必须已正常停服并转换为 1.21.1；调用者负责核实没有进程继续写入。脚本拒绝覆盖或合并世界，排除旧玩家数据、统计、成就、世界 UUID 和锁文件，并移除内嵌 `Data.Player`。

工具保留作者的其他世界规则，设置死亡不掉落、一人睡觉和零出生区常驻半径，并关闭生物破坏与火焰蔓延。未知或转换失败的存档会拒绝导入。

将 `qd_aincrad.dsc` 放入 Denizen scripts，创建同名 Essentials warp。世界由 Denizen 在服务器启动时加载；首次在线加载使用 `ex createworld aincrad`。Warp 必须引用实际生成的世界 UUID，并核对 `world-name: aincrad`，不能复用原主世界 UUID。

本次导入前已在 E/F 双盘保存原 scripts/warps 的校验过的 ZIP 前镜像。地图热载入没有替换 Paper JAR；不能把这份前镜像称为全服冷备份。回滚只移除本次入口和启动脚本；如世界已有人游玩，先存档并正常卸载后再归档新世界，不能在线删除。

2026-10-26 22:44 曾发生 Watchdog 停服，恢复后玩家已重连。保存的线程栈显示 RCON 执行的实体选择查询占用服务器线程，具体命令来源尚未定位；不能声称脚本重载或地图本身已被证明是根因。原维护流程已恢复服务，所有世界的保存完成记录已留存。

验证：`node --test prepare-map.test.cjs`。地图本身、世界存档和私有运行日志不提交 Git。
