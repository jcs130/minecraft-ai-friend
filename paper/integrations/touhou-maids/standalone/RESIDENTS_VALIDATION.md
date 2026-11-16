# 居民 0.3.0 隔离验收（2026-11-16）

这是 0.3.0 的历史验收。0.3.2 的逐项需求、跨维度/导航/两处住宅与当前投放边界见[2026-11-17 复验](../../../docs/NPC_ACCEPTANCE_20261117.md)，不要把下列旧计数冒充新构建实测。

本记录对应候选构建，正式 `E:/MC/server` 没有被替换、重启或生成新居民。模型选择、模型文本、动作实际结果和真人音画分别验收。

| 构建 | SHA256 |
| --- | --- |
| 独立扩展 `residents-candidate.jar` | `a89b1ca24ecdce3a297742aaaec2f9bb29da908f0fe7623da4f6530691feda2f` |
| 合并旧脑 `residents-hybrid-candidate.jar` | `37342a15f964ec646bffc705ea6d8566e02e87c3f8bb3120d4dde329c1ff7cab` |
| AgentFriend 最小补丁 | `331e1fd333edc3cf03a48989107730009f2df19d493f5f9ce7c5e4560fad6207` |
| AgentFriend 构建基线 | `7b4870210ba4d01a98a806943da0eefe97fdc6495d6c50d7a4d05f334c785437` |

## 本轮实际完成

- Java 42 项原伙伴账本与 32 项新居民契约／持久状态／隐私／双语检查通过；新增测试已加入现有 CI runner。
- Qwen Code 8 项 Python 回归、MC 核心记忆 3 项 Node 回归通过。
- 普通 NeoForge 原生联机 29 项通过：三位原生身体不占玩家名额；真实床、家具和门牌；实际走到目标；真实采矿、原生掉落、放置消耗 3→2、头盔换装、职业技能有限耗魔；错误职业拒绝；原生回床睡眠；正常重启保留住处、经验和原动作回执。
- Youer＋现役依赖组合 16 项通过：合并旧脑加载；新版桐人 YSM 选择并重启保持；NPC 本人土地允许、另一居民不能冒用；他人领地拒绝挖建；自家与陌生箱分别允许／拒绝；原生无线饰品实际提取 7 件或保留 7 件；普通地主授权、撤权即时生效；远方未知查询保持拒绝。
- 线上 Qwen Code 实测 2 次 HTTP 200，使用已有 LiteLLM 的在线千问路由。第一轮同时产生中文回复、日语 `spokenReply`；第二轮自主选择并实际挖掉已看到的铁矿石，终态与原身体记忆一致。总计 4033 tokens，模型服务耗时分别 1.047 秒、1.375 秒；这不是游戏完整周转耗时或长期平均成本。
- 今天新下载的桐人模型来源与 SHA256 核对，先前真实 NeoForge 客户端画面已加载；本轮再次验证原生实体选择和存档。不能由此声称每个动画或基岩画面全部验过。

艾因格朗特房屋另外通过 7 项实际检查。只复制一份保存的地形，不复制正式实体或玩家数据；桐人实际穿过原有木门、夜间睡入原生女仆床，正常重启后仍是同一身体和住处。合格入口为 `aincrad (-672,67,825)`，方案见 [aincrad-housing-plan.json](examples/aincrad-housing-plan.json)。测试世界的维度键为 `minecraft:overworld`，正式 `minecraft:aincrad` 已只读确认；不将副本测试冒称正式入住。

保留失败过程：第一次门牌位置有草，预检拒绝且没有覆盖。此前选的 `(-656,67,903)` 房屋在当前原生寻路器下不能到达内部；`canReach=false`，实际移动也超时。没有扩大碰撞或拆房制造通过，改选了有原生可达路线的房屋。运营选房必须检查实际进出和睡眠，不能仅凭门、空床位和导航受理。

## 可复现检查

```sh
python tests/run_companion_ledger.py --jdk /path/to/jdk21 --gson /path/to/gson-2.10.1.jar
python -m unittest discover -s tests -p 'test_*.py'
node --experimental-transform-types --test tests/companion-memory.test.mjs
```

原生测试使用 `tests/RecruitmentProbe.java`，只安装在带隔离标记的新测试世界；构建器不会将其打进发布 JAR。先用住房示例登记三位合成身份，再依次检查 `home-check/furnish`、`walk/break/place/equip/cast` 的原请求终态和实际物品／世界变化，正常停启后用同一 UUID 查询。

开发机完整场景脚本与原始回执在仓库外 `work/maid-recruitment-results-20261116/`：`resident-run-release.txt`、`hybrid-run-release.txt`、`resident-evidence.json`、`hybrid-evidence.json`、`kirito-online-evidence.json`。其中包含隔离运行路径，不能把这些本机文件描述成公开仓库自带资产。生产凭据、模型文件、测试世界和玩家存档不提交。

0.2.0 的 31 项网关、34 项原生客户端招募及 PowerContext 三体独立 Scope 结果属于前一轮，详见 VALIDATION_COMPANIONS，不合并冒充本次新跑的检查数。

## 尚未完成的验收

正式投放与维护窗口；其他房屋逐栋路线；真实基岩手柄菜单和模型气泡；桐人日语音源、实际 TTS／SVC 耳听；24 位居民长期并发成本；跨维度同行；完整 Vortex／玩家经验与全部技能统一；未经审核的附属模组直接世界写入。

历史语音文本成功不等于已播放。固定录音必须与台词对应；动态回复需要另外核验日语 TTS，并明确属于合成语音。
