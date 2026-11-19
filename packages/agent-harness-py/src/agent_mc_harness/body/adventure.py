"""Player-level RPG choices for one configured hosted adventurer."""
from __future__ import annotations

import json
import re
from dataclasses import replace
from math import dist
from time import time

from ..models import NativeAction
from .base import ArgumentError

# The body supplies both player names. Only a catalogue ID is model input.
QUERIES = {
    "events": "world events", "exploration": "tasks list exploration", "combat_jobs": "tasks list combat",
    "quest_info": "tasks info {id}", "quest_status": "tasks status", "guild_board": "guild board",
    "ruins": "dungeon list", "ruin_info": "dungeon info {id}", "ruin_status": "dungeon status",
    "trial": "arena status", "party": "guild party status",
    "plan_invitation": "guild party plan {self} {peer}", "plan_joining": "guild party plan {peer} {self}",
    "detail_page": "page {id} {page}",
}
ACTIONS = {
    "accept_quest": "guild accept {id}", "turn_in_quest": "guild claim",
    "travel_ruin": "dungeon travel {id}", "start_ruin": "dungeon start {id}", "claim_ruin": "dungeon claim {id}",
    "travel_trial": "goto arena", "start_trial": "arena start", "create_party": "guild party create",
    "invite_partner": "guild party invite {peer}", "accept_invitation": "guild party accept",
    "meet_partner": "locate tp {peer}",
}
QUERY, ACT, SURVEY = "adventure_query", "adventure_action", "survey"
PLAYER = re.compile(r"[\w.]{1,16}")
CONTENT_ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,79}")
SURVEY_LUA = """local n=numen_hosted
local map=n.scan.map({radius=8})
local pos=map.center
print('GROUND '..pos.x..' '..pos.y..' '..pos.z..' '..n.status.self().dimension)
for _,row in ipairs(map.rows) do print('ROW '..row) end
for _,e in ipairs(n.scan.entities('player',{radius=16})) do
  if e.name and e.pos then print('PLAYER '..e.name..' '..e.pos.x..' '..e.pos.y..' '..e.pos.z) end
end
for i,e in ipairs(n.scan.entities('hostile',{radius=12})) do
  if i>6 then break end
  if e.type and e.distance and e.hp then print('HOSTILE '..e.type..' '..e.distance..' '..e.hp) end
end
print('SURVEY_END')"""


def catalogue(peer: str) -> list[NativeAction]:
    result = [NativeAction(name=SURVEY, read_only=True, description="Survey the nearby ground and players. walkTo positions are sampled destinations for body:move.",
                           input_schema={"type": "object", "properties": {}, "additionalProperties": False})]
    for name, options, description in (
        (QUERY, QUERIES, "Read this player's live event, quest, ruin, trial or native party. Use returned IDs and requirements."),
        (ACT, ACTIONS, f"Act as yourself. Party partner is {peer}. Inviting gives the other player a choice. Check the effect afterwards."),
    ):
        result.append(NativeAction(name=name, description=description, read_only=name == QUERY, input_schema={
            "type": "object", "properties": {"kind": {"type": "string", "enum": list(options)},
            "id": {"type": "string", "description": "Exact returned quest or ruin ID, only for operations that require one."}},
            "required": ["kind"], "additionalProperties": False}))
    query_properties = result[1].input_schema["properties"]
    query_properties["page"] = {"type": "integer", "minimum": 1, "maximum": 100,
                                "description": "Optional list page for exploration, combat_jobs and ruins. Required with a snapshot ID for detail_page."}
    return result


def player_command(name: str, args: dict, account: str, peer: str) -> str:
    options = QUERIES if name == QUERY else ACTIONS if name == ACT else {}
    kind = args.get("kind")
    template = options.get(kind) if isinstance(kind, str) else None
    if not template or not PLAYER.fullmatch(account or "") or not PLAYER.fullmatch(peer or "") or account.casefold() == peer.casefold():
        raise ArgumentError("Choose an advertised adventure operation with the configured partner.")
    needs_id = "{id}" in template
    expected = {"kind", "id"} if needs_id else {"kind"}
    if kind == "detail_page" or kind in {"exploration", "combat_jobs", "ruins"} and "page" in args:
        expected.add("page")
    if set(args) != expected:
        raise ArgumentError("Provide only kind and the exact catalogue ID when required.")
    identifier = args.get("id", "")
    if needs_id and (not isinstance(identifier, str) or not CONTENT_ID.fullmatch(identifier)):
        raise ArgumentError("Copy a quest or ruin ID from its server catalogue.")
    page = args.get("page", 1)
    if type(page) is not int or not 1 <= page <= 100:
        raise ArgumentError("Use a page number from 1 to 100.")
    if kind == "detail_page" and not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", identifier):
        raise ArgumentError("Copy the snapshotId from the last MC_PAGE result.")
    if "page" in args and kind != "detail_page":
        template += " --page {page}"
    # Public travel and trial start take plain arguments; their feedback already includes MC_* records.
    suffix = "" if kind in {"travel_trial", "start_trial", "meet_partner", "accept_quest", "turn_in_quest", "detail_page", "guild_board"} else " --json"
    return "/mycli " + template.format(id=identifier, self=account, peer=peer, page=page) + suffix


def survey_result(result, *, recovered=False):
    if result.status not in {"completed", "unknown"}:
        return result
    lines = result.text.splitlines()
    origin = next((line.split() for line in lines if line.startswith("GROUND ")), [])
    rows = [line[4:].split() for line in lines if line.startswith("ROW ")]
    if result.status != "completed" or len(origin) != 5 or len(rows) != 17 or any(len(row) != 17 for row in rows) or "SURVEY_END" not in lines:
        return replace(result, status="failed", text="Terrain sample unavailable; observe again when ready.")
    try:
        x, y, z = map(int, origin[1:4])
    except ValueError:
        return replace(result, status="failed", text="Terrain sample has no usable origin.")
    walk = []
    for dx, dz in ((0,-1),(1,0),(0,1),(-1,0),(1,-1),(1,1),(-1,1),(-1,-1)):
        last = 0
        for length in range(1, 9):
            cx, cz = 8 + dx * length, 8 + dz * length
            if rows[cz][cx] != "." or (dx and dz and (rows[cz-dz][cx] != "." or rows[cz][cx-dx] != ".")):
                break
            last = length
        if last:
            walk.append({"x": x + dx * last, "y": y, "z": z + dz * last})
    nearby, hostiles = [], []
    for line in lines:
        parts = line.split()
        if len(parts) == 5 and parts[0] == "PLAYER" and PLAYER.fullmatch(parts[1]):
            try:
                nearby.append({"name": parts[1], "position": [float(v) for v in parts[2:]]})
            except ValueError:
                continue
        if len(parts) == 4 and parts[0] == "HOSTILE" and re.fullmatch(r"[a-z0-9_./-]+:[a-z0-9_./-]+", parts[1]):
            try:
                hostiles.append({"type": parts[1], "distance": float(parts[2]), "health": float(parts[3])})
            except ValueError:
                continue
    sample = {"dimension": origin[4], "origin": [x, y, z], "walkTo": walk, "nearbyPlayers": nearby[:16], "hostiles": hostiles[:6],
              "groundRowsNorthFirst": ["".join(row) for row in rows], "at": 0 if recovered else int(time())}
    return replace(result, text="Nearby terrain and players sampled.", data={"survey": sample})


def game_lua(line: str, account: str) -> str:
    # A scoped owner rule is opt-in. An unattended character must not leave a
    # consent question pending for every read when this integration is disabled.
    rule = json.dumps("allow command(mycli) @" + account, ensure_ascii=False)
    fallback = ""
    if line == "/mycli tasks status --json":
        # A paginated reply may arrive outside mc.run's output capture.
        fallback = "if #r.output==0 then print('QD_GUILD_STATUS'); r=numen_hosted.mc.run('/mycli guild status') end; "
    return ("local allowed=false; for _,row in ipairs(numen_hosted.permission.rules().yours) do "
            "local plain=row:match('^(.-)%s+%-%-') or row; if plain==" + rule + " then allowed=true end end; "
            "if not allowed then print('QD_ADVENTURE_NOT_CONFIGURED'); return end; "
            "local r=numen_hosted.mc.run(" + json.dumps(line, ensure_ascii=False) + "); " + fallback +
            "for _,line in ipairs(r.output) do print(line) end")


def game_result(result, name: str, args: dict, *, peer=None, recovered=False):
    if result.status == "unknown" and name == QUERY:
        return replace(result, status="failed", text="RPG read unavailable. Sample again when ready.")
    if result.status != "completed":
        return result
    if "QD_ADVENTURE_NOT_CONFIGURED" in result.text.splitlines():
        return replace(result, status="rejected", text="RPG access is unconfigured for this body. Continue with terrain survey, walking and nearby dialogue.")
    records, messages = [], []
    guild_status = False
    incomplete = False
    for line in result.text.partition("stdout:\n")[2].splitlines():
        line = re.sub(r"§.", "", line).strip()
        if line.startswith("MC_"):
            tag, _, detail = line.partition(" ")
            try:
                row = json.loads(detail)
            except ValueError:
                if detail.startswith(("{", "[")):
                    incomplete = True
                    continue
                row = detail[:900]
            records.append((tag, row))
        elif line == "QD_GUILD_STATUS":
            guild_status = True
        elif line:
            messages.append(line[:350])
    kind = args["kind"]
    refused = any(tag == "MC_QUERY_ERROR" or isinstance(row, dict) and (
        row.get("success") is False or row.get("status") in ("denied", "failed", "error"))
        or tag == "MC_TRAVEL" and isinstance(row, str) and "status=denied" in row for tag, row in records)
    verified_write = False
    for tag, row in records:
        if tag == "MC_RPG" and kind in COORDINATION and kind != "meet_partner" and isinstance(row, dict):
            verified_write |= row.get("type") == "party" and row.get("success") is True
        if tag == "MC_SITE_DUNGEON_RESULT" and isinstance(row, dict):
            operation = {"start_ruin": "start", "travel_ruin": "travel", "claim_ruin": "claim"}.get(kind)
            verified_write |= bool(operation and row.get("action") == operation and row.get("id") == args.get("id") and row.get("success") is True)
        if tag == "MC_TRAVEL" and kind == "travel_trial" and isinstance(row, str):
            verified_write |= "target=arena" in row.split() and "status=arrived" in row.split()
    if kind == "meet_partner" and peer:
        landing = rf"已安全抵达 {re.escape(peer)} 身边。 dimension=[\w:./-]+ x=-?\d+ y=-?\d+ z=-?\d+"
        verified_write = any(re.fullmatch(landing, message) for message in messages)
    if kind == "accept_quest":
        refused |= any(line.startswith(("已有在途任务", "没有这个任务 ID")) for line in messages)
        verified_write = any(line.startswith("已接公会委托：") for line in messages)
    if kind == "turn_in_quest":
        verified_write = any(line.startswith("委托交付成功！") for line in messages)
    effect = "refused" if refused else "read" if name == QUERY else "confirmed" if verified_write else "dispatched"
    plain_read = messages and (kind == "guild_board" or kind == "quest_status" and guild_status)
    if name == QUERY and not records and not plain_read:
        effect = "incomplete" if incomplete else "unavailable"
    evidence = {"kind": kind, "at": 0 if recovered else int(time()), "records": [
        {"type": tag, "value": row} for tag, row in records[:5]], "messages": messages[:6] if plain_read else messages[:2],
        "effect": effect}
    if guild_status:
        evidence["source"] = "guild status"
    if kind == "guild_board":
        evidence["offers"] = [line[:220] for line in messages if re.match(r"^[a-z0-9][a-z0-9_-]{0,79} ", line)][:24]
    if args.get("id"):
        evidence["id"] = args["id"]
    status = "rejected" if refused else "failed" if effect in {"incomplete", "unavailable"} else "completed"
    return replace(result, status=status, text=f"{args['kind']}: {evidence['effect']}", data={"adventure": evidence})


def partner_nearby(peer, context) -> bool:
    snapshot = context.snapshot
    if not peer or not snapshot or snapshot.life_state != "alive" or not snapshot.position:
        return False
    position = tuple(snapshot.position[k] for k in ("x", "y", "z"))
    for outcome in context.body_results:
        survey = outcome.get("survey")
        if not survey:
            continue
        return (0 <= time() - survey["at"] <= 75 and survey["dimension"] == snapshot.dimension
                and any(p["name"].casefold() == peer.casefold() and dist(position, p["position"]) <= 12
                        for p in survey["nearbyPlayers"]))
    return False


def coordination_check(kind: str, peer: str, data: dict) -> bool:
    if kind == "meet_partner":
        return data.get("inParty") is True and any(member.get("name") == peer and member.get("online") is True
                                                    for member in data.get("members", []))
    expected = {"create_party": "create", "invite_partner": "invite", "accept_invitation": "accept"}
    return data.get("type") == "partyPlan" and data.get("nextAction") == expected[kind] and any(
        actor.get("name") == peer and actor.get("online") is True for actor in data.get("requested", []))


COORDINATION = {"create_party": "plan_invitation", "invite_partner": "plan_invitation",
                "accept_invitation": "plan_joining", "meet_partner": "party"}
