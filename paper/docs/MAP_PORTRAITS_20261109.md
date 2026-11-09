# 地图头像、移动端控件与角色直播入口

地图不再只能显示默认 Steve：每个玩家 UUID 可独立设置公开 PNG 头像，在三个维度的地图标记与居民卡片使用同一张图。可米本次选用现有 YSM 模型包的 `avatar/sbl.png`，保留来源署名；这是模型包自带插画，不是当前游戏模型的实时截图，也不改变游戏皮肤或 YSM。

## 更换头像

当前是运营端自定义接口，尚非玩家自行上传页面。不要把私人角色参考图自动公开。需要获得对应头像的公开使用授权。

```text
node scripts/set-map-avatar.mjs E:/MC/private/portal-sync/config.json 822d173a-7181-3b9b-be60-804f29b24ecc assets/map-portraits/cormy.png
```

复用只读地图发布凭据文件，不在命令行或网页下发 token。接口 `PUT /api/v1/internal/world-map/avatars/{uuid}` 要求运营凭据、`Content-Type: image/png` 和 `X-Content-Sha256`；单图最多 512 KiB，宽高 8–512 像素，拒绝 APNG、URL、SVG。头像存储于地图数据卷的 `world-map/assets/player-portraits/{uuid}.png`；不被位置同步覆盖，重启后保持。刷新地图即可使用更新头像。旧地图生成的普通头像与 Steve 回退保持。

## 地图与直播

地图同源 iframe 使用官网样式：深绿与金色、紧凑坐标栏、44px 缩放按钮、圆形头像；缩放工具高于跟随条，不遮挡操作。点击地图人物或居民卡片可跟随，跟随条和卡片提供“观看直播”。

入口为 `/#live?player=ag_CorMy`。只在当前请求者可见的直播目录中匹配角色；未开放、未授权或尚未同步时显示不可观战，不跳到别人的画面。显式选择其他直播可以退出该角色过滤。

## 验证与部署边界

新增真实 HTTP 回归覆盖鉴权、UUID 隔离、三维度一致、重启保留、超限、格式错误；直播选择检查不越过可见目录，不把缺失角色替换成其他角色。真实 Edge WebGL 在 390px 手机和 1440px 桌面检查头像加载、定位、直播选角、未知角色和横向溢出。

发布仅更新独立地图容器及官网静态 app.js；保留当前地图数据卷、账号、直播权限和 Minecraft 进程。WebRTC 游戏网关的待授权发布是另一批维护，不借此重放。
