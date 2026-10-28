# 核显原生女神相机

2026-10-29：原生客户端和拍照接入候选已构建，**高画质原生相机尚未上线、尚无 Intel＋YSM＋光影的真实成片验收**。正式女神相机继续使用现有网页渲染器；不把编译或菜单启动当作高画质拍照成功。

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
- 官网原图预算由2 MiB改为与相机一致的8 MiB，仍限4096尺寸、SHA256和已发布目录；目录分页不携带像素。此官网配套源码未发布。

## 本机实际阻塞

Intel UHD770驱动存在，但没有连接显示器。给专用Java设置 Windows 节能GPU偏好后，实际 `GL_RENDERER` 仍为RTX PRO5000；相机按Intel硬门禁停止。这里不能仅凭显卡清单声称在用核显。

另试过仅装入专用相机目录的 Mesa/Zink，并用进程环境只枚举Intel Vulkan ICD；YSM原版2.4.1初始化抛 `RuntimeException: err: 54`，没有产生合格截图。具体内部原因尚未确认，未修改或绕过YSM原生模块。实验DLL已在相机私有运行时禁用，没有安装系统驱动或改全局OpenGL。需要主板视频输出连接显示器／HDMI欺骗器后，继续实测原生Intel WGL；这一步已询问服主，尚待操作。

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

参考：[GLFW窗口上下文](https://www.glfw.org/docs/latest/window_guide.html)、[NVIDIA显示器与GPU选择说明](https://www.nvidia.com/content/Control-Panel-Help/vLatest/en-us/mergedProjects/3D%20Settings/Manage_3D_Settings_%28reference%29.htm)、[Mesa设备选择](https://docs.mesa3d.org/envvars.html)。
