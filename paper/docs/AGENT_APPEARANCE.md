# 本人皮肤与 YSM 换装

## 状态（2026-10-26）

正式服的普通皮肤命令已经可用。AgentAppearance0.3.3只有模型查询和控制台分配，缺少普通玩家的YSM选装命令；官网0.8.23的上传只接受网站主人会话，没有Agent外观API。不能让客户端用女神凭据、OP或任意Worker控制台补这个缺口。

本批候选为 **AgentAppearance0.3.4、官网0.8.24、Skill1.3.2，尚未部署**。代理及官网正常停启即可，Paper不需要重启。上线仍需[维护流程](OPERATIONS.md)的当次确认、预告和E/F备份。

## 游戏内用法

普通皮肤沿用SkinsRestorer，不增加另一套命令，不要求模组：

```text
/skin help
/skin set <已有预设或正版玩家名>
/skin url <公开HTTPS皮肤PNG地址> [classic|slim]
```

鸣人现有普通皮肤预设是 `afu_naruto`。省略目标时只改本人；不授予`.other`、管理员或绕过冷却权限。已有签名预设无需重复上传。参见[官方命令与权限](https://skinsrestorer.net/docs/configuration/commands-permissions)。

0.3.4候选在已有命令中增加本人选装：

```text
/appearance list
/appearance set qiandengji_naruto skin
/appearance status
```

只能改执行者自己的已登录身体，不接受目标玩家。模型及贴图须属于已转换核对的公开目录；仅一张贴图时可以省略贴图ID，多张须指定。登录大厅、尚未实际进入世界、Worker未就绪/数量异常不执行。冷却30秒；待确认的请求不会重复派发。实际原生状态读回匹配后才提示“已应用”，超时只报未知并引导查询。回执只给执行者，不发公屏。

Mineflayer/原版Java不装YSM也能选装和正常游戏。Java三维渲染需要匹配的YSM客户端，当前原生链为 **Minecraft1.21.1 / YSM2.4.1**；网页和相机复用原模型资源，基岩以实际Geyser投影能力为准，不能承诺所有模型、尺寸和动画一致。

## 上传新文件

游戏选装只选择服务端已有模型，客户端硬盘里的PNG/ZIP不会因一条游戏命令自动上传。主人可用官网“外观”页；0.8.24及Skill1.3.2候选让Agent用原接入身份自助上传、应用、查询，不要网站密码或YSM管理密钥：

MC核心已有的本地皮肤预览只改变该客户端的显示，不会调用服务器皮肤签名或改变其他客户端看到的外观；原生客户端的可选本地YSM覆盖也应与服务端绑定区分。要让别人和官网观战都收到外观，须走这里的服务端应用回执。

```text
node scripts/appearance.mjs status --identity-file /私有目录/identity.json
node scripts/appearance.mjs skin --identity-file /私有目录/identity.json --file /素材/skin.png --variant slim --public
node scripts/appearance.mjs ysm --identity-file /私有目录/identity.json --file /素材/model.zip --public
```

旧客户端由主人签发单角色`appearance.write`凭据，再使用`--token-file`；原只读凭据不自动升级。体验池的原身份也支持，认领时保留自己的外观和应用回执。细节按需读[外观参考](../integrations/agent-portal/skill/references/appearance.md)，不将文件上传工具塞进每轮游戏上下文。

PNG为64×32/64×64，YSM为包含`ysm.json`、几何、动画、贴图的公开原始ZIP，每份最多8MB。加密`.ysm`需要作者提供可分发源才能用于网页/相机。`--public`确认外观公开；普通皮肤使用既有签名服务。只有`applied`表示该请求已核实，排队/等待上线/处理中/未知都先查原请求，不自动重放。

## 鸣人实查及原生标志

旧`ag_NarutoPi`（`3a0d9481-2a8f-3bdd-9f56-b5d57c7aafd0`）绑定普通皮肤`afu_naruto`；现在的`ag_Naruto`（`c6cc3202-7ad0-3fcb-ade7-b7c7e5984453`）是另一个UUID，没有继承普通皮肤覆盖。2026-10-26既有控制台操作已给后者绑定`qiandengji_naruto / skin`YSM。不要按昵称合并两人的背包、职业、密码或外观存档。

Worker配置`CanSwitchModel=true`。原生命令`ignore_auth`与存档`mandatory`不能互相推断：实测`ysm model set ... false`后原生仍返回`mandatory=true`。不得只凭这个标志认定“服务器锁模型”，也不直接改在线NBT。参考[YSM命令](https://yesstevemodel.github.io/wiki/command/)和[配置](https://yesstevemodel.github.io/wiki/config/)。

## 验证与回退

只编译桥插件，保持生产Freesia af5不重建。28项身份、登录/代次、参数、并发去重与回执检查和8项原Numen兼容检查通过。独立Paper1.21.1＋原生YSM2.4.1＋SkinsRestorer的13项真实联机检查通过，涵盖非OP本人选装、重复抑制、Worker读回、UUID/实体号、资源投递、禁止改别人、公屏隔离和签名皮肤送达另一标准客户端。

初验错误地要求`mandatory=false`，原失败保留；纠正验收假设后通过，没有改原生标志凑通过。原生Fabric界面像素和基岩真机不属于此Mineflayer验收。

正常冷重启后另5项只读检查通过：原UUID的模型、Web/相机资源、普通皮肤持久绑定与实际profile投递保持，没有重放旧换装请求。门户全部297项通过、2项既有条件跳过，补充UI默认只读检查及最新Skill后再次验收。

代理回退仅恢复0.3.3 JAR并正常停启代理；官网恢复原镜像，保留最新数据库与上传文件。不恢复旧世界/背包覆盖进度，不在线覆盖Worker NBT。原admin命令、元数据/资源通道和普通皮肤命令保持兼容。
