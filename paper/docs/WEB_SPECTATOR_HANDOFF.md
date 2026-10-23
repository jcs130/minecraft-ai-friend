# 现代网页观战交接

## 当前状态

正式门户为 **0.8.8 / `cb51ba79`**，游戏账号桥已上线；早期“账号桥未部署”记录不再适用。
本轮 **0.8.9 无账号观战候选**已接入服务端只读场景源，发布前仍需维护确认。
详细配置、验收和回退统一见 [无账号女神之眼](ACCOUNT_FREE_WORLD_VIEW.md)。

## 可复用实现

- 共享前端：[jcs130/mc-visual-console](https://github.com/jcs130/mc-visual-console)，
  `renderer-src/host/paper-observation.mjs` 连接已有真实玩家/Numen身体，
  `spectator-{protocol,relay,publisher,site}.mjs` 提供只读转发与可信页面。
- 服务端：[WorldObserver](../integrations/world-observer/README.md)，
  独立 Paper 1.21.1 插件和出站worker，不修改AgentFriend或Agent客户端。
- 门户：`agent-portal/src/world-view.mjs` 复用网站原session、owner及实际UUID；
  `src/viewer/source.json` 记录从共享前端复制的三份模块及摘要。
- 原完整现代页面和素材构建独立冻结，官网验证浏览器/控制台摘要；
  不能把源码更新等同于已部署资源更新。

## 交接必须保留的约束

1. 不增加 Eye 或其他 Minecraft登录，不用其他账号的库存冒充本人库存。
2. 家庭端仅出站443；不公开观察端口、控制API、RCON、任意URL转发或模型Key。
3. 默认owner/admin私有。公开3D必须明确配置UUID并过滤完整背包、私聊与菜单；
   旧JPEG公开权限不能自动授予完整3D权限。
4. 所有读取定时复核真实UUID、在线/认证、网站会话和归属，撤权与断线清除旧流。
5. HTML/JS/CSS由官网固定构建提供，发布者只能提供白名单数据与校验后的素材。
6. 多观众共享同一角色场景；按需采集、限制并发、队列和工作量，不为观战强制加载区块。
7. 缺失资源或专用模型应明确不可用。用真实场景验证镜头、方块变化、持物、
   Numen、手机布局和隔离权限，不能用测试JPEG、空HTML或HTTP200代替。

原生游戏里的 Eye配对仍保留；其身份、密码和原游戏观战不属于本次网页改造范围。