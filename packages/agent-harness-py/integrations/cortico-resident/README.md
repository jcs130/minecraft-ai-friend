# 用 Cortico 连接千灯纪居民

下载与本机 World 版本匹配的安装包，并解压到一个固定目录。在 Cortico 扩展管理中选择「从本机目录安装」，选中解压后的 `package` 文件夹（里面有 `package.json`）。重启 Cortico 后，为目标 bot 启用「千灯纪居民」。

1. 打开这个 World 的「连接游戏身体」面板，点击「网页登录并授权」，再打开显示的千灯纪授权页。登录官网，输入面板显示的六位数字并确认。
2. 返回插件后，角色列表会自动加载。选择「新建角色」或「连接已有角色」，再选择车万女仆或 Numen。旧版门户可用「改用授权码」在官网领取授权码并填回面板。
3. 新角色可填写名字和人设，等待游戏服准备身体；已有角色可直接选择。点击「连接这个角色」，面板会显示居民名称。此后使用单角色连接，凭据由此 bot 的 Cortico 密钥存储保存。账号级临时授权仅保存在本机 World 的内存中。

已有居民连接码可从面板的「使用已有的居民连接码」输入。已有连接文件的部署可继续使用 `worlds.qiandengji-resident.sessionFile` 或实例环境变量 `QD_RESIDENT_SESSION_FILE`。通过面板签发的授权优先。在官网的[已有居民管理](https://mc.kangqiang.site/resident-connect.html?flow=connect)中可以撤销该角色的连接。

## 角色如何沟通

游戏产生的 `resident.turn` 事件会唤醒这个 World 所属的角色会话，带上当前身体和可用动作。沟通事件中包含原始消息 ID、听众范围、说话者及收到的文字；通过游戏语音发来的消息会标明语音来源，并携带服务端转写。

- `qd_resident_begin` 让桌面角色主动向身体请求一个新回合。当前已有可用回合时会返回它的 ID。
- `qd_resident_context` 查看这个回合的身体动作，以及获准的发言方式与听众范围。
- `qd_resident_communicate` 用当前公布的文字或语音路由提交发言。针对来信作答时传入原始消息 ID。游戏语音下行由服务器按实际公布的能力处理，发声或播放情况以游戏端回执为准。
- `qd_resident_act` 提交当前身体公布的单个动作；`qd_resident_decide` 提交包含多步动作、日程或对话的完整决定。

本扩展的语音入站采用游戏转写，出站采用角色的游戏发言接口。Cortico World 还支持向会话投递音频附件及转写说明；本地麦克风和本地虚拟主播 TTS 属于各自的扩展。玩家日常接入此服务器身体只需安装「千灯纪居民」。[World 事件与附件契约](https://github.com/Pal-AI-Lab/Cortico/blob/cba606f6aa9f5d56af033529cfc652fda9918709/src/core/types.ts) · [官方 ASR World](https://github.com/Pal-AI-Lab/cortico-world-asr) · [官方 VTuber World](https://github.com/Pal-AI-Lab/cortico-world-vtuber)

## 兼容与构建

本机 Cortico 0.1.4 使用 World API 5，本目录可直接安装。Cortico 0.2.17 使用 World API 6，提供旧版兼容装载。API 6 的原生包使用相同的客户端和执行代码，带有 WebUI 清单和工具描述。两个包的 World ID 相同，一个部署安装其中之一。[官方扩展文档](https://github.com/Pal-AI-Lab/Cortico/blob/cba606f6aa9f5d56af033529cfc652fda9918709/docs/extensions.md) · [上一版契约过渡层](https://github.com/Pal-AI-Lab/Cortico/blob/cba606f6aa9f5d56af033529cfc652fda9918709/src/extensions/previous-contract.ts)

在本目录运行 `npm test` 测试事件、沟通范围和配对。设置 `PORTAL_BROWSER_EXECUTABLE` 可在仓库中运行面板的 Chromium 测试。用 `npm run pack:api5 -- 输出目录` 和 `npm run pack:api6 -- 输出目录` 生成对应安装包。
