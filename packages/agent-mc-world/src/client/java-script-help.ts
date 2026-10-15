/** Versioned local references. Reading a page never submits a body action or calls a model. */
const INDEX = `Optional mc_script executor: Minescript 4.0 Python, explicitly installed and enabled. Python is trusted code, not a sandbox. No extra model loop.
Submit {language:"python",code:"...",input:{...},timeoutMs:10000,action_id:"stable-id"}. Variables: minescript (module), input_data (JSON), result (assign a JSON value). Read mc_result/mc_wait by the original action ID. Program termination/result is not goal completion; inspect fresh state, inventory and server receipts.
Read a focused page using api:"blocks", "movement", "interaction" or "inventory". api:"index" returns this index without executing anything.
Version rules: import minescript; use minescript.player_position(), not minescript.player.get_position(). getblock/getblocklist return STRINGS such as minecraft:carrots[age=7], not dictionaries. Use math.floor for negative world coordinates. Many synchronous getblock calls each cross the Python/game boundary; use bounded getblocklist batches. Python waits use import time; time.sleep(seconds), never minescript.sleep. Use player_look_at(x,y,z) rather than guessing yaw.
The native body does not provide automatic navigation/crafting/digging or translate old Mineflayer JavaScript. GUI-open movement can be blocked. Known tool failures should change the method rather than repeat the same script under a new ID. Unknown dispatch still requires reconciliation.
Full pinned reference: https://github.com/maxuser0/minescript/blob/main/docs/v4.0/README.md`;
const PAGES: Record<string, string> = {
  index: INDEX,
  blocks: `Minescript 4.0 block observations: getblock(x,y,z) -> str; getblocklist([[x,y,z],...]) -> list[str] in the same order. Parse the namespaced ID and bracket properties; carrots/wheat age=7 is visible in that string. Do not test raw == "carrots" or raw.get("state"). Cached client data is an observation, not server acceptance; void_air can mean unloaded/void. Do not wait indefinitely for unloaded regions.
Batch example (one sample of 845 absolute positions, filtered and bounded output):
import math
px, py, pz = [math.floor(v) for v in minescript.player_position()]
points = [[x,y,z] for x in range(px-6,px+7) for y in range(py-2,py+3) for z in range(pz-6,pz+7)]
hits = []
for start in range(0,len(points),256):
    batch = points[start:start+256]
    values = minescript.getblocklist(batch)
    if len(values) != len(batch): raise RuntimeError("Incomplete block batch")
    hits.extend({"position":p,"raw":raw} for p,raw in zip(batch,values) if raw.split("[",1)[0] in ("minecraft:carrots","minecraft:wheat"))
result = {"checked":len(points),"count":len(hits),"matches":hits[:32],"truncated":len(hits)>32,"source":"client_cache"}
For reusable programs, this package also includes optional skills/java-client/agent_mc.py. Install it explicitly in the game's minescript directory; it is not assumed installed and does not execute on import.`,
  movement: `Minescript 4.0 movement/view: player_position() -> [x,y,z]; player_orientation() -> [yaw,pitch] in degrees; player_look_at(x,y,z) aims at a world position, normally block center x+.5,y+.5,z+.5. player_set_orientation(yaw,pitch) sets degrees. Positive pitch looks down; Minecraft yaw 0 faces +Z, -90 faces +X. Use math.floor for negative block coordinates.
Prefer mc_do operation:move for a short native movement and check its actual moved/position receipt. Close a menu with its current screenToken first. There is no implicit pathfinder or wall digging.
For a selected Python program:
import time
before = minescript.player_position()
try:
    minescript.press_key_bind("key.forward",True)
    minescript.flush()
    time.sleep(0.25)
finally:
    minescript.press_key_bind("key.forward",False)
    minescript.flush()
result = {"before":before,"after":minescript.player_position()}
Keep the whole program within timeoutMs and lease, including cleanup. time.sleep is Python waiting, not a nonexistent minescript.sleep. Native cancel/stop releases keys; no new program should start until the old one has terminated.`,
  interaction: `Prefer mc_interact for one bounded block interaction with actual hit/range and before/after checks, without writing Python. It is available when Minescript is explicitly enabled; it does not need a separately installed helper. Inspect script.result.outcome and actual inventory/notices; a program report is not a completed goal.
Minescript 4.0 interactions: execute("/help") submits a server command; flush() waits for this job's prior API requests, not the server's gameplay effect. Read fresh mc_notices for the reply.
player_look_at(x+.5,y+.5,z+.5) uses Minecraft view orientation correctly. Inspect reach and screen before using a held item. Native mc_do operation:use holds use for bounded ticks; operation:hotbar uses slot 0..8. An unintended menu (including a backpack) can mean the held item was wrong. Inspect actual inventory and selectedSlot before trying again.
For explicit Python key input, player_press_attack(True/False) holds/releases attack and player_press_use(True/False) holds/releases use. Alternatively press_key_bind("key.attack", True/False) or "key.use" uses full key mapping names. There is no minescript.press_key, release_key or Input context manager. Use try/finally release and flush; recheck the actual crosshair target, reach and block/inventory change. The key API does not provide navigation or server permission.
Python timing: import time; time.sleep(0.25). Hold keys only with try/finally release and flush before/after. A script result or input dispatch does not prove harvest, planting, combat damage or a server skill succeeded; verify actual block/inventory/server changes.`,
  inventory: `Minescript 4.0 player_inventory() returns ItemStack dataclasses by default, not arbitrary dictionaries. Use dataclasses.asdict(item) or item.slot/item.item/item.count as supported by the pinned API. Assigning dataclasses to result is supported by the native wrapper.
Prefer mc_bag for real display names and full component pages, selectedSlot, menu slots and cursor. player_inventory_select_slot(slot) selects hotbar 0..8; player_inventory_slot_to_hotbar(slot) swaps a real inventory slot to hotbar. mc_do hotbar/menu_click preserves the native queue and actual screenToken. Do not mix inventory indexes with an open container's menu slot indexes.
Use the current screenToken for menu_click/close_screen, and inspect fresh slots/cursor after each click. A player_head may carry a custom server item identity; use its actual displayName/components rather than texture or slot position.`,
};
export function javaScriptHelp(topic = 'index'): string {
  if (!Object.hasOwn(PAGES, topic)) throw new Error('Unknown Python API page. Use index, blocks, movement, interaction or inventory.');
  return PAGES[topic];
}

/** Explain an observed API error. Never rewrite, retry or execute the caller's program. */
export function javaScriptErrorHelp(error: unknown): string | undefined {
  if (typeof error !== 'string') return;
  // Signatures and key names are from the pinned upstream v4.0 reference above.
  if (error.includes('No key mapping with name')) return 'Minescript 4.0 press_key_bind uses full names such as "key.attack", "key.use" and "key.forward", not "attack"/"use"/"forward". Release held keys in finally and flush. Read mc_script api:interaction.';
  const member = /module ['"]minescript['"] has no attribute ['"]([a-zA-Z_][a-zA-Z_0-9]*)['"]/.exec(error)?.[1];
  if (!member) return;
  const fixes: Record<string,string> = {
    equipment_hotbar_select: 'Use mc_do operation:hotbar with a discovered slot input, or minescript.player_inventory_select_slot(slot), slot 0..8. Read mc_script api:inventory.',
    block_at: 'Use mc_probe for bounded typed block observations, or minescript.getblock(x,y,z)/getblocklist(points). They return namespaced strings, not state dictionaries. Read mc_script api:blocks.',
    state: 'Use mc_state for actual native body state, or minescript.player_position()/player_orientation()/player_inventory() for specific readings. Read mc_script api:index.',
    sleep: 'Use import time; time.sleep(seconds) inside the admitted timeout and key cleanup. Read mc_script api:movement.',
    press_key: 'Use minescript.player_press_attack(True/False), player_press_use(True/False), or press_key_bind("key.attack", True/False). Full key mapping names are required. Release in finally and flush. Read mc_script api:interaction.',
    release_key: 'Use the same player_press_attack/player_press_use or press_key_bind API with False in finally, then flush. Read mc_script api:interaction.',
    Input: 'Minescript 4.0 has no Input context manager. Use bounded player_press_attack/player_press_use or press_key_bind calls with try/finally release and flush. Read mc_script api:interaction.',
    left_click_block: 'Aim using minescript.player_look_at(x+.5,y+.5,z+.5), then use bounded minescript.player_press_attack(True/False) with try/finally release and flush. Verify actual blocks/inventory. Read mc_script api:interaction.',
  };
  return `Observed unsupported Minescript 4.0 member: ${member}. ${fixes[member] ?? 'Read mc_script api:index and its focused pages before selecting a different program.'} No correction was executed; reconcile any earlier effects before a new action.`;
}
