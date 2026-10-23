# 从公开源码自行部署千灯纪

## 结论与分支

自研源码采用根目录 MIT；Numen 子项目和第三方组件保留自己的许可证。GitHub 仓库公开，可以克隆、fork 和自行构建。默认 `main` 现已包含当前 Paper 工程、正式 0.8.4 网站与通用 MC 核心；旧工程保存在 `legacy/pre-paper-main-20261023`。分支与候选边界见 [BRANCHES.md](BRANCHES.md)。

```sh
git clone https://github.com/jcs130/minecraft-ai-friend.git
cd minecraft-ai-friend
```

普通 clone 或只复制默认分支的 fork 即可获取当前入口。以下步骤均操作自己新建的目录，不读取维护者家服。

这里提供可独立构建和启动的最小 Paper 沙盒。不是整台家服的磁盘镜像：原城镇、存档、玩家背包、账号、模型凭据、NAS 和云主机部署数据属于运行数据。现役 AgentFriend 是 0.4.47.12；当前完整源码生成 0.4.48 候选，不能把构建成功当成与现役包逐字相同或已完成所有玩法验证。

## 一、游戏核心与自研插件

需要 Git、Python 3.10+ 和 **JDK 21**（仅 JRE 不够）。Linux/Windows 均通过 `JAVA_HOME` 或 `--jdk` 选择 JDK，不读取 `E:\MC`。

```sh
python paper/self-host/selfhost.py doctor
python paper/self-host/selfhost.py prepare --directory .self-host/server --accept-eula
python paper/self-host/selfhost.py build --directory .self-host/server --output .self-host/build
```

`--accept-eula` 表示你已阅读并接受 [Minecraft EULA](https://aka.ms/MinecraftEULA)。只有你自己决定接受后才添加它。准备阶段固定下载 Paper 1.21.1 build 133、MagicSpells、AuraSkills、WorldEdit、WorldGuard、EssentialsX、ProtocolLib、SpectatorPlus 和 SQLite JDBC，并逐个校验 `paper/self-host/dependencies.lock.json`。Paperclip 只准备编译输入，不启动游戏、不生成世界。断网后可用相同目录和 `--resume` 继续，已有错误文件不会被自动覆盖。

构建后的自研 JAR 在 `.self-host/build/`。只把其中的 `AgentFriend-*.jar` 和 `CortiEyeMirror-*.jar` 复制到 `.self-host/server/plugins/`，再在该服务器目录执行：

```sh
java -Xms512M -Xmx2G -jar server.jar --nogui
```

默认只监听 `127.0.0.1:25565`，离线模式且关闭 RCON，用于本机 Agent 和开发验收。不要直接把这个离线后端绑定公网。第一次启动后修改生成的插件配置，使用你自己的房管/领地 UUID、NPC 与出生点；源码资源中的家服角色与坐标仅是既有玩法默认值，不是你的账号或现成城镇。

**尚存的地图依赖：**公会大厅、村路、村庄建筑掩码和生活公会仍按家服布局读取 WorldGuard 区域，其中两项预期 23 栋原村屋。全新随机世界没有这些建筑，模块会报缺少布局并拒绝相关区域改块。不能把这个状态当成全套 RPG 已部署，或用假区域/空掩码把校验改绿；需要后续独立制作可分发的新手村/建筑蓝图及相应区域配置。此次只验证源码构建、沙盒启动和实际命令，不上传家服世界来补齐此缺口。

外网/多人的正式部署，应先安装和配置独立认证代理、保护管理名并封闭后端。参考 [登录保护](../paper/integrations/login-guard/README.md) 和 [跨端配置](../paper/config/INTEGRATION.md)。这些涉及自己的域名、入口与认证配置，需要逐项设置；此最小入口没有自动部署公网认证、基岩、YSM、QwenPaw 或整套运营守护。

## 二、网站

网站当前正式源码为 0.8.4，固定提交 `9f03e4f1101d12f75c83add996165958565c964c`，位于 `portal-account-fix-20261023` 发布分支。main 的 `paper/integrations/agent-portal/` 已纳入同一正式源码；原开发分支的 0.9.0 多世界候选未合入本次发布。

需要 Node.js 22.13+。下列命令仅从公开 Git 提交导出正式网站，自动写入指向你自己的本机沙盒的无密配置。浅克隆若没有该对象，会从公开上游获取固定提交；不用 GitHub 私人 token。

```sh
python paper/self-host/selfhost.py export-portal --directory .self-host/server --output .self-host/portal
cd .self-host/portal
npm ci --no-audit
npm test
npm start
```

本人在本机打开 `http://127.0.0.1:8790` 设置网站管理员。所有网站账号和密码都由新部署者自行创建。游戏建号、认领、改密桥默认关闭；需按照网站的 README 用你自己的认证代理、独立密钥和出站同步设置。云端部署可使用网站的 Dockerfile，但仍需独立的持久目录、私有配置和 HTTPS 反向代理。

源码导出不复制当前网站的账号、归属、照片数据库、云配置或模型 Key。对网站做二次开发可 fork 对应发布分支；导出的固定版本不会自动收集本地未发布的开发修改。

## 三、可选组件与来源

| 内容 | 源码/配置入口 | 自部署边界 |
| --- | --- | --- |
| RPG、技能、任务、试炼、保护 | `paper/plugins/AgentFriend/` | MIT 自研；新存档需要自己的场景与配置 |
| Eye/观战同步 | `paper/plugins/CortiEyeMirror/`、`paper/plugins/shared/` | MIT 自研；配对和访问来源由部署者设置 |
| 登录代理与网站桥 | `paper/integrations/login-guard/`、`librelogin-dual/` | 自研集成与 LibreLogin 上游各自许可；需独立账号库、密钥和配置 |
| 网站与出站发布器 | 上述固定公开提交、`paper/integrations/agent-portal/` | Node 源码、锁文件与 Dockerfile；无维护者私有库 |
| Numen Paper、个人模型与 QwenPaw 桥 | [公开 Numen fork](https://github.com/jcs130/minecraft-numen/tree/0b3e1bab925b1c5aa2a9d27d43cf90bdc58a1241)、`paper/integrations/numen-paper/` | LGPL/原项目许可；原生 API、模型供应商和 Key 自备，见 [Numen 说明](../paper/docs/NUMEN_PAPER.md) |
| Web 实时画面 | [mc-visual-console](https://github.com/jcs130/mc-visual-console) | 独立公开仓库；客户端/画面源需自行运行 |
| Mineflayer/DSH | [dsh-minecraft-agent](https://github.com/jcs130/dsh-minecraft-agent) | 独立接入项目与模型；不随服务器提供共享 Key |
| 基岩 | Geyser/Floodgate 上游、`paper/integrations/geyser-ysm/` | 客户端入口、转发和私钥由部署者独立配置 |
| YSM、模型、声音、建筑数据包 | `paper/manifests/`、对应集成目录 | 上游分别下载并核对条款；不是所有第三方资源都由本仓库 MIT 覆盖 |

旧 `compose.yml` 是历史 NeoForge 运营环境，引用本机镜像与运行目录；当前不能把它当 Paper 的通用一键部署。完整 FOM 整合包仍属独立候选，不把 Paper 的注册表、世界或账号库直接复制过去。

## 四、验证与发布检查

```sh
python -m unittest discover -s tests -p test_self_host.py -v
python tools/check_public_source.py
gitleaks dir . --config .gitleaks.toml --redact=100 --no-banner
```

凭据与历史固定值的处置见 [SECURITY.md](../SECURITY.md)。有条件可以继续运行各组件测试；需要运行世界、跨端客户端、第三方模型或本机运维资源的测试，不能被视为无依赖单元测试。构建与沙盒通过不代表公网、手机、Xbox、所有自定义模型和长期多 Agent 性能已验证。
