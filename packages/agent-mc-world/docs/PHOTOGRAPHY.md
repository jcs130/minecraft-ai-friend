# Minecraft 摄影与独立创作

mc_photo 负责普通截图、采样游戏事实、可选体素导出与历史归档。默认 capture 不调用模型；scene:voxel 必须显式选择并配置匹配的渲染器。相机模式、实际 yaw/pitch、采样时间、维度、连接代次、期间位移与可见性限制随原始记录保存。

生成图片、视频与歌曲已迁到独立 cortico-world-aigc。MC 的新构建不包含供应商适配器、FLUX 推理图、模型凭据读取或生成队列。普通截图不依赖 AIGC 安装。现有 mc_photo 名称和 capture/read/list/status/scene 保留；create/enhance 返回 capability_moved 指引，不能把它当作完成回执。

## 跨 World 使用

1. mc_photo capture 保存原片；需要体素时显式传 scene:voxel。
2. read 返回原片附件与事实；scene 返回原始体素 JSON 和独立代理图。
3. Persona 选择本次场景、相机及人物参考，把实际附件句柄传给 aigc_create，场景为第一参考，人物仅作为 identity。
4. 由 AIGC 的原任务 id 查询并检查成品，然后由演出或聊天 World 展示。

MC 不读取人格资料或调用其他 World。体素只包含真实客户端已加载的有界数据；未知单元仍未知。艺术代理不是人物骨骼动画的观测证明，第一人称不证明角色在镜头中。

## 体素配置

photography.voxel 保留 rendererSource、assetPack、threeModule、radius、below、above 和 cameraOffset 等显式参数，源码属于 mc-visual-console。原素材 SHA、版本、原始方块映射、朝向和近似说明保留。不会自动扫描模型或渲染器目录。

## 旧配置和数据

旧 photography.provider/endpoint/model/apiKeyEnv 等字段仅作为可读迁移类型保留，MC 不再执行。将它们用 AIGC 的 planLegacyPhotographyConfig 显式迁到 worlds.aigc.image；voxel 仍留 MC。不要把密钥值复制进资料或报告。

旧 minecraft-photos 与 Java photos 目录保持原位。read/list 继续读旧生成记录，未收敛的运行状态归档为 blocked/unknown，禁止自动重投。AIGC 的 migrateLegacyPhotos 默认预览，显式应用时复制生成记录与成品并按 SHA 去重，原片和旧文件不覆盖。

## 验收范围

截图是历史观察，调用结束不代表目标完成。SDK/MCP 保留工具屏障、取消、任务证据和真实回合边界。原始资料由 read/scene 查询；模型提示词的稳定前缀与动态事实预算由宿主或独立创作室处理。
