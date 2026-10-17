"""Validate native visible effects; bounded recovery never certifies a goal."""
import copy
import json
import math
import re
import time


def _vector(value):
    return isinstance(value, list) and len(value) == 3 and all(
        type(n) in {int, float} and math.isfinite(n) for n in value)


def _inventory(value):
    return isinstance(value, dict) and len(value) <= 128 and all(
        isinstance(k, str) and re.fullmatch(r"[\w:./-]{1,120}", k)
        and type(n) is int and 0 <= n <= 10**9 for k, n in value.items())


def body_changed(previous, current):
    """Fresh native facts can attest motion/stock even for older body builds."""
    before, after = previous.get("observation") or {}, current.get("observation") or {}
    if not before.get("dimension") or before.get("dimension") != after.get("dimension"):
        return False
    def position(sample):
        p = sample.get("position")
        return [p.get(k) for k in ("x", "y", "z")] if isinstance(p, dict) else None
    a, b = position(before), position(after)
    moved = _vector(a) and _vector(b) and math.dist(a, b) > .05
    stock = _inventory(before.get("inventory")) and _inventory(after.get("inventory")) and before["inventory"] != after["inventory"]
    return bool(moved or stock)


def validated_effect(value):
    """Recompute consistency from samples instead of trusting a status string."""
    if (not isinstance(value, dict) or value.get("schema") != "agent-mc-observed-effect/v1"
            or value.get("coverage") != "client-visible-only" or value.get("goalVerified") is not False
            or not isinstance(value.get("skill"), str) or not re.fullmatch(r"[a-z_]{1,50}", value["skill"])
            or not isinstance(value.get("dimension"), str) or not 1 <= len(value["dimension"]) <= 120
            or (value.get("at") is not None and not _vector(value["at"]))):
        return None
    before, after = value.get("before"), value.get("after")
    if not isinstance(before, dict) or not isinstance(after, dict):
        return None
    for sample in (before, after):
        if (sample.get("inventory") is not None and not _inventory(sample["inventory"])) or (
                sample.get("position") is not None and not _vector(sample["position"])):
            return None
        target = sample.get("target")
        if target is not None and (not isinstance(target, dict) or not isinstance(target.get("name"), str)
                or not 1 <= len(target["name"]) <= 120 or type(target.get("stateId")) is not int):
            return None
        window = sample.get("window")
        if window is not None and (not isinstance(window, dict) or type(window.get("id")) is not int
                or not isinstance(window.get("type"), str) or len(window["type"]) > 120):
            return None
    def compare(key):
        a, b = before.get(key), after.get(key)
        if key == "window":
            return a != b if key in before and key in after else None
        if a is None or b is None:
            return None
        if key == "inventory":
            return any(a.get(k, 0) != b.get(k, 0) for k in a.keys() | b.keys())
        if key == "position":
            return math.dist(a, b) > .05
        return a != b
    changed = {key: compare(key) for key in ("target", "inventory", "position", "window")}
    if value.get("at") is None:
        changed["target"] = None
    flags = [changed[k] for k in ("inventory", "position", "window")]
    if value.get("at") is not None:
        flags.append(changed["target"])
    status = "changed" if True in flags else "unknown" if None in flags else "unchanged"
    supplied = value.get("changed")
    if (not isinstance(supplied, dict) or set(supplied) != set(changed) or any(type(supplied.get(k)) not in {bool, type(None)}
            or supplied.get(k) != n for k, n in changed.items()) or status != value.get("status")):
        return None
    return {"skill": value["skill"], "dimension": value["dimension"], "at": value.get("at"),
            "changed": changed, "status": status, "before": before, "after": after}


def effect_view(value):
    effect = validated_effect(value)
    if effect is None:
        return None
    return {key: effect[key] for key in ("skill", "dimension", "at", "status", "changed")} | {
        "coverage": "client-visible-only", "goal_verified": False}


def projected_effect(value):
    """Revalidate the small public shape without inventing missing samples."""
    if (not isinstance(value, dict) or value.get("coverage") != "client-visible-only"
            or value.get("goal_verified") is not False or value.get("status") not in {"changed", "unchanged", "unknown"}
            or not isinstance(value.get("skill"), str) or not re.fullmatch(r"[a-z_]{1,50}", value["skill"])
            or not isinstance(value.get("dimension"), str) or not 1 <= len(value["dimension"]) <= 120
            or (value.get("at") is not None and not _vector(value["at"]))):
        return None
    changed = value.get("changed")
    if not isinstance(changed, dict) or set(changed) != {"target", "inventory", "position", "window"} or any(
            type(v) not in {bool, type(None)} for v in changed.values()):
        return None
    flags = [changed[k] for k in ("inventory", "position", "window")]
    if value.get("at") is not None:
        flags.append(changed["target"])
    status = "changed" if True in flags else "unknown" if None in flags else "unchanged"
    if status != value["status"]:
        return None
    return {k: copy.deepcopy(value[k]) for k in
            ("skill", "dimension", "at", "status", "changed", "coverage", "goal_verified")}


class EffectRecovery:
    """At most 16 dated exact-plan failures; no body action or automatic replay."""
    def __init__(self):
        self.rows = {}

    @staticmethod
    def key(arguments):
        steps = arguments.get("steps")
        return json.dumps(steps, sort_keys=True, ensure_ascii=False) if isinstance(steps, list) and steps else None

    def record(self, arguments, execution, scope, epoch, reference):
        evidence = execution.get("evidence")
        raw = evidence.get("steps") if isinstance(evidence, dict) else None
        steps = arguments.get("steps")
        if not isinstance(raw, list) or not isinstance(steps, list) or len(raw) != len(steps) or not 1 <= len(steps) <= 64:
            return False
        effects = []
        for i, row in enumerate(raw):
            if not isinstance(row, dict) or type(row.get("step")) is not int or row["step"] != i + 1:
                return False
            effect = validated_effect(row.get("observedEffect"))
            if effect is None or not isinstance(steps[i], dict) or effect["skill"] != steps[i].get("skill"):
                return False
            effects.append(effect)
        if any(e["status"] == "changed" for e in effects):
            self.rows.clear()
            return True
        if (scope is None or execution.get("phase") not in {"blocked", "completed", "partial"}
                or any(e["status"] != "unchanged" for e in effects)
                or any(row.get("outcome") not in {"fail", "noop"} for row in raw)):
            return False
        key = self.key(arguments)
        previous = self.rows.get(key, {})
        def state(effect):
            return {"dimension": effect.get("dimension"), "at": effect.get("at"),
                    "after": {k: v for k, v in effect.get("after", {}).items() if k != "at"}}
        same = (previous.get("scope") == scope and previous.get("epoch") == epoch
                and time.monotonic() - previous.get("at", 0) < 120
                and state(previous.get("effect", {})) == state(effects[-1]))
        if len(self.rows) >= 16 and key not in self.rows:
            self.rows.pop(next(iter(self.rows)))
        self.rows[key] = {"scope": scope, "epoch": epoch, "at": time.monotonic(),
            "count": previous.get("count", 0) + 1 if same else 1, "effect": copy.deepcopy(effects[-1]),
            "original_event": dict(reference), "execution_id": execution["id"]}
        return False

    def repeated(self, arguments, facts, scope, epoch):
        row = self.rows.get(self.key(arguments))
        if (not row or row["scope"] != scope or row["epoch"] != epoch or row["count"] < 2
                or time.monotonic() - row["at"] >= 120):
            return None
        current = facts.get("observation") or {}
        after = row["effect"]["after"]
        p = current.get("position")
        position = [p.get(k) for k in ("x", "y", "z")] if isinstance(p, dict) else None
        if (current.get("dimension") != row["effect"]["dimension"] or not _vector(position)
                or not _vector(after.get("position")) or math.dist(position, after["position"]) > .05
                or not _inventory(current.get("inventory")) or current["inventory"] != after.get("inventory")):
            return None
        return {"attempts": row["count"], "execution_id": row["execution_id"],
                "original_event": row["original_event"], "goal_verified": False,
                "effect": {k: row["effect"][k] for k in ("skill", "dimension", "at", "status", "changed")},
                "fresh": False, "coverage": "client-visible-only"}
