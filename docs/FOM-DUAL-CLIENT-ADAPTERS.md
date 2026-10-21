# FOM 双端物品、烹饪锅与女仆动作适配

目标：FOM 2.42 / Minecraft 1.21.1 / NeoForge 21.1.250。2026-10-22
增量已发布到现役服务器，原世界、账号和 103 JAR 保持。服务端实现
`8e97b2bf`，共享可视化 `main` 为 `327de529`，SDK 沿用 `c61e4fca`。
当前交付 `E:\MC\integrations\fom-native-view-20261022-v2`，主服和基岩分别
15/14 项健康及 panel smoke 通过。1911 个可变文件正常冷备到 E/F 两盘，
每成员 SHA 与 CRC 校验通过。正式发布信息记在
`docs/evidence/fom-dual-client-adapters-20261022.json`。

主服务启动正常；基岩桥首启遇微软 OpenID TLS 握手失败，由原守护按正常
停机/退避重试后恢复，Xbox 验证保持开启。隔离服务均正常退出，临时端口
已释放；未解除暂停 Agent，也没有重放历史未知动作。

## 同一账号的原始数据

`mcviewer:native_packet` 的注册表头现在在配置同步结束、前端进入 PLAY
之后发送。旧实现会在 CONFIG 期间发出空表并永久标为已发送。新头包含
`registryVersion:2`、`snapshotPhase:"play_after_configuration"`，本服实测
菜单 105、状态效果 92、药水 50、附魔 51、属性 86。

附魔从本连接 `registry_data` 的实际顺序解析，药水和效果使用原始
NeoForge 表。共享 renderer 的 `native.query({action:'inventory'})`
保留原 ID、数量、typed SNBT，并提供 `resolvedComponents`。没有映射时
明确不可用，不使用原版编号猜测。能力仍绑定实际动作玩家，不另开观察者。

## 农夫乐事烹饪锅

仅在原 Farmer's Delight 1.3.4 JAR SHA 匹配时开启。按当前本服菜单表识别，
不沿用旧整合包的固定 ID。实际服务端菜单有 45 格：前 6 格原料，第 6 格
熟食缓存，第 7 格碗，第 8 格成品；后 36 格属于本人背包，以上编号从 0 起。

Mineflayer 可以继续用 `openBlock`、`moveSlotItem` 等基本容器操作；兼容
Window 为 `minecraft:generic_9x1`。基岩使用标准容器界面：前 9 格有效，
Geyser 为 27 格画面补位，其余格不代表原生库存。不要把这些补位当成额外仓储。

网页使用原 `cooking_pot.png`、原槽位坐标、原生标题 Component 和本人库存。
两个进度值来自 NeoForge `advanced_container_set_data`：BYTE 容器 ID、
SHORT 属性 ID、VAR_INT 值。原 int32 完整进入原生侧流；普通线协议只发送
可表示的 int16 值，超范围不截断伪装。热源状态、锅中食物的方块实体渲染
仍须单独适配，不能从进度或相邻方块猜测。

## 基岩女仆与协议

用户 2026-10-22 报告拿空魂符点击女仆后被踢出，日志精确对应
`UNSUPPORTED_NATIVE_ITEM_COMPONENT touhou_little_maid:maid_info`。
TLM 1.5.3 `InitDataComponent.MAID_INFO` 实际使用
`CustomData.STREAM_CODEC`，现按无名 compound NBT 解码并完整保留。
原基岩投影只删除不能携带的模组 wire component，保留服务端原物品与
连接绑定令牌；Mineflayer 原始侧流继续保留女仆的完整数据。

魂符对合适地面顶面使用会召唤女仆并变为空魂符；拿空魂符点击自己的
女仆会收回并变为 HAS_MAID，再对地使用放出。不是放置方块。
隔离真实 UDP 和普通 Mineflayer 均验证该流程、同一女仆 UUID、原地面未变、
占用图标切换及测试物资清理。只读检查用户最后保存物品也确认收纳数据存在，
未重发魂符或另造女仆。

`mawbedrock:motion` 仅向本连接发送已绑定实体 ID/UUID 的实际移动、朝向、
同步坐姿和挥手提示，带序号与 500 ms 行走租期。Geyser 在自己的事件循环
驱动已经下载的原模型包动作，停止移动后回到 idle，移除/重生/断开清理状态。
没有替换女仆 AI、实体或战斗目标；行走实测使用开启 AI 的受控物理夹具，
不是自主种田或所有 Java 动画的验收。

模型/语音/方块包的原始字节与 UUID 保留。只升级模型扩展 JAR 时，
`maw_bedrock_modpacks.upgrade_packet_motion` 先校验旧包和 Geyser SHA，
产生新目录、保留源文件哈希，再走原守护发布流程。

ViaVersion 读取真正的 1.21.1 药水三字段编码。固定版本 minecraft-data
误含的较新 `customName` 选项仅为 Mineflayer 同版本兼容端保留；基岩
出站使用独立、修正后的 codec。原始服务端物品组件和普通 Mineflayer
协议对象均不因此改写。

## 资源与可维护性

附魔书用原 Items 注册的 EnchantedBookItem 模型与默认 glint override。
药水图标需要共享仓库已有的原客户端 ItemColors 导出，SHA-256 为
`21c83de83b6f57d38f93c0881edaa98a2d2c06ec8c14eceb260a79c380f9e936`。
`build_fom_native_view.add_client_item_colors` 校验版本/来源后加入资源清单。
自定义模组药水颜色、模组图集 glint UV 仍不可据此宣称已一致。

用 `tools/freeze_fom_renderer.py` 冻结已提交的共享源码和完整依赖。
它同时核对 runtime/build 的精确版本，包括新增的 `camera-controls`；
缺项先失败，不再拿旧依赖目录打一个只能查询、不能构建网页的交付包。
打包后仍需实际加载交付目录并构建网页，不能只检查源码或 package.json。

原 FOM/基岩健康探针、看门狗和 panel smoke 继续管理这些能力。
本批没有新增常驻推理循环或管理公网端口。

## 验收与边界

独立、标记为 loopback 的 103 JAR 测试服验证实际 Mineflayer 放料、烹饪、
进度、取物与网页 WebGL；基岩验收脚本增加 `--motion`、`--cooking-pot`、
`--potion-metadata`、`--soul-slab`。`--soak` 明确使用每 10 秒私有只读查询维持协议测试，
不是手机无输入挂机或大规模压力验收。

原始包、完整库存、世界、JAR、资源包、截图和失败日志留在私有研究目录；
Git 只记录实现、资料来源、哈希和去敏汇总。旧空注册表、准备校验失败、
缺失 renderer 依赖、禁 AI 夹具无法产生行走、测试端未应用 stack response、
容器补位判断及 Via 异常均保留，不把重试后的成功覆盖为首次成功。

完整模组 GUI、任意实体/女仆装备层、Create 动态机器、原生复杂寻路、
资源优先级冲突和 Java 像素一致性仍未全覆盖。原世界、账号、权限、
原 103 个服务端 JAR 与已有暂停 Agent 的状态应在发布时逐项保留。
