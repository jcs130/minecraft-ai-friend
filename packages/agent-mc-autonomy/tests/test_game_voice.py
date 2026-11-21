"""Use the native event and receipt contract without game or model traffic."""

import dataclasses
import json
from datetime import datetime

import pytest
from test_controller import setup
from test_event_delivery import noise
from test_social import MEMBERS, NAMES, config

from agent_mc_autonomy.context import project_event, rules_for
from agent_mc_autonomy.native_settings import NativeSettings
from agent_mc_autonomy.social import SocialInbox

STAMP = "2026-11-21T16:01:01+08:00"
UTTERANCE = "0c808429-12cc-483d-b2b9-fba929126997"
REQUEST = "71a082d9-d68c-4c45-9d08-c96ce990ce86"
TOOL = {"name": "mc_voice", "description": "Native nearby voice", "inputSchema": {
    "type": "object", "properties": {"action": {"enum": ["speak", "status"]}, "text": {"type": "string"}},
    "additionalProperties": False}, "_meta": {"agent-mc/v1": {"tags": ["speak"], "bodyControl": "independent"}}}


def hearing(cursor=1, **meta):
    return {"run": "run-1", "cursor": cursor, "ts": STAMP, "source": "minecraft", "type": "minecraft.chat",
            "trigger": "flush", "senderKey": NAMES[1], "text": f"[MC 附近语音] {NAMES[1]}: 一起来挖矿吗？",
            "meta": {"uname": NAMES[1], "channel": "nearby-voice", "senderUuid": MEMBERS[1]["uuid"],
                     "source": "mcagent:voice/nearby_voice", "utteranceId": UTTERANCE, "transcript": True, **meta}}


def sent(state, cursor, **meta):
    return {"run": "run-1", "cursor": cursor, "ts": STAMP, "source": "minecraft", "type": "minecraft.voice",
            "trigger": "piggyback", "text": "原始私有回执", "meta": {"proximityVoice": {
                "game": {"state": state, "delivery": {"listenerCount": 2}},
                "recipientHeard": "unknown", "requestId": REQUEST, "requestedText": "原始私有回执"}, **meta}}


def enable_voice(controller):
    controller.settings = dataclasses.replace(controller.settings, native=NativeSettings.parse(
        {"proximity_voice": {"enabled": True}}))


@pytest.mark.parametrize("context_mode", ["compact", "full"])
def test_default_hides_voice_schema_help_and_dispatch(framework_module, tmp_path, run_async, context_mode):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.extend([TOOL, {"name": "mc_map", "inputSchema": {"type": "object"}}])
    tools = module.model_tools(bridge.tools, context_mode=context_mode)
    assert "mc_voice" not in json.dumps(tools)
    assert "Simple Voice Chat" not in rules_for(tools)
    visible = module.model_tools(bridge.tools, context_mode=context_mode, proximity_voice=True)
    assert next(tool for tool in visible if tool["function"]["name"] == "mc_voice")["function"]["description"] == TOOL["description"]
    assert "listener count does not establish" in rules_for(visible)
    for tool, args in (("mc_voice", {}), ("mc_tool_help", {"name": "mc_voice"})):
        result, _ = run_async(controller.dispatch(tool, args, REQUEST))
        assert result["code"] == "game_voice_disabled" and result["dispatched"] is False
    assert not any(name in {"mc_voice", "mc_tool_help"} for name, _, _ in bridge.calls)
    bridge.event_pages.append([hearing(), sent("sent", 2)])
    assert run_async(controller.events())[0] is False
    assert not controller.recent and not controller.game_voice


def test_voice_events_publish_receipt_state_without_private_contents_or_task_success(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    enable_voice(controller)
    public = []
    controller.publish = lambda **row: public.append(row)
    bridge.event_pages.append([hearing(), sent("sent", 2)] + [noise(i) for i in range(3, 75)])
    assert run_async(controller.events())[0] is True
    assert not controller.pending and not controller.native_outcomes
    assert controller.game_voice == {"received_at": STAMP, "send_state": "sent", "send_at": STAMP, "listener_count": 2}
    bridge.event_pages.append([sent("sent", 75, staleEpoch=True), sent("sent", 76) | {"run": "old-run"},
                               sent("accepted", 77)])
    assert run_async(controller.events())[0] is False
    assert controller.game_voice == {"received_at": STAMP, "send_state": "accepted", "send_at": STAMP}
    voice = project_event(next(row for row in controller.recent if row["cursor"] == 1))
    assert voice["meta"]["utteranceId"] == UTTERANCE
    assert voice["meta"]["senderUuid"] == MEMBERS[1]["uuid"]
    assert "一起来挖矿吗" in voice["text"]
    projected = json.dumps([row["game_voice"] for row in public if "game_voice" in row], ensure_ascii=False)
    assert all(raw not in projected for raw in (REQUEST, UTTERANCE, NAMES[1], "原始私有回执", "一起来挖矿吗"))


def test_voice_acceptance_keeps_the_existing_body_task_and_no_fake_terminal(framework_module, tmp_path, run_async):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    enable_voice(controller)
    bridge.tools.append(TOOL)
    original_call = bridge.call
    calls = []

    async def call(name, args, **kwargs):
        if name == "mc_voice":
            calls.append(args)
            return {"structuredContent": {"protocol": "agent-mc/v1", "text": "voice accepted",
                    "control": {"barrierAfter": False, "endTurnRequested": False},
                    "data": {"requestId": REQUEST, "game": {"state": "accepted"},
                             "recipientHeard": "unknown", "goal_completed": False}}}
        return await original_call(name, args, **kwargs)

    bridge.call = call
    pending = {"kind": "task", "id": "existing-task", "phase": "running", "terminal": False}
    controller.pending[("task", "existing-task")] = pending
    arguments = {"action": "speak", "text": "等我把木头放好就来。"}
    tools = module.model_tools(bridge.tools, proximity_voice=True)
    _, name, validated = controller.prepare_call([{"id": "tool-1", "function": {
        "name": "mc_voice", "arguments": json.dumps(arguments)}}], tools)
    result, _, _ = run_async(controller.execute_model_call(name, validated))
    assert calls == [arguments]
    assert result["data"]["game"]["state"] == "accepted"
    assert result["data"]["recipientHeard"] == "unknown" and result["data"]["goal_completed"] is False
    assert result.get("execution") is None and not controller.native_outcomes
    assert controller.pending == {("task", "existing-task"): pending}
    assert not any(name == "mc_protocol" and args.get("action") == "ack_barrier" for name, args, _ in bridge.calls)


def test_verified_companion_voice_dedups_utterance_and_stays_on_the_social_lane(tmp_path):
    start = datetime.fromisoformat(STAMP).timestamp()
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: start)
    voice = hearing()
    assert inbox.owns(voice) and inbox.offer(voice)
    assert inbox.offer(hearing(2) | {"text": "same native audio captured again"})
    assert not inbox.owns(hearing(3, source="unknown"))
    assert not inbox.owns(hearing(4, senderUuid=MEMBERS[2]["uuid"]))
    assert inbox.ready() == [voice]
    inbox.model_started([voice], "fake-model-1")
    assert not inbox.ready()
    inbox.model_finished("fake-model-1")
    assert not inbox.ready()
    row = inbox.context()["dialogue"][0]
    assert row["speaker_uuid"] == MEMBERS[1]["uuid"] and row["utterance_id"] == UTTERANCE
    assert row["transcript"] is True and row["attention"] == "consumed"
