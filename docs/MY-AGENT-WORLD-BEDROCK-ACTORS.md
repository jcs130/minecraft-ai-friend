# 基岩女仆 / YSM 动画与头顶文字

2026-10-12；实验分支 `experiment/agent-society-1.21.1`。

之前两份专属模型包只有原骨骼、UV 和 PNG，没有动画声明或控制器，因此女仆像静态模型一样滑动。现在两包版本为 **1.1.0**，279 个原模型均有动作入口；原模型选择、纹理、服务端实体 UUID、AI、归属和背包保持。重新进服并接受资源包更新即可加载。

## 动画

`tools/maw_bedrock_animations.py` 生成基岩动画和控制器。能够独立运行的 YSM 原关键帧直接复用；当前 `misc/3_default_boy` 的 idle / walk / run / jump / sit / sleep / swim / sneak / fly 九套均可复用。总计 72 项原姿态映射，包含同一模型不同贴图版本的重复映射，并非 72 个独立动作。TLM 普通人形使用原骨骼上的基岩关节动画；没有腿的灵体使用整个原骨架的浮动。几何和 PNG 不以原版模型替代。

`PlayerActorVisuals` 在现有、已认证、按连接订阅的 `maw_agent:scene_state` 中补充附近已加载的 `actors`，每秒最多 4 帧、32 格范围、24 个实体，不加载新区块。包含原 UUID / entityId、绝对坐标、实际体头转角、姿态、名称、职业和原生气泡；YSM 玩家包含他自己的公开外形选择。既有 64 KiB 总包上限保留，超限先裁掉远处显示实体。

`MawModels` 同时核对 UUID 和当前 Geyser 实体缓存后才应用。女仆保留原实体 ID 的显示载体，`query.variant` 驱动动作控制器，体头角分开同步。真实玩家保留玩家身体，按各自 UUID 下发原 YSM 外形和动画包；不会把观看者的模型套到其他账号。晚到的普通皮肤结果也按各账号已知模型处理。没有新增游戏身体、控制器或权限。

## 名称与气泡

- 名称使用实际自定义名字，村民显示对应中文职业，女仆有女仆标记。
- 女仆读取锁定 TLM 1.5.3 的原生文字、等待和进度气泡，保留真实文本、优先级和到期时间；不调用模型生成假对白，不读取模型配置。进度只显示原生文字，图片、表情贴图和完整进度条尚未移植。
- 玩家正常公开聊天可生成八秒头顶气泡。命令、私聊、祈愿和 Key 配置不进入这个入口。
- 气泡中文换行，最多五行正文；跟随角色，过期、实体消失、换维度或显示流超过两秒未更新后清理。浮字只存在于该基岩连接，无碰撞、重力、服务器实体或存档。
- 管理员可在当前维度调用 `/maw_scene bubble <女仆UUID> <文字>`，使用原模组气泡管理器，权限 4。普通玩家和 Agent 不因此获得管理权限。

## 验证与边界

隔离服真实 Bedrock UDP 验收通过 15 项：五包完整下载及哈希、TLM / YSM 实体、两玩家不同外形、走动后停下、坐姿、体头角、女仆原生和公开聊天气泡、跟随、过期移除、私聊不进入气泡等。脚本 `tools/smoke_bedrock_actors.cjs` 只连固定隔离回环端口；测试召唤、传送和改模是管理员夹具，不能作为 Agent 自主生存证明。初版 UUID 夹具和重跑时复用 UUID 导致的失败记录均保留，最终使用独立 UUID 与实际存活实体。

健康检查 `tools/maw_bedrock_actors_health.py` 同时进入 `world/ops/health/health_mon.py` 的既有基岩探针，检查桥编译来源与资源包配套、动画资源、扩展注册、TLM API 哈希以及两套受管服务。沿用现有 Watchdog，无新增常驻进程或端口。

已正式发布并恢复服务。27 项 Python、12 项 Node、7 组健康探针及基岩 manifest / panel smoke 通过；正式服 Mineflayer 8 项和两 provider 17 项只读复验通过。发布后 29 项核对通过，11 份旧 SDK 分发、Numen 原身体、账号权限、模型配置、原账本前缀与旧未知动作均保留，MawExplorer 原自主暂停不解除。维护前冷备 1404 文件、406242564 字节，CRC 与每个文件 SHA256 验证通过。基岩首次重启遇到微软 OpenID HTTPS 握手失败，原日志保留；重试恢复，未修改认证或 TLS 校验。

真实手机最终像素与 Java 对照仍需玩家复验，`actualPhoneTested=false`，动画时钟 / 完整画面 parity 保持 false。Java 专用脚本、物理发丝、并行动画、完整装备层和第一人称手臂没有完整移植。未支持的 YSM 原片段在 `unsupportedNativeClips` 列明；动作转换不等于所有 Java 渲染器已移植。

## 维护

先隔离验证，确认真人离线、Numen 无待处理动作和托管推理，再由现有 supervisor 正常停服、保存并冷备，CRC 和逐文件 SHA256 通过后替换原生桥、两模型包及 MawModels。同步更新模组锁和编译记录，核对其他 33 个 JAR、账号、世界和旧 SDK 包，再恢复两套受管服务和健康探针。不要覆盖运行中的 JAR，也不要改动旧 Paper、网络、Agent 模型配置或自主暂停标记。

生产者改动后必须重建桥与模型包：`modpack-contract.json.inputs.actorBridgeSources` 与安装桥编译记录须一致。资源内容变化须提升包版本，避免手机使用旧缓存。

私有证据：`E:\QiandengJiSocietyLab\research\bedrock-animations-20261012`；冷备：`E:\QiandengJiSocietyLab\backups\bedrock-animations-20261012`。这些目录、生成包和第三方原素材不提交 Git。
