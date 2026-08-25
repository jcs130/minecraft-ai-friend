# 修复：为守卫 workspace 生成 numen 的 MCP DriverCard + credential。
# 根因：守卫 agent.json 有 mcp.clients.numen（migration_version=0），但 workspace 的
#        drivers/ 目录从未生成 numen DriverCard，QwenPaw 仅经 Driver capability 暴露 MCP，
#        所以 agent 拿不到 numen 工具（say/goto/mine...）。
# 本脚本用 QwenPaw 正规迁移逻辑 legacy_mcp_client_to_driver 生成合法卡/凭据，policy 设 ALLOW。
import asyncio, dataclasses, json, sys
from types import SimpleNamespace
from pathlib import Path

import yaml

sys.path.insert(0, r"C:\Users\lzl19\.qwenpaw\venv\Lib\site-packages")
from qwenpaw.drivers.adapters.mcp_legacy_config import legacy_mcp_client_to_driver
from qwenpaw.drivers.constants import (
    CAPABILITY_KIND_TOOL,
    POLICY_EFFECT_ALLOW,
    POLICY_TARGET_WILDCARD,
    PROTOCOL_MCP,
)
from qwenpaw.drivers.contracts import DriverPolicy, PolicyRule, PolicyTarget
from qwenpaw.drivers.credentials.store import AsyncCredentialStore
from qwenpaw.drivers.storage import card_path


async def gen_for(GUARD_WS: Path) -> None:
    agent_json = GUARD_WS / "agent.json"
    cfg = json.loads(agent_json.read_text(encoding="utf-8"))
    numen = cfg["mcp"]["clients"]["numen"]

    client = SimpleNamespace(**numen)
    card, credential = legacy_mcp_client_to_driver("numen", client)

    # 把默认的 ASK policy 改成 ALLOW，否则自主 agent 每个工具调用都要审批
    card.policy = DriverPolicy(
        rules=[
            PolicyRule(
                subject=POLICY_TARGET_WILDCARD,
                effect=POLICY_EFFECT_ALLOW,
                target=PolicyTarget(
                    kind=CAPABILITY_KIND_TOOL, name=POLICY_TARGET_WILDCARD
                ),
            )
        ]
    )

    # 1) 存 credential（mcp_numen.py 依赖环境注入 NUMEN_COMPANION/DISPLAY）
    store = AsyncCredentialStore(GUARD_WS / "credentials.yaml")
    if credential is not None:
        await store.put(credential)
        print(f"[{GUARD_WS.name}] CREDENTIAL saved ref=", credential.ref)

    # 2) 存 card
    p = card_path(GUARD_WS / "drivers", "numen", protocol=PROTOCOL_MCP)
    p.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.safe_dump(dataclasses.asdict(card), allow_unicode=True)
    p.write_text(text, encoding="utf-8")
    print(f"[{GUARD_WS.name}] CARD saved:", p)
    print("  env ->", card.endpoint.get("env"))
    print("  credentials.yaml exists:", (GUARD_WS / "credentials.yaml").exists())


async def main():
    for name in ("mc-guard-naruto", "mc-guard-kirito"):
        await gen_for(Path(r"C:\Users\lzl19\.copaw\workspaces") / name)


asyncio.run(main())
