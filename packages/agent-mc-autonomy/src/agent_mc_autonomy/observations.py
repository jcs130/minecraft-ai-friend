"""Deterministic spatial receipt previews; full originals stay queryable."""

import json
import re
from collections import Counter


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
    if isinstance(result.get("text"), str):
        result["text"] = native_text_preview(result["text"])
    return result


def native_text_preview(text):
    """Keep native menu contents ahead of redundant empty slots and item metadata.

    This is a planner-only projection. Original component bytes stay in snbt and
    the untouched receipt archive; no inferred ownership or game result is added.
    """
    try:
        root = json.loads(text)
    except (ValueError, TypeError):
        return text
    if not isinstance(root, dict) or not root.get("bodyId") or not (
            root.get("authority") == "client_observed" or isinstance(root.get("state"), dict) and "windowId" in root["state"]):
        return text

    def project(value):
        if isinstance(value, list):
            return [project(child) for child in value]
        if not isinstance(value, dict):
            return value
        if isinstance(value.get("snbt"), str) and isinstance(value.get("id"), str) and isinstance(value.get("count"), int):
            return {k: value[k] for k in ("slot", "id", "name", "displayName", "count", "damage", "maxDamage", "snbt") if k in value}
        if "windowId" in value and isinstance(value.get("slots"), list) and all(isinstance(row, dict) and "item" in row for row in value["slots"]):
            menu = {k: project(v) for k, v in value.items() if k != "slots"}
            menu["slots"] = [project(row) for row in value["slots"] if row.get("item") is not None or row.get("owner") != "player"]
            menu["emptyPlayerSlots"] = [row["slot"] for row in value["slots"] if row.get("item") is None and row.get("owner") == "player"]
            menu["slotProjection"] = "Nonempty slots and all container slots shown; empty player slots listed by exact slot id."
            return menu
        return {k: v if k == "nativeJson" else project(v) for k, v in value.items()}

    return json.dumps(project(root), ensure_ascii=False, separators=(",", ":"))


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
