# -*- coding: utf-8 -*-
# 临时：把守卫 MCP 工具根因/修复经验追加到 mc-god 的 LESSONS.md（不覆盖，仅追加）。
p = r"C:\Users\lzl19\.copaw\workspaces\mc-god\LESSONS.md"
text = r"""

## [2026-08-24] 守卫 agent 拿不到 numen MCP 工具：缺 DriverCard
- 根因：QwenPaw 只经 **Driver capability** 暴露 MCP（builder.build_toolkit 只拼 list_tools()+extra+memory，不读 mcp.clients）。agent.json 里的 `mcp.clients.numen` 不会直接注入 toolkit；守卫 workspace 缺 `drivers/mcp/<name>.yaml` DriverCard → agent 只剩 Skill/recall_history/memory_search 3 个工具，numen__say/goto/mine 全无。
- 印证：SSE 无 tool_use；mcp_client_probe 只测 MCP server 不测 agent；守卫桥 call_guard 只解析 content:text、忽略 tool_use（所以守卫"能说话但从不真调工具"）。
- 修复：`qwenpaw.drivers.adapters.mcp_legacy_config.legacy_mcp_client_to_driver` 生成 DriverCard(+credential)，存 `{workspace}/drivers/mcp/numen.yaml` 和 `credentials.yaml`；card.policy 默认 ASK 会卡审批，需改 `POLICY_EFFECT_ALLOW`。生成后 DriverConfigWatcher 热载，agent 立即可用。
- 验证：逼 agent 调 numen__say → mc_npc.out.log 见 `[npc] Naruto/Kirito -> ...: '...'`。
- 关键文件：sidecar/guard/gen_guard_mcp_card.py（复用生成任意守卫 card）。
"""
open(p, "a", encoding="utf-8").write(text)
print("appended to", p)
