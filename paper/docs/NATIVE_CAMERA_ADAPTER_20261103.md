# 核显相机恢复与应用内显卡选择

2026-11-03 02:20 已恢复原生相机：真实客户端完成认证，实际 OpenGL renderer 为 `D3D12 (Intel(R) UHD Graphics 770)`，连续样本为 29–30 帧、约 2.1 GiB 进程私有内存，40 项模型目录及本人无人机加载正常。仍为无光影、隐藏 HUD 的原专用相机，未切换 LLM/TTS 所用显卡。部署摘要见[清单](../manifests/native-camera-adapter-deployed-20261103.json)。

## 原因和修复范围

监督器独立恢复后，应用内 Mesa 26.1.8 的 Windows DXGI 路径默认选了第一个 NVIDIA 适配器；既有核显检查正确拒绝运行。`MESA_D3D12_DEFAULT_ADAPTER_NAME` 用于另一条 DXCore 路径，不能证明本机 WGL 已选择核显。对照测试确认，普通启动和独立启动均会选错，环境变量和桌面位置不是根因。

`MesaIntelAdapter` 只在相机及 `mesaIntelAdapter` 两个选项同时启用时运行。它先核对相机自身 JDK 目录中 Mesa DLL 的 SHA256，再通过 DXGI 读取 Intel 适配器的真实 LUID，注册这一个应用实例的 WGL 适配器回调，最后创建 GLFW 上下文。缺失或未审核的运行库直接拒绝，不伪造 renderer、不自动切到独显。

构建只改变旧相机的 `CameraWindowMixin`，增加两份适配器类；原 YSM 读取器、画面/HUD/姿态逻辑与其他 JAR 条目字节保持。原始 JAR 和启动脚本已在 E/F 校验备份。没有更新系统驱动、修改显示设备/注册表、增加服务或任务，也没有第二次重启游戏。临时虚拟屏诊断日志开关已恢复关闭。

实现依据：[Mesa 26.1.8 DXGI 选择](https://github.com/chaotic-cx/mesa-mirror/blob/mesa-26.1.8/src/gallium/drivers/d3d12/d3d12_dxgi_screen.cpp)、[WGL 到 D3D12 的 LUID 传递](https://github.com/chaotic-cx/mesa-mirror/blob/mesa-26.1.8/src/gallium/winsys/d3d12/wgl/d3d12_wgl_winsys.c)、[WGL 回调结构](https://github.com/chaotic-cx/mesa-mirror/blob/mesa-26.1.8/src/gallium/frontends/wgl/gldrv.h)。镜像与实际运行库版本均锁定；升级 Mesa 时须重新审核，不能删除摘要门禁。

## 验证和边界

隔离 Java/JNA/LWJGL 测试创建真实 Intel 上下文并绘制、读回像素（RGB 32、128、223）；重复初始化无副作用，缺失运行库被拒绝。首次缺失库测试因夹具过早修改 `java.home` 而失败，修正测试启动顺序后通过，失败回执保留。可复现工具位于 `paper/integrations/native-camera/diagnostics/verify_mesa_adapter.py`，不连接 Minecraft、不读取账号。

正式客户端已实际进入世界，遥测新鲜、模型和帧数正常；本轮未替玩家发起照片，不宣称新增照片已经入箱或同步相册，也不证明长时间光影稳定。原监督器、8 GiB 上限、30 帧和无光影策略保持。私有验证及回退位于 E/F `repairs/native-camera-adapter-20261103-r1`，安装入口已消费，勿重放。
