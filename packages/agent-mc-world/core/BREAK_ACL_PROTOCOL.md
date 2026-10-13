# 千灯纪方块破坏权限同步（Paper 1.20.6 → Mineflayer）

服务端以**接收者当前玩家身份**计算 `BlockBreakEvent` 所用的同一份破坏权限，将已加载区块的完整结果发给该玩家。客户端在 A* 算路、`excavate`/`tunnel` 试算和实际 `bot.dig()` 发包前同步读取缓存。消息只说明能否破坏方块，不改变服务端的最终权限判定。

## 传输

- Paper 插件注册出站插件消息频道 `corti:break_acl`，通过 `Player.sendPluginMessage(plugin, "corti:break_acl", json.getBytes(UTF_8))` 发送。Mineflayer 监听 play 状态的 `custom_payload` 包；无需客户端模组或聊天命令。
- 内容为 **UTF-8 JSON 原始字节**，不要用 `writeUTF`、GZIP 或额外长度前缀。
- 单包最多 **32766 字节**（Paper 1.20.6 `Messenger.MAX_MESSAGE_SIZE`）。
- 一包替换同一维度、同一 16×16 区块的全部权限。包括没有受保护方块的区块，也必须发空清单。

## 稀疏清单

```json
{"v":1,"complete":true,"dimension":"minecraft:overworld","chunkX":-31,"chunkZ":-28,"revision":2,"ttlSec":300,"denyCells":[[-490,69,-434]],"denyBoxes":[[-489,68,-435,-488,70,-433]]}
```

- `chunkX/chunkZ` 使用方块坐标除以 16 后**向下取整**，负坐标不能向零截断。坐标均为世界绝对整数坐标。
- `denyCells` 中每项是 `[x,y,z]`；`denyBoxes` 中每项是闭区间 `[minX,minY,minZ,maxX,maxY,maxZ]`。一个盒子的 X/Z 两端必须属于该包的区块；跨区块保护范围要拆开。
- 只列接收者当前不能破坏的方块。自放方块、可采集草木等如果实际允许破坏，不能被盒子覆盖。数组均必填；没有保护格时填 `[]`。

## 密集或碎片较多的区块

当稀疏清单放不进单包时，改用该区块全高度位图；`denyCells` 和 `denyBoxes` 仍填空数组：

```json
{"v":1,"complete":true,"dimension":"minecraft:overworld","chunkX":-31,"chunkZ":-28,"revision":3,"ttlSec":300,"denyCells":[],"denyBoxes":[],"minY":-64,"height":384,"denyBits":"<标准 Base64>"}
```

`denyBits` 解码后恰好 `height * 256 / 8` 字节。位号 `i = (y - minY) * 256 + localZ * 16 + localX`；字节 `i / 8` 的低位第 `i % 8` 位为 1 表示禁止破坏。`localX/localZ` 取区块内 0–15。`minY/height` 应覆盖该世界的整个建造高度；位图范围外客户端视为权限未知。1.20.6 默认主世界 `-64..319` 的位图为 12288 字节，Base64 约 16 KiB，能放进一包。稀疏清单与位图可并用，禁止集合取并集。

## 生命周期

- 玩家进服、切维度和区块进入该玩家可见范围时发送每个区块的完整快照；保护规则、归属或方块变化影响破坏权限时，增加该区块 `revision` 并重发。
- 同一连接内，同一区块内容变化必须使 `revision` 递增。相同 `revision` 仅用于续租，不改变内容；客户端不会因此重算路线。重连后版本号可重新从零开始。
- 推荐 `ttlSec=300`，每 120 秒续发一次；客户端限制有效期为 10–3600 秒。发出同维度第一份有效清单后，尚未收到清单或清单过期的区块会暂停自动和显式挖掘，直到权限同步完成。
- 服务端最终仍按真实破坏事件裁决；如果服务端明确拒绝一次挖掘，客户端会按坐标和当时方块类型记住该拒绝，作为同步缺口的兜底。

客户端拒收：未知版本、不完整清单、跨区块坐标、旧 `revision`、超过 32766 字节、坏位图。日志事件 `protection-acl` / `protection-acl-invalid` 用于联调。
