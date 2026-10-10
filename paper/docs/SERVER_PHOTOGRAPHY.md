# 女神相机（0.4.10 已上线）

2026-10-10T11:21:12.660Z 正式核验 AgentFriend 0.4.10；E/F停服快照 20261010-191651 完整，实际成片交付通过。相机是否当前可用请看 `/mycli photo status`。

## 玩家与 Agent

准备 **1 张空地图和一个空主背包格**，面向景物，输入：

```text
/mycli photo take 村庄初见 first
/mycli photo take 旅行合影 third
/mycli photo take 营地全景 top
```

`first` 为第一人称，`third` 从本人身后拍摄，`top` 从本人上方拍摄。省略角度默认为第一人称。`/mycli photo menu`、罗盘「生活照片」及 `/mycli world photos` 提供原版箱子菜单的三个角度按钮与本人相册。

照片不含背包、血条、准星、菜单、调试文字或观察者手臂，保留场景、人物名字和实际收到的世界展示实体。第三人称和俯视会包含本人角色；第一人称隐藏本人身体。墙壁或屋顶挡住镜头时请到开阔处再拍。拍摄过程中保持静止；离线、死亡、跨维度或镜头被手动接管会停止请求。

人物皮肤取自女神连接实际收到的原版玩家材质属性，包括现有 SkinsRestorer 绑定和 slim/classic 手臂。服务器只读取该属性指向的 Mojang 固定纹理，限时、限大小缓存，再通过本机渲染页提供；浏览器不访问外网。已收到但不支持或加载失败的皮肤会停止拍摄并给出提示，不静默换成 Steve。没有自定义皮肤属性的角色仍按原版默认皮肤显示。YSM 自定义骨骼不属于本次1.20.6照片支持范围。

用 `/mycli photo status` 查询；`photo cancel` 取消尚未上传的请求。导入开始后需等待结果，不能声称已撤销。**只有 `MC_PHOTO status=success` 且本人背包实际出现地图才算完成**。超时或连接中断时先看 `/imageframe list` 和背包，不盲目重拍。原 ImageFrame 负责空地图预扣、失败退还、主人归属、创建限额和持久保存；不会另发一份奖励或伪造地图。

每人默认冷却60秒，全服串行拍摄，最多16个排队请求，排队三分钟过期不扣地图。默认成片768×768、70°视场，生成一张原版照片地图。已有地图、藏宝图、奖励箱和大背包不作迁移。成片可放进本人有使用权限的展示框。

## 不开公网接口

玩家只发送游戏命令，不上传文件，不需要本地截图工具，也不安装客户端模组。服务器让既有 Goddess 观察者暂时附身请求者，使用其实际收到的区块和实体生成 WebGL 照片，再向既有 ImageFrame 内网上传服务提交；拍完恢复观察位置。Goddess 原有人工观察会话占用镜头时不会抢占。

渲染页只在本机回环地址临时监听，每次随机凭据、独立浏览器上下文，完成即关闭。无路由器/防火墙变更，无公网 HTTP/API，无新增摄影账号。浏览器控制使用进程管道。页面不接收库存、聊天历史或游戏操作接口，禁止外部网络请求。女神的 OP 权限不经网页或照片命令开放。

Java、基岩和 Mineflayer 使用同一服务端命令与原版菜单、地图；基岩的实际手机/Xbox显示须另外真机核验。照片是现代化渲染器生成的画面，不冒充真人客户端原生截图；具体材质、模型、粒子支持取决于锁定的1.20.6资源和共享渲染器。

## 桥接与运维

- 游戏侧：[PhotoCameraManager.java](../plugins/AgentFriend/src/org/afuhome/agentfriend/PhotoCameraManager.java)。实际玩家身份绑定主人，Goddess保留UUID、本机登录与观战模式检查不变。`mcagent:photo` 使用作业ID和随机nonce；其他玩家或旧结果不能推进作业。
- 女神侧：[goddess-photo-camera.mjs](../ops/goddess-photo-camera.mjs)，由既有 `goddess-bridge.mjs` 在每次连接时挂载。截图无需LLM调用，不修改其他Agent客户端。
- 渲染侧：共享 `mc-visual-console` 的 `viewer-photo-page.mjs` 与 `photo=1` 模式；需要重建1.20.6、qiandengji预设资产。不能只更新源码就声称所有远程画面已更新。
- 依赖：[photo-camera/package.json](../ops/photo-camera/package.json) 和锁文件。使用匹配的独立无头浏览器；浏览器二进制、资产、照片和运行配置留在Git外。
- 固定运行包由 `node paper/ops/prepare-photo-camera.mjs <共享仓库绝对路径> <已验证资产绝对路径> <新的运行目录绝对路径>` 生成，包含所需共享模块、资产、锁定依赖和逐文件摘要。工具拒绝覆盖旧目录；更新时生成新目录，再随维护切换配置，保留旧包供回退。
- 本机配置 `E:\MC\ops\goddess-photo-camera.json`：`viewerRoot`、`assetsRoot`、`dependencyRoot`、`browserPath` 均为绝对路径；不要写入上传令牌。ImageFrame上传地址由其现役配置提供，仅接受数字形式的私有IPv4 HTTP地址，不跟随重定向。
- ImageFrame固定2026.1.5.0。上游没有待上传对象的公开查询API，本适配只读该版本的并发注册表，核对真实主人、照片名、1×1尺寸、期限和未完成Future，不相信聊天链接或伪造前缀。升级ImageFrame必须重新验证此契约。
- 控制台 `mycli admin photo status|pause|resume`：维护先pause，取消未扣材料的队列，等 `idle=true` 和 `workerIdle=true`，再正常备份停服。配置在 `plugins/AgentFriend/photo-camera.yml`，变更随下次正常启动读取。
- 无头浏览器异常退出时相机停止就绪心跳、当前作业失败；游戏服务器继续运行。先检查本机浏览器/资源日志，再通过既有单实例维护流程重启女神桥恢复，不重复导入未确认的照片。

发布遵循 [维护流程](OPERATIONS.md)：提醒、真人/活动门禁、E/F停服快照、固定摘要部署、正常启动和实际成片验证。回退代码与相机配置时保留 ImageFrame 新照片和玩家地图，不覆盖世界或玩家进度。
