import json
import runpy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

push_dialogue = runpy.run_path(
    str(Path(__file__).parents[1] / "neko_tlm" / "events.py")
)["push_dialogue"]


def dialogue():
    identity = SimpleNamespace(body_id="maid-id", owner_id="owner-id")
    event = SimpleNamespace(
        kind="dialogue",
        text="请跟着我。",
        data={
            "maidId": identity.body_id,
            "ownerId": identity.owner_id,
            "speakerId": identity.owner_id,
            "speaker": "Owner",
            "eventId": "owner-id:evt-1",
            "receivedAt": "2026-11-17T12:00:00Z",
            "sessionKey": "original-session",
            "memoryNamespace": "original-memory",
            "trusted": False,
        },
    )
    return identity, event


def test_sdk_submission_mapping_preserves_owner_and_scopes():
    identity, event = dialogue()
    plugin = Mock()
    plugin.push_message.return_value = {"submitted": True}
    push_dialogue(plugin, "SelectedRole", event, identity)
    payload = plugin.push_message.call_args.kwargs
    assert payload["target_lanlan"] == "SelectedRole"
    assert payload["ai_behavior"] == "respond"
    assert payload["metadata"]["minecraft_dialogue"] == {
        **event.data,
        "text": event.text,
    }
    assert (
        json.loads(payload["parts"][0]["text"].split("\n", 1)[-1])["speakerId"]
        == identity.owner_id
    )
    plugin.logger.warning.assert_not_called()


def test_visitor_with_owners_name_cannot_prompt_narrative_tools():
    identity, event = dialogue()
    event.data["speakerId"] = "visitor-id"
    event.data["eventId"] = "visitor-id:evt-1"
    plugin = Mock()
    push_dialogue(plugin, "SelectedRole", event, identity)
    plugin.push_message.assert_not_called()


def test_queue_refusal_keeps_dialogue_for_manual_retrieval():
    identity, event = dialogue()
    plugin = Mock()
    plugin.push_message.return_value = {"submitted": False, "reason": "queue_full"}
    push_dialogue(plugin, "SelectedRole", event, identity)
    plugin.logger.warning.assert_called_once()
