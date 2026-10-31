"""Deterministic spatial receipt previews; full originals stay queryable."""

import hashlib
import json
import re
from collections import Counter

from .effects import effect_view, projected_effect
from .chat_noop import chat_noop_view
from .control_motion import control_motion_view


def runtime_error_code(error):
    """Only explicitly supported controller causes may escape exception text."""
    code = str(error).split(":", 1)[0]
    return code if code in {"outcome_unknown", "context_budget_exceeded", "connection_lost"} else type(error).__name__


def _bounded(value, size):
    text = str(value or "")
    raw = text[:size].encode("utf-8")
    return raw.decode() if len(text) <= size and len(raw) <= size else raw[:size - 3].decode("utf-8", errors="ignore") + "…"


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


REPEAT_GUIDANCE = ("Historical native attempt samples only. completed means the action ended, not that stock or a goal was obtained. "
                   "unchanged covers only the core's compared position, inventory and, for target scope, block readings; "
                   "unknown does not establish no change. Use current prerequisites and original receipts to choose the next action. "
                   "This evidence does not authorize replay, cancellation or goal changes.")


def repeat_evidence_view(value):
    """Validate the core's typed attempt metadata without inferring from prose."""
    if (not isinstance(value, dict) or type(value.get("taskId")) is not int or not 0 <= value["taskId"] <= 2**53 - 1
            or type(value.get("attempts")) is not int or not 3 <= value["attempts"] <= 2**53 - 1
            or not isinstance(value.get("scope"), str) or not isinstance(value.get("observation"), str)
            or value.get("scope") not in {"target", "shape"}
            or value.get("observation") not in {"unchanged", "changed", "unknown"}):
        return None
    return {key: value[key] for key in ("taskId", "attempts", "scope", "observation")}


def terminal_repeat_evidence(event):
    """Only the matching original task terminal can attest these samples."""
    execution = event.get("execution") or {}
    evidence = repeat_evidence_view((event.get("meta") or {}).get("repeatFailure"))
    if (not evidence or execution.get("kind") != "task" or execution.get("terminal") is not True
            or execution.get("phase") not in {"completed", "partial", "blocked"}
            or not isinstance(execution.get("id"), str)
            or not execution["id"].endswith(":" + str(evidence["taskId"]))):
        return None
    return evidence


def native_outcome_view(value):
    if (not isinstance(value, dict) or not isinstance(value.get("execution_id"), str)
            or value.get("terminal") is False):
        return None
    observations = spatial_observations(value.get("receipt", "")) if "observations" not in value else value["observations"]
    repeat = repeat_evidence_view(value.get("repeat_evidence"))
    chat_noop = chat_noop_view(value.get("chat_noop_review"))
    control_motion = control_motion_view(value.get("control_motion"))
    return {"tool": _bounded(value.get("tool"), 80), "execution_id": _bounded(value["execution_id"], 160),
            **({"execution_kind": _bounded(value["execution_kind"], 40)} if isinstance(value.get("execution_kind"), str) else {}),
            "phase": _bounded(value.get("phase"), 40), "observation_only": value.get("observation_only") is True,
            "terminal": value.get("terminal") if type(value.get("terminal")) is bool else None,
            "goalCompleted": value.get("goalCompleted") if type(value.get("goalCompleted")) is bool else None,
            "goal_verified": False, "receipt": _bounded(value.get("receipt"), 450),
            **({"observations": observations,
                "observation_guidance": "Observed samples only. An unknown cell is occluded or unloaded, not air or safe ground. Repeating the same scan from the same place cannot establish missing support; change viewpoint/method or choose feasible local work."}
               if isinstance(observations, list) and observations else {}),
            **({"step_outcomes": step_outcomes_view(value["step_outcomes"])} if "step_outcomes" in value else {}),
            **({"repeat_evidence": repeat, "repeat_guidance": REPEAT_GUIDANCE} if repeat else {}),
            **({"chat_noop_review": chat_noop} if chat_noop else {}),
            **({"control_motion": control_motion} if control_motion else {}),
            "original_event": event_reference(value.get("original_event"))}


STEP_OUTCOMES = ("ok", "noop", "partial", "fail", "skip", "cut")
OUTCOME_PRECEDENCE = ("Newest native terminal outcomes take precedence over earlier accepted previews. "
                      "A blocked batch can contain successful steps; ok alone does not verify a goal. "
                      "Use current confirmed stock and query originals for omitted evidence.")
OUTCOME_QUERY = "mc_protocol(action=archive,run=original_event.run,after=original_event.cursor-1)"


def terminal_step_outcomes(execution, arguments):
    """Validate before text truncation; retain both outcome groups in bounded memory.

    Duplicate indices are ambiguous, including contradictory results: discard all
    entries at that index. Native outcomes never imply objective verification.
    The 10,000-index validation ceiling bounds scratch memory for malformed input;
    everything beyond it is explicitly counted as invalid and remains queryable.
    """
    evidence = execution.get("evidence")
    raw = evidence.get("steps") if isinstance(evidence, dict) else None
    submitted = arguments.get("steps") if isinstance(arguments, dict) else None
    ceiling = min(len(submitted), 10000) if isinstance(submitted, list) else 10000
    counts = dict.fromkeys(STEP_OUTCOMES, 0)
    result = {"status": "unknown", "total": len(raw) if isinstance(raw, list) else None,
              "valid": 0, "invalid": 0, "counts": counts, "samples": [], "omitted": 0,
              "mixed": False, "query": OUTCOME_QUERY}
    if not isinstance(raw, list):
        return result
    indices = Counter(row["step"] for row in raw if isinstance(row, dict)
                      and type(row.get("step")) is int and 1 <= row["step"] <= ceiling)
    groups = {outcome: [] for outcome in STEP_OUTCOMES}
    small = []
    for row in raw:
        if (not isinstance(row, dict) or type(row.get("step")) is not int
                or not 1 <= row["step"] <= ceiling or indices[row["step"]] != 1
                or not isinstance(row.get("outcome"), str) or row["outcome"] not in counts
                or (row.get("why") is not None and not isinstance(row["why"], str))):
            result["invalid"] += 1
            continue
        outcome = row["outcome"]
        counts[outcome] += 1
        # First and latest sample per outcome; reasons are bounded UTF-8 bytes.
        sample = {"step": row["step"], "outcome": outcome,
                  **({"why": _bounded(row["why"], 120) if row["why"] is not None else None} if "why" in row else {})}
        effect = effect_view(row.get("observedEffect"))
        if effect:
            sample["observed_effect"] = effect
        if len(small) < 8:
            small.append(sample)
        if len(groups[outcome]) < 2:
            groups[outcome].append(sample)
        else:
            groups[outcome][-1] = sample
    result["valid"] = sum(counts.values())
    # Round-robin prevents early failures or successes from hiding other groups.
    samples = small if result["valid"] <= 8 else [group[i] for i in range(2) for group in groups.values() if len(group) > i][:8]
    result["samples"] = sorted(samples,
                               key=lambda row: row["step"])
    result["omitted"] = result["valid"] - len(result["samples"])
    result["mixed"] = bool(counts["ok"] and result["valid"] > counts["ok"])
    if result["valid"]:
        result["status"] = "partial" if result["invalid"] else "available"
    return result


def step_outcomes_view(value):
    """Revalidate the bounded canonical projection when reading persisted status."""
    unknown = terminal_step_outcomes({}, {})
    if not isinstance(value, dict):
        return unknown
    counts = value.get("counts")
    samples = value.get("samples")
    if (not isinstance(counts, dict) or not isinstance(samples, list) or len(samples) > 8
            or any(type(counts.get(key)) is not int or not 0 <= counts[key] <= 10**9 for key in STEP_OUTCOMES)
            or any(type(value.get(key)) is not int or not 0 <= value[key] <= 10**9 for key in ("valid", "invalid", "omitted"))
            or sum(counts[key] for key in STEP_OUTCOMES) != value["valid"]
            or value["omitted"] != value["valid"] - len(samples)
            or (value.get("total") is not None and (type(value["total"]) is not int
                or value["total"] != value["valid"] + value["invalid"]))):
        return unknown
    projected, seen = [], set()
    for row in samples:
        if (not isinstance(row, dict) or type(row.get("step")) is not int or not 1 <= row["step"] <= 10000
                or row["step"] in seen or not isinstance(row.get("outcome"), str) or row["outcome"] not in STEP_OUTCOMES
                or (row.get("why") is not None and not isinstance(row["why"], str))):
            return unknown
        seen.add(row["step"])
        projected.append({"step": row["step"], "outcome": row["outcome"],
                          **({"why": _bounded(row["why"], 120) if row["why"] is not None else None} if "why" in row else {})})
        effect = projected_effect(row.get("observed_effect"))
        if effect:
            projected[-1]["observed_effect"] = effect
    if any(sum(row["outcome"] == key for row in projected) > counts[key] for key in STEP_OUTCOMES):
        return unknown
    return {"status": ("partial" if value["invalid"] else "available") if value["valid"] else "unknown",
            "total": value.get("total"), **{key: value[key] for key in ("valid", "invalid", "omitted")},
            "counts": {key: counts[key] for key in STEP_OUTCOMES}, "samples": projected,
            "mixed": bool(counts["ok"] and value["valid"] > counts["ok"]), "query": OUTCOME_QUERY}


def native_outcome_summary(row):
    steps = row.get("step_outcomes") or {}
    counts = steps.get("counts") or {}
    text = "原生任务" + row["execution_id"] + "终态" + row["phase"]
    if steps.get("status") in {"available", "partial"}:
        text += "；步骤结果:" + ",".join(f"{key}={counts[key]}" for key in STEP_OUTCOMES if counts.get(key))
        if steps.get("mixed"):
            text += "（成功与未成功并存）"
    else:
        text += "；步骤结果未知"
    return text + "；ok不等于目标核验"


def body_feedback(snapshot, facts):
    """Small public evidence shared by review and commentary, excluding private args."""
    def project(rows, projector, key):
        selected = {}
        for row in rows[-64:] if isinstance(rows, list) else []:
            value = projector(row)
            if value:
                selected[value[key]] = value
        return list(selected.values())[-6:]
    return {"bodyRestriction": _bounded(facts.get("bodyRestriction"), 400), "outcome_precedence": OUTCOME_PRECEDENCE,
            "body_events": project(snapshot.get("body_events"), body_event_view, "id"),
            "native_outcomes": project(snapshot.get("native_outcomes"), native_outcome_view, "execution_id")}


def feedback_signal(feedback):
    """Exclude sample timestamps and older ring churn from change detection."""
    body = feedback["body_events"][-1:]
    outcomes = [row for row in feedback["native_outcomes"] if not row["observation_only"]][-1:]
    selected = [feedback["bodyRestriction"], [(row["id"], row["phase"], row["text"]) for row in body],
                [(row["execution_id"], row["phase"], row["receipt"], row.get("step_outcomes"), row.get("repeat_evidence")) for row in outcomes]]
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
            **({"argument_correction": {"attempts": value["argument_correction"]["attempts"],
                                         "action_dispatched": False}}
               if isinstance(value.get("argument_correction"), dict)
               and type(value["argument_correction"].get("attempts")) is int else {}),
            **({"step_outcomes": step_outcomes_view(value["step_outcomes"])} if "step_outcomes" in value else {}),
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
    if "readout" in value:
        readout = value["readout"]
        if (not isinstance(readout, dict) or readout.get("protocol") != "agent-mc-spatial-read/v1"
                or readout.get("historical") is not False or readout.get("kind") != value.get("kind")
                or any(not isinstance(readout.get(k), str) or not re.fullmatch(r"[0-9a-f]{64}", readout[k])
                       for k in ("selection", "revision"))
                or any(readout.get(k) is not None and type(readout[k]) is not bool
                       for k in ("scanComplete", "knownComplete", "retryable"))
                or type(readout.get("continuationAvailable")) is not bool
                or any(readout.get(k) is not None and (type(readout[k]) is not int or not 0 <= readout[k] <= 2**53 - 1)
                       for k in ("remainingCount", "unknownCount"))
                or readout.get("unknownUnit") not in {None, "cells", "sites"}
                or len(json.dumps(readout, ensure_ascii=False).encode("utf-8")) > 2400):
            return None
        # These are producer-owned coverage facts, not a host decision that the
        # scene is safe or that a native action/whole goal remains pending.
        result["readout"] = readout
    if value.get("kind") == "voxels" and value.get("format") == "visible":
        blocks, palette, coverage = value.get("blocks"), value.get("palette"), value.get("coverage")
        if (value.get("coordinate_system") != "absolute_block" or not isinstance(blocks, list)
                or len(blocks) > 512 or not isinstance(palette, list) or len(palette) > 512
                or not isinstance(coverage, dict) or len(json.dumps(coverage).encode("utf-8")) > 3500):
            return None
        counts, samples = Counter(), {}
        for block in blocks:
            if (not isinstance(block, list) or len(block) != 4 or any(type(n) is not int for n in block)
                    or not 0 <= block[3] < len(palette)):
                return None
            material = palette[block[3]]
            if not isinstance(material, dict) or not isinstance(material.get("name"), str):
                return None
            name = material["name"]
            counts[name] += 1
            samples.setdefault(name, []).append(block[:3])
        feet = result["feet"]
        if isinstance(feet, list) and len(feet) == 3 and all(type(n) in {int, float} for n in feet):
            for positions in samples.values():
                positions.sort(key=lambda p: sum((p[i] - feet[i]) ** 2 for i in range(3)))
        result.update(format="visible", coordinate_system="absolute_block", coverage=coverage,
                      materials=[{"name": name, "count": count, "example_at": samples[name][0]}
                                 for name, count in sorted(counts.items())[:24]],
                      materials_omitted=max(0, len(counts) - 24))
        result["frame"] = {k: value["frame"][k] for k in ("feet", "eye", "yawDeg", "pitchDeg") if k in value.get("frame", {})}
        for key in ("requested_bounds", "next_safe_read"):
            if key in value:
                result[key] = value[key]
        result["detail"] = ("Returned visible surface samples only; counts are not all blocks/resources in the area. "
                            "Hidden/unloaded cells are not expanded into air or a safe route. Query the original for geometry.")
    elif value.get("kind") == "voxels":
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
    elif "readout" in result and value.get("kind") == "sites" and isinstance(value.get("sites"), list):
        result["sites"] = [{key: row[key] for key in ("at", "target", "below", "body") if key in row}
                           for row in value["sites"][:8] if isinstance(row, dict)]
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


def _spatial_objects(text):
    """Find native JSON objects without treating object key order as a schema.

    Current cores prefix the source with a machine readout. Decoding complete
    objects also avoids scanning their quoted JSON strings as fresh evidence.
    Unknown/malformed objects are left verbatim by both consumers below.
    """
    decoder, cursor, attempts = json.JSONDecoder(), 0, 0
    while attempts < 512:
        start = text.find("{", cursor)
        if start < 0:
            return
        attempts += 1
        try:
            value, length = decoder.raw_decode(text[start:])
        except ValueError:
            cursor = start + 1
            continue
        end = start + length
        if isinstance(value, dict) and value.get("source") in {"client-loaded-world", "client-visible-world"}:
            yield start, end, value
            cursor = end
        else:
            # A non-spatial wrapper can contain a real observation, but JSON
            # strings escape their quotes and cannot decode as nested objects.
            cursor = start + 1


def spatial_observations(text):
    """Keep each measured result before a terminal receipt's header is truncated."""
    if not isinstance(text, str):
        return []
    results = []
    for _, _, value in _spatial_objects(text):
        try:
            summary = spatial_summary(value)
        except (ValueError, TypeError, AttributeError):
            continue
        if summary is not None:
            # All spatial coordinates here are the native absolute result, never
            # the request's foot-relative bounds. Full geometry stays archived.
            results.append({key: summary[key] for key in (
                "kind", "bounds", "unknownCells", "feet", "frame", "materials", "rays", "observedAt",
                "format", "coordinate_system", "requested_bounds", "coverage", "readout", "next_safe_read", "sites") if key in summary})
        elif "readout" not in value and value.get("kind") == "sites" and isinstance(value.get("sites"), list):
            results.append({"kind": "sites", "observedAt": value.get("observedAt"),
                "sites": [{key: row[key] for key in ("at", "target", "below", "body") if key in row}
                          for row in value["sites"][:8] if isinstance(row, dict)]})
        if len(results) == 8:
            break
    # Avoid turning malformed or future large receipts into unbounded context.
    return results if len(json.dumps(results, ensure_ascii=False).encode("utf-8")) <= 6000 else []


def spatial_text(text):
    """Replace only recognized native observation objects inside receipt text."""
    output, cursor = [], 0
    for start, end, value in _spatial_objects(text):
        try:
            summary = spatial_summary(value)
        except (ValueError, TypeError, AttributeError):
            continue
        if summary is not None:
            output.extend([text[cursor:start], json.dumps(summary, ensure_ascii=False, separators=(",", ":"))])
            cursor = end
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
