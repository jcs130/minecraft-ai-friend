# 千灯纪安卓客户端导入包

2026-11-09：1.0.0-preview.1已在官网启用，52,587字节/SHA256与审查目录一致；OSS匿名完整下载、GET/HEAD及六种页面尺寸通过。手机麦克风与耳听仍待实机验收。

FCL 导入一个 `.mrpack`，自动准备 Minecraft 1.21.1 / NeoForge 21.1.248、原生女仆 1.5.3、YSM 2.6.5、SVC 2.6.27，预置服务器地址、中文界面、手机画质及安卓音频配置。

当前 **1.0.0-preview.1** 为安卓附近语音兼容预览。构建与 Java SPI 检查不等于 Android 真机麦克风、耳听或公网语音验收；发布页面和包内说明均保留此状态。真人角色、背包、密码与服务端配置不随导入改变。

## 玩家安装

见随包 [PLAYER_GUIDE.md](PLAYER_GUIDE.md) 或官网 `/android.html`。流程为：安装 FCL → 导入包/选择 Java21 → 原角色进服 → 授权麦克风并完成 V 菜单向导。无需安装 Agent 宿主或配置模型 Key。

## SVC 安卓调查与实现

- [SVC #844](https://github.com/henkelmax/simple-voice-chat/issues/844)：社区作者在 FCL / Redmi Note 11T Pro / Android arm64 / Forge1.20.1 实测自己的 NDK 适配版；上游选择暂不正式支持 Android。这不能被解释为安卓技术上不可运行，也不能当作本包 NeoForge1.21.1 的实测。
- [Android Audio Shim](https://modrinth.com/mod/android-audio-shim)：MIT Java Sound SPI + AAudio 麦克风及 OpenSL ES 输出。[上游 NeoForge PR3](https://github.com/Hhhrty2/android-audio-shim/pull/3) 尚未合并，作者只报告26.3测试。
- 本包保留官方 SVC 的原字节和协议，不分发修改版 SVC。`use_natives=false` 选择其原有 Java Opus 回退；`java_microphone_implementation=true` 使用 Java Sound 录音，预选真实的 `Android AudioRecord` 设备。其余声音仍沿 SVC/OpenAL 的现有路径。
- 音频桥只替换 MIT 原包的 `NativeAudio.class`、加载器元数据和许可/来源记录。原 `libaudioshim.so` 与其余上游类逐字节保留。优先使用 FCL 的 `MOD_ANDROID_RUNTIME`，按原生库 SHA256 命名和核验，再调用 `System.load`；没有复制 Mojo 专属的私有目录。
- 使用 NeoForge 1.21.1 的 [lowcodefml 容器](https://github.com/neoforged/FancyModLoader/blob/1.21.1/loader/src/main/java/net/neoforged/fml/lowcodemod/LowCodeModContainer.java) 承载 SPI-only JAR，不需要游戏事件入口。普通 JVM classpath、JPMS module-path 均须能实际发现音频服务。
- 不混装只带 Fabric 元数据的 `voicechat-android-fix`，也不把 `use_natives=false` 宣称为解决全部音频问题。Java 回退不提供原生降噪、自动增益及 SVC 录音。

## 可复现构建

需要 Python3.12+、Java21 和联网。Eclipse 编译器、原音频桥及三个官方模组均在 `sources.lock.json` 锁定来源、大小、SHA1和SHA512；没有读取开发机运行目录或账号。

```sh
python paper/integrations/android-client/build.py --cache /tmp/qd-android-inputs --output /tmp/qd-android-release
python paper/integrations/android-client/verify.py \
  --pack /tmp/qd-android-release/qiandengji-android-1.21.1-neoforge-1.0.0-preview.1.mrpack \
  --cache /tmp/qd-android-inputs \
  --catalog paper/integrations/agent-portal/src/android-client-downloads.json
```

归档时间、排序和编译器固定。现有输入或同名输出摘要不符即拒绝，不覆盖未知文件。整合包中只内嵌 MIT 音频桥；女仆、YSM、SVC 由启动器按清单从作者官方 Modrinth CDN 下载。无 Minecraft 本体、私人模型、账号、Key、存档、服务器 JAR 或测试控制器。产物不提交 Git。

工作流 `Android client import pack` 重建并核对官网下载摘要，保存可下载的 CI 成品。若修改包内字节，重新生成目录记录；已经发布的同版本不可覆盖，需增加版本。

## 官网启用

下载中心新增安卓区，固定别名 `/downloads/android-client`，安装说明 `/android.html`。沿用原下载镜像、显式包启用、307/HEAD、SHA256 响应头、匿名访问及限频，不新增账号或任意文件下载口。

1. 构建并验证最终 `.mrpack`，将输出 `android-client-downloads.json` 与受审源码核对。
2. 把**这个确切文件**上传原公共下载桶的 `<sha256>/<filename>`，匿名完整下载后核对大小与 SHA256。该对象只含公开客户端资源；不使用角色素材/场景的私有桶。
3. 官网保留现有 `downloads.baseUrl` 与全部已启用包，只追加 `android-client-pack` 到 `downloads.enabledPackages`。
4. 窄更新以下官网文件：`src/android-client-downloads.json`、`src/download-catalog.mjs`、`public/android.html`、`public/downloads.html`、`public/downloads.js`、`public/downloads.css`。现役官网有主干之外的补丁时，逐项合并，不能整目录覆盖。保留当前数据库、账号、会话、配置与其他下载；沿既有网站发布流程备份并切换网站。游戏服无须重启。
5. 公网匿名核验 `/api/v1/downloads` 中这个包 `available=true`；固定别名 GET/HEAD 返回307和正确摘要；浏览器实际导入文件，检查390px页面不横向溢出。

此 checkout 不包含网站/OSS 运维凭据；代码合入或 CI 成品不代表正式网站已启用。对象验证和官网启用结果应另写实际发布记录，不能修改 `current-deployment.json` 冒充完成。

回退只关闭新增包 ID 与恢复上述网站代码，保留新账号/会话/作品；已公开的固定摘要对象可保留。玩家退出本实例再用原客户端，不回灌角色或世界。

## 实机验收

用同一部手机按玩家四步完成：FCL 导入/Java21 → 原角色认证 → 女仆原模型和原界面 → YSM形象同步 → SVC显示已连接 → 麦克风自测 → 附近玩家与 Agent 双向听说 → 远离/换维度后不再串音。再检查断线重连、前后台切换和耳机。

区分游戏TCP、语音UDP24454、ASR字幕和实际听感；`/voice status`、字幕、发送回执不能单独证明听到。公开文档只记录设备型号、版本和去敏结果，不保存真人原始录音、密码或Key。
