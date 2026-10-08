# Agent 角色皮肤

## 2026-10-08 在线换装

正式服使用现有 SkinsRestorer **15.12.6** 的已签名原版皮肤。2026-10-08 11:29（北京时间）已在线应用以下绑定，无需重启或客户端模组：

| 角色 | 实际游戏账号 | 离线 UUID | 服内皮肤名 | 外观 / 手臂 |
| --- | --- | --- | --- | --- |
| 桐人 | `ag_Kirito` | `8e7b99e0-595d-3402-935c-7139ac6814e3` | `afu_kirito` | 黑衣剑士 / slim |
| Corti | `CortiLan` | `ccba3629-1f58-33d2-bd0c-f7ba6e699816` | `afu_wizard_girl` | 女法师 / classic |

旧账号 `Kirito` 的 UUID 是 `08a6a7ce-526a-3e3f-b0d3-7509efce8398`；它原来的皮肤绑定不会自动用于 `ag_Kirito`。`CortiEye` 是观战客户端，实际实体角色是 `CortiLan`。维护时先用 `minecraft:list uuids` 和登录记录确认当前账号，不要根据昵称复用旧 UUID。

## 素材与线上维护

桐人皮肤沿用已部署的 [Zso10：Kirito The Black Swordsman](https://www.minecraftskins.com/skin/14443786/kirito-the-black-swordsman/)，材质 ID 为 `1e5af878e5b5ec733a184bd8b5730b81c79d7c31d4296440ef6ed304f6124406`。Corti 皮肤来自 SkinsRestorer 自带推荐库的 `girl-wizzard`，映射见 [skin-catalog.json](../plugins/AgentFriend/skin-catalog.json)，材质 ID 为 `68cba595a57d795d3d0338d9f924d0bb8f523904b6d68a38401835389c3e0122`。两张都是现有已签名材质，本次没有重新上传或生成素材。

维护控制台可直接应用已安装的预设：

```text
skinsrestorer:skin set afu_kirito ag_Kirito slim
skinsrestorer:skin set afu_wizard_girl CortiLan
```

SkinsRestorer 将绑定写入 `plugins/SkinsRestorer/players/<实际UUID>.player`；材质在 `skins/<预设名>.customskin`。在线命令会同步更新已连接的观察者，后续登录继续读取该 UUID 的绑定。控制台 RCON 的即时回复可能为空，不能把空回复当作成功；须检查落盘绑定和观察客户端实际收到的签名纹理。不要在插件运行时直接覆盖这些文件，也不要把未签名 PNG 当作 `.customskin`。

这是原版角色皮肤与手臂形状，不是 YSM 自定义骨骼模型。Java、Mineflayer 和 Geyser 使用现有原版皮肤路径；本次未增加客户端安装要求。Agent 身份铭牌、Eye 配对和可信来源登记各自独立维护，见 [玩家铭牌](PLAYER_NAMETAGS.md) 与 [观战账号](AGENT_EYES.md)。

## 验收与回退

换装前，普通 1.20.6 观察客户端读到两位在线玩家均没有 `textures` 属性。换装后，**9 项检查通过**：两位实际 UUID、各自新增 CUSTOM 绑定、下发的纹理 value 与 signature 和预设逐字一致、原机 CortiEye 仍为 `camera=online attached=true`、两位原玩家继续在线。桐人的 slim 与 Corti 的 classic 元数据匹配素材。没有重连两位 Agent 或 Eye；手机和 Xbox 的最终画面仍需真实客户端观察，Java 纹理包不代替基岩真机画面验收。

变更前已校验 E/F 双盘快照，两个目标 UUID 原先均无 `.player` 绑定；本次只新增这两份映射，旧 `Kirito` 与全部既有皮肤文件保持不变。私有原件、签名纹理包、命令回执和前后清单保存在：

- `E:/MC/ops/repairs/agent-skins-20261008`
- `F:/MC-backups/repairs/agent-skins-20261008`

撤销本次覆盖可分别在线执行 `skinsrestorer:skin clear ag_Kirito` 与 `skinsrestorer:skin clear CortiLan`。先读取 `before/manifest.json`，避免恢复整份玩家目录覆盖他人的新换装。若必须恢复文件，应正常停服后恢复对应原件；原来不存在的目标映射需撤销，世界、背包、公会履历不需要回滚。
