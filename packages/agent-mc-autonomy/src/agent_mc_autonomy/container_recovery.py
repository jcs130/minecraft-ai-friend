"""Bound repeated failed withdrawals by their measured container, not the batch."""
import copy
import json
import math
import time

from .effects import _inventory, _vector, validated_effect


def _same_open_state(previous, current):
    return (isinstance(previous, dict) and _vector(previous.get("position"))
            and _vector(current.get("position")) and math.dist(previous["position"], current["position"]) <= .05
            and all(previous.get(key) == current.get(key) for key in ("target", "inventory", "window")))


def _candidates(arguments):
    steps = arguments.get("steps")
    if not isinstance(steps, list) or not 2 <= len(steps) <= 64:
        return
    for index in range(1, len(steps)):
        step, opened = steps[index], steps[index - 1]
        if (not isinstance(step, dict) or step.get("skill") != "take" or step.get("from") != "open"
                or not isinstance(opened, dict) or opened.get("skill") != "use"
                or not {"skill", "at"} <= set(opened) <= {"skill", "at", "face"} or not _vector(opened["at"])
                or "face" in opened and (not isinstance(opened["face"], str)
                                         or opened["face"] not in {"up", "down", "north", "south", "east", "west"})
                or any(not isinstance(prior, dict) or prior.get("skill") not in {"goto", "look"}
                       for prior in steps[:index - 1])):
            continue
        # A preceding acquisition, arbitrary interaction, relative coordinate or
        # another container is deliberately outside this conservative guard.
        key = json.dumps([opened, step], sort_keys=True, ensure_ascii=False)
        yield key, index, opened, step


class ContainerRecovery:
    """Two measured failures yield a dated refusal for at most 120 seconds."""

    def __init__(self):
        self.rows = {}

    def record(self, arguments, execution, scope, epoch, reference):
        steps = arguments.get("steps")
        raw = (execution.get("evidence") or {}).get("steps")
        if (scope is None or execution.get("terminal") is not True
                or execution.get("phase") not in {"blocked", "partial", "completed"}
                or not isinstance(reference.get("run"), str) or type(reference.get("cursor")) is not int
                or not isinstance(steps, list) or not isinstance(raw, list) or len(raw) != len(steps)
                or any(not isinstance(row, dict) or type(row.get("step")) is not int
                       or row["step"] != index + 1 for index, row in enumerate(raw))):
            return
        now = time.monotonic()
        self.rows = {key: row for key, row in self.rows.items() if now - row["at"] < 120}
        for key, index, opened, step in _candidates(arguments):
            take = validated_effect(raw[index].get("observedEffect"))
            use = validated_effect(raw[index - 1].get("observedEffect"))
            if use is None or use["skill"] != "use" or use["at"] != opened["at"]:
                continue
            unopened = (raw[index - 1].get("outcome") == "fail" and raw[index].get("outcome") == "skip"
                        and use["status"] == "unchanged" and use["after"].get("target") is not None
                        and _vector(use["after"].get("position")) and use["after"].get("window") is None
                        and _inventory(use["after"].get("inventory")))
            if unopened:
                measured = use
                failure_kind = "unopened_container"
            elif (take is None or take["skill"] != "take" or use["dimension"] != take["dimension"]
                    or raw[index - 1].get("outcome") != "ok"
                    or not use["after"].get("window")
                    or use["after"]["window"] != take["before"].get("window")
                    or not _inventory(take["before"].get("inventory"))):
                continue
            elif raw[index].get("outcome") != "fail" or take["changed"]["inventory"] is not False:
                self.rows.pop(key, None)
                continue
            else:
                measured = take
                failure_kind = "failed_container_take"
            stock = measured["after"]["inventory"]
            previous = self.rows.get(key, {})
            same = (previous.get("scope") == scope and previous.get("epoch") == epoch
                    and previous.get("dimension") == measured["dimension"] and previous.get("inventory") == stock
                    and previous.get("kind") == failure_kind
                    and (not unopened or _same_open_state(previous.get("failed_open_state"), measured["after"]))
                    and previous.get("original_event", {}).get("run") == reference["run"])
            if len(self.rows) >= 16 and key not in self.rows:
                self.rows.pop(next(iter(self.rows)))
            self.rows[key] = {"scope": scope, "epoch": epoch, "at": now, "dimension": measured["dimension"],
                              "inventory": copy.deepcopy(stock), "count": previous.get("count", 0) + 1 if same else 1,
                              "kind": failure_kind,
                              "failed_open_state": copy.deepcopy(measured["after"]) if unopened else None,
                              "container_at": copy.deepcopy(opened["at"]), "step": copy.deepcopy(step),
                              "original_event": dict(reference), "execution_id": execution["id"]}

    def repeated(self, arguments, facts, scope, epoch):
        current = facts.get("observation") or {}
        for key, index, _, _ in _candidates(arguments):
            row = self.rows.get(key)
            if (not row or row["scope"] != scope or row["epoch"] != epoch or row["count"] < 2
                    or time.monotonic() - row["at"] >= 120 or current.get("dimension") != row["dimension"]
                    or facts.get("run") != row["original_event"]["run"]
                    or not _inventory(current.get("inventory")) or current["inventory"] != row["inventory"]):
                continue
            if row["kind"] == "unopened_container":
                p = current.get("position")
                position = [p.get(k) for k in ("x", "y", "z")] if isinstance(p, dict) else None
                if not _vector(position) or math.dist(position, row["failed_open_state"]["position"]) > .05:
                    continue
            return {"kind": row["kind"], "attempts": row["count"], "step_index": index + 1,
                    "container_at": copy.deepcopy(row["container_at"]), "step": copy.deepcopy(row["step"]),
                    "original_event": dict(row["original_event"]), "execution_id": row["execution_id"],
                    "fresh": False, "coverage": "client-visible-only", "goal_verified": False}
        return None
