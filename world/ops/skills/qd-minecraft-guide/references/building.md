# 先让住所能用，再改善外观

适用：千灯纪 Minecraft 1.21.1。当前桐人使用背包材料逐块建设，不具有旧守卫包中的批量造物或蓝图管理权限。

## 勘察与分阶段建设

先读本轮 `constructionAreas` 与 `storageSites`，确认可用地点和储物点。没有建设区时，先提出选址调查或地点需求，不能因读了教程就圈占玩家建筑。精查地面、目标格、支撑、出入口和附近危险，再估算自己实际携带的材料；未识别的模组装饰不默认可由当前接口放置。

先确定房屋用途和入口，再分为地面、墙体、屋顶、开口、必要设施与装饰。先实现可以进出和使用的住所，材料充足后再扩大风格设计。每阶段选几个能现场核验的关键格，避免只按已发送的放置次数计算完成度。

`place_block` 的 x/y/z 是目的格，需要实际支撑和足够材料。它不会替换已有建筑；床、门需要双格空间。避免重复铺地板导致门口抬高，核对室内行走高度与外部入口是否衔接。一个门方块存在，不代表角色能从外面走进去。

正常放置后检查实际方块状态、材料消耗和通行情况。床还需通过原生 `sleep` 的实际结果确认可用，日间或敌怪阻止入睡不代表接口失效。箱子、桶、炉子只有本人放置或授权的才能使用；当前容器桥拒绝双箱。先 `open_container`，用 `inspect_container` 精查槽位，再搬运并验收。

## 需要风格时只补一篇

已有旧建筑库可提供构图和材料灵感。桐人具备历史阅读工具时，先在 `knowledge_catalog` 选一项，再例如调用：

`knowledge_read(name="building_design/references/log_cabin", offset=0, max_chars=3000)`

此例只读原木小屋这一篇；返回有 `nextOffset` 且确实缺后半段信息时再续读。可借鉴木材与石材搭配、入口和屋顶关系。旧文里的 `build`、`blueprint`、`ops` 或直接填充等命令并未因此开放，也不能照搬旧批量施工流程。

其他角色可根据本页提供设计说明或材料问题清单；没有 `knowledge_read` 或身体工具时不借读文件跨入桐人目录，不假称房屋已经建成。

依据仓库：`world/survival/world_actions.py`、`world/survival/knowledge.py`、`world/survival/ADVENTURE.md`；历史风格来源 `world/sidecar/guard/skills/building_design/references/log_cabin.md`。
