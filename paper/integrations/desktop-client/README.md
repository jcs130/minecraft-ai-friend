# 千灯纪桌面 Java 整合包

1. 从[千灯纪 Java 客户端下载页](https://mc.kangqiang.site/downloads/java-client)取得桌面整合包 1.1.3，在 Prism、HMCL 或其他支持 Modrinth 格式的启动器中导入 `.mrpack`，建立独立实例并选择 Java 21。首次导入会下载 Minecraft 1.21.1、NeoForge 21.1.252 和官方模组。
2. 多人游戏选择「千灯纪 · 主世界」，地址为 `micro.kangqiang.site:25702`。沿用原角色名与游戏密码。
3. 用 USB 或蓝牙连接手柄，进游戏打开「选项 → 控制设置」中的 Controlify 设置，启用并校准。可调整摇杆灵敏度、菜单虚拟光标、快捷轮盘和按键绑定。默认的「使用物品／放置方块」按键可用来打开手上的技能罗盘。

整合包包含车万女仆、YSM、Simple Voice Chat、Controlify 和配置库 YACL。选项里可选择简体中文。第一次使用附近语音，按 V 完成麦克风向导。手柄也可在 Controlify 中绑定语音按键。

已有 **1.21.1 NeoForge** 实例可以只安装 [Controlify](https://modrinth.com/mod/controlify/version/RqsNKKLK) 与 [YACL](https://modrinth.com/mod/yacl/version/7TVdVtxF)。已有 **1.21.1 Fabric** 实例选 [Fabric Controlify](https://modrinth.com/mod/controlify/version/y9bu5RxH) 与 [Fabric YACL](https://modrinth.com/mod/yacl/version/o3cDn8Vp)，同时需要对应的 [Fabric API](https://modrinth.com/mod/fabric-api/version/5SwzqWUu)。每个模组在同一实例中留一份。

安卓 Java 版在 FCL 内配置手柄。基岩版使用游戏的手柄设置。

## 查看和编辑桐人动作

使用该桌面包进服，走到使用桐人模型的 Numen 角色附近即可观察。客户端收到服务器下发的 `qd_hub_kirito.ysm` 后，会为其第三人称动画装入待机、走路、奔跑、坐地、坐垫、持剑和看到蛋糕七段动作。角色当前的游戏状态决定实际播放哪一段。客户端日志中的 `Registered 7 third-person motion clips for Kirito` 表示七段均已注册。

在 Blockbench 打开 `kirito-motion/kirito-motion.bbmodel` 可以用代理骨架预览和调整关键帧。保留动作和骨骼名称，导出 Bedrock 动画 JSON 到游戏实例的 `config/qd_kirito_motion/kirito.animation.json`，重启客户端后查看效果。模组读取数值型旋转和位移关键帧，可以只覆盖要调的动作。原模型作者及动作许可见 [ATTRIBUTION.txt](kirito-motion/ATTRIBUTION.txt)。

## 从源码重建 1.1.3

在仓库根目录运行以下命令。准备 Python 3.11 或以上、JDK 21、NeoForge 21.1.252 的 Minecraft 1.21.1 客户端编译类路径，以及 YSM 2.6.5 的 NeoForge JAR。`client-classpath.txt` 应含一行本机编译类路径，用系统路径分隔符连接各 JAR，包含 Minecraft、NeoForge 及其依赖。发布版使用 JDK 21.0.12.1。`qiandeng-controls-0.1.1.jar` 可以从已发布整合包的 `overrides/mods/` 取得。

```sh
python paper/integrations/desktop-client/kirito-motion/build.py --classpath-file client-classpath.txt --ysm ysm-2.6.5-neoforge+mc1.21.1-release.jar --out kirito-motion-1.0.0.jar
python paper/integrations/desktop-client/build.py --cache build/client-cache --output build/desktop-release --controls-mod qiandeng-controls-0.1.1.jar --kirito-mod kirito-motion-1.0.0.jar --catalog paper/integrations/agent-portal/src/desktop-client-downloads.json
```

打包器校验上游模组、动作 JAR 和整包目录记录。1.1.3 的 `.mrpack` 为 39,273 字节，SHA256 为 `2d7ea0ea57f7c4ee182d9d7ab9d08b824bbca353f4196b2f10fa2f3db186d484`。需要复现旧包时，1.1.2 仅传 `--controls-mod`，1.1.0 省略两个模组参数，使用对应版本的目录记录或省略 `--catalog`。`pack-guide.md` 保留发布归档内的基础说明，以便复现旧包。
