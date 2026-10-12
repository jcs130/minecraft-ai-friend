# 特色装备模型源文件

`catalog.json` 是物品身份和编号的唯一来源；`models/*.json` 是本项目原创长方体／调色板数据。这里没有第三方美术模型。当前五件、协议目标原生 Java 1.20.6；游戏规则和候选状态见 [ITEM_APPEARANCES](../docs/ITEM_APPEARANCES.md)。

## 构建

需要 Python 3、Pillow，以及 Mojang 官方 1.20.6 客户端 JAR。构建器验证客户端 SHA256 为 `02dfd345ac1ad55692d5dbc8486ac7e4fea72cd54ac494a79cd48963048e56b2`，用于保留原弩的拉弦／弹药覆盖。官方来源：<https://piston-data.mojang.com/v1/objects/05b6f1c6b46a29d6ea82b4e0d42190e42402030f/client.jar>。JAR 不提交仓库。

```powershell
python paper/item-appearances/build.py E:/MC/research/item-art-NEW --client-jar E:/MC/research/item-appearances-20261012/minecraft-1.20.6-client.jar
```

输出目录必须不存在。产物包括 Java ZIP、基岩 MCPACK、Geyser JSON 映射、服务器目录、Web 模型／32×32贴图／128×128图标和逐文件 SHA256 清单。ZIP 可重复构建，不包含构建时间噪声。Web 图标从原创长方体投影生成，不宣称与原版 GUI 像素一致。

运行 `paper/plugins/AgentFriend/build.ps1` 构建服务器，自动把同一目录装入 JAR。只发布 `AgentFriend-0.4.33.jar`，`qa/ItemAppearanceQA.java` 永远仅隔离环境使用。

## 验证

```powershell
$env:MC_TEST_CLIENT_JAR='E:/MC/research/item-appearances-20261012/minecraft-1.20.6-client.jar'
python paper/item-appearances/test_build.py
powershell.exe -NoProfile -File paper/item-appearances/deployment.test.ps1 -EvidenceRoot E:/MC/ops/repairs/item-art-deploy-NEW
```

联机夹具要求 `MC_STAGE_PAPER` 为名称含 staging、绑定 `127.0.0.1`、端口 `256xx` 的隔离服，实际装候选、QA 插件、原 Minepacks／Eye／Geyser。`MC_TEST_REPORT_DIR` 写私有证据，`MC_TEST_RUN_LABEL` 每次用新值，保留失败。只使用 `ag_ArtQA*` 与对应基岩 QA 账号；**会修改这些测试账号和隔离高空石台，不得指向生产**。

- `native.integration.mjs`：原物品工厂、完整元数据、Eye、Minepacks；默认 `MF_REQUIRE_FROM=E:/MC/probe/package.json`。
- 正常 RCON `stop` 并启动同一隔离服后，设 `MC_TEST_RESTART=1` 再运行，回读先前 `native-persistence.json`；不可重做 fixture 冒充持久化。
- `bedrock.integration.mjs`：另设 `MC_TEST_ITEM_PACK` 指向本次 MCPACK，使用固定兼容 Bedrock 协议库；真实下载分块后才确认资源就绪，测试端单独处理该库的 UUID 表示差异。
- `browser.integration.mjs`：设置 `MC_TEST_VIEWER_ASSETS`、`MC_TEST_VIEWER_ROOT`、`MC_TEST_BROWSER_PATH`，用 TSX 启动。Windows 的 `--import` 使用 `file:///E:/mc-visual-console/node_modules/tsx/dist/loader.mjs`。只开放临时回环 HTTP，最终关闭浏览器、桥和 QA 连接。

构建包、JAR、测试产物、录屏、运行配置和真实物品／账号数据全部留在 Git 外。Web 共享源码内跟踪原创模型和贴图是为了让其他开发者可复现，不包含世界存档。
