# 原玩家、女仆与村民身体交接

这个私有端口供角色托管协调器使用。每次交接需要一具已登记的活动身体及另一具已安全停放的原身体。切换沿用双方各自的实体 UUID、装备与原生存档。角色的共同人格、记忆及对外可见的玩法权限由上层角色服务管理。

## 登记

默认关闭。管理员可在隔离环境用 `config/native-resident-handoff.json` 显式注册作用域。每个角色登记一个独有的控制器、至少一具原生身体和至少一个可交接的目标。以下占位值需要换成已核实的服务器身份。

```json
{
  "schema": 1,
  "enabled": true,
  "port": 27818,
  "keyFile": "/private/native-role-control.key",
  "roles": [{
    "characterId": "example-role",
    "ownerId": "<角色所有者 UUID>",
    "controllerId": "<已接管女仆的控制器 UUID>",
    "maid": {
      "bodyId": "original-maid", "entityUuid": "<原女仆 UUID>",
      "nativeOwner": "<原女仆主人 UUID>", "dimension": "minecraft:overworld"
    },
    "villager": {
      "bodyId": "original-villager", "entityUuid": "<原村民 UUID>",
      "issuer": "<已配置的委托发布者 ID>", "dimension": "minecraft:overworld"
    }
  }]
}
```

密钥文件为独立的 32 字节随机数据。仅游戏服务及受信任的协调器进程可读。游戏进程仅监听 IPv4 回环。浏览器、模型及一般游戏调试接口无需取得密钥。

首次登记时须先通过服务器事实核实当前活动身体、两方驱动、原生资料以及另一个原实体的停放前像，在安全维护窗口建立初始控制槽。位置为世界根目录的 `qiandengji-native-custody/role-slots/<角色ID的UTF-8 SHA256>/slot.json`。初始对象中，`scope` 等于上述完整单角色登记项，`activeKind` 为当前真实的 `maid` 或 `villager`，`generation` 等于协调器当前代次，`held` 以另一种身体类型为键，值是该原实体停放文件的完整 SHA256。世界恢复或接入异常时须保留并核对原文件、归档回执与最新世界。缺失或不一致的控制槽需要人工核查。

原玩家加入登记时，可在同一个作用域增加 `mineflayer`、`numen` 或两者。每项都填写唯一的 `bodyId`、原玩家 UUID（字段 `entityUuid`）及游戏名称 `playerName`。Numen 还需要填写已经核实的 `nativeOwner`。两种玩家控制共用原玩家的 UUID 和游戏名称。在首次登记时，`activeKind` 使用实际运行的身体。若原玩家离线并由女仆或村民活跃，另保存原 `playerdata/<UUID>.dat` 的 SHA256 为 `playerSnapshot`。若原玩家活跃，全部已登记的女仆或村民必须分别有真实的停放文件和 `held` 摘要。

## 调用及恢复

`POST /v1/native-resident-handoff` 接收 `{payload, signature}`。payload 为 UTF-8 JSON 的无填充 base64url，签名为对 payload 编码文本计算的 HMAC-SHA256 的无填充 base64url。请求字段为 `phase, kind, bodyId, entityUuid, operationId, characterId, ownerId, generation, expires`。时间为毫秒 Unix 时间，协调器有效期 45 秒。每次读取仍需验证完整作用域与签名。

- `inspect` 在游戏线程核验另一具原身体、停放前像、原维度与区块，并为同一原操作保留短时预检结果。
- `park` 重新核验目标前像、旧身体及其真实原生控制，持久登记原操作后保存原实体，停止旧驱动并确认区块中的实体已写盘。
- `resume` 仅接受上述交接的原请求、已确定的下一代次和预检目标。它按已登记摘要恢复原实体，启动对应的真实驱动，在同一控制槽提交结果。
- `result` 另外带 `originalPhase`，值为 `fence`、`cancel`、`park`、`admit` 或 `resume`。输出中的 `phase` 是被查询的原阶段。核验提交的完整作用域及动作时使用原代次。

- `assets` 仅供受信任的协调器读取当前代次、当前身体所绑定的原玩家账本。请求只传已登记的活动身体标识。原玩家 UUID 由游戏端从同一角色的 `mineflayer`／`numen` 登记解析，两者必须共用该 UUID。切换、停放、旧代次或玩家接入门禁处理中返回暂不可用。只持有女仆或村民身体的角色返回 `no_enrolled_player_body`。
- 返回个人仓库分类、待领奖条目数、公会账本进度、已接受的村民委托，以及已加载时的原 RPG 档案。离线且未加载时，RPG 部分返回不可用。原玩家的背包和末影箱留在原存档，女仆及村民仍使用各自携行库存。身体切换不授予原玩家权限，也不转移、结算或复制物品。仅在私有身份授权后的角色观察中使用此结果，公共状态不可展示。

有原玩家参与时，签名协调器需要完成原玩家连接见证或 Numen 托管回执。游戏端在 `fence` 持久限制原玩家新登入及操作，再由协调器执行退出和保存。已知拒绝且原连接仍在时，可用同一请求 `cancel` 恢复原控制。保存或分离已确认时，协调器发 `park`，游戏核对原玩家离线、验证当前原档 UUID 并保留摘要。目标为原玩家时，游戏在 `admit` 检查原档摘要和所有原生身体都已停放，短时允许指定玩家类型进服。协调器确认真实接管后，`resume` 再核对已加入的原 UUID、名称及预期类型，提交后开放游戏操作。Numen 需要包含对应接入检查的托管 API 构建。

网络超时、挂起或意外退出后查同一原操作。世界结果与控制槽之间中断时保留当前步骤和独占门槛。开服先从磁盘恢复原身体约束，之前临时开的玩家准入需要人工核对原请求。管理员需要核对现有身体、各自最新存档、当前控制及动作账本，再决定如何恢复。
