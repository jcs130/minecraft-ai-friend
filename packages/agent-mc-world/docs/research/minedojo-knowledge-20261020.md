# MineDojo 源码、知识库及接入评估（2026-10-20）

2026-10-25 续：rc.88 已实现显式本地索引与 SDK/MCP 接入，准备、来源短索引、全文／CPU 词元向量、可选神经 embeddings、分页读取与验证见[当前说明](../minedojo-knowledge.md)。完整语料仍不随包分发；下文保留 10 月 20 日研究原型的时间边界与未实现项，不把它们改写为当时已交付。

结论：优先复用 MineDojo Wiki 的离线资料与任务组织方式，继续使用现有 MC 核心执行；不要为了读知识库引入旧模拟器。资料可以帮助规划，但需要经过版本核对和真实执行，才能成为我们验证过的游戏经验或技能。

本轮交付为**源码研究、数据审计和离线检索试验**。新增脚本不接入现役 Agent，不修改 `mc_knowledge` 的公开契约，不训练或调用模型，不启动游戏连接，不恢复已暂停的鸣人。原始 Wiki、SQLite 和下载证据存放在仓库外；MIT 插件不捆绑这些语料。

## 研究基线与组件

| 项目 | 本轮实际核对的源码 | 用途与判断 |
| --- | --- | --- |
| Agent MC World | `233ad1b6952224928b1ab9309fa31fa32cbb9282`，`0.5.7-rc.52` | 从当时远程主分支创建独立工作树；现有执行、知识、游戏记忆、技能与学习证据继续作为基础 |
| [MineDojo](https://github.com/MineDojo/MineDojo/tree/2731bc27394269643b43828d9db8ab3a364601f0) | `2731bc27394269643b43828d9db8ab3a364601f0`，最后提交时间 2023-08-28 | 模拟器、任务规格、数据加载器；这些旧提交日期不能视为当前 Java 兼容承诺 |
| [MineCLIP](https://github.com/MineDojo/MineCLIP/tree/e6c06a0245fac63dceb38bc9bd4fecd033dae735) | `e6c06a0245fac63dceb38bc9bd4fecd033dae735`，最后提交时间 2023-04-01 | 视频语言表征、奖励模型、策略网络与演示；没有在本机下载权重或运行推理 |

另查询 npm registry，当时 `agent-mc-world` 默认发布版本为 `0.5.7-rc.47`。本轮采用更新的远程源码基线 rc.52；没有把开发包版本、已发布版本或本机安装版本混为同一状态，也没有发布新的 npm 版本。

应把以下四件事分别理解：

1. **模拟器**提供统一的观测、动作、初始条件和任务终止条件。其 [Minecraft 构建配置](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/sim/Malmo/Minecraft/build.gradle)绑定 1.11.2/Forge，与我们的 1.21.1 Mineflayer 和服务器扩展不同，不能直接替换。
2. **任务库**提供课程候选及初始条件。检查过的 [程序化任务规格](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/tasks/description_files/tasks_specs.yaml)和[创意任务规格](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/tasks/description_files/creative_tasks.yaml)可以帮助定义有条件、有终态的训练场；自然语言 guidance 仍是建议，不是通过测试的执行程序。
3. **知识库**包含 Wiki 标注，以及 YouTube、Reddit 的可下载索引。各部分发布格式、内容可用性与许可不同，见下文实测。
4. **MineCLIP**把目标文字与视频片段关联，提供训练奖励或辅助评价；它不负责知识检索，也不是一个可直接用于当前服务器的完整 Agent。

[论文](https://arxiv.org/html/2206.08853v2)区分可程序判定和开放创意任务，并用视频语言奖励训练策略；PPO 与成功轨迹自模仿交替进行。本文报告的训练实验没有使用 Wiki/Reddit，因此不能据此声称“Wiki 检索已经证明能提高我们 Agent 的成功率”。视频也没有真实按键标签，不能直接当作运动模仿学习的状态—动作数据。

## 发布数据实际包含什么

2026-10-20 通过官方 Zenodo API 固定到了具体记录，而非只保存可漂移的概念 DOI。以下数量来自实际文件/ZIP 目录检查，不是把网站宣传规模当成本地已取得的语料规模。完整机器可读结果见 [evidence.json](minedojo-knowledge-evidence-20261020.json)。

| 官方记录及文件 | 实际大小、数量 | 可直接用于什么 |
| --- | --- | --- |
| [Wiki 6693745](https://zenodo.org/records/6693745)，`wiki_full.zip` | 32,749,712,512 bytes；120,291 个 ZIP 条目，其中 6,738 个 `data.json` | 页面文本、表格单元、图片/精灵引用及截图。6,738 是目录中的标注文件数，不等于去重后的有效攻略数；与论文口径不能混写 |
| 同记录 `wiki_samples.zip` | 128,063,191 bytes；10 个标注页面 | 最适合先验证解析、版权标记、分页与检索 |
| [YouTube 6693792](https://zenodo.org/records/6693792)，`youtube_tutorial.json` | 8,147,320 bytes；34,472 项；全文件 MD5 验证通过 | 视频 ID、标题、链接、播放/点赞、时长、FPS；**文件本身没有字幕和视频内容** |
| 同记录 `youtube_full.json` | 官方元数据标示 174,033,019 bytes，本轮未下载 | 是更大的索引；不能声称已经取得完整视频或字幕 |
| [Reddit 6693238](https://zenodo.org/records/6693238)，`reddit.json` | 11,963,859 bytes；345,876 项；全文件 MD5 验证通过 | 每项只有 `id`、`type`；**没有帖子正文及评论正文** |

官方 [YouTube 加载器](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/data/youtube_dataset.py)直接返回索引行；[Reddit 加载器](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/data/reddit_dataset.py)需要 PRAW 凭据并实时获取正文/评论。因此“下载 Reddit 包后已有数百万条离线讨论可检索”是不成立的。本轮没有调用 Reddit API。MineCLIP 另公开了[按关键词组织的视频 ID 与起止时间格式](https://github.com/MineDojo/MineCLIP/blob/e6c06a0245fac63dceb38bc9bd4fecd033dae735/README.md#training-data)，仍不能代替媒体、字幕或动作标签。

### Wiki 格式和下载成本

实际页面的结构与[数据文档](https://docs.minedojo.org/sections/getting_started/data.html)一致：

- `metadata`：来源 URL、标题、抓取时间。此次读到的 22 页来自 **2022-04-16 至 2022-04-18**；原始时间未注明时区，保留原字符串，不能伪造 UTC。
- `texts[]`：文字和 bbox。需要去导航噪声、重复块、分段及中英文实体别名；不是已经清洗的问答知识库。
- `tables[]`：整表 bbox、表头文字/bbox、单元文字/bbox。数据是扁平单元列表，**没有可直接当作配方的规范行列关系**。原样留存，不凭展平顺序编造配方或数值对应。
- `images`、`sprites`：素材及位置引用；截图在独立文件。只有文本任务不必加载图片。

全量 ZIP 中所有 `data.json` 的压缩负载合计 **32,624,764 bytes**，解压后合计 **197,602,408 bytes**。因此 32.75 GB 包大小不能当作纯文本索引所需空间。官方存储本轮支持精确 HTTP Range，可先读 ZIP 中央目录，再只取所需标注：

| 本轮操作 | 实际传输 | 完整性边界 |
| --- | --- | --- |
| 读取全量包目录 | 16,740,515 bytes / 4 次 Range | 得到路径、压缩/解压大小、CRC、偏移；未取得全部正文 |
| 取得样本包 10 页标注 | 808,278 bytes / 13 次 Range，含目录开销 | 每条目 CRC 通过，另记录原始 JSON SHA256 |
| 按目录选取 12 页标注 | 995,567 bytes | 每条目 CRC/长度通过，另记录 SHA256；没有下载其截图 |

本轮没有传输完整 Wiki ZIP，**没有验证全包 MD5**。逐条 CRC 检查与内容 SHA256不等于独立来源认证或全包校验。正文 SHA 用于后续定位和复现同一参考版本。

不要为读这些文件直接向生产安装整个旧 MineDojo：其[包入口](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/__init__.py)会导入任务/模拟器；[下载模块](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/data/download.py)在导入时解析远端 DOI；[Wiki loader](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/data/wiki_dataset.py)读单页还会打开截图和图片。独立读取 JSON 能避免这些不需要的依赖和隐式联网。

### 版本和许可不能丢

全量目录包含 Java 快照、Xbox 360、Pocket、Bedrock 更新页等。某页被 2022 年抓取，只能说明抓取时间，不能自动标为 Java 1.18，更不能标为 1.21.1 已验证。正文里的现状、旧版本历史、不同版本规则还需要分开。

[官方许可表](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/README.md#license)和本轮 Zenodo 记录声明：代码 MIT；Wiki **CC BY-NC-SA 3.0**；YouTube/Reddit 数据索引 CC BY 4.0。Wiki 的 [NC/SA 条款](https://creativecommons.org/licenses/by-nc-sa/3.0/)需要随来源保留，不能用代码 MIT 覆盖；用于变现直播、商业产品或分发改编语料前，要落实该用途的授权。索引的许可也不自动覆盖被链接的视频、图片和评论。当前研究语料独立保存，不并入插件或公共技能包；不能据此保证衍生模型的权利状况。

## 已完成的离线检索试验

新增仓库内 [scripts/minedojo-corpus.py](https://github.com/jcs130/minecraft-ai-friend/blob/main/packages/agent-mc-world/scripts/minedojo-corpus.py)，仅使用 Python 标准库和 SQLite FTS5：

- `build` 读取显式本地 Wiki JSON；拒绝覆盖索引、冲突快照、超大页面、异常来源和畸形表格。
- `search` 本地 BM25，最多 10 条摘要；少量明确的中英实体别名，没有调用大模型或向量服务。
- `get` 按 ID 读正文，单次最多 4,000 字符；表格每次最多 16 个单元，单元文本最多 256 字符；保留 bbox，明确行列语义未验证。
- 每项保留 URL、数据集标识、许可、原始抓取时间、原始 JSON SHA256；`minecraftVersion:null`、`minecraftVersionVerified:false`、`currentWorldVerified:false`、`trustedInstructions:false`。
- 资料只作为工具结果。引用命令、服务器指令和页面建议不具备执行授权；表格、页面和链接不被自动执行。

在核心包目录可复现本地处理（Python 3.9+，需 SQLite FTS5；输入目录只放 Wiki 标注，避免混入视频索引等大 JSON）：

```powershell
python scripts/minedojo-corpus.py build --inputs C:/datasets/minedojo/wiki_samples --output C:/datasets/minedojo/index/wiki.sqlite
python scripts/minedojo-corpus.py search --index C:/datasets/minedojo/index/wiki.sqlite --query "鱼竿怎么甩杆" --limit 3
python scripts/minedojo-corpus.py get --index C:/datasets/minedojo/index/wiki.sqlite --id "<上一步返回的完整 id>" --length 2000
python scripts/test-minedojo-corpus.py
```

数据下载和输入来源校验由调用者显式完成；这个脚本不含下载器。输入 JSON 具有 MineDojo 格式不证明它来自官方归档，结果中的归属声明也没有作这种保证。脚本是仓库内研究工具，未加入 npm 发布文件或 SDK/MCP 公开契约。

本轮 22 页包括官方 10 页样本，以及 Bread、Fishing、Fishing Rod、Elytra、Ender Pearl、Smelting、Shield、Furnace、Campfire、Tutorials/Combat、Tutorials/Shelters、Tutorials/Transportation methods。目录里没有找到请求的 `Tutorials/Fishing`，没有伪造该页面。

| 实测项 | 结果 |
| --- | --- |
| 最终试验时间 | 2026-10-20 12:04:38 +08:00 |
| 导入 | 22 页，2,661 个去重文本块，294 张保留的原始表格 |
| SQLite | 1,482,752 bytes；构建约 369 ms |
| 手写检索用例 | 英文 8 条、中文 8 条，预期页面进入前 5 名 **15/16** |
| 检索计时 | 16 次单次查询，p50 **3.18 ms**，p95 **6.21 ms**；包括只读开库/SQL，不含下载、构建、模型和游戏执行 |
| 负例 | 3 条指定负例均空；不能推广为已经识别所有当前状态/模组问题 |
| 边界 | 原始 SHA、未知版本、只读索引、分页/长度、冲突与拒绝覆盖检查通过；4 组可复现的合成契约测试另行保留 |

失败例 `how to make bread` 要求 `make AND bread`，未命中 Bread 本页，返回了含相关词的教程。该例保留，不能为了 16/16 隐去。中文问题主要靠实体别名召回，不能据此宣称理解“耐久”“燃料”等限定条件。后续需独立问题集、实体/意图分离、同义词与词形处理，以及来源、版本和章节过滤。**这次是刻意选页的检索冒烟试验，不是独立准确率、线上加速、游戏成功率或知识采用率。**

## 与我们现有核心怎样衔接

现有 [mc_knowledge](../vanilla-knowledge.md)已经提供精确连接版本的 registry/配方和经核对的 1.21.1 指南；[游戏记忆/学习](../game-memory-learning.md)保存带来源的经历和待审候选；[具身学习](../embodied-learning.md)维护 MCAP/FlatBuffers 的观测、策略、动作及评估。应在这些公共机制上扩展，避免 DSH、Pi、Cortico 各做一套检索和技能库。

建议下一阶段在核心实现**显式启用的外部参考索引**，与当前已验证的原版事实分开：

| 层 | 内容 | 可作出的判断 |
| --- | --- | --- |
| 精确版本基础知识 | 现有 `mc_knowledge` 与核对后的官方机制 | 对指定原版版本适用，仍不证明服务器未覆盖规则 |
| 外部参考 | MineDojo Wiki 的带来源/时间/许可片段 | 可提出方法假设；适用版本和当前世界均可能未知 |
| 当前游戏观测 | 核心 inspect、背包、设备/技能帮助、执行回执 | 判断现在是否具备工具、材料、空间、法力、权限等条件 |
| 实际经历 | 同一目标、决策、采用和执行身份关联的结果 | 证明某条件下实际发生了什么，失败和未知照留 |
| 候选/采用技能 | 方法版本、条件、执行约束和历史证据 | 由宿主选择/审阅/采用；读过 Wiki 不等于掌握 |

推荐的最小流程：

```mermaid
flowchart LR
    Q[任务或明确失败] --> K[按需检索少量参考]
    K --> P[系统二提出有条件的方法]
    P --> O[核对新鲜观测与公开能力]
    O --> X[核心有界执行]
    X --> E[任务终态与实际世界变化]
    E --> M[游戏记忆和反思候选]
    M --> V[方法版本测试与宿主采用]
    V --> F[系统一的可执行候选]
    F --> X
```

具体例子：

- **钓鱼**：Wiki 可帮助说明条件和事件；系统二据当前鱼竿、水域、风险和核心能力建立子目标。抛竿、等待鱼咬、收竿由有界执行器处理，结果用实际获得物与耗时判断。不能让系统二逐次决定鼠标点击，也不能把“完成 use”当作已经钓到鱼。
- **面包/烹饪**：先查精确版本配方，识别制作与烧炼的操作差异，再核对库存和工作台等条件；旧网页表格只能辅助。工具拒绝后应引用拒绝原因调整方案，避免原请求重试循环。
- **飞行/闪现/法术**：鞘翅、末影珍珠只是原版参考；服务器法术要从已启用能力包与真实回执学习。不能把“闪现”静默映射成末影珍珠，更不能凭 Wiki 发明耗蓝、冷却或键位。

外部索引拟保留稳定引用 ID、段落/表格位置、原始 SHA、来源、时间、许可、edition/version applicability 与 unknown 标记；本轮原型只实现了页面 ID、正文偏移和表格索引，没有实现全部适用性字段。先返回少量摘要，再按 ID/位置读取正文，记录实际被读取/采用的引用；不把整库或同一手册每轮追加进 system 前缀。检索超出预算或不命中时如实返回未知。

游戏记忆只保存与自己的目标、条件、失败/成功和方法修订相关的证据或引用，避免把整个百科复制到个人笔记。相同来源衍生的多个摘要不是多次独立经验。工具任务完成、目标实现、技能采用与训练样本合格分别记录；未审/未知方法不自动晋升。

## 学习和评估怎样利用 MineDojo

任务规范最值得借鉴的是将**目标、初始条件、成功判定和可选奖励**分开。我们可在 1.21.1 隔离场景中重写相应任务与操作映射，不复用旧实体数字 ID。通过库存、世界状态或服务端事件测量目标；开放建筑审美等难以程序判定的问题另保留人工或模型评分。

[MineDojo 动作空间](https://docs.minedojo.org/sections/core_api/action_space.html)包含运动、视角、功能动作、制作 ID 和槽位；[观测空间](https://docs.minedojo.org/sections/core_api/obs_space.html)包含 RGB、位置、库存、体素等。它们是接口设计参考，不是与我们当前原子动作、取消语义和技能能力的一一等价契约。训练与在线应使用同一公开执行器，保留准入拒绝、动作持续时间、实际采用者和中止原因。

对已有 MCAP/FlatBuffers 数据，保留真实可见观测与独立评估世界真值的区别。当前 viewer 局部体素的 coverage/unknown 不能升级成完整服务端世界。后续若加真值通道，应显式授权、标注来源和时间对齐，只供目标/训练评估，不把未来状态或玩家不可知信息混进在线策略输入。线上采集是否有真实按键标签、动作来源、碰撞和目标终态也要逐项核验。

MineCLIP 可以未来作为隔离实验中的**辅助进展奖励**，不能直接签发成功证明。旧原版视觉与当前皮肤、光影、模组存在分布差异；看见目标不等于接近/交互成功。学到的策略仍需真实动作轨迹、测试集与回退机制。

另外检查到 [MineAgent 演示代码](https://github.com/MineDojo/MineCLIP/blob/e6c06a0245fac63dceb38bc9bd4fecd033dae735/main/mineagent/run_env_in_loop.py)用随机观测特征，未载入训练好的策略；`transform_action` 的不等判断使用 `or`，使功能动作总被置零。README 也明确标注这个演示为随机策略。它不适合直接部署；这只是演示路径问题，不据此否定论文实验。

后续验收应分三步，均尚未完成：

1. **参考检索**：在未参与选页/别名设计的中文问题集上，评测命中、限定条件、跨版本误导、无答案行为、输出预算与延迟；补齐许可和当前版本数据来源。
2. **规划实测**：同类隔离场景比较现有知识与新增参考的目标完成率、连续停顿、无效调用、失败修正轮数和 token；按输入/输出长度与真实条件分层，不能把检索耗时当作游戏反应时间。
3. **技能/策略学习**：把实际读取、选择、采用、执行与终态关联，合格成功片段用于后续蒸馏/训练，负例用于诊断与反例集；按场景/世界种子/时间切分，防相邻帧和同源教程泄漏。先离线回放，再 shadow，之后是否小流量采用需另行明确授权。

目前最接近直接复用的是**外部攻略参考与课程定义**。它们能为“从零试错”提供起点；让 Agent 越跑越好，仍依赖我们自己的执行证据、反思、验证和版本化技能闭环。

## 本次交付验证与加载状态

- Python 原型：4 组合成契约测试通过；真实 22 页导入/检索、CLI 中文查询和有界读取通过。
- 核心回归：204 个测试文件、1,754 项测试通过；TypeScript 核心检查、318 个公开声明生成、包含锁定 viewer 的构建和源/产物完整性校验通过。核心运行时代码未改动。
- 打包：本地生成 `agent-mc-world-0.5.7-rc.52.tgz`，1,290,790,625 bytes，SHA256 `38b80e17d82ba7169e63efef52a1a96a267b46e62f007b7080cd356dee6603b9`。这是独立消费验证用产物，没有发布 npm；它不包含 Wiki 正文、SQLite 或研究脚本。
- 消费验证：从 tgz 解包到隔离目录，复用锁定的本地依赖目录，4 项 SDK/精确版本配方/烹饪指南/研究资料隔离检查通过；完整 packed runtime、公开声明和入口校验通过。验证脚本禁止 socket 连接。这不是一次重新联网安装，也不代表生产加载。
- 线上：没有安装、重载、启动或恢复模型/游戏任务；未声称实际采纳了知识、完成游戏目标或产生学习收益。
