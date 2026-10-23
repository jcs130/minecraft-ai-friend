"""Opt-in shared-model admission window; never a native work queue or lock."""

import math
import re
import uuid

from .mailbox import observation


def pool_name(value):
    if (
        not isinstance(value, str)
        or value
        and not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", value)
    ):
        raise ValueError("invalid_review_model_pool")
    return value


def valid(window, state, current, revision, now, pool):
    if (
        not isinstance(window, dict)
        or not current
        or not current.get("scope")
        or not state.get("policy", {}).get("enabled")
    ):
        return False
    if not isinstance(window.get("id"), str) or not re.fullmatch(
        r"[a-f0-9]{32}", window["id"]
    ):
        return False
    started, until = window.get("started_at"), window.get("expires_at")
    if (
        any(
            type(value) not in {int, float} or not math.isfinite(value)
            for value in [started, until]
        )
        or not started <= now < until <= started + 180
        or current.get("urgent")
    ):
        return False
    review = state.get("review") or {}
    return (
        window.get("pool") == pool
        and review.get("id") == window.get("review_id")
        and not review.get("result")
        and revision == window.get("revision")
        and all(
            current.get(key) == window.get(key)
            for key in ["session", "scope", "intent", "baseline"]
        )
    )


def begin(port, review_id, pool):
    if not pool_name(pool) or port.stopping():
        return None
    now = port.now()
    current = port.current_observation(observation(port.directory))
    if not current or not current.get("scope"):
        return None
    revision = port.mailbox.intent_revision()
    with port.transaction() as state:
        review = state.get("review") or {}
        until = (review.get("opportunity") or {}).get("expires_at")
        if (
            review.get("id") != review_id
            or "inspected_at" not in review
            or not state.get("policy", {}).get("enabled")
            or review.get("session") != current["session"]
            or review.get("intent") != current["intent"]
            or review.get("scope") != current["scope"]
            or review.get("baseline") != current["baseline"]
            or review.get("revision") != revision
            or type(until) not in {int, float}
            or not math.isfinite(until)
            or not now < until <= review["created_at"] + 180
        ):
            return None
        if valid(
            state.get("model_inference_window"), state, current, revision, now, pool
        ):
            return None  # Another actual review request owns this optional window.
        window = {
            "id": uuid.uuid4().hex,
            "review_id": review_id,
            "pool": pool,
            "started_at": now,
            "expires_at": until,
            "revision": revision,
            **{key: current[key] for key in ["session", "scope", "intent", "baseline"]},
        }
        state["model_inference_window"] = window
        return {
            key: window[key]
            for key in ["id", "review_id", "pool", "started_at", "expires_at"]
        }


def current(port, pool):
    if not pool_name(pool) or port.stopping():
        return None
    state = port.state()
    window = state.get("model_inference_window")
    observed = port.current_observation(observation(port.directory))
    if not valid(
        window, state, observed, port.mailbox.intent_revision(), port.now(), pool
    ):
        return None
    return {key: window[key] for key in ["id", "review_id", "started_at", "expires_at"]}


def end(port, window_id):
    if (
        not isinstance(window_id, str)
        or not re.fullmatch(r"[a-f0-9]{32}", window_id)
        or not port.path.exists()
    ):
        return False
    with port.transaction() as state:
        if (state.get("model_inference_window") or {}).get("id") != window_id:
            return False
        state.pop("model_inference_window")
        return True
