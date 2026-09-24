"""Auditable initial programs; installed through draft/test/promote, never at startup.

These are starting points for agent refinements, not claims of learned mastery.
Parameterized programs deliberately require real targets supplied by cognition.
"""
import copy
import json


COMMON = '''
function stop(m, why) { return {action:null,memory:m,replan:true,reason:why}; }
function finish(s,m,effect) {
  const e=(s.execution||{}).lastExecution||{};
  if(e.status!=="succeeded" || e.completionConfirmed!==true)
    return stop(m,"native_completion_not_confirmed");
  return effect ? {action:null,memory:m,done:true,reason:"receipt_and_effect_checked"}
                : stop(m,"effect_not_observed");
}
function count(s,id) { return (s.counts||{})[id]||0; }
function ready(s) { return s.ok===true && s.counts && s.task && s.task.busy===false; }
'''


def body(counts=None, **values):
    return {'ok': True, 'counts': counts or {}, 'task': {'busy': False}, 'hunger': 20,
            'equipment': {}, 'position': {'x': 0, 'y': 64, 'z': 0}, **values}


def _record(name, description, source, positive, tool, intents=None, maintenance=False, memory=None):
    fixture = {'state': positive, 'memory': memory or {}, 'expectedActionTool': tool}
    fixtures = [fixture, {'state': body(), 'expectedActionTool': None, 'replan': True},
                {'state': body(), 'memory': {'sent': True}, 'expectedActionTool': None, 'replan': True},
                {'state': body(ok=False), 'expectedActionTool': None, 'replan': True}]
    result = {'name': 'base_' + name, 'description': description, 'source': COMMON + source, 'fixtures': fixtures}
    if intents:
        result['routing'] = {'intents': intents, 'maintenance': maintenance}
    return result


def bundle():
    rows = []
    foods = ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
             'cooked_salmon', 'cooked_cod', 'bread', 'baked_potato', 'carrot', 'apple']
    rows.append(_record('eat', '饥饿不高于16时吃一份随身安全食物；核对进食回执和饥饿恢复。', '''
function next(s,m) {
 if(m.sent) return finish(s,m,s.hunger>m.hunger);
 if(!ready(s) || !(s.hunger<=16)) return stop(m,"not_hungry_or_unknown");
 const item=%s.map(x=>"minecraft:"+x).find(x=>count(s,x)>0);
 if(!item) return stop(m,"no_safe_food");
 return {memory:{sent:true,hunger:s.hunger},action:{tool:"eat",args:{item_id:item}}};
}''' % json.dumps(foods), body({'minecraft:bread': 1}, hunger=12), 'eat', ['吃饭', '饥饿', 'eat'], True))
    # Explicit equipment purpose prevents pickaxe/sword/axe oscillation.
    for suffix, slot, intents in [
        ('pickaxe', 'mainhand', ['镐子', '采矿', '铁镐', 'pickaxe', 'mining']),
        ('axe', 'mainhand', ['斧头', '伐木', 'chop']),
        ('shovel', 'mainhand', ['铲子', '挖土', 'shovel']),
        ('hoe', 'mainhand', ['锄头', '耕地', 'hoe']),
        ('sword', 'mainhand', ['铁剑', '战斗', 'sword', 'combat']),
        ('helmet', 'head', ['头盔', '护甲', 'armor']),
        ('chestplate', 'chest', ['胸甲', '护甲', 'armor']),
        ('leggings', 'legs', ['护腿', '护甲', 'armor']),
        ('boots', 'feet', ['靴子', '护甲', 'armor']),
    ]:
        items = ['minecraft:' + material + '_' + suffix for material in
                 (['netherite', 'diamond', 'iron', 'chainmail', 'golden', 'leather'] if slot != 'mainhand'
                  else ['netherite', 'diamond', 'iron', 'stone', 'wooden', 'golden'])]
        source = '''function next(s,m) {
 const slot=%s, items=%s, current=((s.equipment||{})[slot]||{}).item;
 if(m.sent) return finish(s,m,current===m.item);
 if(!ready(s)) return stop(m,"body_unavailable");
 const item=items.find(x=>count(s,x)>0 || x===current);
 if(!item || item===current) return stop(m,"no_upgrade_available");
 return {memory:{sent:true,item:item},action:{tool:"equip_item",args:{item_id:item,action:"equip",slot:slot}}};
}''' % (json.dumps(slot), json.dumps(items))
        rows.append(_record('equip_' + suffix, '装备已有的合适' + suffix + '；不制造或赠送装备，核对实际装备栏。', source,
                            body({'minecraft:iron_' + suffix: 1}), 'equip_item', intents))
    rows.append(_record('equip_shield', '副手装备已有盾牌并核对装备栏。', '''function next(s,m) {
 const current=((s.equipment||{}).offhand||{}).item;
 if(m.sent) return finish(s,m,current==="minecraft:shield");
 if(!ready(s)||count(s,"minecraft:shield")<1||current==="minecraft:shield") return stop(m,"shield_unavailable_or_equipped");
 return {memory:{sent:true},action:{tool:"equip_item",args:{item_id:"minecraft:shield",action:"equip",slot:"offhand"}}};
}''', body({'minecraft:shield': 1}), 'equip_item', ['盾牌', '防御', 'shield']))
    wood = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry']
    rows.append(_record('craft_planks', '用一根已有原木合成相应木板；核对原生完成与木板增加。', '''function next(s,m) {
 if(m.sent) return finish(s,m,count(s,m.output)>m.before);
 if(!ready(s)) return stop(m,"body_unavailable");
 const wood=%s.find(x=>count(s,"minecraft:"+x+"_log")>0);
 if(!wood) return stop(m,"missing_log");
 const out="minecraft:"+wood+"_planks";
 return {memory:{sent:true,output:out,before:count(s,out)},action:{tool:"craft",args:{item_id:out,count:1}}};
}''' % json.dumps(wood), body({'minecraft:oak_log': 1}), 'craft', ['木板', 'plank']))
    # Counts are one recipe batch. Workstation recipes are opt-in with a verified
    # table coordinate; holding a table in inventory is not a placed workbench.
    recipes = [
        ('stick', {'planks': 2}, False, ['木棍', 'stick']),
        ('crafting_table', {'planks': 4}, False, ['工作台', 'crafting_table']),
        ('torch', {'fuel': 1, 'minecraft:stick': 1}, False, ['火把', 'torch']),
        ('bread', {'minecraft:wheat': 3}, True, None),
        ('chest', {'planks': 8}, True, None),
        ('furnace', {'minecraft:cobblestone': 8}, True, None),
        ('wooden_pickaxe', {'planks': 3, 'minecraft:stick': 2}, True, None),
        ('stone_pickaxe', {'minecraft:cobblestone': 3, 'minecraft:stick': 2}, True, None),
        ('iron_pickaxe', {'minecraft:iron_ingot': 3, 'minecraft:stick': 2}, True, None),
        ('stone_axe', {'minecraft:cobblestone': 3, 'minecraft:stick': 2}, True, None),
        ('iron_sword', {'minecraft:iron_ingot': 2, 'minecraft:stick': 1}, True, None),
        ('shield', {'planks': 6, 'minecraft:iron_ingot': 1}, True, None)]
    for item, inputs, table, intents in recipes:
        source = '''function next(s,m) {
 const out=%s, inputs=%s;
 if(m.sent) return finish(s,m,count(s,out)>m.before);
 if(!ready(s)) return stop(m,"body_unavailable");
 const have=k=>k==="planks"?Object.keys(s.counts).filter(x=>/^minecraft:(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry)_planks$/.test(x)).reduce((n,x)=>n+count(s,x),0):
   k==="fuel"?count(s,"minecraft:coal")+count(s,"minecraft:charcoal"):count(s,k);
 if(Object.keys(inputs).some(k=>have(k)<inputs[k])) return stop(m,"missing_materials");
 if(%s) {
   if(!m.table || !["x","y","z"].every(k=>Number.isInteger(m.table[k]))) return stop(m,"known_table_position_required");
   const obs=(s.execution||{}).observation, r=(obs||{}).result||{};
   if(!obs) return {memory:m,observe:{tool:"inspect_block",args:m.table}};
   const b=r.result||r;
   if(!obs.fresh || obs.tool!=="inspect_block" || JSON.stringify(obs.args)!==JSON.stringify(m.table) ||
      r.ok===false || b.block!=="minecraft:crafting_table" || b.in_reach!==true) return stop(m,"placed_table_not_verified");
 }
 return {memory:{sent:true,before:count(s,out)},action:{tool:"craft",args:{item_id:out,count:1}}};
}''' % (json.dumps('minecraft:' + item), json.dumps(inputs), str(table).lower())
        counts = {('minecraft:oak_planks' if k == 'planks' else 'minecraft:coal' if k == 'fuel' else k): v for k, v in inputs.items()}
        point = {'x': 0, 'y': 64, 'z': 1}
        state = body(counts)
        if table:
            state['execution'] = {'observation': {'tool': 'inspect_block', 'args': point, 'fresh': True,
                                                 'result': {'block': 'minecraft:crafting_table', 'in_reach': True}}}
        row = _record('craft_' + item, '合成一批' + item + ('，须memory.table为真实工作台坐标' if table else '，背包2×2合成') + '；材料不足交回规划。',
                      source, state, 'craft', intents, memory={'table': point} if table else None)
        if table:
            row['fixtures'].append({'state': body(counts), 'memory': {'table': point},
                                    'expectedObserve': {'tool': 'inspect_block', 'args': point}})
            row['fixtures'].append({'state': body(counts), 'expectedActionTool': None, 'replan': True})
        rows.append(row)
    rows.append(_record('goto', '沿已有导航到memory.target坐标（24格内）；只有原生完成且到达才结束。', '''function next(s,m) {
 const p=s.position||{}, t=m.target;
 if(!t||!["x","y","z"].every(k=>Number.isFinite(t[k])&&Number.isFinite(p[k]))) return stop(m,"known_target_required");
 const d=Math.hypot(p.x-t.x,p.y-t.y,p.z-t.z);
 if(m.sent) return finish(s,m,d<=2);
 if(!ready(s)||d>24||d<=2) return stop(m,"target_not_applicable");
 return {memory:{sent:true,target:t},action:{tool:"goto",args:t}};
}''', body(), 'goto', memory={'target': {'x': 4, 'y': 64, 'z': 0}}))
    # The gateway independently enforces actual farm maturity, reach and town
    # protection. This script never loops on a rejected interaction.
    rows.append(_record('harvest_replant', '在memory.target收获后，用memory.seed补种一次；每步均核对原生终态。', '''function next(s,m) {
 if(!ready(s)||!m.target||!["x","y","z"].every(k=>Number.isInteger(m.target[k])) ||
    !["minecraft:wheat_seeds","minecraft:beetroot_seeds","minecraft:carrot","minecraft:potato"].includes(m.seed)) return stop(m,"known_crop_and_seed_required");
 if(m.sent) {
   const e=(s.execution||{}).lastExecution||{};
   if(e.status!=="succeeded"||e.completionConfirmed!==true) return stop(m,"harvest_or_plant_unconfirmed");
   if(m.planted) return {action:null,memory:m,done:true,reason:"both_native_actions_confirmed"};
   if(count(s,m.seed)<1) return stop(m,"no_seed_after_harvest");
   return {memory:{...m,planted:true},action:{tool:"farm",args:{...m.target,operation:"plant",item_id:m.seed}}};
 }
 return {memory:{...m,sent:true},action:{tool:"farm",args:{...m.target,operation:"harvest",item_id:null}}};
}''', body({'minecraft:wheat_seeds': 1}), 'farm', memory={'target': {'x': 0, 'y': 64, 'z': 1}, 'seed': 'minecraft:wheat_seeds'}))
    rows.append(_record('sleep', '尝试在memory.target已知床位入睡一次；成功仅表示开始睡眠。', '''function next(s,m) {
 if(m.sent) return finish(s,m,true);
 if(!ready(s)||!m.target||!["x","y","z"].every(k=>Number.isInteger(m.target[k]))) return stop(m,"known_bed_required");
 return {memory:{sent:true},action:{tool:"sleep",args:m.target}};
}''', body(), 'sleep', memory={'target': {'x': 0, 'y': 64, 'z': 1}}))
    from navigation_program import record as navigation_record, motion_record
    rows.append(navigation_record())
    rows.append(motion_record())
    return rows


def install(library):
    """Idempotent and preserves agent edits: never replace an existing name."""
    existing = {r['name'] for r in library.catalog()['skills']}
    result = []
    for row in bundle():
        if row['name'] in existing:
            result.append({'name': row['name'], 'installed': False, 'reason': 'existing_preserved'})
            continue
        draft = library.draft(**row)
        report = library.test(row['name'], draft['version'])
        if not report['passed']:
            raise ValueError('starter_fixture_failed:' + row['name'])
        library.promote(row['name'], draft['version'])
        result.append({'name': row['name'], 'version': draft['version'], 'installed': True,
                       'cases': len(report['cases']), 'automatic': 'routing' in row})
    return result
