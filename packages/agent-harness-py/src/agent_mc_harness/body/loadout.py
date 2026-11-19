"""One ordinary armor preparation step on the configured player's own body."""
from dataclasses import replace
from time import time

from .adventure import ARMOR, PLAYER, permission_lua
from .base import ArgumentError

SUFFIX = {"head": "helmet", "chest": "chestplate", "legs": "leggings", "feet": "boots"}

# Each invocation makes at most one change. A new choice re-reads admission,
# backpack, queued rewards and personal storage before considering a purchase.
PREPARE = r'''
local n=numen_hosted
local function run(cmd) return n.mc.run('/mycli '..cmd).output end
local function done(phase,item) print('QD_ARMOR '..phase..' '..slot..' '..(item or '-')) end
local function missing()
  for _,row in ipairs(run('arena status --json')) do
    if row:match('^MC_TRIAL_STATE ') and row:find('"recipient":"'..account..'"',1,true) then
      local list=row:match('"missingEquipment"%s*:%s*(%b[])')
      if list then return list:find('"'..label..'"',1,true)~=nil end
    end
  end
end
local gap=missing()
if gap==nil then done('read_unavailable');return end
if not gap then done('ready');return end
local function fits(item) return item and item:match('_'..suffix..'$') end
for _,stack in ipairs(n.inv.items()) do
  if fits(stack.item) then
    n.gear.wear(stack.item,{slot=slot})
    done(missing()==false and 'equipped' or 'verify_equipment',stack.item)
    return
  end
end
local function take(item,cmd)
  local before=n.inv.count(item)
  run(cmd)
  done(n.inv.count(item)>before and 'collected' or 'verify_inventory',item)
end
local queued
for _,row in ipairs(run('arena rewards list')) do
  local pos,item=row:match('^MC_REWARD slot=(%d+) id=([%w_:./-]+)')
  if fits(item) then take(item,'arena rewards take '..pos);return end
  if row:match('^MC_REWARD_SUMMARY ') then queued=tonumber(row:match('queuedBonus=(%d+)')) end
end
if not queued or queued>9 then done('rewards_incomplete');return end
local pages
for _,row in ipairs(run('arena stash summary --json')) do
  if row:match('^MC_STASH_OVERVIEW ') then
    local armor=row:match('"armor"%s*:%s*(%b{})')
    if armor then pages=armor:match('"pages"%s*:%s*(%b[])') end
  end
end
if not pages then done('read_unavailable');return end
for page in pages:gmatch('%d+') do
  if tonumber(page)<1 or tonumber(page)>10 then done('read_unavailable');return end
  local complete=false
  for _,row in ipairs(run('arena stash list '..page)) do
    local pos,item=row:match('^MC_STASH slot=(%d+) id=([%w_:./-]+)')
    if fits(item) then take(item,'arena stash take '..pos..' 1');return end
    if row:match('^MC_STASH_SUMMARY ') then complete=true end
  end
  if not complete then done('read_unavailable');return end
end
if not buy then done('no_owned_piece');return end
local id='iron_'..suffix
for _,row in ipairs(run('trade shop list supplies 1 --json')) do
  if row:match('^MC_ARENA_ECONOMY ') and row:find('"offerId":"'..id..'"',1,true)
      and row:find('"success":true',1,true) and row:find('"balanceAvailable":true',1,true) then
    local price=tonumber(row:match('"unitPrice":(%d+)'))
    local balance=tonumber(row:match('"balance":([%d.]+)'))
    if not price or price<1 or price>20 or not balance or row:find('"pending":true',1,true) then done('shop_unavailable');return end
    if balance<price then done('insufficient_balance',id);return end
    for _,line in ipairs(run('trade shop buy '..id..' 1 --json')) do
      if line:match('^MC_ARENA_ECONOMY ') and line:find('"action":"buy"',1,true) then
        if line:find('"offerId":"'..id..'"',1,true) and line:find('"success":true',1,true)
            and line:find('"reason":"queued_for_personal_chest"',1,true) then done('purchased_to_queue',id);return end
        if line:find('"success":false',1,true) and not line:find('"pending":true',1,true) then done('purchase_refused',id);return end
      end
    end
    done('payment_unconfirmed',id);return
  end
end
done('shop_unavailable')
'''


def armor_lua(slot, allow_purchase, account):
    if (not isinstance(slot, str) or slot not in ARMOR or type(allow_purchase) is not bool
            or not isinstance(account, str) or not PLAYER.fullmatch(account)):
        raise ArgumentError("Choose head, chest, legs or feet and an optional allowPurchase boolean.")
    values = f"local slot='{slot}';local label='{ARMOR[slot]}';local suffix='{SUFFIX[slot]}';local account='{account}';"
    return permission_lua(account) + values + ("local buy=true;" if allow_purchase else "local buy=false;") + PREPARE


def armor_result(result, slot, recovered=False):
    if result.status != "completed":
        return result
    marker = next((line.split() for line in result.text.splitlines() if line.startswith("QD_ARMOR ")), [])
    phase, item = (marker[1], marker[3]) if len(marker) == 4 and marker[2] == slot else ("unverified", "-")
    if "QD_ADVENTURE_NOT_CONFIGURED" in result.text.splitlines():
        phase = "access_unconfigured"
    detail = {"kind": "prepare_armor", "slot": slot, "phase": phase, "item": item, "effect": phase,
              "at": 0 if recovered else int(time()), "ready": phase in {"ready", "equipped"}}
    status = "rejected"
    if phase in {"ready", "equipped", "collected", "purchased_to_queue"}:
        status = "completed"
    elif phase in {"unverified", "payment_unconfirmed"}:
        status = "unknown"
    elif phase in {"verify_equipment", "verify_inventory"}:
        status = "failed"
    if status in {"unknown", "failed"}:
        detail["retryWrite"] = False
    return replace(result, status=status, text=f"prepare_armor {slot}: {phase}", data={"adventure": detail})
