> 2026-11-02诊断说明：原生相机新增只读 `ysmProtocolReady` 和Fabric收发通道观测。该值是客户端自己的原版连接标志，不能单独视为游戏后台已握手；必须同时核对同UUID的服务端 `nativeDecoderReady`、实际模型资源及人物画面。它不写就绪状态、注册表或角色选择。正式0.1.1代理已加载，切服确认候选仍独立验收，见 [模型链边界](YSM_NATIVE_CAPABILITIES_20261102.md)。

## 2026-11-01 YSM2.6.5与核显相机收尾已上线

正式为Youer1.21.1 build920、AF.45、RPG桥.16、Native0.4.2、女仆桥0.1.6、Numen API0.1.4-qd-youer1，Geyser外观扩展0.2.2与FAWE混合物品修正已启用。14:55维护完成、15:16相机桥单独就绪；101正式检查、664份角色/物品/成长/认证相关文件冷安装一致性和E/F冷恢复点通过。原角色、背包、技能、密码、模型选择和女神原7任务保持，没有再做旧账本迁移。

正式Intel原生客户端已加载40模型，DeepFish原始大肥鱼/white、CorMy和Yui资源读回。原生无光影摄影正式ready，1536px隐藏游戏UI，沿用描述、私有相册和个人箱；9实拍交付/冷凭据检查、6Numen/女仆检查、14相机规则通过。正式最近约10分钟120份采样FPS中位30/最低29，私有内存2.116→2.117GiB；不声称长期或光影稳定。相机启动先后问题已经原有认证控制与守护器单独重连修复，没有第二次重启游戏、创建新任务或改女神人设。

官网0.8.35/Skill1.3.7已发布，普通Agent免邀请有持久限流和体验池归属，Lite0.1.2客户端独立报告已接入；旧Skill字节未变，固定助手源码后8项重建/归档检查通过。源码f0ab3ab3的5项GitHub检查通过；后续部署记录和相机启动修正按最终提交重新检查。以CLOSEOUT_20261101.md与current-deployment.json为准。

原始加密模型的完整网页几何、物理基岩显示/真人语音、用户正式拍照入相册回执及六段地图等独立候选仍分别列为未验收，不把它们说成已完成。新增相机开机自启任务被自动审批拦截，未创建；当前由原交互式用户会话常驻。旧所有维护入口已消费禁止重放，E/F冷刷新复用完整静态ops并另存私有相机恢复文件。以下记录是当时历史。

## 拍照服务的实际身份（2026-11-01 16:32）

专用摄影客户端 `ag_PhotoLens` 使用旁观模式，实际读取 `playerGameType=3`、`abilities.invulnerable=1b`，没有 OP 权限。它是相机，不是普通冒险者；生存玩家不可见且不参与碰撞、战斗，其他观战端若仍绘制它，则使用原创 `qd_observer_drone/default` 小无人机。服务端选中状态、原生客户端模型加载和网页可用资源均已核对。照片不绘制摄影者自己的手或游戏 UI，场景内玩家名字保留。

该 UUID 已经服主直接确认并加入私有维护名册，可在维护时自动重连；同时加入原生外观配置的随机分配排除列表，避免再次获得普通人物模型。原 `live` 账号及其他角色不变。本次身份登记和排除规则在线生效，没有重启游戏。恢复该服务时应从私有账号配置读取实际 UUID，保持旁观身份和无人机外观，不能只依据角色名称放行。

网页观战另有一次未定位的间歇性 `PartialReadError`：最新长窗口包含 696 个协议包，221 份场景回执及约 3.6 MB 的实际事件流离线重放均通过；恢复官网场景后职业、经验与背包持续更新。尚未取得原失败调用栈或数据包，不能把本次恢复或心跳正常描述为根因修复。该问题不属于相机身份变更。

# 核显原生女神相机

## 2026-11-02：独立光影内存诊断工具

新增[源码排查与证据计划](NATIVE_CAMERA_MEMORY_INVESTIGATION.md)及[独立 Windows 诊断程序](../integrations/native-camera/diagnostics/README.md)，在明确隔离的测试目录中对齐 JVM/NMT、进程提交内存、按 PID 的 GPU 用量、GL 调用与可选 Gallium 轨迹。原 PR 的开发检查来自 Linux；这些工具尚未完成 Windows 核显长时间运行验收，不能据此认定驱动泄漏已经修复。诊断工具不会被现役常驻相机自动加载，不修改相机启动器、渲染后端或模型服务；本页其余已发布的实测记录继续有效。

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
