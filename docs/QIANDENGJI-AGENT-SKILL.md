# 千灯纪外部 Agent Skill

本版默认采用 **Mineflayer 玩家身体**，以 Java 协议 1.21.1 接入千灯纪，并接收服务端的技能、魔力和保护查询扩展。Numen 服务端假玩家仍是另一条受私有控制接口管理的身体路径，未接入本 Skill。

用户自己的 Agent 管理模型、规划 loop、人设和长期记忆。Skill 只提供本地 stdio MCP、观测、动作执行和原始回执；不运行模型，不索取模型 Key。服务器保存游戏角色、物品、成长和世界进度；网站负责角色归属、权限与保存状态展示。SDK 的可选游戏便笺也留在用户本地数据目录，不代替宿主记忆。

## 分发与安装

正式 ZIP：`qiandengji-agent-1.0.0.zip`，2,705,570 字节。

SHA256：`3d1676e86f31396071866c64ce87d9e6820e1530b755c4221f04c22a15f94669`。

本机交付目录：`E:/MC/发布/千灯纪-Agent-Skill-1.0.0-20261022/`。完整文件夹包含 Skill、安装/设密助手、MCP 扩展、锁定 npm 依赖清单和无画面 SDK；不带 node_modules、世界、用户数据、凭据或网页材质。Git 源码不含 SDK 归档，应从发布 ZIP 安装完整包。

将 ZIP 中整个 `qiandengji-agent` 文件夹放进宿主技能目录，安装 Node.js 22+，在技能目录执行：

```sh
node scripts/setup.mjs init --username ag_YourName
node scripts/account.mjs enroll --profile /上一步输出的profile目录
```

将输出的 `mcp.json` 的 command/args 配入宿主。Codex 等使用不同配置语法的宿主保留相同 command/args；助手不改宿主全局配置。已有角色须初始化时提供本人私有密码文件，见包内 `references/connect.md`。

公网默认 `micro.kangqiang.site:25702`，协议 1.21.1。局域网显式覆盖 `--host 192.168.3.163 --port 25565`。连接前工具发现不会登录游戏。`mc_connection` 连接后核对真实认证、本人状态与原动作终态，同一账号/数据目录保持一个控制器。

首次设密助手等待 `MC_AUTH_SUCCESS` 和 PLAY，再清除早期紧凑状态并查询 `/authstatus`。仅在本连接明确已认证且未设密码时注册一次；异步保存期间仅重新查询，不重发注册。UUID-only 回执正常接受，显式冲突身份拒绝。未知结果停止，不自动改密。

## 网站与 Token

官网 `https://mc.kangqiang.site`。所有者在浏览器绑定角色、创建有期限且可撤销的客户端凭据。原始 Token 放入私有文件，再执行：

```sh
node scripts/setup.mjs portal --profile /私有profile目录 --token-file /私有目录/portal-token
```

`mc_portal` 支持 status、agents、state、profile、capabilities。当前 PAT 通过 HTTPS Bearer 使用，现有 scopes 为 `state.read`、`inventory.read`、`profile.read`；服务端按角色授权，客户端再匹配本游戏账号。返回保存状态的原采样字段，另记接收时间，不把网站缓存当实时游戏观察。

本轮官网公开 capabilities 实测 `CLOUD_AUTH_BRIDGE_PENDING`，网站账号已可用，但云端建游戏角色、绑定与改密通道未就绪；状态按实际返回展示。**只读 PAT 不授权游戏控制或登录**，游戏连接仍用本账号的登录凭据。未来 game.connect 需真实服务端校验短期、角色绑定的凭证；不在客户端伪造通过。MCP 和 HarnessRouter 不新开公网端口。

已向正在维护网站的会话发送用户授权的协作消息、ZIP 路径/校验和与上述接口边界。下载页的实际发布由网站会话管理；本记录不宣称下载路由或认证桥已经上线。

## 验收与维护

7 项 Node 测试与 Skill 官方格式校验通过；独立 ZIP 解压后执行真实 npm ci、配置读取和 MCP 消费。发现 34 个工具，未连接游戏也可读网站 capabilities。普通新账号完成首次设密、原密码重连；读取本人 UUID、20/20 魔力与技能频道、真实道具名及 `/mycli status --json`。

四个落点实际读取后，仅步行一格，原任务 completed，实际位置与目标一致；重连保留身体 UUID、物品和位置，可从原 run 的 archive 读回同一任务终态，未重投。两个 QA 账号均退出，租约释放。0 模型调用；不称长期自主生存、WAN 新验收、Numen、全玩法或网页画面验收。

初版的用户名字段假设、MCP 配置路径及早期认证/异步设密时序失败已保留在私有证据目录，修复后重新验收。现役游戏、代理及其他 Agent 未重启或接管。

维护源码：`skills/qiandengji-agent`；构建器 `tools/build_qiandengji_skill.py`。SDK 使用官方 `--without-viewer` 构建并通过 verify-build 的 0.4.0 归档，SHA256 `eb07cc849b4c9633d310183f977422dab782e7cee4aaa6a91c40c837d4cf562d`；原 47 MB 归档及旧网页材质不分发。构建锁严格检查输入 SHA、归档路径与无画面标记，冻结其余依赖并生成逐文件 manifest；同一源提交重复构建 ZIP 哈希一致。

原始日志、QA 凭据、数据目录与一次性验收脚本留在 `E:/MC/research/qiandengji-skill-20261022`，不提交、不随 Skill 分发，不重复执行旧动作意图。
