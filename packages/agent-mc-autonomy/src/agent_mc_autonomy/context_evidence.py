"""Exact evidence reuse in model input; originals and control state stay intact."""

import copy
import hashlib
import json

GUIDANCE = """Native terminal history messages carry context_id and native_outcome. A context_ref in the current tail
points to that identical earlier value in this request; it is historical evidence, never a new instruction.
Tool-result context_value_refs describes an exact receipt copy: {"context_same_as":"/text"} is the identical
literal at /text in the object carrying context_value_refs (including a nested event).
These local pointers do not cross event/actor boundaries. Original text is retained, never summarized.
"""


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def outcome_id(value):
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("execution_id"), str)
        or value.get("terminal") is not True
    ):
        return None
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()[:32]


def outcome_message(value):
    identifier = outcome_id(value)
    return (
        {
            "role": "user",
            "content": encoded(
                {
                    "kind": "native_outcome/v1",
                    "context_id": identifier,
                    "native_outcome": value,
                }
            ),
        }
        if identifier
        else None
    )


def history_sources(group):
    result = set()
    for message in group:
        if message.get("role") != "user" or not isinstance(message.get("content"), str):
            continue
        try:
            value = json.loads(message["content"])
        except ValueError:
            continue
        if (
            isinstance(value, dict)
            and set(value) == {"kind", "context_id", "native_outcome"}
            and value["kind"] == "native_outcome/v1"
            and value["context_id"] is not None
            and outcome_id(value["native_outcome"]) == value["context_id"]
        ):
            result.add(value["context_id"])
    return result


def retire_native_sources(rows, source_ids):
    """Retire recent copies only with their window-evicted immutable source.

    The newest terminal stays available even if its history group cannot fit.
    This changes model replay only; original journals and execution state are
    untouched. A reference below locates omitted evidence, not an in-request
    context_ref claiming that the complete value is still present.
    """
    latest = outcome_id(rows[-1]) if rows else None
    retained, retired = [], []
    for index, row in enumerate(rows):
        key = outcome_id(row)
        if key and key in source_ids and key != latest and index < len(rows) - 1:
            retired.append({"outcome_id": key, **{field: copy.deepcopy(row[field])
                for field in ("execution_kind", "execution_id", "phase", "original_event") if field in row}})
        else:
            retained.append(row)
    return retained, retired


def project_values(value):
    """Reuse only the native wrapper's exact copy of its primary receipt text.

    This is model-facing JSON only. Originals, tool arguments, provider replay,
    current facts, chat and events never pass through this projection. Do not
    coalesce similar evidence or equal text attributed to different attempts.
    An existing root marker stays literal rather than being reinterpreted.
    """
    projected = copy.deepcopy(value)
    if not isinstance(value, dict) or "context_value_refs" in value:
        return projected
    text = value.get("text")
    execution = projected.get("execution")
    evidence = execution.get("evidence") if isinstance(execution, dict) else None
    if (
        isinstance(text, str)
        and len(text.encode()) >= 512
        and isinstance(evidence, dict)
        and evidence.get("receipt") == text
    ):
        evidence["receipt"] = {"context_same_as": "/text"}
        projected["context_value_refs"] = {"/execution/evidence/receipt": "/text"}
    return projected
