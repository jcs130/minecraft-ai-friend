"""Net motion from known native control receipts, never goal verification."""
import math

from .effects import _inventory, _vector, validated_effect

MOVEMENT_KEYS = frozenset({"forward", "back", "left", "right", "jump", "sprint", "sneak"})


def control_motion_view(value):
    """Validate public geometry without treating a deliberate loop as failure."""
    if (not isinstance(value, dict) or value.get("schema") != "agent-mc-control-motion/v1"
            or value.get("coverage") != "client-visible-only" or value.get("goal_verified") is not False
            or not isinstance(value.get("dimension"), str) or not 1 <= len(value["dimension"]) <= 120
            or type(value.get("steps")) is not int or not 2 <= value["steps"] <= 64
            or type(value.get("moving_steps")) is not int or not 0 <= value["moving_steps"] <= value["steps"]
            or not _vector(value.get("origin")) or not _vector(value.get("destination"))
            or type(value.get("net_distance")) not in {int, float} or not math.isfinite(value["net_distance"])
            or any(type(value.get(key)) is not bool for key in
                   ("position_changed", "returns_to_start", "other_effects_observed"))):
        return None
    distance = math.dist(value["origin"], value["destination"])
    if (abs(value["net_distance"] - distance) > 1e-7
            or value["position_changed"] != (distance > .05)
            or value["returns_to_start"] != (distance <= .05 and value["moving_steps"] > 0)):
        return None
    return {key: list(value[key]) if key in {"origin", "destination"} else value[key] for key in (
        "schema", "dimension", "steps", "moving_steps", "origin", "destination", "net_distance",
        "position_changed", "returns_to_start", "other_effects_observed", "coverage", "goal_verified")}


def derive_control_motion(arguments, execution):
    """Recompute known, contiguous control samples; never block or certify a goal."""
    steps = arguments.get("steps") if isinstance(arguments, dict) else None
    if (not isinstance(steps, list) or not 2 <= len(steps) <= 64
            or any(not isinstance(step, dict) or step.get("skill") != "control"
                   or step.get("mode", "ground") not in ("ground", "flight")
                   or not isinstance(step.get("keys"), list) or not 1 <= len(step["keys"]) <= 8
                   or any(not isinstance(key, str) or key not in MOVEMENT_KEYS for key in step["keys"])
                   for step in steps)
            or not isinstance(execution, dict) or execution.get("terminal") is not True
            or execution.get("kind") != "task" or execution.get("phase") != "completed"):
        return None
    evidence = execution.get("evidence")
    raw = evidence.get("steps") if isinstance(evidence, dict) else None
    if not isinstance(raw, list) or len(raw) != len(steps):
        return None
    effects = []
    for index, row in enumerate(raw):
        if (not isinstance(row, dict) or type(row.get("step")) is not int
                or row["step"] != index + 1 or row.get("outcome") != "ok"):
            return None
        effect = validated_effect(row.get("observedEffect"))
        if (not effect or effect["skill"] != "control" or effect["at"] is not None
                or effect["status"] == "unknown" or effect["changed"]["window"] is None
                or any(not _vector(sample.get("position")) or not _inventory(sample.get("inventory"))
                       for sample in (effect["before"], effect["after"]))):
            return None
        if effects:
            previous = effects[-1]
            before, after = effect["before"], previous["after"]
            if (effect["dimension"] != previous["dimension"]
                    or math.dist(before["position"], after["position"]) > .05
                    or before["inventory"] != after["inventory"] or before.get("window") != after.get("window")):
                return None
        effects.append(effect)
    origin, destination = effects[0]["before"]["position"], effects[-1]["after"]["position"]
    distance = math.dist(origin, destination)
    moving = sum(effect["changed"]["position"] is True for effect in effects)
    return control_motion_view({"schema": "agent-mc-control-motion/v1", "dimension": effects[0]["dimension"],
        "steps": len(steps), "moving_steps": moving, "origin": origin, "destination": destination,
        "net_distance": distance, "position_changed": distance > .05,
        "returns_to_start": distance <= .05 and moving > 0,
        "other_effects_observed": any(effect["changed"][key] is True for effect in effects
                                      for key in ("inventory", "window", "target")),
        "coverage": "client-visible-only", "goal_verified": False})
