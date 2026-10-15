"""Exercise the real Python-to-Node MCP bridge with networking denied."""

import argparse
import asyncio
import json
import tempfile
from pathlib import Path


async def check(directory: Path, node: str) -> dict:
    root = Path(__file__).resolve().parent
    from agent_mc_autonomy import bridge as module
    from agent_mc_autonomy import controller

    from . import install as installer
    installer.verify_runtime(directory.resolve())
    with tempfile.TemporaryDirectory(prefix="neko-minecraft-offline-") as temporary:
        data = Path(temporary)
        config = data / "client.json"
        config.write_text(json.dumps({"dataDir": str(data / "data"), "consolePort": 0, "metricsPort": 0,
                                      "world": {"host": "example.test", "username": "OfflineCheck", "viewerPort": 0, "version": "1.21.1"}}), encoding="utf-8")
        bridge = module.MinecraftBridge(node, directory.resolve() / "node_modules/agent-mc-world/bin/minecraft-agent-mcp.mjs",
                                        config, data / "backend.log", node_args=("--import", (root / "deny-network.mjs").as_uri()))
        try:
            await bridge.open()
            names = {tool["name"] for tool in bridge.tools}
            assert {"mc_connection", "mc_do", "mc_events", "mc_script", "mc_queue", "mc_visual", "mc_memory", "mc_combat_tactic", "mc_knowledge"} <= names
            assert not any(name.startswith("mymc_") for name in names)
            status = module.json_content(await bridge.call("mc_connection", {"action": "status"}))
            assert status["phase"] == "disconnected" and status["facts"] is None
            reference = module.json_content(await bridge.call("mc_knowledge", {"action": "get", "id": "food/beef"}))
            assert reference["version"] == "1.21.1" and reference["currentWorldVerified"] is False
            assert reference["entry"]["nutrition"] == {"foodPoints": 3, "saturation": 1.8}
            assert reference["entry"]["cooking"]["nutrition"] == {"foodPoints": 8, "saturation": 12.8}
            assert reference["retrieval"] == "local-reference"
            recipes = module.json_content(await bridge.call("mc_knowledge", {"query": "charcoal", "kind": "recipe", "limit": 1}))
            assert recipes["entries"][0]["id"] == "recipe/charcoal"
            charcoal = module.json_content(await bridge.call("mc_knowledge", {"id": "recipe/charcoal"}))
            assert charcoal["entry"]["variants"][0]["type"] == "smelting"
            saved = module.json_content(await bridge.call("mc_memory", {"action": "remember", "kind": "method",
                "summary": "Offline method fixture", "content": "Historical hypothesis, no gameplay claim.",
                "source": {"kind": "hypothesis", "reference": "offline:test"}}))
            memory_id = saved["entry"]["id"]
            learning_help = module.json_content(await bridge.call("mc_memory", {"action": "service", "operation": "help",
                "input": {"operation": "record_outcome"}}))
            assert learning_help["enabled"] is False and learning_help["inputSchema"]["type"] == "object"
            assert "dream" in learning_help["operations"] and "approve" not in learning_help["operations"]
            recalled = module.json_content(await bridge.call("mc_memory", {"action": "get", "id": memory_id}))
            assert recalled["entry"]["content"] == "Historical hypothesis, no gameplay claim."
            assert recalled["entry"]["currentWorldVerified"] is False
            assert (await bridge.call("mc_memory", {"action": "capture"})).get("isError") is True
            await bridge.close()
            bridge = module.MinecraftBridge(node, directory.resolve() / "node_modules/agent-mc-world/bin/minecraft-agent-mcp.mjs",
                                            config, data / "reopened-backend.log", node_args=("--import", (root / "deny-network.mjs").as_uri()))
            await bridge.open()
            restored = module.json_content(await bridge.call("mc_memory", {"action": "get", "id": memory_id}))
            for key in ("id", "revision", "content", "source", "currentWorldVerified"):
                assert restored["entry"][key] == recalled["entry"][key]
            assert module.json_content(await bridge.call("mc_connection", {"action": "status"}))["phase"] == "disconnected"
            environment = module.text_content(await bridge.resource("mc://environment"))
            assert "mc_help" in environment
            _, budget = controller.assemble(environment, controller.model_tools(bridge.tools), "survive", {"parts": []}, [], [],
                                            context_tokens=32768, reserved_output=1024)
            # Keep room for one image and essential body facts in the default
            # 32k budget, while complete large tool manuals stay retrievable.
            try:
                _, image_budget = controller.assemble(environment, controller.model_tools(bridge.tools), "survive", {"parts": [
                    {"key": "body", "text": "health 20/20, hunger 20/20"}, {"key": "place", "text": "overworld (0,64,0)"}]}, [], [],
                    context_tokens=32768 - controller.IMAGE_RESERVE, reserved_output=2048)
                image_fits = not image_budget["omitted"]
            except ValueError as error:
                if not str(error).startswith("context_budget_exceeded:"):
                    raise
                # Match the runner's explicit text fallback; do not claim image support
                # merely because the transport passed for the current tool catalog.
                image_fits = False
            facts = module.json_content(await bridge.call("mc_protocol", {"protocol": "agent-mc/v1", "action": "facts"}))
            assert "1.21.1" in facts["parts"][0]["text"]
            refused = await bridge.call("mc_bag", {})
            assert refused.get("isError") is True
            assert "disconnected" in module.text_content(refused)
            invalid = await bridge.call("mc_connection", {"action": "not-an-action"})
            assert invalid.get("isError") is True
            pending = asyncio.create_task(bridge.call("mc_events", {"after": 0, "waitMs": 30000}))
            try:
                await asyncio.sleep(0.05)
                assert not pending.done()
                concurrent = module.json_content(await bridge.call("mc_connection", {"action": "status"}, timeout=2))
                assert concurrent["phase"] == "disconnected"
            finally:
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
            return {"ok": True, "protocol": "MCP stdio", "profile": status["profile"], "tools": len(names),
                    "phase": status["phase"], "game_connected": False, "network_denied": True,
                    "minecraft_version": "1.21.1", "stable_context_byte_budget": budget["total"],
                    "image_and_body_facts_fit_default_budget": image_fits,
                    "concurrent_status_and_cancel": True,
                    "service_learning_contract": True, "service_learning_opt_in": True,
                    "game_memory_write_recall": True, "game_memory_restart_recall": True,
                    "disconnected_capture_refused": True, "shared_tactics_discovered": True,
                    "cortico_installed": (directory / "node_modules/cortico").exists()}
        finally:
            await bridge.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--node", default="node")
    arguments = parser.parse_args()
    print(json.dumps(asyncio.run(check(arguments.directory, arguments.node)), indent=2))


if __name__ == "__main__":
    main()
