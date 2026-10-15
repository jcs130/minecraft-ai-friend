"""Deterministic spatial receipt previews; full originals stay queryable."""

import hashlib
import json
import re
from collections import Counter


def runtime_error_code(error):
    """Only explicitly supported controller causes may escape exception text."""
    code = str(error).split(":", 1)[0]
    return code if code in {"outcome_unknown", "context_budget_exceeded", "connection_lost"} else type(error).__name__


def _bounded(value, size):
    raw = str(value or "").encode("utf-8")
    return raw.decode() if len(raw) <= size else raw[:size - 3].decode("utf-8", errors="ignore") + "…"


def event_reference(value):
    if not isinstance(value, dict):
        return {}
    return {key: _bounded(value[key], 160) if isinstance(value[key], str) else value[key]
            for key in ("run", "cursor", "ts") if isinstance(value.get(key), str) or type(value.get(key)) is int}


def body_event_view(value):
    """Project authoritative body lifecycle; never infer a stall from position."""
    if not isinstance(value, dict) or value.get("type") != "minecraft.body":
        return None
    text = _bounded(value.get("text"), 400)
    phase = value.get("phase") or (value.get("meta") or {}).get("phase")
    if not phase:
        phase = "inhibited" if text.startswith("[身体受限]") else "recovered" if text.startswith("[身体恢复]") else "observed"
    if phase not in {"inhibited", "recovered", "stalled", "observed"}:
        phase = "observed"
    reference = event_reference(value.get("original_event", value))
    identity = value.get("id") or ([reference.get("run"), reference["cursor"]] if "cursor" in reference else [phase, text])
    return {"id": _bounded(identity, 240), "type": "minecraft.body", "phase": phase, "text": text,
            "sampled_at": _bounded(value.get("sampled_at", reference.get("ts")), 80), "original_event": reference}


def native_outcome_view(value):
    if not isinstance(value, dict) or not isinstance(value.get("execution_id"), str):
        return None
    return {"tool": _bounded(value.get("tool"), 80), "execution_id": _bounded(value["execution_id"], 160),
            "phase": _bounded(value.get("phase"), 40), "observation_only": value.get("observation_only") is True,
            "goal_verified": False, "receipt": _bounded(value.get("receipt"), 450),
            "original_event": event_reference(value.get("original_event"))}


def body_feedback(snapshot, facts):
    """Small public evidence shared by review and commentary, excluding private args."""
    def project(rows, projector, key):
        selected = {}
        for row in rows[-64:] if isinstance(rows, list) else []:
            value = projector(row)
            if value:
                selected[value[key]] = value
        return list(selected.values())[-6:]
    return {"bodyRestriction": _bounded(facts.get("bodyRestriction"), 400),
            "body_events": project(snapshot.get("body_events"), body_event_view, "id"),
            "native_outcomes": project(snapshot.get("native_outcomes"), native_outcome_view, "execution_id")}


def feedback_signal(feedback):
    """Exclude sample timestamps and older ring churn from change detection."""
    body = feedback["body_events"][-1:]
    outcomes = [row for row in feedback["native_outcomes"] if not row["observation_only"]][-1:]
    selected = [feedback["bodyRestriction"], [(row["id"], row["phase"], row["text"]) for row in body],
                [(row["execution_id"], row["phase"], row["receipt"]) for row in outcomes]]
    return hashlib.sha256(json.dumps(selected, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def tool_failure_view(value):
    """A bounded unresolved error for host reviews, with an original journal reference."""
    if not isinstance(value, dict) or not isinstance(value.get("error"), str):
        return None

    def brief(text, limit):
        raw = str(text).encode("utf-8")
        return raw.decode() if len(raw) <= limit else raw[:limit - 3].decode("utf-8", errors="ignore") + "…"

    receipt = value.get("receipt") if isinstance(value.get("receipt"), dict) else {}
    return {"tool": brief(value.get("tool", ""), 80), "error": brief(value["error"], 900),
            "next_step": brief(value.get("next_step", ""), 400),
            **({"native_execution": {key: brief(value["native_execution"].get(key, ""), 160)
                                      for key in ("kind", "id", "phase")},
                "native_event": event_reference(value.get("native_event"))}
               if isinstance(value.get("native_execution"), dict) else {}),
            "receipt": {key: brief(receipt[key], 256) if isinstance(receipt.get(key), str) else None
                        for key in ("request_id", "turn_id", "archive")}}


def receipt_view(value):
    """Remove transport-only fields and exact repeats from the planner's copy."""
    result = {k: v for k, v in value.items() if k not in {"protocol", "control"}
              and not (k in {"events", "blobs"} and not v)}
    execution = value.get("execution")
    if isinstance(execution, dict) and isinstance(execution.get("evidence"), dict):
        evidence = execution["evidence"]
        if isinstance(value.get("text"), str) and evidence.get("receipt") == value["text"]:
            result["execution"] = {**execution, "evidence": {k: v for k, v in evidence.items() if k != "receipt"}}
    return result


def spatial_summary(value):
    result = {k: value[k] for k in ("source", "observedAt", "dimension", "kind", "bounds", "unknownCells") if k in value}
    result["feet"] = value.get("frame", {}).get("feet")
    result["detail"] = "Summary of observed samples only; query original for collision geometry and omitted samples."
    if value.get("kind") == "voxels":
        bounds, cells, palette = value.get("bounds"), value.get("cells"), value.get("palette")
        if (value.get("order") != "y,z,x; x fastest" or not isinstance(bounds, list) or len(bounds) != 6
                or not all(type(n) is int for n in bounds) or not isinstance(cells, list) or not isinstance(palette, list)):
            return None
        dx, dy, dz = (bounds[i + 3] - bounds[i] + 1 for i in range(3))
        if min(dx, dy, dz) <= 0 or len(cells) != dx * dy * dz or len(cells) > 512:
            return None
        counts, samples = Counter(), {}
        for index, cell in enumerate(cells):
            if type(cell) is not int or not 0 <= cell < len(palette):
                continue
            block = palette[cell]
            if not isinstance(block, dict) or not isinstance(block.get("name"), str):
                return None
            name = block["name"]
            counts[name] += 1
            if not block.get("air"):
                at = [bounds[0] + index % dx, bounds[1] + index // (dx * dz), bounds[2] + index // dx % dz]
                samples.setdefault(name, []).append(at)
        feet = result["feet"]
        if isinstance(feet, list) and len(feet) == 3 and all(isinstance(n, (int, float)) for n in feet):
            for positions in samples.values():
                positions.sort(key=lambda p: sum((p[i] - feet[i]) ** 2 for i in range(3)))
        result["materials"] = [{"name": name, "count": count, **({"example_at": samples[name][0]} if name in samples else {})}
                               for name, count in sorted(counts.items())][:24]
        result["materials_omitted"] = max(0, len(counts) - 24)
        result["entities"] = value.get("entities", [])[:6]
    elif value.get("kind") == "rays" and isinstance(value.get("rays"), list):
        # Ray angles are relative to the current eye frame. Keeping the offsets
        # without that frame turns an upward scan after mining into an apparent
        # horizontal scan. Preserve the measured direction, never infer it.
        result.pop("feet", None)
        result["frame"] = {k: value.get("frame", {})[k] for k in ("feet", "eye", "yawDeg", "pitchDeg") if k in value.get("frame", {})}
        if "geometry" in value:
            result["geometry"] = value["geometry"]
        result["rays"] = []
        for ray in value["rays"][:4]:
            terrain = ray.get("terrain") or {}
            item = {k: ray[k] for k in ("pitchDeg", "yawDeg", "range", "direction", "first") if k in ray}
            item["terrain"] = {k: terrain[k] for k in ("kind", "cell", "distance") if k in terrain}
            if terrain.get("material"):
                item["terrain"]["name"] = terrain["material"].get("name")
            if ray.get("entity"):
                hit = ray["entity"]
                entity = hit.get("entity", {})
                item["entity"] = {"id": entity.get("id"), "name": entity.get("name"), "distance": hit.get("distance")}
            result["rays"].append(item)
        result["rays_omitted"] = max(0, len(value["rays"]) - 4)
    else:
        return None
    return result


def spatial_text(text):
    """Replace only recognized native observation objects inside receipt text."""
    decoder, output, cursor = json.JSONDecoder(), [], 0
    for match in re.finditer(r'\{"source"\s*:\s*"client-(?:loaded|visible)-world"', text):
        if match.start() < cursor:
            continue
        try:
            value, length = decoder.raw_decode(text[match.start():])
            summary = spatial_summary(value)
        except (ValueError, TypeError, AttributeError):
            continue
        if summary is not None:
            output.extend([text[cursor:match.start()], json.dumps(summary, ensure_ascii=False, separators=(",", ":"))])
            cursor = match.start() + length
    output.append(text[cursor:])
    return "".join(output)


def fact_preview(text, byte_limit):
    """Keep both ends of a large fact; its original handle remains authoritative."""
    raw = text.encode("utf-8")
    if len(raw) <= byte_limit:
        return text
    marker = "\n[abridged; query this fact's original for full evidence]\n"
    remaining = byte_limit - len(marker.encode("utf-8"))
    if remaining <= 0:
        return ""
    head = remaining // 3
    return raw[:head].decode("utf-8", errors="ignore") + marker + raw[-(remaining - head):].decode("utf-8", errors="ignore")
