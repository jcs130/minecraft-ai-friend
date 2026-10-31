# 核显原生女神相机

## 2026-10-31晚：原生核显候选，等待虚拟屏安装

已确认WSLg的Weston以约104秒周期发生signal11退出，匹配[上游故障41552](https://github.com/microsoft/WSL/issues/41552)，不能把旧GLX/EGL超时归咎于核显算力。后续优先在Windows原生路径验证，未重启WSL、游戏服、推理或TTS。

原专用Java实为Temurin21.0.12.1，旧YSM初始化有err54。[YSM官方安装说明](https://yesstevemodel.github.io/en/wiki/install/)建议此错误改用其测试的JVM；已在独立目录准备官方Microsoft21.0.13.0.2并核验官方SHA256，没有替换服务器Java。尚未完成同场景对照，不能断言旧err54只由JVM导致。官方文档还限制较新YSM的Linux客户端支持，故不把WSLg修好等同于可直接运行整套YSM客户端。

Windows Mesa D3D12探测实际仍选RTX PRO5000，严格核显门禁拒绝该结果；Zink限定Intel后进入真实Intel Vulkan驱动，但上下文在30秒限时内未创建成功，记录保留并停止自己的探测进程。这些均不是合格照片。

已准备[Virtual Display Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver)25.7.23与其官方使用的NefCon1.14.0。CAT、驱动DLL、安装工具签名均Valid；单独1536×1536@30Hz、Intel UHD770的配置和移除入口在E/F核对。当前没有原MttVDD设备，不改现有GameViewer/NVIDIA设备、不更改证书库或关闭签名验证。新增显示设备需要Windows管理员令牌；本轮系统确认已取消，尚未安装，不能称核显相机已上线。

隔离客户端不复制账号/模型认证缓存，不连接服务器，不启动模型循环。相机窗口可从自己的`native-camera-display.json`读取已核对虚拟屏坐标，在WGL创建上下文前定位隐藏窗口；实际GL_RENDERER仍必须含Intel，否则退出。相机编译器现优先复用此客户端已安装的MC bridge，并检查ClientBridge API，避免默用不存在或另一路新核心的构建目录；新模块已对原客户端依赖编译通过。尚无Intel＋YSM＋光影实拍，正式网页相机继续服务。

准备入口`launch.py`只读取相机目录内可选显示配置，不修改显示设置；文件格式为`schema:1`、`expectedGpu:"Intel"`、整数`windowX/windowY`。坐标仅用于窗口放置，不是GPU成功证据；必须以新鲜运行诊断和实际像素验收。

2026-10-31晚补充：服主再次指定优先使用闲置核显。实机Intel UHD770、驱动32.0.101.7092状态正常；无物理显示器不作为拒绝条件。本轮只创建微型离屏诊断上下文，没有启动游戏、修改显示驱动或重启WSL/推理服务。GLX未取得X显示连接；Wayland连接进入EGL初始化但在10秒限时内未完成，均没有取得Intel渲染器或照片，不能称高画质核显版上线。现役网页相机重启后ready/idle，继续服务。后续需先修复图形上下文，再验证真实Intel＋原YSM＋光影成片、耗时和稳定性。

2026-10-29：原生客户端和拍照接入候选已构建，**高画质原生相机尚未上线、尚无 Intel＋YSM＋光影的真实成片验收**。正式女神相机继续使用现有网页渲染器；不把编译或菜单启动当作高画质拍照成功。

## 2026-10-31 新GPU授权与画质方案研究

服主新增允许使用RTX3080Ti渲染，不再把Intel作为唯一目标；当前代码的Intel专用就绪守卫和旧客户端候选尚未修改或启用。正式WebGL摄影已恢复交付，不能将其称为原生光影成片。

只读核实RTX PRO5000约72GB显存占用、RTX3080Ti约10.5/12GB占用；WSL `cormy-tts.service` 明确绑定3080Ti。共享本地API公布的模型为 `qwen3.8-flash-next-iq3_s`，但这不证明每个Agent的系统一实际均走该路由，更不能把3080Ti占用全归因于决策模型。本轮未更换模型、卸载TTS或重启推理。轻量系统一可候选4B量化、非思考、短现场上下文，长规划保留系统二；实际路由、中文工具选择、延迟、取消及显存须单独对照验证，不以参数量保证游戏决策效果。

官方确认 [Iris](https://www.irisshaders.dev/) 支持1.21.1 NeoForge，集成Sodium优化；DH必须使用明确支持它的光影。[DH官方项目](https://modrinth.com/mod/distanthorizons) 说明客户端可跨会话保存已探索LOD；仅安装客户端不会自动取得未接收的远方世界。相机初期使用已有地形缓存、限制后台LOD构建和内存，不提高游戏服模拟距离。新增服务端LOD供应需要独立验证现役Youer兼容及访问边界，本轮没有安装。

建议先验证原YSM2.4.1＋匹配加载器＋Sodium/Iris和轻量光影，再加DH做远景对照；3080Ti算力不等于当前有足够可用显存。预算分别实测TTS、模型KV和原生相机，采用有界按需拍摄。禁止升级原YSM、改共享GPU设置或把启动成功当作完成。仍须实际像素、相册/个人箱、取消和掉线验收后才能切换正式后端。

## 已完成的接入

原1.21.1世界和原女神拍照任务继续负责请求归属、魔力、站稳检查、视角避墙、相册导入、个人奖励箱和作品持久化。`goddess-photo-camera.mjs` 新增显式 `renderer: native`，选择原生后故障不会悄悄回退网页。

专用 Fabric 客户端仅渲染。使用MC核心现有 `agent-mc-java-bridge` 的只读 `screenshot`，不获取身体控制租约、不发聊天／管理命令、不运行模型循环。YSM目录和选中模型读取在构建时复用MC核心的 `YsmAccess`，不复制另一套混淆接口，不强制覆盖玩家外观。普通Agent、女神本人和常驻框架保持。

相机主客户端仍是原Goddess，另一个已认证、非普通玩家的固定UUID旁观角色只负责原生渲染。Paper在拍照租约内把渲染者移动到拍摄者并附身，结束后只恢复本次仍拥有的镜头。渲染者不需要OP；服务器不根据名字自动放行认证或维护。`photo-camera.yml` 的 `native-renderer-uuid` 默认空，现有行为保持。该可选分支只对实际AF.27编译通过，尚未在正式角色启用。

原生镜头姿态由私有文件传入，绑定客户端实例、照片请求、nonce和本人实际实体UUID／编号，最长3秒并续租。每帧核对已加载区块、角色离锚点不超过0.75格、镜头距离不超过24格；不会主动载入任意区块。别人占用MC核心控制时停止覆盖。截图前须看到同一请求的实际镜头位置与至少两帧相机更新，结束后过期自己的租约。

## 客户端候选

- Minecraft1.21.1、Java21、Fabric0.16.13、Fabric API0.115.4。
- 原YSM2.4.1、Iris1.8.8、Sodium0.6.13、ForgeConfigAPIPort21.1.6；候选光影MakeUp UltraFast9.6。
- 独立 `goddess-camera-java`，相机专用GPU偏好；不更改共享服务器Java或两张推理显卡的设置。
- 1536×1536、视距6、帧率上限30、FOV70；隐藏HUD，创建后台窗口。需要有图形环境的登录会话和有效OpenGL上下文，不是 `java.awt.headless=true` 或SYSTEM Session0渲染。
- 官网原图预算由2 MiB改为与相机一致的8 MiB，仍限4096尺寸和SHA256；目录分页不携带像素。此配套已随官网0.8.29发布，未公开原片由本人或管理员管理。

## 无物理显示器方案与本机实测

物理显示器不是硬性前提。服主明确要求无需连接显示器；后续使用虚拟显示或离屏上下文验证，不再把插主板视频线作为操作前置。当前机器已有GameViewer虚拟显示驱动、WSL2 Ubuntu24.04及WSLg，尚未新增驱动或修改全局GPU设置。

此前给专用Java设置Windows节能GPU偏好，实际 `GL_RENDERER` 仍为RTX PRO5000，相机按Intel门禁停止。私有Mesa/Zink加Intel Vulkan ICD时，YSM2.4.1初始化抛 `RuntimeException: err: 54`；原因未确认，实验DLL已在专用目录禁用，没有修改或绕过YSM原生模块。

本轮另以进程环境 `MESA_D3D12_DEFAULT_ADAPTER_NAME=Intel` 探测现有WSLg。GLX尚未取得可用上下文，surfaceless EGL报告llvmpipe软件渲染，不能算核显成功。这里只在私有目录解包mesa-utils诊断程序，没有升级WSL、重启推理服务或更改驱动。下一步排查WSLg显示服务与D3D12适配器，再做真实Intel＋YSM＋光影成片验收；现役网页相机继续服务。

## 准备与使用

源码位于 [native-camera](../integrations/native-camera/)。`provision.py` 只下载和核验Mojang、Fabric、Modrinth资源，不启动游戏、不建Agent。先用专用运行时完成一次Fabric缓存准备，再构建现有MC bridge及相机策略：

```powershell
node packages/agent-mc-java-bridge/build.mjs <相机游戏目录> <JDK21目录> 1.21.1
python paper/integrations/native-camera/build.py --game <相机游戏目录> --jdk <JDK21目录> --out <私有构建目录> --install
```

`native-camera/package.json` 锁定 PNG读取依赖；在独立媒体目录执行 `npm ci --ignore-scripts`。配置仍存本机私有 `goddess-photo-camera.json`，保留原设置并显式加：

```json
{
  "renderer": "native",
  "nativeGameDir": "E:/MC/clients/goddess-camera-1.21.1",
  "nativeDependencyRoot": "E:/MC/runtime/native-camera-media"
}
```

```powershell
python paper/integrations/native-camera/launch.py --game <相机游戏目录> --java <专用Java路径> --server <明确测试入口:端口>
```

启动成功不代表可拍照。必须检查新鲜诊断中的Intel渲染器、启用光影、YSM目录与拍摄者模型，以及第一／第三人称和俯视真实成片，再验证相册、奖励箱、官网原图、取消与掉线。相机客户端的连接令牌、诊断和原图只存本机，不能提交Git或把完整MC bridge状态上传网站。

当前9项相机／原质量检查及8项相册测试通过；相机客户端、可选Paper分支对实际依赖编译通过。测试握手使用夹具，不冒称已经真实渲染。启用时需同时部署相机模块、Paper可选镜头配置和官网8 MiB配套版本；不可只覆盖单个JS文件。

参考：[GLFW窗口上下文](https://www.glfw.org/docs/latest/window_guide.html)、[WSLg官方GPU选择](https://github.com/microsoft/wslg/wiki/GPU-selection-in-WSLg)、[Mesa D3D12驱动](https://docs.mesa3d.org/drivers/d3d12.html)。
