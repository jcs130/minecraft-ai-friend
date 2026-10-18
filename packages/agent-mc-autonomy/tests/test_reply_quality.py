import copy

import pytest

from agent_mc_autonomy.reply_quality import repeated_plain_reply


@pytest.mark.parametrize("content", [
    "我只剩一点生命！" + "先离开水面站稳！" * 16,
    "I need shelter. " + "Let me get out of the water! " * 20,
    '{"spoken_text":"' + "先离开水面站稳！" * 16 + '"}',
])
def test_runaway_plain_response_has_content_free_diagnostic(content):
    response = {"content": content, "tool_calls": []}
    original = copy.deepcopy(response)
    diagnostic = repeated_plain_reply(response)
    assert diagnostic["code"] == "repetitive_model_reply"
    assert diagnostic["repetitions"] >= 8
    assert diagnostic["dispatched"] is False
    assert diagnostic["repeated_characters"] >= diagnostic["content_characters"] * 0.75
    assert "content" not in diagnostic and response == original


@pytest.mark.parametrize("content", [
    None, "", "   \n\t", "等眼前这群怪物走开再出门。", "先离开水面站稳！" * 3,
    "山里的风轻轻吹！" * 4, "喵！" * 30,
    "Let me get out of the water! " * 7,
    ("先离开水面站稳！" + "另一条不同的观察事实。") * 10,
    "先离开水面站稳！" * 8 + "This is a different and much longer paragraph of useful evidence. " * 20,
])
def test_conversation_brief_chorus_short_vocalization_and_distinct_evidence_are_not_rejected(content):
    assert repeated_plain_reply({"content": content, "tool_calls": []}) is None


def test_structured_tool_response_keeps_its_normal_admission_and_action_authority():
    response = {"content": "先离开水面站稳！" * 16,
                "tool_calls": [{"function": {"name": "mc_do", "arguments": "{}"}}]}
    assert repeated_plain_reply(response) is None


def test_repeated_invalid_reply_keeps_existing_work_and_bounded_original_idle_cadence(
    framework_module, tmp_path, run_async
):
    from test_controller import action, setup

    async def decide(*_):
        return {"content": "先离开水面站稳！" * 16, "tool_calls": []}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.pending[("task", "existing-work")] = {**action(), "id": "existing-work"}
    tools = module.model_tools(bridge.tools)
    for _ in range(10):
        run_async(controller.turn_once("survive", "body contract", tools))
        assert controller.settings.idle_decision_seconds - 1 <= controller.planner_retry_at - module.time.monotonic() <= 300
        assert controller.pending[("task", "existing-work")]["terminal"] is False
    assert controller.planner_failures == 10 and not controller.groups
    assert 299 <= controller.planner_retry_at - module.time.monotonic() <= 300
    assert not any(name in {"mc_do", "mc_stop", "mc_escape"} for name, _, _ in bridge.calls)


def test_stop_arriving_with_repetitive_response_is_respected(framework_module, tmp_path, run_async):
    from test_controller import setup

    stopped, published = [False], {}

    async def decide(*_):
        stopped[0] = True
        return {"content": "先离开水面站稳！" * 16, "tool_calls": []}

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: stopped[0])
    controller.publish = lambda **values: published.update(values)
    run_async(controller.turn_once("survive", "body contract", module.model_tools(bridge.tools)))
    assert not (tmp_path / "decisions.jsonl").exists()
    assert not published.get("narration", {}).get("offered")
    assert not controller.pending and not controller.groups
    assert not any(name == "mc_do" for name, _, _ in bridge.calls)
