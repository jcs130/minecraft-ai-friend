# MineDojo 参考索引：准备、检索与 Agent 使用

`mc_knowledge` 现在可按需读取显式配置的 MineDojo 历史 Wiki 索引。通用实现、CLI、SDK 和 MCP 均在 Agent MC World；DSH 等宿主只配置路径并消费同一接口。原版知识仍默认可用，不安装整个 MineDojo 模拟器，不下载图片或启动新的模型／游戏循环。

## 知识源短索引

| source | 内容与入口 | 适用边界 |
| --- | --- | --- |
| `vanilla`（默认） | 随包原版物品、配方和生存卡片；search → get | 按实际版本查询；1.21.1 的详细语义不代表所有版本 |
| `minedojo`（可选） | 外部历史 Wiki 的段落；search → 返回页面 ID 与 offset → get | 版本、版别和服务器规则未核实，不能直接当执行方案 |
| `mc_memory` | 自己的地点、经历、失败和方法引用 | 个人游戏记忆，与静态参考库分开 |

先用 `mc_knowledge {"action":"sources"}` 查看已声明来源；未配置索引会明确显示 `not-configured`。`configured-not-probed` 只是有配置，必须用 `source:minedojo, action:help` 检查文件是否可读。索引缺失或损坏会报错，不伪装成“没有相关资料”。不会自动下载或修复。

## 显式准备本地索引

需要 Node.js 22.13+ 或 24，使用 Node 自带 SQLite / FTS5，无须 Python、向量数据库或额外 npm 原生编译依赖。索引能力按需加载；没有配置索引不影响原版知识。

1. 从 [MineDojo 官方知识库说明](https://docs.minedojo.org/sections/getting_started/data.html) 或固定 [Wiki 数据记录](https://zenodo.org/records/6693745) 取得 Wiki 标注。目录中仅放所需 `data.json`／页面 JSON；图片、截图不需要。样本只有 10 页，完整标注目录约 6,738 个文件，不能把样本称作完整库。保留原归档来源与校验记录。
2. 在插件／角色工作区之外准备语料目录，例如 `D:/datasets/minedojo/wiki-json/`。也可为 `--inputs` 传多个明确的页面文件。不要把账号文件、游戏记录或其他 JSON 混入。
3. 执行安装包附带的命令，输出必须是新的绝对路径；拒绝覆盖已有索引。

```powershell
minecraft-agent-knowledge prepare --inputs D:/datasets/minedojo/wiki-json --output D:/datasets/minedojo/wiki.sqlite
minecraft-agent-knowledge status --index D:/datasets/minedojo/wiki.sqlite
minecraft-agent-knowledge search --index D:/datasets/minedojo/wiki.sqlite --query "鱼竿怎么甩杆" --limit 3
minecraft-agent-knowledge get --index D:/datasets/minedojo/wiki.sqlite --id "<上一步返回的完整 id>" --offset 0 --length 2000
```

也可直接用 `node <核心安装目录>/bin/minecraft-agent-knowledge.mjs ...`。准备只读原始标注，保留来源顺序并去除完全重复文本，按约 1,200 字符片段索引。SQLite 外另生成 `.manifest.json`：页数、片段数、输入指纹、索引 SHA256、数据集／许可及向量方式。每个返回页面带原 URL、原 JSON SHA256、抓取时间原字符串。`archiveProvenanceVerified:false` 表示脚本不能仅凭 JSON 格式认证原始下载来源；本地指纹不等于官方归档认证。

文件边界：单页 4 MiB、最多 10,000 个输入文件／100,000 个片段、索引最多 1 GiB；符号链接、冲突快照、异常来源、畸形表格和已有输出均拒绝。写入先在独立临时文件完成，查询始终只读。不把表格平铺单元猜成配方行列；正文中的配方仍优先与当前原版和真实服务器核对。

## 配置及 Agent 查询

在 SDK 或宿主的 Minecraft 配置加入：

```json
{"knowledge":{"minedojo":{"indexFile":"D:/datasets/minedojo/wiki.sqlite","retrieval":"hybrid"}}}
```

DSH 在 Minecraft → 配置 → DSH 插件中填写索引路径，先“仅保存”，再“检查已保存的索引”。无需配置模型或连接游戏即可检查页数与片段数；运行中的连接配置应先正常停止再修改。

```json
{"action":"search","source":"minedojo","query":"how to make bread","limit":3}
{"action":"get","source":"minedojo","id":"<返回的页面 id>","offset":0,"length":2000}
```

search 最多 10 条，每条摘要最多 800 字符；get 最多 4,000 字符，使用返回的 offset / nextOffset 继续读取，不把整页反复注入提示词。与 MCP 相同的公开 SDK 是 `queryMinecraftKnowledge(args, version, config, signal)`；原同步 `readMinecraftKnowledge` 保持原版查询契约。CLI 准备使用 `buildReferenceIndex`，独立读取使用 `readReferenceIndex`。

返回始终标明 `currentWorldVerified:false`、`trustedInstructions:false` 和 `minecraftVersionVerified:false`。页面中的命令与建议是参考数据，不是主人授权。Agent 应根据当前时间、饥饿、背包、威胁和能力比较方案，先核对材料与动作前提，再执行小阶段并查看真实回执；有用经验可将引用 ID、条件和结果记入自己的笔记，不把整库复制为个人经验。

## 向量检索的实际含义

- `hybrid`（默认）：FTS5 BM25 + CPU 词元向量余弦排名；含少量明确中英实体别名。无需下载模型或调用网络。词元向量是词面相似度，不能声称理解任意语义或自动翻译。
- `lexical`：仅全文 BM25；`local-vector`：仅 CPU 词元余弦检索。
- 神经 embeddings：准备时通过 `--embeddings-config <本机私有 JSON>` 显式调用兼容 embeddings 的完整 URL，将参考片段向量存入同一索引。随后配置同一个 `embeddings` 对象，再选 `hybrid` 或 `semantic`。端点／模型指纹或维度不一致、缺失向量或查询失败，会明确标记 `degraded` 并回退本地检索；取消不会触发额外请求。输出相似度是排名分数，不是校准成功率。

```json
{"endpoint":"http://127.0.0.1:8080/v1/embeddings","model":"your-embedding-model","apiKeyEnv":"OPTIONAL_EMBEDDING_KEY","timeoutMs":5000}
```

高级配置示例：`knowledge.minedojo.embeddings` 填上述对象；密钥只用环境变量名，不能填密钥本身。索引只保存模型与端点指纹，不保存凭据。该模式会向你明确指定的服务发送参考片段和搜索词，不发送游戏提示词、回答、思考或个人记忆。默认不启用，也不扫描服务或后台重建。

## 验证与数据范围

本轮实际用原有 22 页历史标注建了 570 个片段，索引约 5.10 MB。预先固定的 32 个手写问题中，28 个有预期页面、4 个是语料覆盖缺口；默认混合检索这 28 个均进入前 5，首位 24/28，p50 约 4.7 ms、p95 约 24.2 ms。三个无共同词元的负例为空。全文基线前 5 也是 28/28、首位 23/28。这是刻意选择的小语料检索冒烟，不是独立准确率或线上任务成功率；缺页和失败记录保留。神经 embeddings 本轮仅验证受控接口契约、模型绑定、取消和降级，不宣称已实测某个真实神经模型的检索质量。

完整语料和真实长期游戏仍需另测。本索引不自动采用方法、训练策略、切换影子模式或恢复现役角色。

## 来源和许可

MineDojo 代码为 MIT，官方 Wiki 数据另标 **CC BY-NC-SA 3.0**；视频和 Reddit 索引的许可又不同，见[官方许可表](https://github.com/MineDojo/MineDojo#license)。本包只分发索引代码、格式和使用说明，不把 Wiki 正文、SQLite 或派生向量夹带进 MIT 发行包。数据的使用及再分发须保留其独立条款与来源；视频索引不是字幕，Reddit ID 也不是帖子正文。更完整的原始格式与下载审计见[研究记录](research/minedojo-knowledge-20261020.md)。
