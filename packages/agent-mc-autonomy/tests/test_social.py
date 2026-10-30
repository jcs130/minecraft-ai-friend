"""Synthetic native receipts and model ports only; no server/model/network calls."""
import asyncio
import copy
import dataclasses
import json
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from test_controller import choose, setup

from agent_mc_autonomy.social import SocialInbox, SocialSettings

NAMES = ("ag_CorMy", "Coobot", "DeepFish", "Yui")
MEMBERS = [{"name": n, "uuid": str(uuid.UUID(int=i + 1))} for i, n in enumerate(NAMES)]


def config(**values):
    return SocialSettings.parse({"enabled": True, "members": MEMBERS, **values})


def event(number=1, speaker="Coobot", text="发现一片成熟的麦田，要一起收吗？", now=1000, **meta):
    return {"run": "native-run", "cursor": number, "type": "minecraft.chat", "trigger": "flush",
            "ts": datetime.fromtimestamp(now, timezone.utc).isoformat(), "text": f"[MC] {speaker}: {text}",
            "senderKey": speaker, "meta": {"uname": speaker, "channel": "public", "identityEvidence": "packet-sender",
                "senderUuid": next(row["uuid"] for row in MEMBERS if row["name"] == speaker), **meta}}


def test_pending_survives_busy_cooldown_and_restart_and_only_actual_model_input_is_consumed(tmp_path):
    clock = [1000]
    inbox = SocialInbox(tmp_path, config(), NAMES[0], clock=lambda: clock[0])
    original = event()
    before = copy.deepcopy(original)
    assert inbox.offer(original) and not inbox.ready()
    clock[0] += 2
    assert not inbox.ready(busy=True)
    inbox = SocialInbox(tmp_path, config(), NAMES[0], clock=lambda: clock[0])
    assert inbox.ready() == [original]
    assert original == before
    inbox.model_started([], "not_in_context")
    assert inbox.ready() == [original]
    inbox.model_started([original], "request-1")
    assert not inbox.ready()
    assert inbox.context()["dialogue"][0]["attention"] == "unknown"
    inbox.model_finished("request-1")
    assert inbox.offer(event(2, text="我可以负责补种。", now=1002))
    clock[0] = 1016
    assert not inbox.ready()
    clock[0] = 1017
    assert [e["cursor"] for e in inbox.ready()] == [2]
    assert inbox.status()["recipient_delivery_inferred"] is False


def test_event_and_content_dedup_survive_restarts_and_inbound_replies(tmp_path):
    clock = [1000]
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: clock[0])
    row = event(text="收到！")
    inbox.offer(row)
    inbox.model_started([row], "first")
    inbox.model_finished("first")
    clock[0] += 20
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: clock[0])
    inbox.offer(row)  # Same native event after reconnect.
    inbox.offer(event(2, text=" 收到。 ", now=1020))  # New event, same content.
    inbox.offer(event(3, speaker="Yui", text="收到！", now=1020))  # Different speaker is independent.
    assert [e["cursor"] for e in inbox.ready()] == [3]
    assert inbox.status()["counts"]["duplicate_content"] == 1


def test_continuous_novel_peer_loop_stops_without_delayed_reawakening(tmp_path):
    clock = [1000]
    inbox = SocialInbox(tmp_path, config(batch_seconds=0, cooldown_seconds=1, max_peer_turns=3), NAMES[0], clock=lambda: clock[0])
    for i in range(12):
        clock[0] += 20
        row = event(i, text=f"不同内容 {i}", now=clock[0])
        inbox.offer(row)
        selected = inbox.ready()
        assert bool(selected) == (i < 3)
        inbox.model_started(selected, str(i))
        inbox.model_finished(str(i))
    clock[0] += 1000
    assert not inbox.ready()  # Cooldown/TTL never creates a new model call.
    inbox.offer(event(13, text="现在有新的同行邀请。", now=clock[0]))
    assert len(inbox.ready()) == 1  # A genuinely new input after quiet can start a new episode.


def test_roster_identity_changes_do_not_replay_old_inbox_or_inherit_old_dialogue(tmp_path):
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: 1000)
    inbox.offer(event())
    changed = copy.deepcopy(MEMBERS)
    changed[1]["uuid"] = str(uuid.UUID(int=99))
    inbox = SocialInbox(tmp_path, SocialSettings.parse({"enabled": True, "members": changed}), NAMES[0], clock=lambda: 1001)
    assert not inbox.ready() and not inbox.context()["dialogue"]


@pytest.mark.parametrize("mutation", [
    {"ts": "old-without-timezone"}, {"ts": "1970-01-01T00:00:01Z"},
    {"ts": "1970-01-01T00:30:00Z"}, {"contextDelivery": "archive-only"},
    {"trigger": "piggyback"},
])
def test_stale_archived_or_ambient_data_never_wakes(tmp_path, mutation):
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: 1000)
    inbox.offer({**event(), **mutation})
    assert not inbox.ready()


def test_unverified_old_adapter_and_human_inputs_keep_original_route(tmp_path):
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: 1000)
    assert not inbox.offer(event(identityEvidence="explicit-chat-event", senderUuid=None))
    assert not inbox.owns(event(identityEvidence="explicit-chat-event", senderUuid=None))
    assert not inbox.offer(event(2, senderUuid=MEMBERS[2]["uuid"]))
    human = event(3)
    human["meta"]["uname"] = human["senderKey"] = "HumanPlayer"
    assert not inbox.offer(human)
    assert not inbox.ready() and not inbox.context()["dialogue"]
    assert inbox.offer(event(4, identityEvidence="player-list-format"))
    assert len(inbox.ready()) == 1


def test_transport_send_and_self_echo_are_not_partner_hearing(tmp_path):
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: 1000)
    assert not inbox.offer({**event(), "type": "minecraft.chat.sent", "meta": {
        "chatDelivery": {"status": "sent", "boundary": "client-transport", "recipientRead": "unknown"}}})
    assert inbox.offer(event(speaker=NAMES[0]))
    assert inbox.offer(event(2, direction="outgoing"))
    assert not inbox.ready() and not inbox.context()["dialogue"]


def test_ttl_and_bounded_overflow_are_visible(tmp_path):
    clock = [1000]
    inbox = SocialInbox(tmp_path, config(batch_seconds=0, ttl_seconds=10), NAMES[0], clock=lambda: clock[0])
    for i in range(35):
        inbox.offer(event(i, text=f"发现 {i}"))
    assert len(inbox.ready()) == 4 and inbox.status()["counts"]["inbox_full"] == 3
    clock[0] += 10
    assert not inbox.ready()
    assert inbox.status()["counts"]["expired"] == 32


def test_waiting_does_not_refresh_old_observation_age(tmp_path):
    clock = [1000]
    inbox = SocialInbox(tmp_path, config(batch_seconds=2, ttl_seconds=10), NAMES[0], clock=lambda: clock[0])
    inbox.offer(event(now=991))
    clock[0] += 2
    assert not inbox.ready() and inbox.status()["counts"]["expired"] == 1


def test_unknown_model_request_is_not_retried_after_restart(tmp_path):
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: 1000)
    row = event()
    inbox.offer(row)
    inbox.model_started([row], "lost-response")
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: 1020)
    inbox.offer(row)
    assert not inbox.ready()
    assert inbox.context()["dialogue"][0]["attention"] == "unknown"


def test_settings_parse_is_wired_and_disabled_by_default(framework_module):
    assert not framework_module.Settings.parse({}).social.enabled
    raw = {"social": {"enabled": True, "members": MEMBERS}}
    assert framework_module.Settings.parse(raw).social == config()


def test_controller_does_not_consume_messages_while_busy_or_before_cooldown(
        framework_module, tmp_path, run_async):
    clock, decisions = [1000], []

    async def decide(messages, _):
        decisions.append(messages)
        return {"content": "", "tool_calls": []}  # No speech and no game action.

    module, bridge, ctl = setup(framework_module, tmp_path, decide)
    ctl.settings = dataclasses.replace(ctl.settings, username=NAMES[0], social=config(batch_seconds=0))
    ctl.social = SocialInbox(tmp_path, ctl.settings.social, NAMES[0], clock=lambda: clock[0])
    ctl.death_waiting = True
    bridge.event_pages.append([event()])
    wake, urgent, _ = run_async(ctl._poll_events())
    assert not wake and not urgent and not ctl.recent
    ctl.death_waiting = False
    assert ctl.refresh_social()
    run_async(ctl.turn_once("一起生存", "prefix", module.model_tools(bridge.tools)))
    bridge.event_pages.append([event(2, speaker="Yui", text="我负责做饭。")])
    assert not run_async(ctl._poll_events())[0]
    clock[0] += 15
    assert run_async(ctl._poll_events())[0]
    run_async(ctl.turn_once("一起生存", "prefix", module.model_tools(bridge.tools)))
    assert len(decisions) == 2
    assert not any(n == "mc_do" for n, _, _ in bridge.calls)


@pytest.mark.parametrize("raw", [
    {"enabled": True}, {"enabled": "yes"}, {"members": MEMBERS * 2},
    {"members": [{"name": "Yui", "uuid": "guess"}]}, {"batch_seconds": True},
    {"cooldown_seconds": 0}, {"enabled": False, "unexpected": 1},
])
def test_settings_fail_closed(raw):
    with pytest.raises(ValueError):
        SocialSettings.parse(raw)


def test_native_model_receipt_seam_retains_persona_and_requires_selected_chat_action(
        framework_module, tmp_path, run_async):
    clock, captured = [1000], []

    async def decide(messages, _):
        captured.append(messages)
        reply = choose()
        reply["tool_calls"][0]["function"]["arguments"] = json.dumps({"steps": [{"skill": "chat", "text": "我来补种，你们收麦。"}]})
        return reply

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, username=NAMES[0], social=config(batch_seconds=0))
    controller.social = SocialInbox(tmp_path, controller.settings.social, NAMES[0], clock=lambda: clock[0])
    controller.host_context_provider = lambda _: {"stable": {"agent_name": "可米", "persona": "珍惜材料，喜欢种田",
                                                            "persona_source": "host_projection"}, "dynamic": {}}
    controller.receipt({"events": [event()]})
    assert not controller.recent  # Not a second parallel pending queue.
    assert controller.refresh_social()
    assert controller.conversation_ready()
    run_async(controller.turn_once("生存", "body contract", module.model_tools(bridge.tools)))
    assert "珍惜材料" in captured[0][0]["content"]
    assert "成熟的麦田" in json.dumps(captured[0], ensure_ascii=False)
    assert sum(n == "mc_do" for n, _, _ in bridge.calls) == 1
    assert controller.social.status()["counts"]["model_observed"] == 1
    assert not controller.social.ready()
    assert controller.pending[("task", "body-1")]["terminal"] is False


def test_four_receivers_use_actual_native_route_not_sender_success(
        framework_module, tmp_path, run_async):
    """All 12 ordered edges through actual Controllers and fake native ports.

    The fake server emits one recipient-local event only after applying its
    route. The sender's transport receipt is deliberately insufficient.
    """
    clock = [1000]
    received, sent, rigs = [], [], {}
    for self_name in NAMES:
        async def decide(messages, _, name=self_name):
            received.append((name, json.dumps(messages, ensure_ascii=False)))
            return {"content": "本轮选择继续手头工作。", "tool_calls": []}  # Silence is a valid decision.
        module, bridge, ctl = setup(framework_module, tmp_path / self_name, decide)
        ctl.settings = dataclasses.replace(ctl.settings, username=self_name,
            social=config(batch_seconds=0, cooldown_seconds=1, max_peer_turns=12))
        ctl.social = SocialInbox(tmp_path / self_name, ctl.settings.social, self_name, clock=lambda: clock[0])
        ctl.receipt({"execution": {"kind": "task", "id": "following", "terminal": False, "phase": "running"}})
        rigs[self_name] = module, bridge, ctl

    seq = [0]

    def server_send(sender, listeners, text):
        sent.append({"status": "sent", "boundary": "client-transport", "recipientRead": "unknown"})
        for listener in listeners:
            seq[0] += 1
            rigs[listener][1].event_pages.append([event(seq[0], sender, text, now=clock[0])])

    for sender in NAMES:
        listeners = [n for n in NAMES if n != sender]
        server_send(sender, listeners, sender + " 分享刚刚观察的发现")
        for listener in listeners:
            module, bridge, ctl = rigs[listener]
            wake, urgent, _ = run_async(ctl._poll_events())
            assert wake and not urgent and ctl.conversation_ready()
            run_async(ctl.turn_once("一起生存", "body contract", module.model_tools(bridge.tools)))
            assert ("task", "following") in ctl.pending
        clock[0] += 2
    assert len(received) == 12
    assert not any(n == "mc_do" for _, bridge, _ in rigs.values() for n, _, _ in bridge.calls)

    # Simulate different dimension/outside range/offline: the fake native route
    # produces no receiver event. It must not leak via a shared transcript.
    server_send(NAMES[0], [], "无人听到的发现")
    for _, bridge, ctl in rigs.values():
        wake, _, _ = run_async(ctl._poll_events())
        assert not wake and "无人听到" not in json.dumps(ctl.social.context(), ensure_ascii=False)
    assert len(received) == 12 and len(sent) == 5


def test_four_models_actually_choose_speech_and_a_novel_group_loop_settles(
        framework_module, tmp_path, run_async):
    clock, rigs, speech, decisions = [1000], {}, [], []
    seq = [0]

    def send(sender, text):
        speech.append((sender, text))  # One send, independent receiver observations.
        for listener, (_, bridge, _) in rigs.items():
            if sender != listener:
                seq[0] += 1
                bridge.event_pages.append([event(seq[0], sender, text, now=clock[0])])

    for name in NAMES:
        async def decide(messages, _, actor=name):
            decisions.append((actor, messages))
            reply = choose()
            # A deliberately over-eager synthetic model tries new wording every
            # time. Settling therefore tests episode limits, not canned silence.
            reply["tool_calls"][0]["function"]["arguments"] = json.dumps({"steps": [
                {"skill": "chat", "text": actor + " 根据眼前发现继续商量 " + str(len(decisions))}]})
            return reply
        module, bridge, ctl = setup(framework_module, tmp_path / name, decide)
        ctl.settings = dataclasses.replace(ctl.settings, username=name,
            social=config(batch_seconds=0, cooldown_seconds=1, max_peer_turns=2))
        ctl.social = SocialInbox(tmp_path / name, ctl.settings.social, name, clock=lambda: clock[0])
        ctl.receipt({"execution": {"kind": "task", "id": "following", "terminal": False, "phase": "running"}})
        native_call = bridge.call

        async def call(tool, args, actor=name, original=native_call, **kwargs):
            if tool == "mc_do":
                for step in args["steps"]:
                    if step.get("skill") == "chat":
                        send(actor, step["text"])
            return await original(tool, args, **kwargs)

        bridge.call = call
        rigs[name] = module, bridge, ctl

    # A real game opportunity in the fake native stream starts the first model,
    # rather than a recurring instruction to say something.
    first_module, first_bridge, first_ctl = rigs[NAMES[0]]
    first_ctl.receipt({"events": [{"run": "native-run", "cursor": 0,
        "type": "minecraft.advancement", "trigger": "flush", "text": "发现村庄的农田"}]})
    run_async(first_ctl.turn_once("一起生存", "body contract", first_module.model_tools(first_bridge.tools)))
    for _ in range(30):
        clock[0] += 1
        for module, bridge, ctl in rigs.values():
            wake, urgent, _ = run_async(ctl._poll_events())
            assert not urgent
            if wake and ctl.conversation_ready():
                run_async(ctl.turn_once("一起生存", "body contract", module.model_tools(bridge.tools)))
    assert set(actor for actor, _ in speech) == set(NAMES)
    assert 4 <= len(speech) <= 9  # Root turn + two companion-triggered turns per body.
    assert all(("task", "following") in ctl.pending for _, _, ctl in rigs.values())
    total = len(decisions)
    clock[0] += 1000
    for _, _, ctl in rigs.values():
        wake, _, _ = run_async(ctl._poll_events())
        assert not wake
    assert len(decisions) == total


def transport(text="收到！", *, channel="public", to=None, number=1, now=1000):
    return {"type": "minecraft.chat.sent", "trigger": "piggyback", "meta": {"outgoing": True,
        "direction": "outgoing", "chatDelivery": {"protocol": "agent-mc/chat-delivery/v1",
            "status": "sent", "id": f"send-{number}", "boundary": "client-transport", "recipientRead": "unknown",
            "sentAt": datetime.fromtimestamp(now, timezone.utc).isoformat(), "channel": channel, "to": to, "text": text}}}


def plan(text):
    return {"steps": [{"skill": "chat", "text": text}]}


def test_outgoing_repetition_does_not_reset_on_peer_input_or_restart_or_claim_hearing(tmp_path):
    clock = [1000]
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: clock[0])
    inbox.note_transport(transport())
    inbox.offer(event(text="接着讨论下一件事。"))
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: clock[0])
    refusal = inbox.speech_problem("mc_do", plan(" 收到。 "))
    assert refusal["dispatched"] is False and refusal["recipient_heard"] == "unknown"
    assert not inbox.speech_problem("mc_do", plan("/mycli status"))
    assert not inbox.speech_problem("mc_do", plan("发现新的煤矿。"))
    assert inbox.speech_problem("mc_do", {"steps": [*plan("新话题")["steps"], *plan("新话题！")["steps"]]})
    clock[0] += 600
    assert not inbox.speech_problem("mc_do", plan("收到！"))


def test_private_output_dedup_separates_recipients_and_ignores_stale_receipts(tmp_path):
    inbox = SocialInbox(tmp_path, config(), NAMES[0], clock=lambda: 1000)
    inbox.note_transport(transport(channel="private", to="Yui"))
    assert inbox.speech_problem("mc_do", plan("/minecraft:tell yui 收到。"))
    assert not inbox.speech_problem("mc_do", plan("/msg DeepFish 收到！"))
    assert not inbox.speech_problem("mc_do", plan("收到！"))
    inbox.note_transport(transport(number=2, text="旧消息", now=1))
    assert not inbox.speech_problem("mc_do", plan("旧消息"))


def test_new_signed_coordinates_are_not_mistaken_for_repeated_discoveries(tmp_path):
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: 1000)
    inbox.note_transport(transport(text="煤矿在(-10,64,20)"))
    assert not inbox.speech_problem("mc_do", plan("煤矿在(10,64,20)"))
    assert not inbox.speech_problem("mc_do", plan("煤矿在(-106,4,20)"))
    inbox.offer(event(1, text="煤矿在(-10,64,20)"))
    inbox.offer(event(2, text="煤矿在(10,64,20)"))
    assert len(inbox.ready()) == 2


def test_repeated_speech_rejection_reaches_actual_model_tool_port_without_dispatch(
        framework_module, tmp_path, run_async):
    async def unused(*_):
        raise AssertionError("No model in transport receipt test")
    _, bridge, ctl = setup(framework_module, tmp_path, unused)
    ctl.settings = dataclasses.replace(ctl.settings, username=NAMES[0], social=config())
    ctl.social = SocialInbox(tmp_path, ctl.settings.social, NAMES[0], clock=lambda: 1000)
    ctl.receipt({"events": [transport()]})
    assert not ctl.social.ready() and not ctl.conversation_ready()
    mixed = {"steps": [*plan("收到！")["steps"], {"skill": "eat"}]}
    result, _ = run_async(ctl.dispatch("mc_do", mixed, str(uuid.uuid4())))
    assert result["code"] == "repeated_social_speech"
    assert not any(n == "mc_do" for n, _, _ in bridge.calls)
    assert not ctl.pending  # No partial plan and no invented task completion.


def test_cancelled_inference_does_not_become_model_observed(framework_module, tmp_path, run_async):
    async def decide(*_):
        ctl.operator_stop = True
        return {"content": "这个结果已过时", "tool_calls": []}
    module, bridge, ctl = setup(framework_module, tmp_path, decide)
    ctl.settings = dataclasses.replace(ctl.settings, username=NAMES[0], social=config(batch_seconds=0))
    ctl.social = SocialInbox(tmp_path, ctl.settings.social, NAMES[0], clock=lambda: 1000)
    ctl.receipt({"events": [event()]})
    run_async(ctl.turn_once("一起生存", "prefix", module.model_tools(bridge.tools)))
    assert ctl.social.status()["states"] == {"unknown": 1}
    assert "model_observed" not in ctl.social.status()["counts"]


def test_real_run_loop_revisits_pending_at_cooldown_without_cancelling_native_work(
        framework_module, tmp_path, run_async, monkeypatch):
    clock, decisions, delivered = [1000], [], set()

    async def decide(*_):
        decisions.append(clock[0])
        return choose() if len(decisions) == 1 else {"content": "本轮不发言，继续同行。", "tool_calls": []}

    module, bridge, ctl = setup(framework_module, tmp_path, decide, lambda: clock[0] >= 1030)
    ctl.settings = dataclasses.replace(ctl.settings, username=NAMES[0], social=config(),
        max_decisions=0, max_tool_rounds=1, min_decision_seconds=5)
    ctl.social = SocialInbox(tmp_path, ctl.settings.social, NAMES[0], clock=lambda: clock[0])
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    monkeypatch.setattr(module.asyncio, "sleep", tick)

    def incoming():
        for at in (1002, 1007):
            if ctl.pending and clock[0] >= at and at not in delivered:
                delivered.add(at)
                bridge.event_pages.append([event(at, text=f"同伴在{at}的发现", now=clock[0])])

    bridge.on_poll = incoming
    run_async(ctl.run("一起生存"))
    assert decisions == [1000, 1005, 1020]
    assert sum(n == "mc_do" for n, _, _ in bridge.calls) == 1
    assert not any(n == "mc_stop" for n, _, _ in bridge.calls)
