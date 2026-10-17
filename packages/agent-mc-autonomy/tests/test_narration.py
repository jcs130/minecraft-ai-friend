"""Real durable port, fake model/body: no speech, network or host imports."""

import json
import time
from datetime import datetime, timezone

import pytest

from agent_mc_autonomy.death_memory import scope_key
from agent_mc_autonomy.host_context import HostContextPort
from agent_mc_autonomy.narration import NarrationPort, binding_key, spoken_line


@pytest.fixture
def voice(tmp_path):
    clock = [float(int(time.time()))]
    expected = {"identity": "identity-1", "actor": "Cat", "session": "session-1", "run": "run-1",
                "scope": {"realm": "test", "account": "bot", "agent": "bot"}, "intent_revision": 0, "death_episode_id": None}
    snapshot = {"updated_at": datetime.fromtimestamp(clock[0], timezone.utc).isoformat(), "phase": "running", "game_connected": True,
                "settings_identity": expected["identity"], "runtime_session": expected["session"], "native_run": expected["run"],
                "game_identity": expected["scope"], "body_death_episode_id": None}
    (tmp_path / "status.json").write_text(json.dumps(snapshot), encoding="utf-8")
    HostContextPort(tmp_path, now=lambda: clock[0]).publish_static(
        {"agent_name": "Cat", "persona": "爱冒险，说中文", "persona_source": "character_profile"}, scope=scope_key(expected["scope"]))
    return NarrationPort(tmp_path, now=lambda: clock[0]), expected, clock


@pytest.mark.parametrize("content", [None, "I will inspect the world", '{"spoken_text":"hello","tone":"happy"}',
    '{"spoken_text":null}', '{"spoken_text":""}', '{"spoken_text":"line\\nnext"}', '{"spoken_text":"' + "x" * 601 + '"}'])
def test_only_explicit_plain_line(content):
    assert spoken_line(content) is None


def test_native_planning_and_claim_do_not_require_review_or_audio(voice):
    port, expected, _ = voice
    assert port.offer('{"spoken_text":"盖个窗边小窝吧。"}', expected) == {"offered": False}
    assert port.subscribe(expected)
    offered = port.offer('{"spoken_text":"盖个窗边小窝吧。"}', expected)
    assert offered["offered"]
    claimed = port.take(expected)
    assert claimed["line"] == "盖个窗边小窝吧。" and port.speech_current(claimed)
    assert port.take(expected) is None
    # A restarted adapter cannot replay unknown delivery.
    assert NarrationPort(port.directory, now=port.now).take(expected) is None
    assert not (port.directory / "reviews.sqlite3").exists()
    assert not (port.directory / "decisions.jsonl").exists()


@pytest.mark.parametrize("field,value", [("settings_identity", "other"), ("runtime_session", "new"), ("native_run", "other"),
    ("game_connected", False), ("body_death_episode_id", "died"), ("phase", "stopped")])
def test_changed_body_invalidates_pending_speech(voice, field, value):
    port, expected, _ = voice
    assert port.subscribe(expected)
    port.offer('{"spoken_text":"出发咯！"}', expected)
    status = port.directory / "status.json"
    status.write_text(json.dumps({**json.loads(status.read_text()), field: value}), encoding="utf-8")
    assert port.take(expected) is None


def test_user_stop_actor_switch_and_expiry_never_replay(voice):
    port, expected, clock = voice
    assert port.subscribe(expected)
    port.offer('{"spoken_text":"出发咯！"}', expected)
    line = port.take(expected)
    clock[0] += 16
    assert not port.speech_current(line)  # Detached host's subscription expires.
    clock[0] -= 16
    port.mailbox.submit("stop", {}, "c20ebc02-0a7c-47bc-b780-73be24c17724")
    assert not port.speech_current(line)


def test_actor_switch_and_completed_delivery_are_not_replayable(voice):
    port, expected, _ = voice
    assert port.subscribe(expected)
    port.offer('{"spoken_text":"出发咯！"}', expected)
    line = port.take(expected)
    port.delivered(line, "accepted")
    assert port.take(expected) is None
    HostContextPort(port.directory, now=port.now).publish_static(
        {"agent_name": "OtherCat", "persona": "安静", "persona_source": "character_profile"}, scope=scope_key(expected["scope"]))
    assert not port.speech_current(line)


def test_binding_key_is_independent_of_process_dict_order(voice):
    _, expected, _ = voice
    reordered = dict(reversed(list(expected.items())))
    reordered["scope"] = dict(reversed(list(expected["scope"].items())))
    assert binding_key(expected) == binding_key(reordered)


def test_interval_duplicate_and_storage_bound(voice):
    port, expected, clock = voice
    assert port.subscribe(expected)
    assert port.offer('{"spoken_text":"出发咯！"}', expected)["offered"]
    assert not port.offer('{"spoken_text":"想去看看山！"}', expected)["offered"]
    for index in range(40):
        clock[0] += 31
        status = port.directory / "status.json"
        status.write_text(json.dumps({**json.loads(status.read_text()), "updated_at": datetime.fromtimestamp(clock[0], timezone.utc).isoformat()}))
        HostContextPort(port.directory, now=port.now).publish_static(
            {"agent_name": "Cat", "persona": "爱冒险", "persona_source": "character_profile"}, scope=scope_key(expected["scope"]))
        assert port.subscribe(expected)
        text = json.dumps({"spoken_text": f"山边的第{index}棵树真漂亮。"})
        assert port.offer(text, expected)["offered"]
        clock[0] += 10
        assert port.subscribe(expected)
        assert not port.offer(text, expected)["offered"]
    with port.connection() as db:
        assert db.execute("SELECT count(*) FROM lines").fetchone()[0] == 32


def test_one_existing_planner_call_offers_line_before_native_dispatch(voice, framework_module, run_async, monkeypatch):
    from test_controller import choose, setup
    port, expected, _ = voice
    assert port.subscribe(expected)
    captured = []

    async def decide(messages, _):
        captured.append(messages)
        return {**choose(), "content": '{"spoken_text":"小窝还差块石头，我去找找。"}'}

    module, bridge, controller = setup(framework_module, port.directory, decide)
    controller.host_context_provider = lambda _: HostContextPort(port.directory, now=port.now).read(0)
    controller.recent_request = lambda _: {**expected, "as_of": port.now()}
    original = bridge.call

    async def call(name, args, **kwargs):
        if name == "mc_do":
            claimed = port.take(expected)
            assert claimed and claimed["line"] == "小窝还差块石头，我去找找。"
        return await original(name, args, **kwargs)

    monkeypatch.setattr(bridge, "call", call)
    run_async(controller.turn_once("survive", "body contract", module.model_tools(bridge.tools)))
    assert len(captured) == 1
    assert "SAME decision" in captured[0][0]["content"]
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 1


def test_tool_only_model_keeps_narration_out_of_native_arguments(voice, framework_module, run_async, monkeypatch):
    from test_controller import choose, setup
    port, expected, _ = voice
    assert port.subscribe(expected)
    captured = []

    async def decide(messages, tools):
        captured.append(tools)
        response = choose()
        response["tool_calls"][0]["function"]["arguments"] = '{"steps":[],"_spoken_text":"山边搭个小窝吧。"}'
        return response  # No assistant content, as with some tool-only models.

    module, bridge, controller = setup(framework_module, port.directory, decide)
    controller.host_context_provider = lambda _: HostContextPort(port.directory, now=port.now).read(0)
    controller.recent_request = lambda _: {**expected, "as_of": port.now()}
    run_async(controller.turn_once("survive", "body contract", module.model_tools(bridge.tools)))
    assert len(captured) == 1
    assert "_spoken_text" in next(t["function"]["parameters"]["properties"] for t in captured[0] if t["function"]["name"] == "mc_do")
    assert all("_spoken_text" not in args for _, args, _ in bridge.calls)
    assert port.take(expected)["line"] == "山边搭个小窝吧。"
    assert "_spoken_text" not in bridge.tools[0]["inputSchema"].get("properties", {})
