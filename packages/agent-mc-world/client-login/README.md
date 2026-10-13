<!-- Owner: CorticoClientLogin.java, LoginSession.java, ReconnectSession.java, fabric.mod.json, ../scripts/build-client-login.mjs -->

# 原生观察者自动登录与重连

Fabric 1.20.6 客户端在收到配置的系统登录提示后提交一次 `/login`，以服务端成功提示确认登录。每次连接只提交一次；错误密码、两步验证或凭据不可读时停止自动重试。普通玩家聊天不触发登录。附身与本模块分别核验。

凭据使用 Windows 当前用户 DPAPI 加密，保存在部署私有目录。配置文件只保存凭据路径；客户端、命令行、Agent 上下文与日志不保存明文密码。同一个游戏目录中的其他账号或其他服务器不匹配时不会读取凭据。

```text
node scripts/build-client-login.mjs <gameDir> --java-home <JDK21Dir> --install
```

脚本使用该游戏目录已安装的 Fabric API、Minecraft 1.20.6 中间命名客户端及 JNA 编译并检查认证状态机，然后安装 `mods/cortico-client-login.jar`。单独重启原生观察者客户端生效，无需重载 Mineflayer、主循环或语音。

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
    "reconnect": true
  }]
}
```

标记必须是系统消息的开头或方括号前缀，不能把玩家名称、转述或一般聊天当作服务端认证。配置按新的网络连接重新读取；同一连接重复收到进世界事件不会重置认证或重复提交。启动日志中的 `Submitted` 只证明提交；`Server confirmed login` 才是认证成功证据。移除 jar 或关闭配置后重启该观察者可回退。

`reconnect` 默认关闭。匹配账号连接断开后，客户端在断线画面等待 3 秒再进服；连续连接失败依次等待 10、30、60 秒，成功连接后重置。返回菜单或取消连接后不自动重进；账号不匹配、认证明确失败或配置不可读时停止重试。进服前重新核对配置；密码仍只在收到系统登录提示后提交。

1.1.1 修正普通重连的握手类型：1.20.6 的连接入口收到非空 cookie storage 时会发送 TRANSFER，空存储也一样。这里使用普通 LOGIN 连接，不携带跨服转移上下文。复验须分别确认 `Reconnecting`、重新进世界与 `Server confirmed login`，不能将重试日志或 Mojang profile-key 的 401 警告作为登录成功或失败的充分证据。
