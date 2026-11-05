# 旅途留影：验收与恢复候选（2026-11-05）

本次补验基于 PR #66 的 `05d2e8e1759f9d77f3347148f9afdc6932e40d6b`。复核时该 PR 已合并为 `abf3f5200c511b0529dc11d85c00c1f89e86b63d`，相关源码未变。本文件描述后续源码候选，没有部署或修改正式服。

**结论：完成本地缺陷复现、修复回归和实机取证工具；真实端到端验收仍阻塞。** 当前环境没有连接实际 Agent 模型宿主、Minecraft 游戏进程和女神原生摄影客户端。真实模型调用 **0**、真实成片 **0**、本次真实游戏交付 **0**。先前 PR 的洞穴实走不作为本次摄影证据。

## 现有链路与复用边界

| 环节 | 既有实现 | 本次处理 |
| --- | --- | --- |
| 低频建议 | `AgentCoach`、`GuildAdventureGuide` | 保留原频率、活动、安全及在途任务限制；追加只发本人的 `MC_COACH adventure_hint` 观测事件。`requiresDecision:true` 明确它只是建议 |
| Agent 决策 | 已有宿主的模型、观测和工具执行循环 | 不新增自动拍照脑、不把建议直接变成命令；记录实际模型响应、工具调用与安全观测 |
| 请求与排队 | `PhotoRequest`、`PhotoCameraManager` | 复用 `/mycli photo take <新名> third 1 --story <见闻>`；增加最近任务持久回执及原任务核对 |
| 真实拍摄 | `ops/goddess-photo-camera.mjs`、`native-photo-renderer.mjs` | 不改渲染器、皮肤或摄影角色；利用既有 `onCapture` 钩子保存工作进程上传后的同一份 PNG |
| 导入、地图及奖励 | 原 ImageFrame 上传 Future、原片导入、`PhotoRewards` | 保留原 owner/imageIndex/mapIds 去重、个人箱和箱满待入箱队列；恢复不创建第二张地图 |
| 作品与隐私 | `PhotoJournal`、原档案存储、agent-portal gallery | 保留原 UUID、故事、原片索引、`published:false` 默认及本人主动公开规则；只新增按原 job 查询是否记录的方法和原片加载恢复钩子 |

默认建议约在活动 20 分钟后轮换，每人定时建议至少间隔 60 分钟，与其他教练提示共享 30 分钟冷却；近期冒险事件延迟约 15 秒、有效窗口 5 分钟，按原一分钟轮询检查。`readyForReminder()` 继续检查相机、本人任务、队列容量及拍摄冷却。以上频率来自源码核查，**未以真实多小时 Agent 运行测量**；配置覆盖时以隔离服实际配置为准。

## 复现缺陷与最小生产改动

原 `PhotoCameraManager` 在收到工作进程 `failed` 后直接结束任务。若此前已发送 `uploading`，或 HTTP 已完成而回执丢失，结束流程会释放正在核对的上传；主人断线也会过早结束。内存状态消失后，`status` 不能找回原 job、作品和地图 ID。

用**同一个完整生产类测试**分别加载原 PR 的 manager 和候选：`uploading → failed` 在原版触发断言失败 `HTTP/ACK failure after upload must retain original import`，候选通过。这里的网络、Bukkit 和 ImageFrame 是明确的替身，证明控制流缺陷，不能证明真实上传成功。

候选只改三处既有类并增加一个薄回执账本：

- `AgentCoach`：带事件 ID 的私有建议观测，不执行摄影。
- `PhotoTaskLedger`：复用既有 `ProfessionLedger` 的原子文件写入，在新的 `photo-tasks.json` 中每位主人只保留最近一笔任务，保存 job、故事、拍摄位置、冷却、图像证据和交付 ID。不另建相册、不保存上传 URL、nonce 或凭据。
- `PhotoCameraManager`：发出拍摄前保存任务；上传后失败、断线保留同一上传结果；未知结果阻止换名重拍。`MC_PHOTO` 增加 job/owner/name/imageIndex/mapIds、`jobStatus`、`journalRecorded`、ready/cooldownSeconds。查询保持只读。
- `PhotoJournal`：复用原 ImageFrame 加载事件和玩家重连时机核对已有原片，以原奖励去重写入和原纪念册方法补齐记录。没有再次渲染、扣魔力或发第二份地图。

状态含义：`queued` 尚未开始；`rendering` 已发拍摄；`confirming` 正在核对；`unknown` 结果不确定，禁止自动重试；`stopped` 已知停止；`success` 原地图已交付。重启后的未开拍队列置为 stopped，进行中的任务置为 unknown。明确的上传前失败或取消仍可在原冷却结束后自愿重试。成功后迟到的失败消息不能倒退成功记录。

**恢复限制：**只有已持久化到 ImageFrame、且能以本人和原照片名找回的有效原片，才自动核对已有奖励和纪念册。若服务器在 HTTP 文件上传后、原生原片提交前崩溃，原上传 Future 无法跨进程恢复；任务保持 unknown，需在隔离环境核查原上传和持久化数据。本候选不宣称自动修好这个窗口，不清账、不重复创建。若纪念册写入失败，地图交付和 `journalRecorded:false` 分开报告；完整验收仍不通过。新文件异常时保留原文件并停止接收新拍摄。

复核补充了上传过期分支。ImageFrame 的 Future 完成也可能代表过期异常。只有收到该版本明确的 `PendingUploadExpiredException` 才将任务记为 stopped，允许玩家在原冷却后主动发起新请求。已返回文件、开始导入或其他未分类失败继续核对原任务。相关回归先在候选上失败，修复后通过。

## 本地结果

| 检查 | 结果 | 能证明的范围 |
| --- | --- | --- |
| 完整 AgentFriend + shared 编译 | 177 个 Java 源文件，JDK 21，退出 0 | 使用公开锁定 Paper 1.21.1 build133 和插件依赖；只有 patch-only，未启动游戏 |
| PhotoRequestTest | 14 检查通过 | 命令与故事解析 |
| PhotoEvidenceTest | 24 检查通过 | 原有图像/场景证据规则；不是本次真实照片 |
| GuildAdventureGuideTest | 通过 | 原 PR 的引导、规则与资源 |
| PhotoTaskLedgerTest | 25 检查通过 | 真实临时文件的原子持久化、断写、损坏文件、冷却和重启语义 |
| PhotoJourneyManagerTest | 28 检查通过 | 完整 manager 配合 Bukkit/ImageFrame/纪念册/奖励箱替身；没有真实背包、扣费、HTTP 或原生事件 |
| 摄影工作进程、原生渲染器及取证器 Node 回归 | 23 测试通过 | 既有模拟协议与新只读取证器；无实拍 |
| 证据审计和只读快照 Python 回归 | 14 测试通过 | 故意构造的测试数据；合成图片只能检验格式，不能充当验收图片 |
| 既有 portal gallery / photo tiles / photo scenes 回归 | 19 测试通过 | 本机 HTTP、SQLite、私有访问与地图/场景处理；不代表真实对象存储和真实服务器 |

编译有既有弃用 API 警告。开发中曾遇测试资源参数缺失、容器不能动态附加 Mockito agent、Bukkit 初始化需要真实游戏元数据；最终分别补入资源路径、在测试 JVM 启动时附加固定 Byte Buddy agent、仅在测试内设置 Bukkit 替身。没有通过删掉生产功能或删除断言让测试通过。

## 故障矩阵

| 场景 | 当前本地证据 | 隔离实机还需验证 |
| --- | --- | --- |
| 相机未就绪、队列满、本人已有请求、冷却中 | manager 不给留影建议，取证预检明确阻塞 | 停真实相机心跳，在真实教练周期内核对无反复提醒、无提交/扣费 |
| 收到建议但决定暂不拍 | 审计器缺模型决策即 BLOCKED | 让真实 Agent 在危险或忙碌时自主推迟；保留原模型响应与观测 |
| 正常故事拍照 | 命令/证据/相册规则通过 | 真实模型自选时机、提交、PNG、插件完成回执、私有相册及原地图入箱全部同一 job |
| 重复请求/重复回执 | 拒绝未知任务换名重拍；重复 ACK 不生成第二任务；账本拒绝重复 begin | 两次实际提交只消耗一次有效拍摄成本，箱内每个 mapId 一份；单独故障 run |
| 上传前摄影失败 | stopped；保留结果及冷却，可后续自愿重试 | 原生渲染超时、目标丢失；核对原魔力规则与无假成功 |
| 上传成功、uploaded 回执丢失或 failed 到达 | 保留原任务；原生 Future 已完成时，即使两条 ACK 丢失也不能当作可重试失败 | 真实 HTTP 2xx 后在隔离转发层丢/改 ACK，验证同一 PNG、同一原片最终交付 |
| 上传后主人断线 | 不丢原任务，重连按原任务核对 | 真实断线、重连及 PlayerJoin/ImageFrame 回调次序；不代登录正式角色 |
| 导入/交付后游戏端完成回执丢失 | status 可返回原 job 与地图 ID；status 本身不补写 | 丢一次本人完成插件包，重连再查询；不得提交第二次 take |
| 服务端重启且原片已存在 | 真实文件恢复 unknown，再用原片替身核对成功 | 正常停启及受控崩溃点；原生原片、奖励去重和故事恢复 |
| 上传完成但原片未提交即崩溃 | 明确保留 unknown、不重拍 | **尚无自动恢复保证**；核对上传文件与原片存储后另行处理 |
| 纪念册写失败、损坏回执文件 | 分别报告 journalRecorded=false；损坏文件保留并关闭新拍摄 | 原生保存失败后已有地图保持，修复存储后原片能补记 |
| 作品隐私、角色及玩家数据 | 沿用原 owner/私有机制；portal 回归通过 | 用另一测试账号验证不可读私有照片，重启前后核对人物、旧相册及背包摘要 |

## 重复运行本地检查

从仓库根目录运行，JDK 21、Node 22+、Python 3.11+；快照测试需要 PyYAML 6.0.3。只用新建隔离输出目录。先按 [独立源码构建](../self-host/README.md) 准备依赖和编译产物；不要把正式服目录作为 `--inputs`。本次仅下载并验证锁定依赖及 Paper patch-only 输入，没有启动服务器或写入 EULA 接受文件。

以下变量由执行者设置为各自隔离目录；`PHOTO_CLASSES` 是完整 AgentFriend 编译后的类目录，`PHOTO_MOCKITO` 包含 Mockito 5.14.2、Byte Buddy/agent 1.15.4、Objenesis 3.3（Maven 官方包）。新测试 runner 不联网、不自动下载、不启动游戏。

```bash
python paper/plugins/AgentFriend/tests/run_photo_journey_tests.py \
  --jdk "$PHOTO_JDK" --inputs "$PHOTO_INPUTS" --classes "$PHOTO_CLASSES" \
  --mockito "$PHOTO_MOCKITO" --output "$PHOTO_NEW_TEST_OUTPUT"
python -m unittest discover -s paper/probe -p 'test_photo_journey_*.py' -v
node --test paper/ops/goddess-photo-camera.test.mjs \
  paper/ops/native-photo-renderer.test.mjs paper/ops/photo-image-quality.test.mjs \
  paper/probe/photo-journey-recorder.test.mjs
```

portal 子目录先按锁文件安装依赖，再运行：

```bash
node --test tests/gallery.test.mjs tests/photo-tiles.test.mjs tests/photo-scenes.test.mjs
```

runner 记录每个源文件、依赖 SHA-256 和各测试退出码，明确 `realMinecraft:false, realModelCalls:0, realPhotos:0`。要重现原版缺陷，用同一测试的 `--upload-ack-only` 模式，将原 PR manager 编译目录放在候选类目录之前；原版预期退出 1，候选预期退出 0。

## 实机接入与验收步骤

1. 在独立 Minecraft 1.21.1/Youer 环境用测试角色和原有配置机制接入原生女神相机、原模型宿主及 ImageFrame。目录、端口、世界和凭据与正式服隔离。保留已有角色/相册；不借用、重置或直接复制正在运行的正式玩家数据。
2. 原相机启动后做只读预检：

   ```bash
   node paper/probe/photo-journey-preflight.mjs "$PHOTO_NATIVE_GAME_DIR"
   ```

   如果隔离相机实际启用光影，追加 `--shaders-on`。工具复用原生状态校验，只读取 `diagnostics/qiandeng-native-camera.json` 和本机 bridge connection 文件，检查新鲜度、Intel 渲染器、模型目录、原协议及 `127.0.0.1:<端口>` 目标。不输出 token，不调用 bridge、不代启动。退出 2 是阻塞，文件就绪也不等于实拍。
3. 在**既有 QA Agent 宿主**选择一个新证据目录，创建 `createPhotoJourneyRecorder({directory, owner, gameAddress:'127.0.0.1:<隔离端口>', evidenceKind:'real-client'})`，用 `attach(existingBot)` 观察已连接且 UUID 一致的真实 Agent。它不创建账号、不发送游戏命令，只记录私有系统建议、本人摄影插件回执和断线。
4. 宿主真实模型返回摄影工具调用时，在执行前调用 `decision({model,responseId,toolCallId,command,hintId,observation,trace})`。`trace` 为该次真实响应/工具调用原始片段（含模型/响应 ID/工具 ID/原命令，可保留 JSON 字符串形式 arguments），不拼装假响应。`observation` 包含 `safe`、`cameraReady`、观测毫秒时间 `at` 和指向实际输入的 `sourceRef`。安全包括人物存活、当前危险/战斗/移动情况，摄影条件来自刚读取的真实状态；审计要求距决策不超过 15 秒。
5. 只有既有工具执行器确实提交该命令后，才调用 `submitted({command,toolCallId})`。建议只是输入；不为补验硬编码 take，不把 script dispatch 称为自主决策。测试调短教练周期必须标记为加速机制测试，另留默认周期运行记录核查低频行为。
6. 在原 `startGoddessPhotoCamera` 已有 `onCapture` 中链式调用 `recorder.onCapture(info)`，保存**真实工作进程上传后的同一 PNG 字节**及 native diagnostics。保留原 `cacheObservedPhoto` 回调；取证保存失败单独报告，不能抛回摄影流程造成假失败。Agent、worker 跨进程时用一个隔离 QA 编排器顺序汇总这些真实事件；不要让两个 recorder 写同一目录，不更改生产 bridge。
7. 收到完成后本人查询 `/mycli photo status`、`/mycli photo album`、`/mycli arena stash pages`；暂不取走地图，以便确认原片在箱中恰好一份。通过隔离服正常保存/停服获取一致副本，再只读导出指定主人和 job：

   ```bash
   python paper/probe/photo_journey_snapshot.py \
     --server-copy "$PHOTO_SAVED_SERVER_COPY" --owner "$PHOTO_OWNER_UUID" \
     --job "$PHOTO_JOB_UUID" --output "$PHOTO_NEW_SNAPSHOT_FILE"
   ```

   将返回 `album`、`stash` 通过同一 recorder 记录；保留其源文件摘要。快照只读原文件，输出不含其他玩家记录，但本人的照片故事/位置仍是私有证据，不提交 Git。此快照不是 ImageFrame 原生文件或画面本身的独立验证。
8. 结束该 run 后：

   ```bash
   python paper/probe/photo_journey_audit.py \
     --evidence "$PHOTO_EVIDENCE_DIR" --report "$PHOTO_NEW_REPORT_FILE"
   ```

   只有建议、真实模型工具调用与安全观测、实际提交、可解码 PNG 及 SHA、同 job 完成回执、本人私有相册与单份原地图存储全部一致才退出 0。缺项或 `synthetic-fixture` 退出 2。`uploading`、`unknown`、脚本模拟 ACK 均不是完成。默认一 run 一次请求；重复请求故障单独记录并人工核对次数，不能拿该故障 run 冒充正常链路。
9. 人工打开 PNG，核对确实是该旅途、该角色外观、视角与画面内容，非黑屏/旧图/别人的图；核对模型原始记录来源。审计器只能检查所给证据一致性，不能鉴别手工伪造的完整日志，也不自动证明模型对安全的判断正确。每个故障用新 run，并保留失败，不仅挑成功样本。

## 数据与回退

本候选不修改渲染器、人物配置、门户访问策略、原相册格式、原奖励账本结构或任何正式服数据；没有部署包热替换。`photo-tasks.json` 是新增可备份的私有任务元数据，需随隔离服数据备份；照片与历史仍在原存储。不要删除 unknown 任务以强行放行，不要用旧世界/配置覆盖新进度。若退回旧代码，保留新回执文件和全部原相册/奖励数据；旧代码不认识的 unknown 任务须先核对，不能绕过去重再拍。
