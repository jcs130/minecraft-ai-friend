"""Actual provider rejection bodies are bounded and classified without disclosure."""
import json

import httpx
import pytest

from agent_mc_autonomy.model_config import HttpPlannerConfig
from agent_mc_autonomy.planner import HttpPlanner


@pytest.mark.parametrize(("message", "category"), [
    ("Duplicate function name: mc_do; private-api-key", "duplicate_tool_name"),
    ("Invalid schema: items must be an object or a boolean; private-api-key", "tool_schema_incompatible"),
    ("Maximum context length exceeded; private-api-key", "context_limit"),
    ("Unauthorized: invalid API key private-api-key", "credentials_rejected"),
    ("unknown-private-body", "provider_request_rejected"),
])
def test_error_classification_contains_no_arbitrary_provider_text(run_async, message, category):
    cfg = HttpPlannerConfig.parse({"provider": "deepseek", "model": "fixture", "auth": {"mode": "none"}})
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(400, json={"error": {"message": message}})))
    planner = HttpPlanner(cfg, 1024, 10, client=client)
    async def exercise():
        with pytest.raises(RuntimeError, match="brain_http_error_400") as caught:
            await planner.decide([], [])
        diagnostic = getattr(caught.value, "diagnostic", {})
        assert diagnostic.get("category") == category
        assert diagnostic["status"] == 400
        assert "private" not in json.dumps(diagnostic)
        await planner.aclose()
    run_async(exercise())


def test_oversized_error_stream_is_not_fully_buffered(run_async):
    class ErrorStream(httpx.AsyncByteStream):
        consumed = 0
        async def __aiter__(self):
            for _ in range(100):
                self.consumed += 1
                yield b"private" * 1024
    stream = ErrorStream()
    cfg = HttpPlannerConfig.parse({"provider": "deepseek", "model": "fixture", "auth": {"mode": "none"}})
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(400, stream=stream)))
    planner = HttpPlanner(cfg, 1024, 10, client=client)
    async def exercise():
        with pytest.raises(RuntimeError) as caught:
            await planner.decide([], [])
        assert getattr(caught.value, "diagnostic", {}).get("body_truncated") is True
        assert stream.consumed < 5
        await planner.aclose()
    run_async(exercise())


def test_rejected_schema_keeps_body_queue_and_publishes_safe_actionable_reason(framework_module, tmp_path, run_async):
    from test_controller import action, setup
    cfg = HttpPlannerConfig.parse({"provider": "deepseek", "model": "fixture", "auth": {"mode": "none"}})
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(400,
        json={"error": {"message": "Invalid schema: items must be object; private-key"}})))
    planner = HttpPlanner(cfg, 2048, 10, client=client)
    module, bridge, controller = setup(framework_module, tmp_path, planner.decide)
    published = {}
    controller.publish = lambda **value: published.update(value)
    controller.persist(stopped=False)
    controller.pending[("task", "body-1")] = action()
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert controller.pending and not bridge.closed
    assert not json.loads(controller.state_path.read_text())["stopped"]
    assert controller.planner_failures == 1
    assert published["planner_retry_seconds"] == 300
    assert published["planner_diagnostic"]["category"] == "tool_schema_incompatible"
    assert "private-key" not in (tmp_path / "decisions.jsonl").read_text()
    assert not any(name in {"mc_do", "mc_connection"} for name, *_ in bridge.calls)
    run_async(planner.aclose())
