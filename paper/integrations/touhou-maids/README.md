# 千灯纪 · 原生女仆客户端与兼容状态

Minecraft 1.21.1 / Java 21。现役使用 Youer、原生 Touhou Little Maid 1.5.3 和女仆桥 **0.1.9-follow**，保留 Bukkit 插件、Vortex RPG、原角色与认证。原生 NeoForge 相机与 Web 女仆资源已另行发布；10月31日文档是历史记录，不能据此判断当前部署状态。

**0.1.10-harness 是隔离候选，尚未部署**：原肥鱼可查询并选择原生、DSH或Codex，复用服务器已有HarnessRouter；真人普通菜单与Agent `brain` 共用原身份/记忆/工具。见[运行方式说明](harness/README.md)。附近聊天自动触发及TTS声线统一尚未接入，本候选不自动替换玩家客户端或现役Numen。

**0.1.9-follow 已于2026-11-07部署**：闲置陪伴超过3格追近、卡路8秒后尝试原生安全落点，保留停留/工作/战斗；`context.follow` 说明实际原因，[发布记录](../../docs/MAID_CLOSE_FOLLOW_20261107.md)。此前0.1.8-life已保存同 UUID 存活见证，区分当前死亡与历史墓碑；正常重启后不会反复发旧死亡通知。此前0.1.7已补齐原生模型对话、武器/四件护甲、原版装备菜单、死亡状态与私有提醒。见 [Agent 命令和回执](agent/CONTRACT.md) 与 [发布记录](../../docs/MAID_AGENT_OPERATIONS_20261106.md)。先 `list → context/inventory/tasks`，再按需操作；`chat` 调用已配置的原生模型，旧 `talk` 只是外部宿主留言。客户端不要把原版悦灵投影当成普通动物，也不要把菜单图标当成可取的箱内物品。匹配客户端加载与可米主人格实际使用仍待联调，不能以服务端上线代替客户端验收。

## 客户端怎么选

0.1.8-life [生命状态修复](../../docs/MAID_LIFECYCLE_20261107.md)已正式部署。它区分当前死亡与历史墓碑，保存同 UUID 存活见证并提供恢复事件；不改原女仆、遗物、对话或复活流程。

| 客户端 | 是否需要女仆模组 | 当前体验 |
| --- | --- | --- |
| Java 原版 / 现有 Fabric | 不需要 | 可以进服、玩 RPG，使用兼容投影及本人操作入口 |
| Mineflayer / Numen / 现有 Agent | 不需要原生女仆 JAR | 使用服务器接口；`/qdmaid help` 查询本人权限下的操作 |
| NeoForge 1.21.1 | 想要原生模型和原界面时安装 | 配套官方女仆 1.5.3，保留其原模型、界面与交互 |
| 基岩版 | 不安装 Java JAR | 由服务器协议与资源映射提供兼容表现，物理设备画面另行验收 |

玩家自己的 YSM、Numen、语音模组为可选；NeoForge 实例需用其相应版本，不能把 Fabric JAR 放进去。这个下载与 NEKO、Cortico、DSH 的 Agent 宿主包属于不同用途，宿主包保留原安装方式。

## 配套下载

官网入口已发布：[女仆客户端下载](https://mc.kangqiang.site/downloads.html#maid-client)。固定链接为 [启动器导入包](https://mc.kangqiang.site/downloads/maid-client)（`.mrpack`）、[手动安装包](https://mc.kangqiang.site/downloads/maid-mods)（ZIP）；文件由专用 OSS 直接分发，保留原下载限频。

以下是原女仆单项资源 **1.0.0-20261030** 的发布记录，不代表最新完整客户端包的版本：

- 启动器包约 12 KB：选择 Minecraft 1.21.1、NeoForge 21.1.248，按清单从 OSS 下载原模组。
- 手动包约 30.3 MB：官方女仆 JAR、官方 NeoForge 安装器、中文说明、来源许可和校验。
- 1.5.3 官方原始客户端 SHA256：`f6db04195820c8508704277ea76d63723804ff236a7b780369ba59ebe5cd9c27`。
- 包内没有服务端改版 JAR、测试控制器、账号、Key、存档或 Minecraft 本体。

版本、完整摘要和公开对象链接见 [client-release.json](client-release.json)。四个资源已逐个匿名完整下载校验；官网 0.8.32 上的两条固定链接、公网 1440px/390px 页面和 OSS 响应均已验收。原 SAO 下载、账号与观战功能保留；本次未重启游戏服或登录代理。见[发布记录](../../docs/MAID_CLIENT_RELEASE_20261030.md)。

官方版本：[Modrinth 1.5.3](https://modrinth.com/mod/touhou-little-maid/version/tXG1TkGx)；[原作者源码](https://github.com/TartaricAcid/TouhouLittleMaid)。代码 MIT、美术等资源 CC BY-NC-SA 4.0，语音按原声明；随包保留 [原许可](licenses/)。

## 测试覆盖

原生隔离客户端使用的正是上述官方原始 JAR，NeoForge 21.1.248；生产核心内部 NeoForge 为 21.1.252。既有兼容交接记录包含 17 项真实 Mineflayer、实际 MCP 跟随/停留/静音，以及 Java 38、基岩协议 22、传输 10 项检查。原生 21 种任务已有行为检查，棋牌只验证入座；不声称完整棋局、物理基岩画面、真人听感或远端公网原生客户端全流程已验证。

女仆拥有者与操作权限保持。公共Skill与远端宿主不会随服务端自动更新，不能把适配器源码已更新说成所有客户端都已加载 `mc_maids` 或新增的 `brain`，也不要用旧包覆盖现有核心。现有Agent先按服务器当前 `/qdmaid help` 查询，匹配适配器另行联调。

本次副本候选另在同一 Youer 核心、原生女仆模组和 0.1.4 兼容层上通过 54 项实际关卡检查，见[环形斗技遗迹](../../docs/AINCRAD_ARCHITECTURE_20261030.md)。

## 重新构建客户端包

下载清单中的官方女仆与官方 NeoForge 安装器，使用 Python 3.12+：

```text
python paper/integrations/touhou-maids/build-client-pack.py --maid-jar <原始女仆JAR> --neoforge-installer <原安装器> --licenses paper/integrations/touhou-maids/licenses --output <新目录> --base-url https://你的公开OSS域名/releases/
```

构建器先核对两份原始文件的固定摘要，再生成导入包、手动包和清单；拒绝未知来源及服务端改版。`update-download-page.py` 只更新自己的 HTML 标记区，保留现有网站与其他服务器下载入口。公开目录默认仍由运营者逐包启用，不因加入清单自动开放任意文件。
