"""Prepare one missing piece of equipment or ammunition from the player's own supplies."""
from dataclasses import replace
from time import time

from .adventure import ARMOR, PLAYER, permission_lua
from .base import ArgumentError

SUFFIX = {"head": "helmet", "chest": "chestplate", "legs": "leggings", "feet": "boots"}

# Each invocation makes at most one change. A new choice re-reads admission,
# backpack, queued rewards and personal storage before considering a purchase.
PREPARE = r'''
local n=numen_hosted
local ammo=slot=='ammo'
local function run(cmd) return n.mc.run('/mycli '..cmd).output end
local function done(phase,item) print('QD_ARMOR '..phase..' '..slot..' '..(item or '-')) end
local function missing()
  for _,row in ipairs(run('arena status --json')) do
    if row:match('^MC_TRIAL_STATE ') and row:find('"recipient":"'..account..'"',1,true) then
      local list=row:match('"missingEquipment"%s*:%s*(%b[])')
      if list then return list:find('"'..label,1,true)~=nil end
    end
  end
end
local gap=missing()
if gap==nil then done('read_unavailable');return end
if not gap then done('ready');return end
local function arrow(item)
  return item=='minecraft:arrow' or item=='minecraft:spectral_arrow' or item=='minecraft:tipped_arrow'
end
local function fits(item)
  if ammo then return arrow(item) end
  return item and item:match('_'..suffix..'$')
end
if ammo and n.inv.count('minecraft:bow')+n.inv.count('minecraft:crossbow')==0 then done('bow_required');return end
for _,stack in ipairs(n.inv.items()) do
  if fits(stack.item) then
    if ammo then done('ranged_unavailable',stack.item);return end
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
local rewardScanComplete=false
local reward
local filteredCount
for _,row in ipairs(run('arena rewards list '..slot)) do
  if row:match(' filter=(%a+)$')==slot then filteredCount=tonumber(row:match('^MC_REWARD_SUMMARY visible=(%d+)')) end
  local pos,item=row:match('^MC_REWARD slot=(%d+) id=([%w_:./-]+)')
  if not reward and fits(item) then
    local ref=row:match(' ref=(%x+)$')
    if tonumber(pos)<9 or (ref and #ref==64) then
      reward={item=item,cmd='arena rewards take '..pos..(ref and ' '..ref or '')}
    end
  end
end
if filteredCount then
  if filteredCount>0 and reward then take(reward.item,reward.cmd);return end
  rewardScanComplete=filteredCount==0
else
  -- Older servers expose only the first nine bonus entries.
  for _,row in ipairs(run('arena rewards list')) do
    local pos,item=row:match('^MC_REWARD slot=(%d+) id=([%w_:./-]+)')
    if fits(item) then take(item,'arena rewards take '..pos);return end
    local queued=row:match('^MC_REWARD_SUMMARY .*queuedBonus=(%d+)')
    if queued then rewardScanComplete=tonumber(queued)<=9 end
  end
end
local pages
for _,row in ipairs(run('arena stash summary --json')) do
  if row:match('^MC_STASH_OVERVIEW ') then
    local category=ammo and 'consumables' or 'armor'
    local group=row:match('"'..category..'"%s*:%s*(%b{})')
    if group then pages=group:match('"pages"%s*:%s*(%b[])') end
  end
end
if not pages then done('read_unavailable');return end
for page in pages:gmatch('%d+') do
  if tonumber(page)<1 or tonumber(page)>10 then done('read_unavailable');return end
  local complete=false
  for _,row in ipairs(run('arena stash list '..page)) do
    local pos,item=row:match('^MC_STASH slot=(%d+) id=([%w_:./-]+)')
    if fits(item) then
      local count=ammo and math.min(16,tonumber(row:match(' count=(%d+)')) or 1) or 1
      take(item,'arena stash take '..pos..' '..count);return
    end
    if row:match('^MC_STASH_SUMMARY ') then complete=true end
  end
  if not complete then done('read_unavailable');return end
end
if not rewardScanComplete then done('rewards_incomplete');return end
if not buy then done('no_owned_piece');return end
local id=ammo and 'arrows' or 'iron_'..suffix
local page=ammo and 2 or 1
for _,row in ipairs(run('trade shop list supplies '..page..' --json')) do
  if row:match('^MC_ARENA_ECONOMY ') and row:find('"offerId":"'..id..'"',1,true)
      and row:find('"success":true',1,true) and row:find('"balanceAvailable":true',1,true) then
    local price=tonumber(row:match('"unitPrice":(%d+)'))
    local balance=tonumber(row:match('"balance":([%d.]+)'))
    if ammo and (not row:find('"id":"minecraft:arrow"',1,true) or tonumber(row:match('"quantity":(%d+)'))~=16) then done('shop_unavailable');return end
    if not price or price<1 or price>(ammo and 3 or 20) or not balance or row:find('"pending":true',1,true) then done('shop_unavailable');return end
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
    return _prepare_lua(slot, ARMOR[slot] + '"', SUFFIX[slot], allow_purchase, account)


def ammo_lua(allow_purchase, account):
    if type(allow_purchase) is not bool or not isinstance(account, str) or not PLAYER.fullmatch(account):
        raise ArgumentError("prepare_ammo accepts an optional allowPurchase boolean.")
    return _prepare_lua("ammo", "另一件可用远程武器", "", allow_purchase, account)


def _prepare_lua(slot, label, suffix, allow_purchase, account):
    values = f"local slot='{slot}';local label='{label}';local suffix='{suffix}';local account='{account}';"
    return permission_lua(account) + values + ("local buy=true;" if allow_purchase else "local buy=false;") + PREPARE


def armor_result(result, slot, recovered=False):
    if result.status != "completed":
        return result
    marker = next((line.split() for line in result.text.splitlines() if line.startswith("QD_ARMOR ")), [])
    phase, item = (marker[1], marker[3]) if len(marker) == 4 and marker[2] == slot else ("unverified", "-")
    if "QD_ADVENTURE_NOT_CONFIGURED" in result.text.splitlines():
        phase = "access_unconfigured"
    kind = "prepare_ammo" if slot == "ammo" else "prepare_armor"
    detail = {"kind": kind, "slot": slot, "phase": phase, "item": item, "effect": phase,
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
    return replace(result, status=status, text=f"{kind} {slot}: {phase}", data={"adventure": detail})
