"""Optional MIT helpers for explicitly selected Minescript 4.0 programs.

Install this file in the game's minescript directory. Importing it does not read
the game, hold inputs, start jobs, access the network or run an agent/model loop.
"""
import math
import time
from datetime import datetime, timezone

__all__ = ["help", "sample_blocks", "scan_blocks", "scan_nearby", "wait", "interact_block"]


def help(topic="index"):
    """Return structured documentation, unlike Python's print-only builtin help()."""
    pages = {
        "scan_blocks": {"signature": "scan_blocks(minimum, maximum, names=[], limit=32)",
            "example": {"minimum": [-414, 120, -483], "maximum": [-398, 130, -467], "names": ["minecraft:stone"], "limit": 32},
            "bounds": "inclusive absolute integer [x,y,z] vectors; volume=(maxX-minX+1)*(maxY-minY+1)*(maxZ-minZ+1)<=4096; limit 1..64",
            "returns": "checked,count,matches,truncated,unknownCount,minimum,maximum,startedAt,sampledAt,source,serverConfirmed",
            "match": {"position": [-414, 120, -483], "name": "minecraft:stone", "properties": {}, "raw": "minecraft:stone", "observation": "client_cache"},
            "note": "Read match['position'][1] for y, not match.get('y'). This is not a heightmap or a reachability/collision test."},
        "scan_nearby": {"signature": "scan_nearby(radius=6, below=2, above=2, names=[], limit=32)",
            "bounds": "(2*radius+1)^2*(below+above+1)<=4096; radius/below/above integers 0..16; limit 1..64",
            "example": {"radius": 6, "below": 2, "above": 2, "names": ["minecraft:carrots", "minecraft:wheat"], "limit": 12},
            "returns": "Same as scan_blocks; centered on floor(current player position). View rotation does not change the scan center."},
        "sample_blocks": {"signature": "sample_blocks(positions)", "example": {"positions": [[-406, 120, -475], [-406, 121, -475]]},
            "bounds": "1..512 absolute integer [x,y,z] vectors", "returns": "blocks,checked,startedAt,sampledAt,source,serverConfirmed; block rows use position/name/properties/raw/observation"},
        "wait": {"signature": "wait(seconds)", "bounds": "0..5 seconds; include waits and cleanup in the native script timeout and lease"},
        "interact_block": {"signature": "interact_block(position, action='attack', hold=0.3, max_distance=4.5, aim_offset=[0.5,0.5,0.5], observe_positions=[])",
            "bounds": "One absolute integer target; action attack/use; hold 0.05..2 seconds; raycast bound 0.5..8; aim offsets 0..1. Run only in an explicitly admitted leased mc_script job.",
            "example": {"position": [-566,66,-455], "action": "use", "hold": 0.15, "aim_offset": [0.5,0.9,0.5]},
            "note": "Planting targets the actual support farmland, not its empty air above. Aim is configurable for non-full blocks. The helper checks real crosshair hit and distance before input. A raycast bound does not grant server reach or permission.",
            "returns": "target,before,after,observedBefore/After for <=4 explicitly selected related positions,hit,inputDispatched,outcome,reason,observedChanged,sampledAt,serverConfirmed=false; no_observed_change is not success. It neither moves nor retries."},
    }
    if topic == "index":
        return {"api": "agent-mc-python/v1", "minescriptVersion": "4.0", "topics": list(pages), "next": "result = agent_mc.help('scan_blocks')",
                "functions": {name: page["signature"] for name, page in pages.items()},
                "limits": "scan <=4096 blocks, <=64 matches; specific sample <=512 blocks; batches <=256 positions",
                "effects": "Import/help only read local documentation. Scans read existing client cache; no chunk requests, body movement or network/model loop."}
    if topic not in pages:
        raise ValueError("Unknown helper topic. Use agent_mc.help() for the supported functions; do not guess methods.")
    return {"api": "agent-mc-python/v1", "topic": topic, **pages[topic]}


def _api():
    import minescript
    return minescript


def interact_block(position, action="attack", hold=0.3, max_distance=4.5, aim_offset=None, observe_positions=None):
    """One explicitly chosen, bounded body interaction; never pathfind or retry."""
    target = _point(position)
    if action not in ("attack", "use"):
        raise ValueError("action must be attack or use")
    for value, minimum, maximum in ((hold, 0.05, 2), (max_distance, 0.5, 8)):
        if type(value) not in (int, float) or not math.isfinite(value) or not minimum <= value <= maximum:
            raise ValueError("Invalid bounded interaction duration or raycast distance")
    offset = [0.5,0.5,0.5] if aim_offset is None else aim_offset
    if not isinstance(offset, (list,tuple)) or len(offset) != 3 or any(type(v) not in (int,float) or not math.isfinite(v) or not 0 <= v <= 1 for v in offset):
        raise ValueError("aim_offset must contain three finite 0..1 values")
    related = [] if observe_positions is None else observe_positions
    if not isinstance(related, (list,tuple)) or len(related) > 4:
        raise ValueError("observe_positions supports at most four absolute positions")
    related = [_point(point) for point in related]
    api = _api()
    report = {"target": target, "action": action, "startedAt": _stamp(), "inputDispatched": False,
              "outcome": "blocked", "observedChanged": False, "serverConfirmed": False}
    def finish(reason=None):
        if reason is not None:
            report["reason"] = reason
        report["sampledAt"] = _stamp()
        return report
    if api.screen_name():
        return finish("gui_open; inspect and close the actual screen first")
    before = _block(target, api.getblock(*target))
    report["before"] = before
    if before["observation"] != "client_cache" or before["name"] in ("minecraft:air", "minecraft:cave_air"):
        return finish("target is air or unknown; select an actual observed block")
    api.player_look_at(*[coordinate+delta for coordinate,delta in zip(target,offset)])
    api.flush()
    time.sleep(0.05)
    hit = api.player_get_targeted_block(max_distance)
    if hit is None:
        return finish("no_hit_within_bound; change position or target before retrying")
    hit_position = list(hit.position)
    distance = hit.distance
    report["hit"] = {"position": hit_position, "distance": distance, "side": hit.side, "type": hit.type}
    if hit_position != target or not isinstance(distance,(int,float)) or not math.isfinite(distance) or not 0 <= distance <= max_distance:
        return finish("target_not_hit_or_out_of_bound; inspect occlusion and change position or target")
    if related:
        report["observedBefore"] = sample_blocks(related)["blocks"]
    press = api.player_press_attack if action == "attack" else api.player_press_use
    try:
        press(True)
        report["inputDispatched"] = True
        api.flush()
        time.sleep(hold)
    finally:
        press(False)
        api.flush()
    time.sleep(0.1)
    after = _block(target, api.getblock(*target))
    report["after"] = after
    report["observedChanged"] = before["raw"] != after["raw"]
    if related:
        report["observedAfter"] = sample_blocks(related)["blocks"]
        report["observedChanged"] |= any(a["observation"] == b["observation"] == "client_cache" and a["raw"] != b["raw"]
                                         for a,b in zip(report["observedBefore"],report["observedAfter"]))
    report["outcome"] = "observed_change" if report["observedChanged"] else "no_observed_change"
    return finish(None if report["observedChanged"] else "input dispatched without observed block change; verify inventory/server notices")


def _point(value):
    if not isinstance(value, (list, tuple)) or len(value) != 3 or any(type(v) is not int for v in value):
        raise ValueError("Expected three absolute integer block coordinates")
    if abs(value[0]) > 30000000 or abs(value[2]) > 30000000 or not -2048 <= value[1] <= 2048:
        raise ValueError("Block position outside supported bounds")
    return list(value)


def _stamp():
    return datetime.now(timezone.utc).isoformat()


def _block(position, raw):
    if not isinstance(raw, str) or ":" not in raw:
        raise RuntimeError("Unexpected Minescript 4.0 block string")
    name, bracket, tail = raw.partition("[")
    props = {}
    if bracket:
        if not tail.endswith("]"):
            raise RuntimeError("Malformed block state")
        for prop in tail[:-1].split(","):
            if prop:
                key, sep, value = prop.partition("=")
                if not sep:
                    raise RuntimeError("Malformed block property")
                props[key] = value
    return {"position": position, "name": name, "properties": props, "raw": raw,
            "observation": "void_or_unloaded" if name == "minecraft:void_air" else "client_cache"}


def _batches(points):
    api = _api()
    for start in range(0, len(points), 256):
        batch = points[start:start + 256]
        values = api.getblocklist(batch)
        if not isinstance(values, list) or len(values) != len(batch):
            raise RuntimeError("Incomplete block batch; do not infer missing positions are air")
        for position, raw in zip(batch, values):
            yield _block(position, raw)


def sample_blocks(positions):
    """Read at most 512 absolute positions in bounded batches, preserving properties."""
    if not isinstance(positions, (list, tuple)) or not 1 <= len(positions) <= 512:
        raise ValueError("sample_blocks needs 1..512 positions; use scan_blocks for larger filtered areas")
    points = [_point(p) for p in positions]
    started = _stamp()
    blocks = list(_batches(points))
    return {"startedAt": started, "sampledAt": _stamp(), "source": "client_cache",
            "serverConfirmed": False, "blocks": blocks, "checked": len(points)}


def scan_blocks(minimum, maximum, names=(), limit=32):
    """Scan an inclusive absolute cuboid <=4096 blocks; return <=64 matching rows."""
    minimum, maximum = _point(minimum), _point(maximum)
    if any(a > b for a, b in zip(minimum, maximum)):
        raise ValueError("minimum must not exceed maximum")
    volume = math.prod(b - a + 1 for a, b in zip(minimum, maximum))
    if type(limit) is not int or not 1 <= limit <= 64:
        raise ValueError("limit must be 1..64; count still reports all matches. Read agent_mc.help('scan_blocks').")
    if volume > 4096:
        raise ValueError(f"Cuboid has {volume} blocks, maximum 4096; narrow the inclusive absolute [minX,minY,minZ]/[maxX,maxY,maxZ] bounds or split into nonoverlapping tiles. Read agent_mc.help('scan_blocks').")
    if not isinstance(names, (list, tuple)) or any(not isinstance(n, str) or ":" not in n for n in names):
        raise ValueError("names must be a list of namespaced block IDs")
    wanted = set(names)
    points = [[x, y, z] for x in range(minimum[0], maximum[0] + 1)
              for y in range(minimum[1], maximum[1] + 1) for z in range(minimum[2], maximum[2] + 1)]
    started, count, unknown, matches = _stamp(), 0, 0, []
    for block in _batches(points):
        if block["observation"] == "void_or_unloaded":
            unknown += 1
        if not wanted or block["name"] in wanted:
            count += 1
            if len(matches) < limit:
                matches.append(block)
    return {"startedAt": started, "sampledAt": _stamp(), "source": "client_cache", "serverConfirmed": False,
            "minimum": minimum, "maximum": maximum, "checked": volume, "count": count,
            "unknownCount": unknown, "matches": matches, "truncated": count > len(matches)}


def scan_nearby(radius=6, below=2, above=2, names=(), limit=32):
    """Convert current feet to absolute block coordinates with floor, then scan."""
    if any(type(v) is not int or not 0 <= v <= 16 for v in (radius, below, above)):
        raise ValueError("radius/below/above must be integers in 0..16")
    if (radius * 2 + 1) ** 2 * (below + above + 1) > 4096:
        volume = (radius * 2 + 1) ** 2 * (below + above + 1)
        raise ValueError(f"Nearby volume=(2*radius+1)^2*(below+above+1)={volume}, maximum 4096. Example radius=6,below=2,above=2 has 845 blocks. For an absolute box use agent_mc.scan_blocks; read agent_mc.help('scan_blocks').")
    x, y, z = [math.floor(v) for v in _api().player_position()]
    return scan_blocks([x-radius, y-below, z-radius], [x+radius, y+above, z+radius], names, limit)


def wait(seconds):
    """Bounded Python wait; Minescript 4.0 has no minescript.sleep function."""
    if type(seconds) not in (int, float) or not math.isfinite(seconds) or not 0 <= seconds <= 5:
        raise ValueError("wait requires 0..5 seconds")
    time.sleep(seconds)
