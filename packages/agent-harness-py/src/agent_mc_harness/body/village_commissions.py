"""The VillagerQuests board as seen by the player executing /mycli."""
from __future__ import annotations

import re
from dataclasses import replace
from time import time

from .base import ArgumentError


QUERIES = {"village_list": "list", "village_info": "info", "village_status": "status"}
ACTIONS = {"village_accept": "accept", "village_deliver": "deliver"}
KINDS = QUERIES | ACTIONS
CARD_ID = re.compile(r"vq_[a-f0-9]{16}")
TAG = "MC_VILLAGE_GUILD"
REFUSALS = {
    "permission_denied", "invalid_arguments", "invalid_id", "invalid_page", "missing", "offer_unavailable",
    "spectator", "issuer_unavailable", "unknown_quest", "taken_by_hero", "not_open", "expired", "player_limit",
    "hero_uses_bridge", "no_delivery", "issuer_out_of_reach", "nothing_delivered",
}

# mc.run captures messages synchronously on this player's own connection. Numen limits
# stdout to 6000 characters. Keep the complete index when long stories exceed that budget.
# Gson quotes inside a string are escaped, so a literal object key cannot be mistaken for story text.
PRINT_BOARD = """
for _,line in ipairs(r.output) do
  if line:sub(1,16)=='MC_VILLAGE_GUILD' and line:sub(17,17)==' ' then
    if #line>5500 then
      for _,field in ipairs({'cards','active'}) do
        local head,body,tail=line:match('^(MC_VILLAGE_GUILD {.-"'..field..'":)%[(.*)%](,.*})$')
        if head then
          local ids={}
          for id in body:gmatch('"id":"(vq_[0-9a-f]+)"') do
            ids[#ids+1]='{"id":"'..id..'"}'
          end
          line=head..'['..table.concat(ids,',')..'],"indexOnly":true'..tail
          break
        end
      end
    end
    print(line)
  end
end
"""


def command(kind, args):
    action = KINDS[kind]
    line = "/mycli guild village " + action
    if action == "list" and "page" in args:
        page = args["page"]
        if set(args) != {"kind", "page"} or type(page) is not int or not 1 <= page <= 9999:
            raise ArgumentError("Use the village_list page number returned by the board.")
        return f"{line} {page}"
    if action in {"info", "accept", "deliver"}:
        identifier = args.get("id")
        if set(args) != {"kind", "id"} or not isinstance(identifier, str) or not CARD_ID.fullmatch(identifier):
            raise ArgumentError("Copy the exact vq_ card ID from village_list or your own village_status.")
        return f"{line} {identifier}"
    if set(args) != {"kind"}:
        raise ArgumentError("Use only the arguments advertised for this village board operation.")
    return line


def _card(row, *, index=False):
    if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not CARD_ID.fullmatch(row["id"]):
        return False
    if index:
        return set(row) == {"id"}
    return (row.get("type") in ("slay", "gather", "reach")
            and row.get("status") in ("open", "accepted", "hero", "completed", "failed", "expired", "cancelled")
            and type(row.get("quantity")) is int and type(row.get("progress")) is int
            and 0 <= row["progress"] <= row["quantity"] and row["quantity"] > 0)


def _list_matches(row, action, requested):
    entries = row.get("cards" if action == "list" else "active")
    index = row.get("indexOnly") is True
    state = "open" if action == "list" else "accepted"
    if (not isinstance(entries, list)
            or not all(_card(c, index=index) and (index or c["status"] == state) for c in entries)
            or len({c["id"] for c in entries}) != len(entries)):
        return False
    if action == "status":
        return True
    if not all(type(row.get(key)) is int for key in ("page", "pages", "pageSize", "total")):
        return False
    page, pages, size, total = (row[key] for key in ("page", "pages", "pageSize", "total"))
    return (size > 0 and total >= 0 and pages == max(1, (total + size - 1) // size)
            and page == min(requested, pages) and len(entries) == min(size, total - (page - 1) * size))


def _effect(action, row, args):
    outcome = row.get("status")
    if not isinstance(outcome, str):
        return None
    card = row.get("card")
    identifier = args.get("id")
    if card is not None and (not _card(card) or card["id"] != identifier):
        return None
    if outcome in REFUSALS:
        return "rejected", outcome
    if action in ("list", "status"):
        if outcome == "observed" and _list_matches(row, action, args.get("page", 1)):
            return "completed", "read"
    elif action == "info":
        if outcome == "observed" and card:
            return "completed", "read"
    elif action == "accept":
        if outcome in ("accepted", "already_accepted") and card and card["status"] == "accepted":
            return "completed", outcome
    elif action == "deliver" and card and card["type"] == "gather":
        counted = row.get("counted")
        if type(counted) is int and 0 < counted <= card["progress"]:
            if outcome == "progress" and card["status"] == "accepted" and card["progress"] < card["quantity"]:
                return "completed", outcome
            if outcome == "completed" and card["status"] == "completed" and card["progress"] == card["quantity"]:
                return "completed", outcome
    return None


def receipt(result, kind, args, records, body_id, recovered):
    # Existing /mycli guild accept routes vq_ cards through the same native board.
    action = "accept" if kind == "accept_quest" else KINDS[kind]
    rows = [row for tag, row in records if tag == TAG]
    row = rows[0] if len(rows) == 1 and isinstance(rows[0], dict) else {}
    native = (body_id and row.get("source") == "villager_quests" and row.get("action") == action
              and type(row.get("schemaVersion")) is int and row["schemaVersion"] == 1
              and type(row.get("observedAt")) is int and row["observedAt"] > 0
              and row.get("actorUuid", body_id) == body_id)
    outcome = _effect(action, row, args) if native else None
    status, effect = outcome or (("failed", "unavailable") if kind in QUERIES else ("unknown", "unverified"))
    # Unknown and unrelated responses must not re-enter the planner as trusted cards.
    evidence = {"kind": kind, "effect": effect, "at": 0 if recovered else int(time()), "retryWrite": False,
                "records": [{"type": TAG, "value": row}] if outcome else []}
    text = f"{kind}: {effect}"
    if status == "unknown":
        text += ". Query the original request and village_status before considering another action."
    elif outcome and row.get("indexOnly"):
        text += ". Long board: use village_info with an exact listed ID for its objective and issuer location."
    return replace(result, status=status, text=text, data={"adventure": evidence})
