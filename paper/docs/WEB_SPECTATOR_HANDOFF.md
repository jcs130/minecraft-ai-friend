# 完整网页观战与门户授权交接

## 当前文件分工（2026-10-22，邀请码 0.6.0 发布准备）

本对话正在提交邀请码 API 与测试绑定清理：暂时占用 `src/server.mjs`、`public/app.js`、`package.json`/lock、`config.example.json`、`src/config.mjs`、`src/store.mjs`、`src/cloud-source.mjs`、`src/game-accounts.mjs` 和对应测试。请等这一提交完成后再接 3D 的闭包 hook/UI/依赖，不整体覆盖这些文件。新 `vendor/`、`src/spectator.mjs` 和独立 3D 测试可另行准备；本次邀请码候选不包含未验收的 3D 接线。待发布时按来源提交逐项核对；不要仅因文件出现在同一工作区就一起打包。

2026-10-22。此文是后续接口约定建议，**当前生产网站只有原 canvas-only 预览**，下述 watch/WS 路由尚未启用。Paper、游戏代理和现役 Agent 身体保持。

## 可复用的现有数据

- 源码 `paper/integrations/agent-portal/src/live.mjs`：`live_channels` 中的 channel ID、真实 player_uuid、publisher_hash 与所属玩家关系；发布凭据为现有 pub_ Token，数据库只存摘要。
- `src/server.mjs` 的 Cookie / Origin / browserAuth、`Store.ownedUuids(owner.id)` 与管理员判断。网站账号 ID 与 Minecraft UUID 不能混用；网站 Token PAT 是只读角色资料凭据，不是游戏登录票据。
- `/api/v1/live` 列出本人可看频道并优先选择自己的角色。未绑定或不可见的频道返回同样的404，不能只检查在线名或 ag_ 前缀。
- 当前 live GET frame 的 ACL 和发布 token 校验可以抽为可调用 hook；不要复制另一套 session 或 owner 数据库。新模块需门户适配器包装，不能直接导入闭包内函数。

## 建议接法（候选）

1. `GET /watch/:channelId/` 由门户先核验浏览器会话和频道 UUID，再返回服务器固定构建的可信 mc-visual-console HTML/JS/CSS。
2. 发布端出站 `wss://mc.kangqiang.site/api/v1/live/:channelId/source`，第一帧携带 pub_ 凭据，只在服务器校验，不放 URL/日志/前端 JS。认证前不接收其他数据，限制首帧时间和大小。
3. 网页通过同源、已鉴权的 JSON/SSE/素材路由取世界数据。仅转发白名单消息和验证过的资源，不托管发布者 HTML/JavaScript，不开放任意 URL 请求或原生 Numen 控制接口。
4. 多个观看者复用同一原客户端/身体和原渲染源，不启动另一个同名 bot 或 Agent 决策循环。家庭端只出站，复用443，访客不直连 LAN。

完整3D可能包含背包与私聊，默认仅实际 owner/admin。**旧公开JPEG频道不构成公开完整3D的授权**；新增独立的、默认关闭的公开3D开关，须主人明确开启，并分别筛选公开可见字段。断流、过期、退出登录/撤权和角色切换应停止旧流、清空旧场景与私有面板；会话撤销不能只等浏览器刷新。

建议共享模块提供 attach 方法并接受 `resolveChannel`、`authorizeViewer`、`authorizePublisher`、`onRevoke` hooks；授权由门户决定，业务模块不自行创建 owner/session。协议应有版本、源连接epoch、单调seq、大小/频率上限和慢消费者退订；资源固定类型与SHA，避免无界缓存。适配者给出实际函数签名、依赖锁和1.21.1验收后再接路由。

Nginx当前没有为候选路由配置 Upgrade。后续仅为明确WS路径加 Upgrade/超时，保留 Host、HTTPS 和 Origin检查；网站发布独立于Paper维护。不能把空HTML、测试JPEG、纯天空首帧或HTTP200当成完整3D验收。需要登录后实际区块/实体/手持/动画、背包更新、断线恢复、owner隔离及手机视图证据。

## 当前状态

网站0.5系列已公开 Agent Skill1.0.0下载；jcs130 的4个指定角色与140测试角色已记录网站归属。正式 LoginGuard仍0.1.3，游戏自助建号/认领/改密桥未上线；邮箱发信也未配置。当前不改变真人或Agent准入规则，不修改游戏密码/UUID/背包。
