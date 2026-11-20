"""Correlation for resident decisions and body receipts without their contents."""
import hashlib
import json
from contextlib import contextmanager
from datetime import datetime, timezone

from pydantic import ValidationError


DECISION_ERROR_CODES = frozenset({
    "action_not_in_current_body_catalogue",
    "at_most_three_game_actions",
    "attention_unavailable_no_speech",
    "body_follow_means_owner_use_companion_with_a_name_or_uuid_from_the_skill_compass",
    "choose_companion_from_the_skill_compass_before_travel",
    "choose_one_character_uuid_from_the_directory",
    "communication_not_available_for_this_turn",
    "communication_source_event_required",
    "companion_target_not_observed",
    "conflicting_companion_targets",
    "invalid_companion_args",
    "invalid_companion_choice",
    "invalid_companion_plan",
    "invalid_companion_step",
    "invalid_companion_target",
    "invalid_dialogue_reply",
    "invalid_resident_communication",
    "item_not_in_reviewed_native_catalogue",
    "model_cannot_change_body_or_request_identity",
    "npc_cannot_attack_players_or_passive_entities",
    "npc_plan_schema",
    "overlapping_or_out_of_day_agenda",
    "short_single_line_speech_required",
    "task_not_in_reviewed_native_catalogue",
    "unexpected_companion_step",
    "use_the_bounded_fishing_action",
})


def correlation_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def trace_resident_turn(turn_hash: str, stage: str, **fields) -> None:
    record = {"at": datetime.now(timezone.utc).isoformat(), "turnHash": turn_hash, "stage": stage, **fields}
    print("resident_turn " + json.dumps(record, separators=(",", ":")), flush=True)


class ResidentDecisionError(ValueError):
    def __init__(self, turn_hash: str, step: str, kind: str, error: ValueError):
        code = error.args[0] if len(error.args) == 1 and isinstance(error.args[0], str) else None
        if code not in DECISION_ERROR_CODES:
            code = "schema_validation_error" if isinstance(error, ValidationError) else "invalid_decision"
        super().__init__(code)
        self.turn_hash = turn_hash
        self.step = step
        self.code = code
        trace_resident_turn(turn_hash, "decision_rejected", decisionKind=kind, step=step, errorCode=code)


@contextmanager
def validate_resident_decision(turn_hash: str | None, step: str, kind: str = "plan"):
    try:
        yield
    except ValueError as error:
        if turn_hash:
            raise ResidentDecisionError(turn_hash, step, kind, error) from None
        raise
