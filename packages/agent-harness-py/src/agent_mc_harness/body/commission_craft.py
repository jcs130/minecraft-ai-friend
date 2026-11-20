"""One player-inventory torch batch for the mine journal's current commission stage."""
from dataclasses import replace
import json
import re
from time import time

from . import adventure


KIND = "craft_torches"


def eligible(stage):
    return bool(stage and stage.get("contractId") == "tm_local_mine_journal" and stage.get("stage") == 1
                and isinstance(stage.get("requirement"), str) and re.match(r"^亲手合成\s+TORCH\b", stage["requirement"]))


def previous_attempt(stage, journal, body):
    if not eligible(stage):
        return None
    prior = journal.last_adventure(body, KIND, "accept_quest", "turn_in_quest")
    if prior.get("kind") != KIND or prior.get("progressBefore") != stage["progress"]:
        return None
    if prior.get("effect") == "missing_materials":
        sample = journal.inventory_after(body, prior["requestId"])
        carried = {row.get("itemId") for row in sample
                   if isinstance(row, dict) and type(row.get("count")) is int and row["count"] > 0}
        if "minecraft:stick" in carried and carried.intersection({"minecraft:coal", "minecraft:charcoal"}):
            return None
        return prior
    return prior if prior.get("effect") in {"crafted", "craft_failed", "unverified"} else None


def craft_lua(read, progress, account):
    # Recheck the same server-authored record in the crafting program, in case the
    # commission was claimed, abandoned or changed after the body's read.
    if read.status != "completed":
        return None
    records = [line for line in read.text.partition("stdout:\n")[2].splitlines() if line.startswith("MC_ADVENTURE ")]
    if len(records) != 1:
        return None
    sample = adventure.game_result(read, adventure.QUERY, {"kind": "quest_status"})
    stage = adventure.unfinished_craft_stage((sample.data or {}).get("adventure", {}))
    if not eligible(stage) or stage["progress"] != progress:
        return None
    return adventure.permission_lua(account) + "local expected=" + json.dumps(records[0], ensure_ascii=False) + "\n" + TORCH_LUA


TORCH_LUA = """local n=numen_hosted
local current=n.mc.run('/mycli progress --json')
local matched=false
for _,row in ipairs(current.output) do if row==expected then matched=true end end
if not matched then print('QD_TORCH stage_changed'); return end
local function counts()
  return {n.inv.count('minecraft:coal'), n.inv.count('minecraft:charcoal'),
          n.inv.count('minecraft:stick'), n.inv.count('minecraft:torch')}
end
local before=counts()
if before[1]+before[2]<1 or before[3]<1 then print('QD_TORCH missing_materials'); return end
local ok,result=pcall(function() return n.inv.craft('minecraft:torch',{count=4}) end)
local after=counts()
local crafted=ok and type(result)=='table' and result.crafted or 'error'
print('QD_TORCH counts '..table.concat(before,' ')..' '..table.concat(after,' ')..' '..tostring(crafted))
"""


def measured(result, progress, request_id, recovered=False):
    if result.status in {"accepted", "unknown"}:
        return result
    evidence = {"kind": KIND, "requestId": request_id, "progressBefore": progress, "at": 0 if recovered else int(time()),
                "retryWrite": False, "creditVerified": False}
    markers = [line for line in result.text.partition("stdout:\n")[2].splitlines() if line.startswith("QD_TORCH ")]
    marker = markers[0] if result.status == "completed" and len(markers) == 1 else ""
    if marker in {"QD_TORCH missing_materials", "QD_TORCH stage_changed"} or "QD_ADVENTURE_NOT_CONFIGURED" in result.text.splitlines():
        reason = marker.removeprefix("QD_TORCH ") or "access_unconfigured"
        return replace(result, status="rejected", text=f"{KIND}: {reason}; no craft sent.", data={"adventure": {**evidence, "effect": reason}})
    counts = re.fullmatch(r"QD_TORCH counts((?: [0-9]{1,6}){8}) ([0-9]{1,6}|error)", marker)
    if counts:
        values = list(map(int, counts[1].split()))
        before, after, crafted = values[:4], values[4:], counts[2]
        delta = tuple(b - a for a, b in zip(before, after))
        evidence.update(before=dict(zip(("coal", "charcoal", "stick", "torch"), before)),
                        after=dict(zip(("coal", "charcoal", "stick", "torch"), after)))
        if crafted == "4" and delta in {(-1, 0, -1, 4), (0, -1, -1, 4)}:
            evidence.update(effect="crafted", crafted=4)
            return replace(result, text="Crafted 4 torches in your backpack. Read quest_status for guild credit.", data={"adventure": evidence})
        if crafted in {"0", "error"} and before == after:
            return replace(result, status="failed", text="Native crafting failed. Materials and torch counts are unchanged.",
                           data={"adventure": {**evidence, "effect": "craft_failed"}})
    return replace(result, status="unknown", text="Torch crafting outcome unverified. Query the original request.",
                   data={"adventure": {**evidence, "effect": "unverified"}})
