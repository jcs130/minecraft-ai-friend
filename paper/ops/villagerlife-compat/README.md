# VillagerLife 1.0.0 / Paper 1.21.1 兼容补丁

上游：[VillagerLife](https://modrinth.com/plugin/villagerlife)，MIT。只接受
SHA256 `ea9e00f7bb9ab414d51fbd0b1d29a2fec1c383c33bc0d4eef84e5606628e2fa4`
的官方 JAR；文件不进 Git。补丁不会接受其他版本后继续猜测处理。

修正内容：

- 普通右键保留原版交易；空手潜行右键才聊天。遵守已取消的交互，固定 NPC、无 AI、乘坐中的村民不接管。
- 村民日程查找排除上述固定角色，保留原有服务员、导师和接待员。
- 常用中文问候、近况、方向、声望、再见映射到作者原有意图；未知内容保留原来的兜底处理。
- 聊天不能免费改名，提示使用原版命名牌并取得所属者许可。
- 上游对 `Biome.getKey` 使用较新 API 的接口调用；1.21.1 中 Biome 仍是枚举类，改为正确的类方法调用。实际联机曾触发 `IncompatibleClassChangeError`，启动成功不能替代交互测试。

构建需要 Java 21、当前 Paper 的 libraries（含 Paper API、Adventure、Bungee chat、ASM 9.7.1）。

```powershell
./build.ps1 -InputJar <官方JAR> -OutputJar <新输出JAR> `
  -Libraries <服务器libraries> -JavaHome <JDK21> -BuildDirectory <新目录>
```

应输出 `talk=1 routine=1 intent=1 rename=1 biome=1`。任一数量不符即失败。
源代码、构建参数和官方输入摘要均保留；替换后须完整重启，不能插件热卸载。

配置在 `paper/content/world-variety/VillagerLife`。作者内部文件名仍是 en_US.yml，内容已翻译为中文。
代取、稀有代取、代工需要的声望设为 1000000，暂不开放这些可能绕过私人物资权限的操作。
这里是预设生活对话，原有 NPCSpeak 问答服务不变，不新增模型调用或费用。

Mineflayer 4.39 的 `activateEntity` 会固定发送 `sneaking:false`。验证潜行交互时应发送标准协议的
`use_entity {mouse:0, hand:0, sneaking:true, ...}`，或使用实际支持潜行交互的客户端操作；不要把测试工具没有发出潜行当成服务器权限故障。
