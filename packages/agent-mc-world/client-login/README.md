<!-- Owner: CorticoClientLogin.java, LoginSession.java, ReconnectSession.java, InitialPerspective.java, fabric.mod.json, ../scripts/build-client-login.mjs -->

# 原生观察者自动登录与重连

此辅助模块默认以 Fabric Java 1.21.1 为构建目标，旧版 1.20.6 需显式选择。客户端在收到配置的系统登录提示后提交一次 `/login`，以服务端成功提示确认登录。默认每次连接只提交一次；可显式配置已登录后失效的再认证提示。错误密码、两步验证或凭据不可读时停止自动重试。普通玩家聊天和 HUD 提示不触发登录。附身与本模块分别核验。

凭据使用 Windows 当前用户 DPAPI 加密，保存在部署私有目录。配置文件只保存凭据路径；客户端、命令行、Agent 上下文与日志不保存明文密码。同一个游戏目录中的其他账号或其他服务器不匹配时不会读取凭据。

```text
node scripts/build-client-login.mjs <gameDir> --minecraft 1.21.1 --java-home <JDK21Dir> --install
```

脚本使用该游戏目录中与所选版本匹配的 Fabric API、Minecraft 中间命名客户端及 JNA 编译并检查认证状态机；输出清单的 Minecraft 版本也由所选目标写入。加上 `--install` 才安装 `mods/cortico-client-login.jar`，省略时仅生成候选包。兼容构建使用 `--minecraft 1.20.6`。原生客户端实际登录与重连仍需单独验收，不能由 Mineflayer 或网页测试推断。单独重启原生观察者客户端生效，无需重载 Mineflayer、主循环或语音。

`config/cortico-client-login.json` 示例不包含密码：

```json
{
  "enabled": true,
  "accounts": [{
    "server": "example.test:25565",
    "username": "Camera",
    "credentialFile": "C:/private/camera-login.dpapi",
    "command": "login",
    "requestMarkers": ["AUTH_LOGIN"],
    "successMarkers": ["AUTH_SUCCESS"],
    "failureMarkers": ["AUTH_FAILED", "AUTH_2FA"],
    "reauthMarkers": ["AUTH_EXPIRED"],
    "reconnect": true,
    "retryWhileTransportUnavailable": true,
    "retryableDisconnectMarkers": ["AUTH_SERVICE_UNAVAILABLE"],
    "retryWhileTransportUnavailable": false,
    "initialPerspective": "third_person_back"
  }]
}
```

标记必须是系统消息的开头或方括号前缀，不能把玩家名称、转述或一般聊天当作服务端认证。配置按新的网络连接重新读取；同一连接重复收到进世界事件不会重置认证或重复提交。启动日志中的 `Submitted` 只证明提交；`Server confirmed login` 才是认证成功证据。移除 jar 或关闭配置后重启该观察者可回退。

1.2.1 增加可选的每账号 `initialPerspective`：`first_person`、`third_person_back` 或 `third_person_front`。省略、空值和未知值保持现有视角。只有配置中服务器与账号都匹配的新连接才应用一次；不逐帧锁视角，用户之后仍可按 F5 切换。同一游戏目录的其他账号不受影响。此设置只控制镜头视角，不授权附身、传送、认证或改变服务器规则。YSM 仍需安装与实际 Minecraft/Fabric 版本匹配的客户端模组，并另外验证服务端模型同步与真实渲染；第三人称日志不等于模型已显示。

1.1.2 增加可选 `reauthMarkers`。只有此前已有服务端成功确认，且随后收到匹配的真实系统失效提示，才再次提交一次私有登录。等待确认期间忽略重复提示；再次成功后才允许下一次独立失效。连续再认证之间至少30秒，过快的“成功—失效”循环会停止；明确失败仍停止，不把它当成新的挑战。省略或空列表保留原来每连接一次的行为，不增加定时登录，也不会让模型读取或发送密码。45项认证状态机检查覆盖默认行为、失效恢复、重复提示、失败和快速循环；原生实测需另行记录。

`reconnect` 默认关闭。匹配账号连接断开后，客户端在断线画面依次等待3、10、30、60秒，最多自动重连四次。只有服务端确认授权且连续在线30秒才清零；刚登录成功就被踢不会重置间隔和次数，认证等待与配置换服阶段也不算稳定在线。耗尽后保留原断线画面并停止，用户可在修复原因后手动连接；此后稳定在线可恢复正常的重连预算。返回菜单或取消连接后不自动重进；账号不匹配、认证明确失败或配置不可读时停止重试。进服前重新核对配置；密码仍只在收到系统登录提示后提交。认证只读回执公开重连次数、上限和耗尽状态，不包含凭据。

持续观战账号可显式启用 `retryWhileTransportUnavailable`。常规重试用尽后，只有
Minecraft 1.21.1 本地连接器报告的连接超时或拒绝才会每隔 120 秒再尝试。每次重试前复核
原服务器、原账号与开关。服务器踢出、认证失败和未知错误仍受四次上限约束。

1.1.1 修正普通重连的握手类型：1.20.6 的连接入口收到非空 cookie storage 时会发送 TRANSFER，空存储也一样。这里使用普通 LOGIN 连接，不携带跨服转移上下文。复验须分别确认 `Reconnecting`、重新进世界与 `Server confirmed login`，不能将重试日志或 Mojang profile-key 的 401 警告作为登录成功或失败的充分证据。

NeoForge platform 0.1.3 adds optional per-account `retryableDisconnectMarkers`. Only explicit protocol tokens on a disconnected screen allow slow retries after the normal budget, every 120 seconds. Omitted or empty lists preserve bounded retries. Server/account matching, fresh config, manual cancellation and explicit authentication failure still govern reconnection; no credential relaxation or new bot is involved. Configure only service-readiness tokens documented by your server, never bad-password, lock or ban codes.
