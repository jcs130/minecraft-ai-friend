# 运行与维护手册

## 本地启动

```powershell
npm start
```

默认地址：`http://127.0.0.1:4177`。

## 常用检查

```powershell
npm run check
Invoke-RestMethod http://127.0.0.1:4177/api/status
```

直播可视化 bridge 单独检查：

```powershell
node --check scripts\visualizer-bridge.js
Invoke-RestMethod http://127.0.0.1:3010/api/status
```

## 服务边界

- Minecraft Server 可能由本控制台托管，也可能是外部进程。
- 只有本控制台托管的 Minecraft Server 才允许从页面停止。
- Mindcraft 只有本控制台启动的 owned process 才应该由页面停止。
- 直播可视化站和 bridge 是独立进程，重启 bridge 不应影响 Minecraft Server。

## 安全重启顺序

需要加载 `server.js` 新代码时，优先维护窗口操作：

1. 确认玩家和 AI 当前状态。
2. 停止 Autopilot。
3. 停止本控制台托管的 Mindcraft。
4. 如果要重启 Minecraft Server，先在游戏中通知玩家并正常 `stop`。
5. 重启控制台。
6. 启动 Minecraft Server、Mindcraft、恢复居民、启动 Autopilot。

如果只是更新直播文案或状态映射，只重启 `scripts/visualizer-bridge.js`。

## 局域网访问

控制台默认 localhost。若要局域网访问直播后台，优先开放只读直播页，不要直接开放控制台写操作。控制 API 要暴露到局域网前必须补：

- token 鉴权。
- 只读和控制权限分离。
- 危险操作二次确认。
- 明确禁止外部读取密钥、profile 中的密钥字段和服务器世界文件。

## 密钥处理

- 不提交 `.env`、`data/`、`logs/`、Mindcraft `keys.json`。
- 只在文档中写环境变量名，不写真实 key。
- 提交前运行：

```powershell
rg -n 'sk-[A-Za-z0-9_-]{20,}' src scripts public package.json README.md docs integrations .codex
```

## 观众可见文本

AI 对观众可见内容必须是中文公开行动思考。允许展示：

- 当前计划。
- 为什么这样做。
- 下一步。
- 风险或材料缺口。

禁止展示：

- 系统提示或管理员指令。
- 隐藏推理。
- 原始 `!goToCoordinates(...)` / `!newAction(...)` 动作命令。
- 英文模板句。
