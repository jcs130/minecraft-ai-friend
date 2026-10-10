# 截图拍照与地图相册

**0.4.10候选新增无需公网上传的[女神相机](SERVER_PHOTOGRAPHY.md)**：`/mycli photo take <名字> [first|third|top]`，去掉游戏UI、保留人物名字。正式上线以版本与相机状态为准；下方是仍保留的手动截图导入方式。

用 Agent 已有的视角截图或真人客户端截图保存 PNG/JPG，再导入 ImageFrame。原 Agent 客户端、Minecraft 客户端和 Eye 程序均无须更换。截图由现有工具取得，服务器负责上传、制图和保存照片。

## 游戏内步骤

1. 保存截图到本机文件，大小不超过 **4 MiB**，准备至少一张原版空地图。
2. 输入 `/imageframe create 村庄初见 upload 1 1`。名字不带空格；建议每张照片使用新名字。
3. 收到只发给本人的临时链接后，**五分钟内**打开网页选择截图上传，或用下方脚本上传。
4. 等待游戏里 ImageFrame 的创建成功提示，并确认背包实际出现地图。HTTP 的成功回复只表示文件上传完成。
5. 将成品地图放进自己有使用权限的原版展示框，即可挂墙。不要尝试修改其他玩家的领地或公会私有展示物。

`/photohelp` 随时查看步骤；登录提示和 `/mycli world photos` 也会提示上传入口。原来的 `MC_WORLD` 字段保持，`automaticCaptureReady=false` 表示服务器没有代替客户端按快门，不影响已有截图上传。

默认 `1 1` 使用一张空地图；宽幅照片可用 `2 1` 使用两张地图，最大总面积四张地图。空地图在领取上传链接时预扣，创建失败或等待超时由 ImageFrame 退回；务必观察本人游戏回执。取另一份 `/imageframe get 村庄初见` 也消耗对应数量的空地图。

## Agent 上传脚本

下载仓库的 [imageframe-upload.py](../ops/imageframe-upload.py)，使用 Python 3，无额外依赖。在自己的机器上运行；`screenshot.png` 必须是现有截图文件。

把刚收到的完整私有链接写到 UTF-8 文件 `upload-link.txt`，文件只放链接：

```text
python imageframe-upload.py screenshot.png --url-file upload-link.txt
```

也支持 `--url "<游戏内临时链接>"`。脚本识别文件实际 PNG/JPG 格式、限制 4 MiB、关闭环境 HTTP 代理和重定向，不输出链接令牌，也不会自动重试。返回 `status=uploaded` 和 `gameConfirmationRequired=true` 后，继续检查游戏中的成功提示及地图物品；网络超时须先确认游戏状态再决定是否重建请求。

**同一玩家串行拍照。** 新的 `create ... upload` 会取消此前等待中的创建请求。不要并行领取多个链接，也不要复用旧链接。当前上游版本对已取消旧请求仍可能返回 HTTP 200，但不会生成照片，因此游戏回执才是完成依据。临时链接相当于这一次上传的钥匙，不发公屏、不交给其他玩家。

## 保存、归属与分享

- `/imageframe list` 查看自己的照片；`info <名字>` 查看详情；`rename <旧名> <新名>` 改名。
- 默认只授权创建、获取、改名、删除和分享本人的照片，其他人不能删除或编辑。拿到临时链接的人可以为该请求提交图片，但不能改变创建请求的主人，所以要保密。
- 每人最多 **64 张照片**；单图最多 4 MiB、总面积最多四张地图；后台制图单并发、地图发送每 tick 最多八包。
- 照片及地图数据由 ImageFrame 持久保存，正常维护备份包含它们。已有藏宝图、探险家地图和遗迹地图仍走原有任务，不用覆盖导入。
- 这是原版地图及展示框，沿用 Geyser/Floodgate 给基岩玩家显示。手机/Xbox 真实画面仍需设备验收。

## 网络与运营

当前上传入口为服务器 LAN 地址 **192.168.3.163:8517**，仅绑定该网卡。Agent 所在机器须能访问此地址；公网 Minecraft 连接不代表公网上传网页也已开放。异地玩家可继续用允许域名的图片 URL 导入；服主明确要求不开公网接口；不新增HTTPS入口或路由器转发。异地游戏内摄影使用待发布的女神相机，本机渲染后通过现有内网服务导入。

上传服务是已安装的 ImageFrame 内置功能，没有另起媒体服务或摄影账号。配置在 `plugins/ImageFrame/config.yml` 的 `UploadService`；首次启用和修改监听地址/端口须正常重启。教程文字在 ConditionalEvents 的 `qd_photo_help/qd_photo_discovery`，可用该插件自己的加载命令更新；首次注册 `/photohelp` 随正常重启生效。

发布按 [维护流程](OPERATIONS.md) 完成 E/F 双盘停服快照后替换配置。回退只恢复两个配置，保留新增 ImageFrame 照片、地图数据和玩家物品，不覆盖旧世界。
