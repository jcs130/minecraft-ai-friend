"""Player-level RPG choices for one configured hosted adventurer."""
from __future__ import annotations

import json
import re
from dataclasses import replace
from math import dist
from time import time
from uuid import UUID
from xml.etree import ElementTree
from xml.sax.saxutils import unescape

from ..models import NativeAction
from .base import ArgumentError

# The body supplies both player names. Only a catalogue ID is model input.
INVENTORY = {f"inventory_{action}": f"inventory {action}" for action in ("clean", "store", "donate")}
QUERIES = {
    **{key: command + " --dry-run" for key, command in INVENTORY.items()},
    "events": "world events", "exploration": "tasks list exploration", "combat_jobs": "tasks list combat",
    "quest_info": "tasks info {id}", "quest_status": "tasks status", "guild_board": "guild board",
    "ruins": "dungeon list", "ruin_info": "dungeon info {id}", "ruin_status": "dungeon status",
    "trial": "arena status", "party": "guild party status",
    "plan_invitation": "guild party plan {self} {peer}", "plan_joining": "guild party plan {peer} {self}",
    "detail_page": "page {id} {page}",
}
ACTIONS = {
    **INVENTORY,
    "accept_quest": "guild accept {id}", "turn_in_quest": "guild claim",
    "travel_ruin": "dungeon travel {id}", "start_ruin": "dungeon start {id}", "claim_ruin": "dungeon claim {id}",
    "travel_trial": "goto arena", "start_trial": "arena start", "create_party": "guild party create",
    "invite_partner": "guild party invite {peer}", "accept_invitation": "guild party accept",
    "meet_partner": "locate tp {peer}", "party_chat": "guild party chat {text}",
}
QUERY, ACT, SURVEY = "adventure_query", "adventure_action", "survey"
PLAYER = re.compile(r"[\w.]{1,16}")
CONTENT_ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,79}")
# Read old, server-authored display echoes when reconciling an earlier installation.
PARTY_LINE = re.compile(r"(?:[^\[\]<>:\r\n»]{1,96} » )?\[Party\] (?:[★☆] )?([\w.]{1,16}): ([^\r\n]{1,400})")
ARMOR = {"head": "头盔", "chest": "胸甲", "legs": "护腿", "feet": "靴子"}
PARTY_OPENING = "我们组好队了，在哪个入口会合？分开时用 /mycli guild party chat 加上想说的话，我也能收到。"
INVITE_INTERVAL = 30 * 60
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
        (QUERY, QUERIES, "Preview inventory clean/store/donate or read this player's live event, quest, ruin, trial or native party. Use returned IDs and requirements."),
        (ACT, ACTIONS, f"Act as yourself. When space is tight, store ordinary surplus privately, clean common junk, or donate extra supplies to the guild. Party partner is {peer}. Inviting gives the other player a choice. Check the effect afterwards."),
    ):
        result.append(NativeAction(name=name, description=description, read_only=name == QUERY, input_schema={
            "type": "object", "properties": {"kind": {"type": "string", "enum": list(options)},
            "id": {"type": "string", "description": "Exact returned quest or ruin ID, only for operations that require one."}},
            "required": ["kind"], "additionalProperties": False}))
    query_properties = result[1].input_schema["properties"]
    query_properties["page"] = {"type": "integer", "minimum": 1, "maximum": 100,
                                "description": "Optional list page for exploration, combat_jobs and ruins. Required with a snapshot ID for detail_page."}
    actions = result[2].input_schema["properties"]
    actions["kind"]["enum"].extend(("prepare_armor", "prepare_ammo"))
    actions["text"] = {"type": "string", "maxLength": 100, "description": "party_chat only. A short message to the current native party."}
    actions["partyId"] = {"type": "string", "description": "party_chat only. Copy partyId from the current native party status."}
    actions["slot"] = {"type": "string", "enum": list(ARMOR), "description": "prepare_armor only. Choose a missing armor slot."}
    actions["allowPurchase"] = {"type": "boolean", "description": "Optional for prepare_armor or prepare_ammo. Use personal supplies first. Allows one iron piece up to 20 RPG coins, or 16 arrows up to 3 coins for your bow."}
    return result


def player_command(name: str, args: dict, account: str, peer: str) -> str:
    options = QUERIES if name == QUERY else ACTIONS if name == ACT else {}
    kind = args.get("kind")
    template = options.get(kind) if isinstance(kind, str) else None
    if not template or not PLAYER.fullmatch(account or "") or not PLAYER.fullmatch(peer or "") or account.casefold() == peer.casefold():
        raise ArgumentError("Choose an advertised adventure operation with the configured partner.")
    if kind == "party_chat":
        words = args.get("text")
        try:
            valid_id = str(UUID(str(args.get("partyId")))) == args.get("partyId")
        except ValueError:
            valid_id = False
        if (set(args) != {"kind", "text", "partyId"} or not valid_id or not isinstance(words, str)
                or not 1 <= len(words) <= 100 or words != words.strip() or not words.isprintable()
                or "§" in words or any(word.startswith("-") for word in words.split())):
            raise ArgumentError("Copy the current partyId and supply one short line of party dialogue.")
        return "/mycli " + template.format(text=words)
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


def permission_lua(account: str) -> str:
    # A scoped owner rule is opt-in. An unattended character must not leave a
    # consent question pending for every read when this integration is disabled.
    rule = json.dumps("allow command(mycli) @" + account, ensure_ascii=False)
    return ("local allowed=false; for _,row in ipairs(numen_hosted.permission.rules().yours) do "
            "local plain=row:match('^(.-)%s+%-%-') or row; if plain==" + rule + " then allowed=true end end; "
            "if not allowed then print('QD_ADVENTURE_NOT_CONFIGURED'); return end; ")


def game_lua(line: str, account: str) -> str:
    fallback = ""
    if line == "/mycli tasks status --json":
        # A paginated reply may arrive outside mc.run's output capture.
        fallback = "if #r.output==0 then print('QD_GUILD_STATUS'); r=numen_hosted.mc.run('/mycli guild status') end; "
    return (permission_lua(account) + "local r=numen_hosted.mc.run(" + json.dumps(line, ensure_ascii=False) + "); " + fallback +
            "for _,line in ipairs(r.output) do print(line) end")


def party_delivery(row):
    if not isinstance(row, dict) or type(row.get("schema")) is not int or row["schema"] != 1 or not isinstance(row.get("speaker"), str):
        return False
    try:
        return (all(isinstance(row.get(k), str) and str(UUID(row[k])) == row[k]
                    for k in ("id", "partyId", "speakerId", "recipientId"))
                and PLAYER.fullmatch(row["speaker"]) is not None
                and isinstance(row.get("text"), str) and 0 < len(row["text"]) <= 400)
    except ValueError:
        return False


def party_line(raw, listener=None):
    """Recognise Vortex's native channel only as untrusted speech, never as an identity grant."""
    if raw.data.get("nativeKind") != "server_message" or len(raw.text) > 8192 or not raw.text.startswith("<event "):
        return None
    header, closing, body = raw.text.partition(">")
    if not closing or not body.endswith("</event>"):
        return None
    try:
        envelope = ElementTree.fromstring(header + "/>")
    except ElementTree.ParseError:
        return None
    if envelope.tag != "event" or envelope.get("kind") != "server_message" or envelope.get("where") != "chat":
        return None
    line = unescape(body.removesuffix("</event>"), {"&quot;": '"', "&apos;": "'"})
    if line.startswith("MC_PARTY_CHAT "):
        try:
            row = json.loads(line.removeprefix("MC_PARTY_CHAT "))
        except ValueError:
            return None
        if not party_delivery(row) or row["recipientId"] != listener:
            return None
        return {"eventId": "party:" + row["id"], "at": raw.data.get("occurredAt"),
                "partyId": row["partyId"], "speakerId": row["speakerId"], "speaker": row["speaker"], "text": row["text"]}
    match = PARTY_LINE.fullmatch(re.sub(r"§.", "", line))
    if match:
        return {"eventId": "party:" + raw.id, "at": raw.data.get("occurredAt"), "speaker": match[1], "text": match[2]}
    return None


def travel_denial(messages):
    for message in messages:
        tagged = re.match(r"\[((?:team_[a-z_]+|equipment_required|unsafe_destination|protected_entry|protected_exit))\] ", message)
        if tagged:
            evidence = {"reason": tagged[1]}
            missing = re.match(r"\[equipment_required\] 增援需补齐：([^；。]+)", message)
            if missing:
                evidence["missingEquipment"] = missing[1].split("、")
                if "/mycli stash 打开个人箱" in message:
                    evidence["activity"] = "trial"
            return evidence, message
        for prefix, reason in (("传送冷却还剩", "cooldown"), ("传送被保护规则取消", "protected"),
                               ("魔力不足", "insufficient_mana"), ("旁观者不能使用传送术", "actor_unavailable")):
            if message.startswith(prefix):
                return {"reason": reason}, message
    return {}, ""


def game_result(result, name: str, args: dict, *, account=None, body_id=None, peer=None, recovered=False):
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
    if kind in INVENTORY:
        action = INVENTORY[kind].split()[1]
        receipts = [row for tag, row in records if tag == "MC_INVENTORY_BATCH" and isinstance(row, dict)
                    and row.get("action") == action and body_id and row.get("playerUuid") == body_id]
        row = receipts[0] if len(receipts) == 1 else {}
        preview = name == QUERY
        if row.get("outcomeUnknown") or not row or (row.get("success") and row.get("dryRun") is not preview):
            status, effect = ("failed", "unavailable") if preview else ("unknown", "unverified")
        elif row.get("success") is False:
            status, effect = "rejected", "refused"
        elif row.get("success") is True and row.get("reason") in {
                "preview", "unchanged", "completed", "partial", "destination_full", "shared_chest_unavailable", "nothing_to_move"}:
            status, effect = "completed", "read" if preview else row["reason"]
        else:
            status, effect = ("failed", "unavailable") if preview else ("unknown", "unverified")
        return replace(result, status=status, text=f"{kind}: {effect}", data={"adventure": {
            "kind": kind, "effect": effect, "receipt": row, "at": 0 if recovered else int(time()), "retryWrite": False}})
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
    details, explanation = travel_denial(messages) if kind == "meet_partner" else ({}, "")
    if details:
        refused = True
    if kind == "start_ruin":
        for tag, row in records:
            if (tag != "MC_SITE_DUNGEON_RESULT" or not isinstance(row, dict) or row.get("id") != args.get("id")
                    or row.get("action") != "start" or row.get("success") is not False):
                continue
            guide = row.get("guidance") or {}
            if isinstance(guide, dict) and guide.get("reason") == "EQUIPMENT_REQUIRED":
                details["reason"] = "equipment_required"
                explanation = str(guide.get("nextAction") or row.get("nextAction") or "Check entry equipment.")[:350]
                missing = re.match(r"缺少[：:]?([^。；]+)", explanation)
                details["missingEquipment"] = row.get("missingEquipment") or (missing[1].split("、") if missing else [])
    if kind == "trial" and any(tag == "MC_TRIAL_STATE" and isinstance(row, dict)
                               and row.get("reason") == "trial_busy" for tag, row in records):
        explanation = "A run is active. Ask in party chat whether your teammate is in it. You can reinforce a participating teammate once equipped."
    if kind == "accept_quest":
        refused |= any(line.startswith(("已有在途任务", "没有这个任务 ID")) for line in messages)
        verified_write = any(line.startswith("已接公会委托：") for line in messages)
    if kind == "turn_in_quest":
        verified_write = any(line.startswith("委托交付成功！") for line in messages)
    effect = "refused" if refused else "read" if name == QUERY else "confirmed" if verified_write else "dispatched"
    if kind == "travel_trial" and effect == "dispatched" and any(tag == "MC_TRAVEL" and isinstance(row, str)
            and {"target=arena", "status=pending"}.issubset(row.split()) for tag, row in records):
        effect = "awaiting_arrival"
        details["retryWrite"] = False
        explanation = "The landing is being checked. Stay in place, then observe your position and the trial entrance."
    if not refused and kind == "party_chat":
        receipts = [row for tag, row in records if tag == "MC_PARTY_CHAT"]
        sent = next((row for row in receipts if party_delivery(row) and row["partyId"] == args.get("partyId")
                     and row["speakerId"] == row["recipientId"] == body_id
                     and row["speaker"] == account and row["text"] == args["text"]), None)
        if sent:
            details["messageId"] = sent["id"]
        elif not receipts:
            sent = any(m and m[1] == account and m[2] == args["text"] for m in (PARTY_LINE.fullmatch(s) for s in messages))
        effect = "sent" if sent else "unverified"
    if kind == "meet_partner" and effect == "dispatched":
        effect = "unverified"
    if effect == "unverified":
        details["retryWrite"] = False
        explanation = "Read current party status and positions before a new decision. Do not repeat this request."
    plain_read = messages and (kind == "guild_board" or kind == "quest_status" and guild_status)
    if name == QUERY and not records and not plain_read:
        effect = "incomplete" if incomplete else "unavailable"
    evidence = {"kind": kind, "at": 0 if recovered else int(time()), "records": [
        {"type": tag, "value": row} for tag, row in records[:5]], "messages": messages[:6] if plain_read else messages[:2],
        "effect": effect, **details}
    if kind == "party_chat":
        evidence["messages"] = []  # Party dialogue does not enter general action memory.
        evidence["records"] = []
    if guild_status:
        evidence["source"] = "guild status"
    if kind == "guild_board":
        evidence["offers"] = [line[:220] for line in messages if re.match(r"^[a-z0-9][a-z0-9_-]{0,79} ", line)][:24]
    if args.get("id"):
        evidence["id"] = args["id"]
    if kind == "invite_partner" and effect == "confirmed" and peer:
        evidence["peer"] = peer
    status = "rejected" if refused else "failed" if effect in {"incomplete", "unavailable", "unverified"} else "completed"
    text = f"{kind}: {effect}" + (f" — {explanation}" if explanation else "")
    return replace(result, status=status, text=text, data={"adventure": evidence})


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


def coordination_check(kind: str, peer: str, data: dict, party_id=None) -> bool:
    if kind in ("meet_partner", "party_chat"):
        if kind == "party_chat" and (not party_id or data.get("partyId") != party_id):
            return False
        return data.get("inParty") is True and any(member.get("name") == peer and member.get("online") is True
                                                    for member in data.get("members", []))
    expected = {"create_party": "create", "invite_partner": "invite", "accept_invitation": "accept"}
    return data.get("type") == "partyPlan" and data.get("nextAction") == expected[kind] and any(
        actor.get("name") == peer and actor.get("online") is True for actor in data.get("requested", []))


def current_party(evidence, peer, *, since=0):
    at = evidence.get("at", 0)
    if not isinstance(at, (int, float)) or not 0 <= time() - at <= 90 or at + 1 < since:
        return None
    for record in evidence.get("records", []):
        row = record.get("value")
        if record.get("type") != "MC_RPG" or not isinstance(row, dict) or row.get("type") != "party":
            continue
        party_id = row.get("partyId")
        if not coordination_check("party_chat", peer, row, party_id):
            return None
        member = next(m for m in row["members"] if m.get("name") == peer)
        return {"partyId": party_id, "phase": row.get("phase"), "partner": peer,
                "sameWorld": member.get("sameWorld"), "distance": member.get("distance")}
    return None


def assembly_action(evidence, peer: str, actor: str) -> str | None:
    """Use the native roster to propose a single action for the configured partner."""
    at = evidence.get("at", 0)
    if not isinstance(at, (int, float)) or not 0 <= time() - at <= 90:
        return None
    for record in evidence.get("records", []):
        row = record.get("value")
        if (record.get("type") != "MC_RPG" or not isinstance(row, dict) or row.get("type") != "party"
                or row.get("available") is not True or row.get("inviteStateKnown") is not True or row.get("selfUuid") != actor):
            continue
        phase = row.get("phase")
        if row.get("inParty") is False and phase == "not_in_party" and row.get("memberCount") == 0:
            return "create_party"
        if row.get("inParty") is False and phase == "invited":
            invite = row.get("pendingInvite")
            expires = invite.get("expiresInSeconds") if isinstance(invite, dict) else None
            if isinstance(expires, (int, float)) and invite.get("inviter") == peer and expires > time() - at:
                return "accept_invitation"
        if (row.get("inParty") is True and phase == "awaiting_teammates" and row.get("memberCount") == 1
                and row.get("leaderUuid") == actor):
            return "invite_partner"
        return None
    return None


def public_outing(roster, invitation, creation, trial, travel, peer, snapshot):
    """A public meeting place needs no access to the invitee's private position."""
    now = time()
    sent = invitation.get("at", 0)
    if (not snapshot or snapshot.life_state != "alive" or not snapshot.position
            or not 0 <= now - sent < INVITE_INTERVAL or sent < creation.get("at", 0)
            or invitation.get("effect") != "confirmed" or not 0 <= now - roster.get("at", 0) <= 90):
        return None

    def value(evidence, tag):
        return next((r["value"] for r in evidence.get("records", [])
                     if r.get("type") == tag and isinstance(r.get("value"), dict)), {})

    status = value(roster, "MC_RPG")
    sent_to = value(invitation, "MC_RPG")
    original_message = str(sent_to.get("message", "")).startswith(f"已向 {peer} 发送邀请，")
    if (status.get("phase") != "awaiting_teammates" or status.get("inParty") is not True or status.get("memberCount") != 1
            or not status.get("selfUuid") or status["selfUuid"] != status.get("leaderUuid")
            or sent_to.get("success") is not True or not (invitation.get("peer") == peer or original_message)):
        return None
    offer = {"place": "试炼塔公共入口", "partnerAttendance": "unconfirmed", "next": "trial"}
    if trial.get("at", 0) < sent or not 0 <= now - trial.get("at", 0) < 180:
        return offer
    facts = value(trial, "MC_TRIAL_STATE")
    if (not facts or facts.get("participant") is not False or facts.get("reason") in
            {"observer", "downed", "actor_unavailable", "other_activity", "return_pending", "trial_unavailable"}):
        return None
    entrance = facts.get("entrance")
    if not isinstance(entrance, dict) or not facts.get("worldKey") or not all(
            isinstance(point.get(k), (float, int)) for point in (entrance, snapshot.position) for k in "xyz"):
        return None
    near = snapshot.dimension == facts["worldKey"] and dist([snapshot.position[k] for k in "xyz"], [entrance[k] for k in "xyz"]) <= 24
    offer["missingArmor"] = [s for s, label in ARMOR.items() if label in facts.get("missingEquipment", [])]
    if travel.get("at", 0) >= sent and trial.get("at", 0) <= travel["at"] and travel.get("effect") in {"awaiting_arrival", "dispatched", "confirmed"}:
        offer["next"] = "trial"
        return offer
    if near:
        walk = facts.get("walkTarget")
        if isinstance(walk, dict) and all(isinstance(walk.get(k), (float, int)) for k in "xyz"):
            remaining = dist([snapshot.position[k] for k in "xyz"], [walk[k] for k in "xyz"])
            if remaining <= 3:
                offer["next"] = "trial"
            else:
                offer.update(next="walk_to_platform", walkTarget=walk)
            return offer
        ruin = (facts.get("outing") or {}).get("ruin") or {}
        if isinstance(ruin.get("id"), str) and CONTENT_ID.fullmatch(ruin["id"]):
            offer.update(next="ruin_info", siteId=ruin["id"], siteName=str(ruin.get("name", ""))[:60])
        else:
            offer["next"] = "ruins"
    elif travel.get("at", 0) >= sent or facts.get("reason") in {"travel_mana_required", "mana_unknown"}:
        offer["next"] = "ruins"
    else:
        offer.update(next="travel_trial", travelMana=facts.get("travelMana", 6))
    return offer


def continue_outing(offer, recent):
    if offer["next"] != "ruin_info":
        return
    site = offer["siteId"]
    for result in recent:
        sample = result.get("adventure") or {}
        if sample.get("id") != site or not 0 <= time() - sample.get("at", 0) <= 180:
            continue
        if sample.get("kind") in {"travel_ruin", "start_ruin"}:
            offer["next"] = "ruin_status"
            return
        if sample.get("kind") != "ruin_info" or sample.get("effect") != "read":
            continue
        for record in sample.get("records", ()):
            info = record.get("value")
            if record.get("type") != "MC_SITE_DUNGEON_INFO" or not isinstance(info, dict) or info.get("id") != site:
                continue
            guide = info.get("guidance") or {}
            stage = guide.get("state")
            if stage == "requirements" and guide.get("reason") == "EQUIPMENT_REQUIRED":
                missing = guide.get("missingEquipment", [])
                offer["missingArmor"] = [s for s, label in ARMOR.items() if label in missing]
                if offer["missingArmor"]:
                    offer["next"] = "prepare_armor"
                elif any(str(label).startswith("另一件可用远程武器") for label in missing):
                    offer["next"] = "check_ranged_loadout"
                else:
                    offer["next"] = "check_loadout"
            else:
                offer["next"] = {"travel": "travel_ruin", "ready": "start_ruin",
                                 "approach": "survey_then_walk"}.get(stage, "ruin_status")
            offer["siteInstruction"] = str(guide.get("nextAction", ""))[:230]
            return


def meeting_recovery(last, prepared):
    if not 0 <= time() - last.get("at", 0) <= 900:
        return None
    # Read receipts from the previous release without rewriting history.
    denial, _ = travel_denial(last.get("messages", []))
    if last.get("effect") == "refused" and last.get("reason"):
        denial.update({key: last[key] for key in ("reason", "missingEquipment", "activity") if key in last})
    if not denial and last.get("effect") != "unverified":
        return None
    recovery = {**denial, "effect": "refused" if denial else "unverified", "at": last["at"]}
    if prepared.get("at", 0) >= last["at"]:
        recovery["latestPreparation"] = prepared
        if denial.get("activity") == "trial" and prepared.get("phase") == "insufficient_balance":
            recovery["alternative"] = "travel_trial"
    return recovery


COORDINATION = {"create_party": "plan_invitation", "invite_partner": "plan_invitation",
                "accept_invitation": "plan_joining", "meet_partner": "party", "party_chat": "party"}
