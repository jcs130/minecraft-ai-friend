# 智能居民管理、邀约与世界地图

已于 2026-11-16 发布：居民脑 0.3.1、AgentFriend 0.4.47.83-resident-admin、官网 0.8.42。实际部署、验收边界和恢复入口见[发布记录](NPC_ADMIN_DEPLOYED_20261116.md)及[清单](../manifests/npc-admin-deployed-20261116.json)。

## 玩家怎么使用

- 官网管理员登录后，从账号菜单进入“智能居民管理”，也可打开 `/npc-admin.html`。可以修改名称、人设、Agent 框架与推理模型、YSM 外观、配音、自主生活开关、地图可见性。
- 模型、框架、音色只列出服主预先配置的选项。网页不收 API 密钥、不接受任意服务地址；尚未配置的选项不会伪装为可用。`不配音` 保留文字与气泡。
- 公屏 `@桐人 一起来冒险吧`，或者 `/maidagent companion <NPC UUID> whisper 我在试炼塔里，请来帮忙`。`/maidagent residents` 可查询居民身份；私聊入口不会把消息广播到公屏。
- NPC 按人设和当前关系决定是否同意。远程邀请被接受后，在邀请者身边寻找安全落点并移动原身体；正在战斗的试炼／副本房间允许应邀到场，不必等清关。使用本人的 5 魔力，传送冷却 60 秒，仍不占玩家槽。
- 跟随关系沿用原伙伴系统。修改人设／外观或跨维度移动不新建身体，不更换 NPC UUID、主人、背包或记忆。
- 地图把在线玩家和智能 NPC 分别存储、合并展示。关闭地图可见性、不在已加载世界中或观测过期的 NPC 不显示旧坐标。NPC 使用单独的居民标记，不生成不存在的直播链接。

## CLI 的身体适配

新增居民动作 `{"action":"cli","command":"archive create 旅行札记|今天走过了营地。"}`，由同一个串行执行器受理、持久化并查询原请求。被招募后、离开家所在的维度，也可以写书与使用相机服务；自主生活规划仍不会和领队的跟随控制争抢身体。

这批明确接通的是原 `/mycli archive` 和 `/mycli photo` 服务，运行时 `status` 的 `cli.available` 按需给出语法。正常对话可以提出写书或拍照，模型选择 `cli` 后只提交一条命令；说“我来写”不代表已经写完。

书籍进入原公共档案库，作者为 NPC 自己；实体副本消耗其背包中的一本可写书。没有可写书时只能完成数字档案，回执会区分，不能宣称生成了实体书。照片沿用原相机、原生渲染和 ImageFrame 流程，消耗自己的魔力，实际成品进入本人奖励箱；相机不就绪时明确拒绝，不能用一个状态查询冒称拍摄成功。

尚未适配的玩家 CLI 不会作为 NPC 已有能力发布，也没有 OP／控制台兜底。真实玩家专属界面和需要 PlayerList 连接的命令仍须逐项移植到身体接口；本批不宣称所有 `/mycli` 子命令均已兼容。

执行端使用原实体、原女仆库存和原 RPG 魔力。兼容的 Bukkit 服务获得一个有界的作者接口，权限只包含普通照片创建；它不是登录玩家，不添加 PlayerList，不复制领队权限。未实现的方法明确拒绝。请求 ID 在 NPC UUID 下隔离，重复请求返回原结果；处理中／结果未知时不重复派发。重启或超时后只查询原请求，可确认的终态再解除动作占用。

## 管理配置和数据流

1. 网站仅允许已登录、最近重新验证过密码的管理员提交，使用现有 CSRF 防护。普通账号、Agent Token 和跨站请求不能修改居民。
2. 网站保存请求 ID、目标 UUID、预期配置版本与完整期望配置。每个 NPC 同时仅一项待核对操作。未知结果不允许覆盖或重放；其它 NPC 的新请求可继续处理。
3. 家庭端每 5 秒拉取一项请求。源码支持在 `sync-home.mjs` 配置 `npcWorkerConfig`；现役为独立 `Qiandengji-Resident-Admin` 计划任务，避免打断原有账号同步。两种入口选择一种，不同时运行；本机锁和请求账本防止重复派发。网关不增加公网 RCON 或新的入站端口。
4. 本机执行 `/maidagent resident-admin apply <UUID> <requestId> <expectedRevision> <profile JSON>`；原始档案写入后作用到原实体，再检查实际名称、脑选择和外观。网站核对版本及完整配置后才显示“已生效”。
5. 超时只执行 `resident-admin receipt <UUID> <原 requestId>`。本地与云端都保留请求账本；不清空历史来恢复任务。
6. 地图同步器配置 `residentNpcs: true`，读取 `/maidagent resident-map`，只传 UUID、名称、职业、维度、绝对坐标、朝向及观测时间。人设、对话、库存、密码、API Key 不进公开地图。

`npcWorkerConfig` 的本机私有 JSON 示例（路径按宿主实际设置）：

```json
{"endpoint":"https://mc.kangqiang.site","tokenFile":"E:/MC/private/portal-sync/publish-token","rconModule":"E:/MC/ops/rcon-client.mjs","journalDirectory":"E:/MC/private/resident-admin/requests"}
```

原 `config/tlm-maid-agents.json` 管理每个 NPC 可选的脑／模型；网页只选其中的 ID。可选 `config/tlm-resident-voices.json`：

```json
{"approved_voice":{"site":"本机已配置的原生 TTS site ID","model":"该 site 的模型 ID","language":"zh-CN"}}
```

只有启用的原生 TTS site 参与选择，语言当前为 `zh-CN` 或 `ja-JP`。日文语音与中文文字分别生成，不把准备好的文本当作已播放的声音。没有审核并接通的日语音源时仍选 `none`。

可选 `config/tlm-resident-models.json` 最多 32 项；每项为服主已经安装、核验过的本地 YSM 文件：

```json
{"kirito":{"label":"桐人","modelId":"qd_hub_kirito.ysm","texture":"skin","sha256":"填入实际文件的64位小写SHA256"}}
```

提交时核对文件与摘要，不从网站下载或执行陌生模型。`original` 恢复居民原配置的外观。

## 维护与验收边界

网站升级保留原 SQLite、账号、作品、下载和观战素材挂载。游戏需要正常维护停启与当次 F 盘冷备份，回退只换代码，不回灌世界、角色或账本。合并居民脑仍为一份 JAR，不能同时安装独立脑和合并脑。

已完成的专项覆盖管理员／CSRF／重新验证、原请求去重和未知结果、移动布局、地图隐私与过期、原身份配置变更及冷启动保持、真实数字档案和实体书。实际隔离试炼第 1 层仍有 3 只怪时，远程邀请成功，原身体到场并进入跟随，未清怪或替换身份。对话决策使用确定的隔离模型夹具，不冒称所有线上模型都已验收。

正式服实际拍照请求已送入原生相机；因 NPC 继续走动，原请求返回 `stopped`，没有成片、没有档案成功记录。拍照期间暂停自主移动仍是明确缺口；不得把相机准备回执当成照片。新加密 YSM 在基岩／网页的同款像素、实际日语音色、长期多人自主协作也尚未验收。
