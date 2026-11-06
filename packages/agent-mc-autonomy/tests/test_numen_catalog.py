from agent_mc_autonomy.controller import model_tools
from agent_mc_autonomy.controller import Controller
from types import SimpleNamespace


def test_numen_body_keeps_its_actual_compact_tool_vocabulary():
    schema = {"type": "object", "properties": {"op": {"enum": ["catalog", "observe", "call", "result"]},
        "tool": {"type": "string"}, "args": {"type": "object"}}, "required": ["op"]}
    tools = model_tools([{"name": "mc_numen", "description": "Native Numen body", "inputSchema": schema}])
    entry = next(tool["function"] for tool in tools if tool["function"]["name"] == "mc_numen")
    assert entry["parameters"]["properties"]["op"] == schema["properties"]["op"]
    assert "steps" not in entry["parameters"]["properties"]
    assert not any(tool["function"]["name"] in {"mc_do", "mc_script"} for tool in tools)


def test_numen_observation_uses_the_advertised_body_not_an_imaginary_mineflayer_queue(run_async):
    calls, published = [], {}
    async def call(name, args):
        calls.append((name, args))
        return {"structuredContent": {"protocol": "agent-mc/v1", "text": "actual native body"}}
    async def protocol(action):
        assert action == "facts"
        return {"parts": []}
    controller = Controller.__new__(Controller)
    controller.bridge = SimpleNamespace(tools=[{"name": "mc_numen"}], call=call)
    controller.pending = {}
    controller.protocol = protocol
    controller.publish = lambda **value: published.update(value)
    run_async(controller.observe_queue())
    assert calls == [("mc_numen", {"op": "observe"})]
    assert "native_body" in published and "native_queue" not in published
