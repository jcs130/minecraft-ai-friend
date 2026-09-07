# 世界内容检查与本轮修复

检查时间：2026-09-07。范围是 D:\Projects\QiandengJi 当前运行的 1.21.1 / NeoForge 21.1.248 整合版，并与原开发文档及 C 盘遗留资产对照。原 C 盘文件未修改；没有更换主世界生成器、重建旧区块或批量迁移 NPC。

## 结论

当前包已有大量探索建筑和部分群系、生物扩展，但还不是原规划的完整世界内容。最明显的遗留是：旧地形包留在其他世界目录、风格领地包缺少依赖、NPC 档案指向退役模组、公会旧单与实际收购单错配。启动正常不能代替这些内容的可玩性验收。

| 范围 | 已有内容 | 明确缺口与处理 |
|---|---|---|
| 主世界群系 | 原版多噪声主世界；Spawn 的 ant_gardens、rocky_shore、deep_warm_ocean、seagrass_meadow 有常规气候入口，另 6 种由岛屿/潮池结构生成 | C 盘其他世界留有 Terralith、Tectonic，但当前 shadow 没有启用；本轮未直接换旧档生成器 |
| 末地与其他维度 | 原版末地、下界；铁魔法口袋和女仆归隐维度 | 旧目录的 Nullscape 不在当前世界。口袋/归隐维度不等于开放式冒险世界 |
| 村落与探索地点 | Towns and Towers、WDA、ATi、Moog、Trek、酒馆、日式/中式建筑等，457 项结构定义（含变体/可选联动） | 结构定义不等于玩家附近实际生成的地点；T&T 有依赖外部群系的可选分支，不能当通用建筑强行放开 |
| 风格领地 | 旧源码有 zzz-style-territories 数据包 | 当前未部署，并引用 mcs/chinesevillage/peakscape 等不存在的池，不能只复制目录就启用 |
| 动物与怪物 | Spawn、铁魔法、女仆生态及地牢怪物配置；自然刷怪开启、Easy 难度 | 镇区由 InControl 禁止敌对怪。镇外具体生态仍需逐项实际遭遇验收；mobGriefing=false 对农民工作也有影响 |
| NPC 商店 | 保留 35 份角色档案、商品和任务记录 | 全部档案仍指向退役的 settlements:base_villager；旧实体与新坐标不一致，历史角色记录大量重复。不能开启自动重召来掩盖 |
| 公会与探索记录 | 原有当日 11 项任务记录、功勋、讨伐计分和远行机制 | 本轮修普通任务与自动建造开关耦合、旧单错配检查、旧地点暂停接取、坐标解析；已有任务记录保留 |

## 本轮已经修复的内容

`qiandeng_fixes` 是已启用的独立数据包，不修改原模组 JAR：

1. **蚁丘考古掉落**：不存在的 `spawn:roly_poly` 让整个表无法加载。仅把这个不可用条目变为空结果，其概率和其他 7 项奖励权重不变，恢复其他考古奖励。
2. **暗影刺客掉落**：移除当前未安装的 Farmer's Delight 所属 `backstabbing` 附魔引用，恢复整张掉落表。紫晶细剑、锋利 V、暗影斩法术和其他奖励均保留。
3. **两项探索进度**：荆棘塔、渔屋进度引用了不存在的父进度；接回 WDA 的实际根进度，同时修正旧图标格式。发现结构的原判定条件不变。
4. **探索坐标**：服务器返回 `[-530.5d,201.0d,865.5d]` 时，旧正则无法识别；新解析器支持 double 后缀和科学计数法，拒绝非法/无穷数值。
5. **公会基本任务**：普通讨伐、远行任务与自动放置营地、宝箱和 Boss 分离。已有当日板优先保留；错配收购单、未核验旧地点和需要新召唤的首领任务显示暂停接取。已接任务记录不被重新生成覆盖。
6. **造物卷旧商品键**：把档案里的 `craftbook` 解析为已有的 `craft`，恢复原书与笔及 `craftreq` 标记，价格/库存不变。此项通过离线商品构造回归；NPC 身份问题未解决，因此未把它宣称为柜台实际成交。

机器验证见 `reports/content-fixes-smoke.json`、`reports/guild-board-smoke.json` 与 `reports/runtime-health.json`。掉落表已实际生成奖励、进度已在专用 QA 身上授予并撤销、真实 RCON 坐标解析通过；这不等于已在自然生成的地牢击杀怪物或实地完成全部探索。临时掉落已清理，测试角色已退出。

公会聊天实际 6 项通过：`公会 看板` 收到今日列表、旧单暂停提示、普通任务可接；`公会 接 7` 明确拒绝旧矿场任务，原当日任务板字节保持一致。请使用空格分隔。公会轮询已加入 NPC 线程监督、健康心跳和项目健康检查，服务已重启加载本轮代码。

## 后续开发顺序

**首先修 NPC 身份与柜台。** 在停止的独立快照中，按 UUID、角色、背包、Offers 和位置确认身份，一次处理一个角色。23526 是带角色 tag 的序列化记录数，不是已确认的唯一活跃 NPC 数；不据此直接批量删除。完成单柜台开窗和交易实测后，再扩大迁移。

**再接入完整的地形与探索扩展。** 先用独立测试世界核验旧 Terralith/Tectonic/Nullscape 资产的版本、相互兼容和与 Spawn 的生成关系，检查结构标签覆盖、生成耗时与客户端进入。Terralith 官方明确不建议中途加入已有世界，也不支持随意移除，因此当前保留 shadow，不能把“有安装文件”当成可直接无缝合并。[Terralith 官方项目说明](https://modrinth.com/datapack/terralith)

**最后补生态和任务目的地。** 保留镇区保护，验证镇外动物、怪物、村民农事与探索奖励；把真实找到并核验过的遗迹、村庄和营地接到公会任务，而不是继续使用其他旧世界的坐标。

## 证据与复现

- 世界生成与旧资产：`docs/WORLD-CONTENT-AUDIT-WORLDGEN.md`、`reports/worldgen-audit.json`。
- NPC、刷怪与原档：`docs/WORLD-CONTENT-AUDIT-NPC.md`、`reports/npc-world-audit.json`。
- 原规划与公会代码：`docs/WORLD-CONTENT-AUDIT-PLAN.md`、`reports/world-plan-audit.json`。
- 修复源：`content/datapacks/qiandeng_fixes/`；来源锁：`manifests/content-fixes.lock.json`。
- 重建并部署：`python tools/prepare_content_fixes.py --deploy`，升级上游 JAR 时会拒绝沿用未复核的补丁。
- 数据包独立分发：`dist/QiandengJi-content-fixes-1.21.1.zip`。当前 D 盘服已启用；单机同模组存档可放入其 `datapacks/`，客户端 mrpack 本身不包含这个世界专属数据包。
- 健康检查：`python world/ops/health/health_mon.py`。服务健康和这些实测通过，仍不表示上述待迁移 NPC、完整群系方案已完成。
