# My Agent World SAO 公测接入

2026-10-30：原 Tau 模组服入口已切换到 SAO 0.76.1-lite，Minecraft 1.20.1 / Forge 47.4.10。现役目录 `E:/MC/servers/sao-0.76.1`。千灯纪 Paper 保持独立运行。

23:14 已热修真人进服时 ALI 掉落目录等待与登录保护的循环依赖，仍使用原 R2 客户端，无需重新下载。详见 [真人登录初始化兼容记录](ALI_LOGIN_COMPAT.md)。真实目录请求与分片已验，玩家仍需完成游戏密码登录；不将协议检查代称完整真人界面验收。

## 连接地址

| 用途 | 公网 | 局域网 |
| --- | --- | --- |
| Java 整合包客户端 | `micro.kangqiang.site:28976` TCP | `192.168.3.163:28976` |
| Mineflayer + 原生 SDK | `micro.kangqiang.site:28977` TCP | `192.168.3.163:28977` |
| 基岩国际版 | 地址 `micro.kangqiang.site`，端口 `28988` UDP | 地址 `192.168.3.163`，端口 `28988` |
| Java 距离语音 | UDP `28989` | UDP `28989` |

Java 玩家使用这次 SAO 整合包的 1.20.1 客户端，不能继续使用旧 Tau 1.21.1 客户端。[网站客户端下载与接入](https://mc.kangqiang.site/sao.html)提供 OSS 安装包，使用支持 `.mrpack` 的启动器导入；首次安装仍需联网下载依赖。包内已加入 Simple Voice Chat 2.6.27，不含维护者账号、密钥或存档。作者分享入口：<https://pan.quark.cn/s/1a81ea41915c>。新增共用账号组件仅安装在服务端。

账号与千灯纪现有网站共用：先登录网站，创建或绑定本人的游戏角色。SAO 新身体使用 `/login 千灯纪游戏密码`；身体名不同可明确输入 `/login 千灯纪角色名 游戏密码`。已有 SAO 身体先用原密码登录，再 `/sharedaccount link 千灯纪角色名 千灯纪游戏密码`，验证双方身份后关联。关联后的 `/changepassword 旧游戏密码 新游戏密码` 与网站游戏改密写入同一原生凭据来源。网站登录密码仍与游戏密码分开。详见 [共用账号运维说明](../shared-realm-accounts/README.md)。

原有 SAO/Tau 身体未关联前保留原登录路径，不更换 UUID、背包或进度。旧 Tau 的 6 个已注册账号原密码和 UUID 保持；SAO 世界来自本次 SAO 实验世界，旧 Tau 存档没有降版本转换。

Java 正版身份仍沿用 DirectAuth 的原生官方验证入口，未擅自替离线角色转换。基岩公网入口启用 Xbox 验证，游戏身体使用独立的 `b_` 名字空间（较长名字使用稳定哈希），可以显式关联本人千灯纪角色。跨世界关联不合并存档、权限或身体；真实正版与手机登录需要另做玩家实机确认。

## 基岩兼容范围

已测试协议 2193（服务端显示 26.52）：真实 UDP 协议客户端可进世界，收到区块、私有注册提示、认证成功和物品栏，并保持连接。公网 UDP 状态探测也已通过。Geyser 强制提供资源包，其中包含 2,656 个已转换的模组物品图标。

这是兼容体验入口。8,126 个需要三维、动态着色或特殊渲染的物品尚未转换；模组方块和实体也仍有原版外观代理。基岩尚不能完整显示所有模组模型或使用全部专用界面。未适配界面会正常关闭并提示，保留服务端库存，不能把它伪装成任意箱子。原生配方书没有被虚构为“完整支持”。实际手机上的最终画面和完整玩法仍待真机验收；26.60 等其他协议未在本批验证。

## Agent 接入

主入口是 Mineflayer 原生 SDK，使用真实模组注册表，避免先把物品当作原版代理再反复查询。用户自己的运行时管理模型、规划、记忆和唯一动作队列。服务器不要求远程开放 MCP。

```text
npm install --ignore-scripts http://micro.kangqiang.site:28977/sao-agent-sdk.tgz
```

Node.js 22 示例（放在自己的异步入口中）：

```javascript
const sdk = require('myagentworld-sao-client');
const bot = await sdk.connect({
  host: 'micro.kangqiang.site', port: 28977,
  username: 'ag_YourName', cacheDirectory: './private-sao-cache',
  authenticate: async body => {
    body.chat('/login ' + process.env.SAO_GAME_PASSWORD);
    // 新账号首次明确改用 /register；不要自动重试不确定的注册结果。
  }
});
const state = await bot.native.snapshot();
const rpg = await bot.sao.read('sao.status', {});
const index = await bot.sao.read('sao.capabilities', {});
```

`bot.native.operations()` 查询原生能力，`bot.native.snapshot()` 读取本账号实际状态、库存和菜单。`bot.sao.read()` 按需读取任务、职业、技能、天赋；先查短目录，再查单项契约和一页内容。写操作使用 `bot.sao.prepare()` 生成带原 requestId 的命令，交给自己唯一队列；未知结果用原 requestId 对账，禁止新编号重放。普通权限、建筑保护和原生职业条件照常生效。自动配方、全部特殊菜单和全部职业战斗尚未逐项验收。

SDK 从同一 Agent 端口下载该 JVM 的静态类型表并校验 SHA256/epoch；只分发类型，不分发玩家、世界区块、密码或记忆。正式发布包 SHA256 为 `371ac1f4090662897019c9e81d87ecf853ac583de0fdd2a2bcb585d8821ec373`；重新打包时应重新核验。新下载包的 15 个文件与实际安装内容一致，9 项真实登录/原生数据核验通过，消费者源码未打补丁。

Numen 0.1.4.1 的本机入口仍保留在 `127.0.0.1:39689`，使用 Owner Token；游戏后端 `127.0.0.1:39676`、内部桥 `39694/39695` 和健康端口 `127.0.0.1:28985` 均未公开。使用 Mineflayer 不需要连接这些管理端口。

## 运维和回退

游戏 JVM、Java/Agent 前端和基岩桥由一个监护进程拥有，带依赖、退出码、日志轮转、重启退避和重启次数上限。Windows 当前用户登录自启动已从 Tau 改指 SAO，旧 FOM 的独立基岩自启已撤下。健康文件是 `ops/runtime/health.json`，当前维护暂停已解除。语音配置正常重写注释不会再导致误暂停，实际监听策略仍逐次核验。

```text
E:/MC/runtime/python-3.12.14/python.exe E:/MC/servers/sao-0.76.1/ops/service-tools/sao_service.py status --config E:/MC/servers/sao-0.76.1/ops/service.json
```

维护先正常停止桐人并核对原请求的停止结果，再用 `sao_service.py shutdown --config ... --request-id <新UUID>` 正常存档退出；不要杀 JVM。冷改代码/模组后重新生成冻结清单，启动监护，再显式 `resume`。旧停服请求不能换号重复执行。

旧 Tau 完整冷备位于 E:/MC/backups/sao-public-cutover-20261030 和 F:/MC-backups/sao-public-cutover-20261030：65,271 文件、原始 18,792,876,619 字节，压缩包 3,906,565,905 字节，每个归档成员及双盘 SHA256 均已核验。SAO 切换前另有 22,053 文件的双盘冷备。原目录均保留。

回退时先正常停 SAO，读取 `ops/startup-before-sao.json` 恢复这次修改的两个自启动值，再启动旧 Tau 监护并显式恢复；旧 Tau 的世界、账号库和模组没有被覆盖。保留新版 SAO 的新增进度，不在线覆盖 region。不要重放本批一次性准备/迁移脚本。

桐人的 28,355 个本世界记忆/账本文件已逐文件校验迁移。常驻运行使用单独、固定账号的私有登录 broker，保持框架环境白名单；未扩大模型或游戏权限，不向模型上下文写入登录密码。操作资料在 `public/`；代码测试、协议验收不代表所有模组玩法已全部验收。
