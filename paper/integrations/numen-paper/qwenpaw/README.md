# QwenPaw ↔ Numen

私有 stdio MCP 适配器，让一个 QwenPaw Agent 独占控制一个已有 Numen 身体。详细接管和发布规则见 [原桐人与外脑](../../../docs/KIRITO_QWENPAW.md)。

启动参数：Python 3.12（已安装 `mcp`、`httpx`）运行 `numen_controller.py <私有配置JSON>`。配置包含 `upstream_url`、`token_file`、`companion_uuid`、`agent_id`、`qwenpaw_url`、`journal_dir`、`auto_wake`。两个服务 URL 必须是本机 HTTP 回环地址；不要把令牌写入配置模板、日志或仓库。

原生端开启 MCP 后，由角色配置账号执行 `/numen token create brain <角色名> 30`，保存只覆盖该角色的原生令牌。QwenPaw 建立独立 Agent 和 stdio MCP 驱动，启用本适配器返回的八个工具；不修改其他 Agent 的模型或工具策略。

```text
python -m unittest -v test_controller.py
```

查询游戏命令使用 `command`，如 `{"line":"/mycli status"}`；它复用 `numen.mc.run`、原有授权流程和原始命令结果。`lua` 仍可按原生 API 编排动作。命令和动作超时均须只读核对，不直接重放。

## 信息读取与复用

实时入口见 `../../../docs/KIRITO_SERVER_INFORMATION.md`。先 `command` 查询 `/mycli status`、`/mycli tasks status`，技能按 `skills status/list/info` 读取；核心目录用 `lua` 执行 `print(numen.api.help("numen"))`。不要给所有旧命令盲加 `--json`。

命令只执行一次。新版原生端把原始命令返回值经可选 MCP `structuredContent.commandReceipt` 交回，避免 Lua stdout 的 6000 字限制；适配器用其原始 output 替换缩略显示，保留附带事件。`complete=true` 仅指回执完整，仍须按实际状态判断成功。旧端明确截断、超限或掉线均不自动重放动作。

独立联机检查默认跳过；仅在现有隔离服就绪时设置 `NUMEN_KIRITO_TEST_CONFIG` 为其私有配置路径，再运行 `python -m unittest -v test_information_live.py`。测试硬性要求 `127.0.0.1:25978` 和原桐人 UUID，不调用模型、不接单、不学技能或挪动物品。常规单元测试为 `python -m unittest -v test_controller.py`。
