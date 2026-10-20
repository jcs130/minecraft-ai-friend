# QwenPaw ↔ Numen

私有 stdio MCP 适配器，让一个 QwenPaw Agent 独占控制一个已有 Numen 身体。详细接管和发布规则见 [原桐人与外脑](../../../docs/KIRITO_QWENPAW.md)。

启动参数：Python 3.12（已安装 `mcp`、`httpx`）运行 `numen_controller.py <私有配置JSON>`。配置包含 `upstream_url`、`token_file`、`companion_uuid`、`agent_id`、`qwenpaw_url`、`journal_dir`、`auto_wake`。两个服务 URL 必须是本机 HTTP 回环地址；不要把令牌写入配置模板、日志或仓库。

原生端开启 MCP 后，由角色配置账号执行 `/numen token create brain <角色名> 30`，保存只覆盖该角色的原生令牌。QwenPaw 建立独立 Agent 和 stdio MCP 驱动，启用本适配器返回的八个工具；不修改其他 Agent 的模型或工具策略。

```text
python -m unittest -v test_controller.py
```

查询游戏命令使用 `command`，如 `{"line":"/mycli status"}`；它复用 `numen.mc.run` 和原有授权流程，完整打印命令回执。`lua` 仍可按原生 API 编排动作。命令和动作超时均须只读核对，不直接重放。
