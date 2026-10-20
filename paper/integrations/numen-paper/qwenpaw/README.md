# QwenPaw ↔ Numen

原生游戏频道候选位于 `native_plugin/`，入门Skill在 `skills/qiandengji-start/`。固定QwenPaw2.2.2；接入、限制、隔离验证和回退见 [原生游戏接入](../../../docs/QWENPAW_NATIVE_GAME.md)。常规检查可用该版本的Python执行 `python -m unittest discover -s . -p "test_*.py"`，6项独立联机检查默认跳过。

私有 stdio MCP 适配器，让一个 QwenPaw Agent 独占控制一个已有 Numen 身体。详细接管和发布规则见 [原桐人与外脑](../../../docs/KIRITO_QWENPAW.md)。

启动参数：Python 3.12（已安装 `mcp`、`httpx`）运行 `numen_controller.py <私有配置JSON>`。配置包含 `upstream_url`、`token_file`、`companion_uuid`、`agent_id`、`qwenpaw_url`、`journal_dir`、`auto_wake`。两个服务 URL 必须是本机 HTTP 回环地址；不要把令牌写入配置模板、日志或仓库。

`event_session_id` 可指定稳定的事件会话；正式启用时使用与隔离测试不同的值，避免沿用测试对话。未配置时保留旧默认值，重连不会更换会话或重放动作。

`event_transport` 默认 `console`，保留已部署兼容路径；配置为 `channel` 时不启动旧自动分发，`events` 返回带ID、唤醒标志及连接状态的有界快照，由原生频道持久去重。`auto_wake=false` 与频道配套使用，不影响原生身体连接。两种入口不能同时启用。

原生端开启 MCP 后，由角色配置账号执行 `/numen token create brain <角色名> 30`，保存只覆盖该角色的原生令牌。QwenPaw 建立独立 Agent 和 stdio MCP 驱动，启用本适配器返回的八个工具；不修改其他 Agent 的模型或工具策略。

```text
python -m unittest -v test_controller.py
```

查询游戏命令使用 `command`，如 `{"line":"/mycli status"}`；它复用 `numen.mc.run`、原有授权流程和原始命令结果。`lua` 仍可按原生 API 编排动作。命令和动作超时均须只读核对，不直接重放。

## 信息读取与复用

实时入口见 `../../../docs/KIRITO_SERVER_INFORMATION.md`。先 `command` 查询 `/mycli status`、`/mycli tasks status`，技能按 `skills status/list/info` 读取；核心目录用 `lua` 执行 `print(numen.api.help("numen"))`。不要给所有旧命令盲加 `--json`。

命令只执行一次。新版原生端把原始命令返回值经可选 MCP `structuredContent.commandReceipt` 交回，避免 Lua stdout 的 6000 字限制；适配器用其原始 output 替换缩略显示，保留附带事件。`complete=true` 仅指回执完整，仍须按实际状态判断成功。旧端明确截断、超限或掉线均不自动重放动作。

独立联机检查默认跳过；仅在现有隔离服就绪时设置 `NUMEN_KIRITO_TEST_CONFIG` 为其私有配置路径，再运行 `python -m unittest -v test_information_live.py`。测试硬性要求 `127.0.0.1:25978` 和原桐人 UUID，不调用模型、不接单、不学技能或挪动物品。常规单元测试为 `python -m unittest -v test_controller.py`。
