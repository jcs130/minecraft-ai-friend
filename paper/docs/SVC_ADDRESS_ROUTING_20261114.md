# 公网与局域网 SVC 地址选择

状态：LoginGuard 0.1.14-svc-routing 修复候选；本文不代表正式部署或 Pad 实际通话验收。

玩家继续使用同一公网进服地址。登录代理根据可信入口保留的连接来源，下发该连接能使用的语音地址：外网使用公网域名，配置的家中子网使用局域网地址，本机服务使用回环地址。不要求玩家安装另一份 SVC，不自动开启麦克风。

## 已核对的问题

2026-11-14 的截图与正式 SVC 2.6.27 资源核对，图标是断开的插头，并非麦克风静音。`.MicroKQ` 的一次 Java 连接在 19:16:08 收到 SVC 密钥请求／发送记录，随后没有 UDP 认证与验证成功记录。该连接是否就是反馈 Pad、其当时网络和设备日志尚未得到用户确认。

正式服 `voice_host` 为空，SVC 默认沿用客户端的游戏主机名。服务器回环和局域网 UDP nonce 探测通过；同机绕行公网域名超时；香港云主机到公网同一端口的独立探测通过（约 44 ms）。因此公网端口并非全面不可达，而家中公网回环缺少兼容路径。探测结果不能代替 SVC 认证、麦克风录音或人工听感，也不能排除 Pad 另有 UDP/VPN 或设备问题。

## 最小修复与边界

- 仅在显式启用后，注册并处理 `voicechat:secret`。从当前已认证的 Paper 物理连接向同一玩家发送；不能凭名字或 UUID 替换物理连接，不接受客户端伪造的服务端密钥包，不撤销其他插件的拦截。
- SVC 协议 20 的 SecretPacket 只替换 `voiceHost`；原始密钥、后端 UUID、端口、编解码器、距离、保活和录音标志保持。原包消费一次，只发一份替换包；地址本来正确则沿用正常转发。
- 按明确的 RFC1918 子网分类，不把所有私网、未知来源或 IPv6 都当家中局域网。未知来源使用公网地址。分类不做 DNS 查询，不保留密钥或玩家 IP 缓存。
- 只有绑定回环的 Velocity 才启用。部署必须现场核对入口对实际 TCP 来源生成 PROXY 头，Velocity 开启 `haproxy-protocol`，且没有可从外网直接伪造来源的代理监听。现有 `agent-lan-gateway.mjs` 使用 socket 的真实来源生成该头。
- 非预期包长、字段或编码不改写，保留后端原始行为并限频记录分类错误；配置无效只禁用本功能，不影响原登录。更新 SVC 时必须重新验证格式。

配置示例（不是可直接覆盖正式私有配置的完整文件）：

```properties
svc-route.enabled=true
svc-route.public-host=voice.example.org:24454
svc-route.lan-cidr=192.168.50.0/24
svc-route.lan-host=192.168.50.2:24454
svc-route.loopback-host=127.0.0.1:24454
```

## 验证记录

1. 修复前完整原认证套件 16 轮通过；新增真实 PluginMessageEvent 用例在第一条 LAN 地址选择断言失败。未使用真实账号密码。
2. 修复后 67 项地址／认证边界、2161 项格式／配置／有界模糊检查通过，连同原认证回归共 18 轮；安装版本的 LoginGuard、OptionalPayloadGuard、ViaVersion 六个消息订阅的顺序矩阵通过。
3. 新建回环 Paper 世界，加载真实 SVC Bukkit 2.6.27 与 Velocity，使用临时玩家和模拟认证提供者，前后两版对照：旧版仍下发空主机名；候选按实际解析的测试 PROXY 来源选择公网／LAN／本机地址，三路完成真实加密 UDP 认证，双方实际收到合成 Opus 测试包；未授权玩家收不到密钥，无重复密钥消息。候选 10 项检查通过。此项不是正式 LibreLogin 身份链或 Pad 听感验收。
4. 制品与现役 0.1.13 比较：仅 LoginGuard 外层及其内部类、新增 SvcAddressRouting 类和版本元数据不同；原 PortalBridge、身份验证、账户策略等其他类逐字节保持。

本机私有证据目录：`D:/codex/2026-09-14/new-chat/work/pad-svc-audit-20261114`。`red.txt`、`native/baseline-client.log`、`native/candidate-client.log`、`native/*-proxy.log` 和 `native/paper.log` 分别保存前后对照与联机结果。原始握手密钥不落盘、不提交源码。测试代码位于 `paper/integrations/login-guard/tests/protocol/run_svc_live.py`；仅复制程序及依赖，不复制世界、账号或凭据；QA 插件绝不进入正式制品。

## 发布与回退

这批只需更新 LoginGuard 和给现有私有配置追加五项地址设置；正常重连登录代理会使 Java 玩家和 Agent 短暂断线，游戏服、TTS 和系统一不需要重启。发布前核对实际连接来源、候选摘要和安全窗口，按当次授权预告维护。回退只保留 F 盘本批 JAR 和配置前像；不覆盖认证库、角色、世界、物品或动作回执。新旧 SVC 密钥由正常重连重新签发，不保存或恢复密钥。

验收需同时满足：正式加载版本和摘要匹配，公开 Java 入口正常，外网 SVC 认证成功，家中使用公网游戏地址的 Pad 完成 SVC 认证；最后由真实设备验证能听到、能录音，才记为实际通话通过。若候选导致原登录失败、错误下发私网地址或持续不兼容报文，正常停代理并恢复本批代码与配置；游戏世界不回灌。

官方参考：[断线图标与排查](https://dev.modrepo.de/minecraft/voicechat/wiki/troubleshooting)、[服务端配置](https://dev.modrepo.de/minecraft/voicechat/wiki/server_config)、[代理接入](https://dev.modrepo.de/minecraft/voicechat/wiki/proxy_setup)、[客户端设置](https://dev.modrepo.de/minecraft/voicechat/wiki/client_setup)。
