"""Bound repeated failed withdrawals by their measured container, not the batch."""
import copy
import json
import time

from .effects import _inventory, _vector, validated_effect


def _candidates(arguments):
    steps = arguments.get("steps")
    if not isinstance(steps, list) or not 2 <= len(steps) <= 64:
        return
    for index in range(1, len(steps)):
        step, opened = steps[index], steps[index - 1]
        if (not isinstance(step, dict) or step.get("skill") != "take" or step.get("from") != "open"
                or not isinstance(opened, dict) or opened.get("skill") != "use"
                or set(opened) != {"skill", "at"} or not _vector(opened["at"])
                or any(not isinstance(prior, dict) or prior.get("skill") not in {"goto", "look"}
                       for prior in steps[:index - 1])):
            continue
        # A preceding acquisition, arbitrary interaction, relative coordinate or
        # another container is deliberately outside this conservative guard.
        key = json.dumps([opened["at"], step], sort_keys=True, ensure_ascii=False)
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
            if (take is None or use is None or take["skill"] != "take" or use["skill"] != "use"
                    or use["at"] != opened["at"] or use["dimension"] != take["dimension"]
                    or raw[index - 1].get("outcome") != "ok"
                    or not use["after"].get("window")
                    or use["after"]["window"] != take["before"].get("window")
                    or not _inventory(take["before"].get("inventory"))):
                continue
            if raw[index].get("outcome") != "fail" or take["changed"]["inventory"] is not False:
                self.rows.pop(key, None)
                continue
            stock = take["after"]["inventory"]
            previous = self.rows.get(key, {})
            same = (previous.get("scope") == scope and previous.get("epoch") == epoch
                    and previous.get("dimension") == take["dimension"] and previous.get("inventory") == stock
                    and previous.get("original_event", {}).get("run") == reference["run"])
            if len(self.rows) >= 16 and key not in self.rows:
                self.rows.pop(next(iter(self.rows)))
            self.rows[key] = {"scope": scope, "epoch": epoch, "at": now, "dimension": take["dimension"],
                              "inventory": copy.deepcopy(stock), "count": previous.get("count", 0) + 1 if same else 1,
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
            return {"kind": "failed_container_take", "attempts": row["count"], "step_index": index + 1,
                    "container_at": copy.deepcopy(row["container_at"]), "step": copy.deepcopy(row["step"]),
                    "original_event": dict(row["original_event"]), "execution_id": row["execution_id"],
                    "fresh": False, "coverage": "client-visible-only", "goal_verified": False}
        return None
