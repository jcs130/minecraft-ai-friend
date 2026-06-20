# 安全说明

这个项目默认面向本地和局域网使用。不要把控制台端口直接暴露到公网。

## 默认安全策略

- 控制台监听 `127.0.0.1`。
- 不提交 `data/`、`logs/`、`.env`。
- 不展示 Mindcraft `keys.json`。
- 不把 API key 写进 Agent Profile。
- 只允许页面编辑有限的 server.properties 字段。
- 外部启动的 Minecraft Server 不会被页面强制停止。

## Mindcraft 风险

Mindcraft 支持让模型写入和运行代码。公开服务器或不可信模型场景下，应关闭 `allow_insecure_coding`。如果必须开启，建议在隔离环境或容器中运行。

## 建议

- 仅在可信局域网中使用。
- 不要把 API key 发给第三方页面或写入 Git。
- 公开发布前检查 `.gitignore`，确认没有提交服务器世界、日志、密钥和个人记忆。
