# 建筑结构保护

保护由实验服自有 Forge 服务端组件执行，普通真人、Mineflayer 玩家与 Numen 假玩家都经过相同规则。不是只在模型提示里要求“别挖”。当前组件构建 SHA-256：`015bd25ce522e2b65ac5e2fe2f0b3b872ca9c3d879b7783553f4d518fb1acfff`。

## 区域和规则

`server/config/maw-structure-protection.json` 采用 [protection.example.json](protection.example.json) 的 schema 1。`regions` 登记人工主城/公共建筑的绝对坐标边界，范围两端均包含；当前仅登记实验营地，作者包本身没有主城地图，不能把营地称成已导入完整 Aincrad。

`generatedStructurePieces=true` 读取当前加载区块的真实结构引用和 start/piece 边界，自动保护已登记在世界结构系统里的村庄、地下城等建筑部件，不把整个探索地图设为禁区。手工搭建、地图导入或仅用 `/place` 放置而没有原生结构记录的建筑，必须单独登记区域。未来导入主城/地下城前先登记准确范围。

- 建筑/结构部件内阻止普通玩家拆除、放置和工具改造；草本、作物和树叶保留清理能力。不是全服禁止挖掘。
- 可以通行、开门、使用容器和战斗；这些普通交互没有被区域一并禁止。
- 爆炸影响列表会剔除受保护方块；活塞推动/目标位置、流体生成方块也检查边界。
- 管理员 4 级权限与控制台用于有意施工。桐人和 Numen 测试身体没有因此获得 OP。
- 配置未就绪、区块或结构元数据未加载返回 `unknown`，不猜成安全。判定不为远处查询强制生成区块。自动结构保护基于当前已加载的真实元数据。

本次覆盖标准玩家/Numen 破坏、放置、Forge 工具修改、爆炸及活塞等事件。尚未逐个验收所有模组直接修改世界的法术/机械；不能承诺任意模组绕过这些事件的写入也已拦截。正式公开前仍需按实际能力做破坏测试。

## 给 Agent 的私有查询

出站 `mcagent:protection`，入站 `mcagent:protection_query`，UTF-8 JSON 原始字节，无 `writeUTF`。每次请求只回本人连接；不发同一结果的系统聊天、公屏或标题副本。

```json
{"requestId":"request-001","action":"break","dimension":"minecraft:overworld","x":1258,"y":89,"z":-962}
```

返回 `status=deny|unknown|allow_likely`、`reason`、绝对坐标、维度、`observedAt`、原 `requestId` 和可用的 `region`。插件查询仅本人 64 格内、每秒最多 20 次、请求最多 1024 字节。`allow_likely` 不是免除其他模组限制的授权。

桐人的同一核心 Bridge 接入这个保护端口，在需要拆放的寻路候选前查询、缓存真实拒绝；超时保留未知。模型可调用：

```json
{"name":"mc_protect","arguments":{"action":"break","x":1258,"y":89,"z":-962}}
```

控制台 `mawprotect reload` 重载配置，需先审核/备份原范围。`mawprotect check break <x> <y> <z>` 可检查；玩家查询走自己的插件回执，控制台输出仅在日志。不改变权限来制造成功。

## 实际验收

- 营地泥土遭真实 Mineflayer 挖掘后仍保留，受保护放置被拒；野外泥土能正常挖掉，营地草能清理。
- Numen 同样实挖 `(6,100,0)`，终态 `denied`、挖掉 0 格；早先错误参数/视线不达的记录保留，不能当成保护通过。
- 真实生成村庄 `(1258,89,-962)` 的橡木楼梯返回 `protected_structure_piece / minecraft:village_plains`，实际挖掘后服务器核对屋顶仍在。
- 保护区内农夫乐事烹饪锅可打开，真实 45 格菜单及正常关闭回执已收到。
- 原始裸 Mineflayer 一次拒绝挖掘后曾短暂把本地预测格当成空气，服务端实际未变；验收以服务端核对为准。桐人通过核心的库存/破坏确认机制操作，不能把 `bot.dig()` 返回本身当成拆除成功。

实验服已正常退出并保存、备份原世界及旧组件后安装；备份在实验根 `backups/pre-protection-20261029-210517/`。现役 Paper/Tau、路由、防火墙及监护配置未修改。
