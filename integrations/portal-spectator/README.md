# 门户完整 3D 观战接线

复用 `mc-visual-console` 的原生网页渲染器。网站浏览器会话和角色归属继续由原
agent-portal 管理，本目录只有薄适配，不创建另一个游戏身体或模型循环。

1. 在门户锁定并安装直接依赖 `ws`。将可信构建目录放进网站自己的不可变发布目录。
2. 将 `portal-adapter.mjs` 复制到门户 `src/spectator.mjs`；在已有 `live` 和
   `browserAuth` 闭包建立后调用：

   ```js
   const spectator = await createPortalSpectator({ config, live, browserAuth, store, WebSocketServer });
   ```

3. 请求处理器中，完成门户现有 Host/Origin 校验后、普通静态文件 fallback 前：

   ```js
   if (await spectator.http(req, res)) return;
   ```

4. `server.on('upgrade', ...)` 调用 `spectator.upgrade(req, socket, head)`；未命中的
   upgrade 交还网站其他明确注册的处理器，或直接关闭。关闭网站时调用 `close()`。
5. `GET /api/v1/live` 的既有 ACL 列表再 `.map(spectator.decorate)`。只给实际
   `canManage` 的本人/管理员频道返回 `watchUrl`，按钮写“3D 观战”；源离线时明确
   显示“等待 Agent 发布观战”，不展示测试图或自动登录同名角色。

启用配置位于原 `live`：`native3dEnabled: true`、
`native3dSiteDirectory: "/app/vendor/mc-spectator"`。默认关闭不影响原 JPEG 预览。
不要把完整 3D 的授权等同于原公开 JPEG。完整 3D 目前仅本人/管理员可看。

Nginx 对 `/api/v1/live/<id>/source` 增加明确的 WebSocket Upgrade 路由，保留网站
现有 Host/HTTPS 设置，`proxy_read_timeout 75s`。`/watch/` 的 SSE 使用
`proxy_buffering off`、`proxy_read_timeout 75s`。只复用现有 HTTPS443，家庭端只出站。

发布凭据依然是现有 `pub_` Token；首帧认证，URL/浏览器不含凭据。每5秒重验来源
凭据和观看会话，轮换、退出登录或撤销绑定后结束旧流并清空网页状态。所有发布者
资源仅作校验过的 PNG/JSON/动画元数据/GLSL/OGG；站点固定提供 HTML/JS/CSS。

部署前需真实门户 owner/非 owner/管理员/会话撤销验证，以及原1.21.1同连接
区块/实体/背包菜单/图标/移动端 WebGL。私有联机原包与测试凭据不提交。
