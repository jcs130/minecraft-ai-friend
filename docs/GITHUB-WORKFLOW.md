# GitHub 开发与本机资源恢复

主仓库是 https://github.com/jcs130/minecraft-ai-friend，整合开发分支为 `codex/performance-foundation`。本次目录整合继承原 `main` 的 `7e2b4e19f07cacab903f88e5b785487b9deae225` 及之前 409 个提交；原世界服务源码现在位于 `world/`。配套 `dsh-minecraft-agent` 是另一个 Agent 接入仓库，不是本项目的远端。

## 提交范围

仓库保存 `world/` 自研源码、`tools/` 构建与维护工具、`tests/`、配置模板、内容修复数据包、来源锁文件及设计文档。运行数据和派生产物由 `.gitignore` 排除，但本机文件不会被删除：

- `client/`、`server/`、`runtime/`、`.env`、密钥、数据库和日志是本机状态，不能作为 Git 备份。
- `reports/` 是本机验收证据，包含宿主和角色运行信息，不进入公开提交。文档中这些路径须在开发机查看，不能当作仓库中已有的文件。
- `dist/`、生成的 YSM 模型和网页 bundle、GLB、图片、模组提取资源不重复发布。保存生成器、SHA256 来源清单及自研 `vendor/modern-viewer/runtime-budget.js`。
- 原 MIT 许可保留在根目录和 `world/LICENSE`。第三方游戏资源仍适用其各自许可；恢复历史资源不改变许可归属。

后续开发完成后，在当前分支提交已经验证的改动并推送，核对本地和远端提交号。不要强推或把运行数据加入提交。本次目录迁移会在比较中显示旧根目录删除、新 `world/` 路径增加或重命名，原历史仍可以追溯。

## 首次拉取

```powershell
git clone --branch codex/performance-foundation https://github.com/jcs130/minecraft-ai-friend.git QiandengJi
cd QiandengJi
npm ci --prefix world --ignore-scripts
python tools/restore_viewer_assets.py --check
```

请使用完整历史 clone；历史网页基线的恢复需要上述固定提交对象。`--ignore-scripts` 仅适合安装源码检查所需的 JS 依赖，不表示 `canvas`、`gl`、`better-sqlite3` 等宿主原生模块已经构建。

当前 Compose 仍使用开发机已有的 `mc-world:2.1.38` 等镜像及 `pull_policy: never`，构建与迁移工具也保留 Rapid Optimization、原 Numen 改版、模型源档等本机输入。需要 Java 21、匹配模组和 NeoForge、Docker 镜像、依赖及独立本机配置。**尚未提供从任意新电脑一条命令安装全部环境的流程。** 不要把 clone 成功描述为游戏和语音服务已经可以启动。

## 网页资源恢复

`tools/restore_viewer_assets.py` 从固定历史提交的 `packaging/docker/modern-viewer/` 读取 22 项基线文件，以 `manifests/modern-viewer-source.json` 中的 SHA256 逐项核验，不下载未知的新版本。它默认只检查，显式 `--restore` 才补齐缺失项；已有文件与基线不同会整体拒绝写入，避免覆盖部署后的补丁。

仅在全新 clone 的资源目录执行：

```powershell
python tools/restore_viewer_assets.py --restore
```

现有 D 开发目录已经包含后续修改，基线检查显示不同是预期情况，不能删除现有资源来追求“基线一致”。该工具只恢复历史输入，不包含当前模组包、世界数据或全部本机运行环境。

具备本机游戏 JAR、24 小时内导出的当前 `server/mc/block-registry.json`、`world/node_modules/minecraft-data` 和 Pillow 等输入之后，按顺序生成当前网页资源。还须准备 `assets/prepared-models/characters/naruto-uzumaki-shippuden.glb`：当前派生文件仅把锁定原 GLB 的 `JSPN` 块标记修复为 `JSON`，其余字节保持不变；仅恢复历史基线不会自动准备该输入。原版 JAR 路径目前硬编码在 `tools/build_web_mod_assets.py`，需要按新机器位置核对。

```powershell
python tools/build_web_mod_assets.py
python tools/patch_modern_viewer_runtime.py
python tools/patch_modern_viewer_runtime.py --check
```

资源构建会生成 mod-pack、兼容性摘要、注册表镜像和原版状态映射；运行时补丁再嵌入性能预算模块。不能只应用最后一个补丁而跳过原有资源/预算补丁。生成器的输入路径须按实际机器核对，不能读取另一套正在运行的世界来冒充本项目注册表。

YSM 模型使用 `tools/build_game_models.py`，皮肤准备使用 `tools/prepare_character_skins.mjs`，配音包使用 `tools/prepare_voice_packs.py`，各自需要来源锁记录的本机源文件。Git 不包含这些源档或个人存档。

## 验证范围

2026-09-07 本机天神之眼优化已通过 Node 自动检查、21 项 Python 网页资产检查及三视角持续浏览器验收；首个非空几何为 2.7–3.1 秒。原因、修复与测量限制见 [EYE-PERFORMANCE.md](EYE-PERFORMANCE.md)。这些是开发机环境证据，不是 fresh clone 的 CI 结果。

`tests/web-state-map.test.mjs` 等真实注册表测试依赖被忽略的 `server/` 和生成资源；服务健康检查依赖本机凭据、Docker 与运行报告。先准备输入再运行对应检查，不要伪造报告或用空注册表绕过校验。单独恢复历史网页基线也不能代替当前模组兼容性和实际画面的验证。
