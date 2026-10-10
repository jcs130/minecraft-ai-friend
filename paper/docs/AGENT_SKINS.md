# Agent 角色皮肤

## NEKO 白色猫娘（2026-10-08 19:48:21已在线生效）

`ag_NEKO`（`6e8b395e-4349-3d44-99f5-b7488825e426`）绑定`afu_neko_whitecat`，slim手臂。外观为白色猫耳兜帽、浅色长发和白色服装，少量浅灰/淡粉细节。素材来自[ShadowCat100：White Cat Girl](https://www.minecraftskins.com/skin/23050342/white-cat-girl/)；原始64×64 PNG的SHA256为`c77a7b6bee493b6e0228b1a3eae13250fdf7db5326bcc7aa6420a831ec31a1fb`。SkinsRestorer 15.12.6已生成并保存签名预设，Mojang材质`d8c68d4b05a1b147b51b68148038f81f07d3413f2b1ec24acc2e1ed6fa76573a`与选中PNG可见像素相同；第三方PNG和签名存储文件只保存在私有快照中。

首次19:40:24应用后，服务器日志确认NEKO于19:41:43自行执行`/skin clear`，清除了新皮肤。随后仅为该精确UUID设置LuckPerms节点`skinsrestorer.command.clear=false`，再在线执行`skinsrestorer:skin set afu_neko_whitecat ag_NEKO slim`。临时观察账号实测清空命令明确提示“很抱歉, 你沒有權限執行這個指令”，选中皮肤保持，测试节点已移除。权限前后导出确认其他玩家、全部组和轨道保持原样，只有NEKO新增这一条非默认权限。

最终10项检查通过：临时账号及NEKO的实际UUID、清空命令明确拒绝及皮肤保持、精确CUSTOM持久绑定、原版观察客户端收到完全相同的签名纹理、slim元数据、刷新后映射保持、NEKO原连接在线、原机CortiEye继续附身。E/F双盘快照已核对；32份既有其他皮肤记录与SkinsRestorer配置哈希保持，另1份玩家皮肤缓存只刷新了签名时间，解码后的材质保持。观察账号已退出并移除白名单。无需服务器或Agent重启，AgentFriend仍为0.3.95。手机/Xbox实际画面仍需真实客户端观察。

控制台回退：先`lp user 6e8b395e-4349-3d44-99f5-b7488825e426 permission unset skinsrestorer.command.clear`，再`skinsrestorer:skin clear ag_NEKO`。原UUID没有选中皮肤；勿整目录恢复覆盖他人的换装。私有原件、失败探针与最终回执：E/F `repairs/neko-skin-20261008`；[公开换装清单](../manifests/neko-skin-20261008.json)。

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

## YSM 兼容性调研（2026-10-10，未安装）

YSM 的完整功能需要匹配的 Java 客户端模组。现有 Paper 1.20.6 不能直接加载 Forge/Fabric/NeoForge 模组；YSM 文档介绍的第三方 [Freesia](https://yesstevemodel.github.io/wiki/freesia-plugin/) 可通过 Velocity、模型 Worker 和 Paper Backend 接入，并可设置 `kick_if_ysm_not_installed=false` 保留普通客户端。该方案需要隔离验证现有可信来源网关、转发身份和单实例运维，不能只放一个 YSM JAR 就视为完成。

基岩/Xbox 不能运行 Java YSM，模型使用基岩格式也不表示能自动显示。[Geyser 安装文档](https://geysermc.org/wiki/geyser/setup/) 明确不支持依赖客户端模组的功能；完整模型需要另做资源与实体状态映射。[Hydraulic](https://github.com/GeyserMC/Hydraulic) 仍提示不用于生产，不能作为现成兼容保证。Mineflayer 接入与动作需独立实测，其 Web 模型显示还需要适配。

共享 `mc-visual-console` 的另一套原生1.21.1集成已有部分 YSM 2.6.5 原模型支持，限 Alex/gsl、Steve/tartaric_acid 和 Boy/blue|red；未知模型、装备和第一人称等仍未完整验收。这不代表本 Paper 服或远程画面已安装。若后续接入，先采用可选 YSM 外观与普通原版皮肤兼容显示，并分别验收 Java、基岩、Mineflayer 和 Web；不得承诺各端完整一致。

## 验收与回退

换装前，普通 1.20.6 观察客户端读到两位在线玩家均没有 `textures` 属性。换装后，**9 项检查通过**：两位实际 UUID、各自新增 CUSTOM 绑定、下发的纹理 value 与 signature 和预设逐字一致、原机 CortiEye 仍为 `camera=online attached=true`、两位原玩家继续在线。桐人的 slim 与 Corti 的 classic 元数据匹配素材。没有重连两位 Agent 或 Eye；手机和 Xbox 的最终画面仍需真实客户端观察，Java 纹理包不代替基岩真机画面验收。

变更前已校验 E/F 双盘快照，两个目标 UUID 原先均无 `.player` 绑定；本次只新增这两份映射，旧 `Kirito` 与全部既有皮肤文件保持不变。私有原件、签名纹理包、命令回执和前后清单保存在：

- `E:/MC/ops/repairs/agent-skins-20261008`
- `F:/MC-backups/repairs/agent-skins-20261008`

撤销本次覆盖可分别在线执行 `skinsrestorer:skin clear ag_Kirito` 与 `skinsrestorer:skin clear CortiLan`。先读取 `before/manifest.json`，避免恢复整份玩家目录覆盖他人的新换装。若必须恢复文件，应正常停服后恢复对应原件；原来不存在的目标映射需撤销，世界、背包、公会履历不需要回滚。
