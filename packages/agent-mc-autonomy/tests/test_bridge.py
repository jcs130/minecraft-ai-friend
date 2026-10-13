import asyncio

import pytest

from agent_mc_autonomy import bridge as bridge_module


def test_mcp_failure_is_not_success():
    with pytest.raises(RuntimeError, match="disconnected"):
        bridge_module.json_content({"isError": True, "content": [{"type": "text", "text": "disconnected"}]})
    assert bridge_module.json_content({"content": [{"type": "text", "text": '{"phase":"starting"}'}]}) == {"phase": "starting"}


def test_stopped_bridge_never_submits(run_async, tmp_path):
    bridge = bridge_module.MinecraftBridge("node", tmp_path / "entry", tmp_path / "config", tmp_path / "log")
    bridge.tools = [{"name": "mc_do"}]
    with pytest.raises(RuntimeError, match="not running"):
        run_async(bridge.call("mc_do", {}))
    run_async(bridge.close())
    run_async(bridge.close())


def test_timeout_does_not_retry_action(run_async, tmp_path):
    async def exercise():
        bridge = bridge_module.MinecraftBridge("node", tmp_path / "entry", tmp_path / "config", tmp_path / "log")
        bridge.tools = [{"name": "mc_do"}]
        requests = []

        async def consume():
            request = await bridge._queue.get()
            requests.append(request)
            await asyncio.Event().wait()

        bridge._owner = asyncio.create_task(consume())
        try:
            with pytest.raises(RuntimeError, match="delivery is uncertain"):
                await bridge.call("mc_do", {}, timeout=0.01)
            assert len(requests) == 1
            assert requests[0][2].cancelled()
        finally:
            bridge._owner.cancel()
            await bridge.close()

    run_async(exercise())


def test_protocol_metadata_and_failed_execution_are_preserved(run_async, tmp_path):
    async def exercise():
        bridge = bridge_module.MinecraftBridge("node", tmp_path / "entry", tmp_path / "config", tmp_path / "log")
        bridge.tools = [{"name": "mc_do"}]

        async def consume():
            _, args, future = await bridge._queue.get()
            assert args[2] == {"agent-mc/v1": {"requestId": "r1", "turnId": "t1"}}
            future.set_result({"structuredContent": {"protocol": "agent-mc/v1", "execution": {"phase": "blocked", "terminal": True}}, "isError": True})

        bridge._owner = asyncio.create_task(consume())
        result = bridge_module.outcome(await bridge.call("mc_do", {}, request_id="r1", turn_id="t1"))
        assert result["failed"] is True and result["execution"]["phase"] == "blocked"
        await bridge.close()
    run_async(exercise())

