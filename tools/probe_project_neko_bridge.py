"""Exercise the real N.E.K.O. tool + WS client against a bounded Neko QA body.

Run using a local Python environment with the Project N.E.K.O. SDK dependencies.
No LLM server is started; no credentials, cheat command or ordinary inventory grant.
"""
from __future__ import annotations
import argparse
import asyncio
import json
import logging
from pathlib import Path
import queue
import sys


async def probe(project: Path, body_dir: Path, output: Path) -> None:
    sys.path.insert(0, str(project))
    import websockets
    from plugin.core.context import PluginContext
    from plugin.plugins.game_agent_minecraft import GameAgentMinecraftPlugin
    from plugin.sdk.plugin.llm_tool import collect_llm_tool_methods

    if output.exists():
        raise RuntimeError("prior result must not be overwritten/replayed")
    ready = json.loads((body_dir / "ready.json").read_text(encoding="utf-8"))
    ctx = PluginContext(plugin_id="game_agent_minecraft", config_path=project / "plugin/plugins/game_agent_minecraft/plugin.toml",
                        logger=logging.getLogger("neko-native-probe"), status_queue=queue.Queue(), message_queue=queue.Queue())
    plugin = GameAgentMinecraftPlugin(ctx)
    plugin._service.configure({"ws_url": ready["ws"], "system_prompt_interval_seconds": 86400,
                               "stream_screenshots_to_llm": False, "reconnect_interval_seconds": 1})
    receipts, observer_results = [], []
    observer = None
    observer_task = None
    error = None

    async def invoke(operation, **kwargs):
        result = await plugin.minecraft_mod(operation=operation, **kwargs)
        assert result.is_ok(), result
        value = result.value
        receipts.append({"operation": operation, "args": kwargs, "receipt": value})
        assert value["playerUuid"] == ready["playerUuid"], value
        return value

    try:
        tools = {meta.name: meta for meta, _ in collect_llm_tool_methods(plugin)}
        assert "minecraft_mod" in tools and "minecraft_task" in tools
        assert tools["minecraft_mod"].parameters["properties"]["args"]["type"] == "object"
        first = await invoke("list")
        assert first["ok"] and first["operationCount"] == 48
        assert len([row for row in first["operations"] if row["readOnly"]]) == 23
        assert (await invoke("explain", id="colony.assignCitizen"))["operation"]["parameters"]
        observer = await websockets.connect(ready["ws"])

        async def observe():
            async for wire in observer:
                value = json.loads(wire)
                if value.get("type") == "native_mod_result":
                    observer_results.append(value)

        observer_task = asyncio.create_task(observe())
        for identifier, arguments in (("colony.capabilities", {}), ("spell.glyphs", {"limit": 1}),
                                      ("curios.state", {}), ("maid.list", {})):
            result = await invoke("call", id=identifier, args=arguments)
            assert result["ok"] and result["readOnly"], result
        call_id = "neko-probe-open-curios"
        opened = await invoke("call", id="curios.open", args={}, callId=call_id)
        assert opened["ok"] and not opened["outcomeUnknown"], opened
        await asyncio.sleep(0.5)
        menu = await invoke("call", id="menu.current", args={})
        assert menu["result"]["windowId"] > 0
        repeated = await invoke("call", id="curios.open", args={}, callId=call_id)
        assert repeated["replayed"] and repeated["ok"]
        saved = await invoke("result", callId=call_id)
        assert saved["ok"] and saved["outcomeUnknown"] is False
        await asyncio.sleep(0.2)
        assert observer_results == [], observer_results
        assert not plugin._service.has_pending_task()
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    finally:
        if observer_task:
            observer_task.cancel()
            await asyncio.gather(observer_task, return_exceptions=True)
        if observer:
            await observer.close()
        await plugin.shutdown()
        (body_dir / "stop.requested").write_text("Project N.E.K.O. probe finished\n", encoding="utf-8")
        report = {"schemaVersion": 1, "ok": error is None, "error": error, "account": ready["account"],
                  "playerUuid": ready["playerUuid"], "receipts": receipts, "unrelatedSocketNativeReceipts": observer_results,
                  "sameConnection": True, "modelCalls": 0, "dialogueRuntimeStarted": False,
                  "nativeWrites": 1 if error is None else None}
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({key: value for key, value in report.items() if key != "receipts"}, ensure_ascii=False))
        if error:
            raise RuntimeError(error)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-neko", type=Path, required=True)
    parser.add_argument("--body-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    asyncio.run(probe(options.project_neko, options.body_dir, options.output))


if __name__ == "__main__":
    main()
