# 千灯纪桌面 Java 整合包

1. 在 Prism、HMCL 或其他支持 Modrinth 格式的启动器中导入 `.mrpack`，建立独立实例并选择 Java 21。首次导入会下载 Minecraft 1.21.1、NeoForge 21.1.252 和官方模组。
2. 多人游戏选择「千灯纪 · 主世界」，地址为 `micro.kangqiang.site:25702`。沿用原角色名与游戏密码。
3. 用 USB 或蓝牙连接手柄，进游戏打开「选项 → 控制设置」中的 Controlify 设置，启用并校准。可调整摇杆灵敏度、菜单虚拟光标、快捷轮盘和按键绑定。默认的「使用物品／放置方块」按键可用来打开手上的技能罗盘。

整合包包含车万女仆、YSM、Simple Voice Chat、Controlify 和配置库 YACL。选项里可选择简体中文。第一次使用附近语音，按 V 完成麦克风向导。手柄也可在 Controlify 中绑定语音按键。

已有 **1.21.1 NeoForge** 实例可以只安装 [Controlify](https://modrinth.com/mod/controlify/version/RqsNKKLK) 与 [YACL](https://modrinth.com/mod/yacl/version/7TVdVtxF)。已有 **1.21.1 Fabric** 实例选 [Fabric Controlify](https://modrinth.com/mod/controlify/version/y9bu5RxH) 与 [Fabric YACL](https://modrinth.com/mod/yacl/version/o3cDn8Vp)，同时需要对应的 [Fabric API](https://modrinth.com/mod/fabric-api/version/5SwzqWUu)。每个模组在同一实例中留一份。

安卓 Java 版在 FCL 内配置手柄。基岩版使用游戏的手柄设置。

## 构建

```sh
python paper/integrations/desktop-client/build.py --cache /tmp/qd-client-inputs --output /tmp/qd-desktop-release --catalog paper/integrations/agent-portal/src/desktop-client-downloads.json
```

打包器校验五份官方模组的大小、SHA1 和 SHA512。整合包清单保留下载链接和许可，归档只包含清单、说明及预置服务器地址。上传制品后在现有下载配置启用 `desktop-client-pack`。已发布的文件名和 SHA256 应保持对应。
