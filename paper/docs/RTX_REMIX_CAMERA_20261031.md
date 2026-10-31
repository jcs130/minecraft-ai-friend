# RTX Remix 相机兼容调查

状态：已确认官方版本、资源及本机阻塞条件，**未启用、没有本服RTX成片**。正式女神相机仍为1536px WebGL；分辨率高不等于已启用原生光影。

用户所说的新模组是 NVIDIA 的 [RTX Remix for Minecraft](https://github.com/NVIDIAGameWorks/rtx-remix-minecraft)，当前公开版本 `v0.1.0`，2026-10-23发布，目标Minecraft Java 1.21.1。它使用路径追踪与PBR材质，属于客户端渲染方案；普通服务器画面无需把渲染模组装进Youer。官方明确说明多人游戏和其他渲染/区块模组的组合测试有限，YSM和女仆模型的实际画面仍须独立验证，不能把Iris、Sodium、DH与它混装后直接宣称兼容。

[官方安装说明](https://github.com/NVIDIAGameWorks/rtx-remix-minecraft/blob/main/docs/PLAYING.md)要求Windows、Java21、Fabric Loader至少0.16.5、Fabric API至少0.116.10+1.21.1、RTX30系或更新显卡及616.92或更新驱动。现有原生相机候选的Fabric API0.115.4不满足此包要求，必须使用独立试拍配置。RTX初始化与SDK可用、原模型、实际像素以及相册交付均需验证，启动器出现不算完成。

## 已核实的本机条件

10月31日只读检查：两张卡均使用610.88驱动；3080Ti共12288MiB、已用约10717MiB，RTX PRO5000 72GB也接近占满。3080Ti型号满足上述代际要求，当前驱动与可用显存预算不满足立即试拍条件。没有停止TTS/模型、更新共享驱动、改全局GPU选择或切换正式相机。

官方Studio616.92页面的“Supported Products”列出了3080Ti，但未列出当前RTX PRO5000 72GB；不能据此为双卡主机直接选择该驱动。共享驱动维护要先确认同时支持两卡的具体包及回退，再与模型、TTS维护协调。此项尚未执行。

## 固定发布资产与验证顺序

- [官方发布页](https://github.com/NVIDIAGameWorks/rtx-remix-minecraft/releases/tag/v0.1.0)，提交 `170197a63d233f8462e921d231cf5124feb08ffe`。
- 资产 `rtx-remix-renderer-0.1.0-202610230634-170197a.zip`，1031023911字节；官方SHA256 `0a4b84fc6a1eb13294daba7bb015431a13ad660febd6cb201ee30ba91b1301fa`。本机已下载并逐字节摘要核对，尚未解压安装，没有RTX试拍；私有回执只记下载与检查结果。
- 独立配置保留1.21.1和原YSM，不改变普通客户端或服务器模组；先用匹配驱动和有界显存预算验证渲染器，再对照同地点/时间的普通、Iris和RTX截图。
- 验证角色模型、女仆、手持物和半透明材质，之后才接入拍照租约与个人箱/网站。最终切换默认相机需要真实成片和对应维护确认。

原生相机当前就绪校验还以Intel＋Iris为目标；本次照片描述/日记补丁没有顺带放宽该校验。详见[原生相机现状](NATIVE_GODDESS_CAMERA.md)。
