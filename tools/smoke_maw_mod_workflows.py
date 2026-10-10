"""Actual loaded-mod workflows, with all operator fixtures recorded by the driver."""
import math
import time

def workflows(a):
    c=a.console
    def face(name,xyz,target):
        dx=target[0]-xyz[0];dy=target[1]-xyz[1]-1.62;dz=target[2]-xyz[2]
        c(f'tp {name} {xyz[0]} {xyz[1]} {xyz[2]} {math.degrees(math.atan2(-dx,dz))} {-math.degrees(math.atan2(dy,math.hypot(dx,dz)))}')
    def state():return a.query('menu.snapshot')['state']
    def pickup(slot):
        s=state();item=s['slots'][slot];cursor=s['carried']
        return a.mutation('menu.pickup',{'windowId':s['windowId'],'expectedStateId':s['stateId'],'slot':slot,'button':0,'expectedItemId':item['id'] if item else 'minecraft:air','expectedCount':item['count'] if item else 0,'expectedSnbt':item['snbt'] if item else '', 'expectedCarriedSnbt':cursor['snbt'] if cursor else ''})
    def close():
        s=state();return a.mutation('menu.close',{'windowId':s['windowId'],'expectedStateId':s['stateId']})
    def look():return a.query('world.look')
    def interact(aid=None):
        s=state();l=look();assert l['ok'],l
        return a.mutation('world.interact',{'position':l['position'],'aimOffset':[l['hit']['cursor'][k] for k in ('x','y','z')],'expectedBlockId':l['block']['id'],'expectedProperties':l['block']['properties'],'expectedHotbarSlot':s['selectedHotbarSlot'],'expectedHeldSnbt':s['self']['equipment']['mainhand']['snbt'] if s['self']['equipment']['mainhand'] else ''},aid)
    def total(s,item):return sum(x['count'] for x in s['slots'] if x and x['id']==item)
    c('gamerule doDaylightCycle false');c('time set day');c('gamerule doWeatherCycle false');c('weather clear');c('setworldspawn 0 64 0');c('gamerule keepInventory true')
    catalog=a.rpc('mod_operations');a.check('native_contract_34_real_handlers',catalog['operationCount']==34 and len(catalog['operations'])==34)
    a.check('exact_operation_schema',a.rpc('mod_operations',{'operation':'colony.stockResource'})['operation']['parameters']['additionalProperties'] is False)
    made=a.rpc('create_companion',{'name':'MawModBody','action_id':'mod-audit-create-01'});a.body=made['bodyId'];assert made['online'],made
    lease=a.rpc('claim_control',{'companion':a.body,'controller_id':'isolated-mod-audit'});a.lease=lease['lease']['leaseId']
    a.check('numen_no_op_survival',a.rpc('get_state',{'companion':a.body})['permissionMode']=='ask')
    blocked=a.mutation('curios.open',expect=False);a.check('numen_ask_policy_preserved',blocked['code']=='numen_bypass_mode_required_for_mod_actions')
    a.rpc('set_permission',{'companion':a.body,'lease_id':a.lease,'mode':'bypass'})
    bad=a.query('menu.snapshot',{'playerUuid':a.credentials['owner']});a.check('native_arguments_cannot_impersonate_player',not bad['ok'] and bad['code']=='invalid_mod_arguments')
    switched=a.rpc('mod_query',{'companion':a.body,'operation':'curios.open'});a.check('read_route_cannot_mutate',not switched['ok'] and switched['code']=='mod_read_write_mismatch')
    # Farmer's Delight: query every declared result without rolling random outputs.
    recipes=a.query('native.recipes',{'recipeType':'farmersdelight:cutting','outputId':'minecraft:bone_meal','limit':12})
    a.check('cutting_recipe_secondary_output_discoverable',recipes['ok'] and any(r['recipeId']=='farmersdelight:cutting/chicken' and any(o['item']['id']=='minecraft:bone_meal' for o in r['processing']['rollableResults']) for r in recipes['recipes']))
    c('clear MawModBody');c('setblock 20 64 20 farmersdelight:cutting_board');face('MawModBody',(20.5,64,19.1),(20.5,64.12,20.5))
    c('item replace entity MawModBody hotbar.0 with minecraft:beef 1')
    held=state()['self']['equipment']['mainhand'];a.check('fd_real_raw_beef_fixture',held and held['id']=='minecraft:beef')
    interact('fd-board-input-01');board=look();a.check('fd_board_real_stored_item',board['block']['farmersDelight']['storedItem']['id']=='minecraft:beef' and total(state(),'minecraft:beef')==0)
    c('item replace entity MawModBody hotbar.0 with farmersdelight:iron_knife 1')
    interact('fd-board-cut-01');time.sleep(1.0)
    # Move within the native pickup radius; the result itself is never given.
    face('MawModBody',(20.5,64,20.0),(20.5,64.12,20.5));time.sleep(.8)
    sliced=state();a.check('fd_cutting_actual_outputs_and_knife_damage',total(sliced,'farmersdelight:minced_beef')==2 and 'damage' in sliced['self']['equipment']['mainhand']['snbt'])
    # Cooking pot: real heat, six native ingredient slots, bowl and served output.
    c('clear MawModBody');c('setblock 30 64 20 farmersdelight:stove[lit=true]');c('setblock 30 65 20 farmersdelight:cooking_pot')
    face('MawModBody',(30.5,64,18.3),(30.5,65.3,20.5));c('item replace entity MawModBody hotbar.0 with farmersdelight:rice 2');c('item replace entity MawModBody hotbar.1 with minecraft:bowl 2')
    interact('fd-open-pot-01');s=state();a.check('fd_pot_native_menu_layout_heat',s['menuType']=='farmersdelight:cooking_pot' and s['slotRoles'][:9]==['ingredient']*6+['cooked_meal_buffer','serving_container','served_output'] and s['cookingPot']['isHeated'])
    pickup(next(i for i,x in enumerate(s['slots']) if x and x['id']=='farmersdelight:rice'));pickup(0)
    s=state();pickup(next(i for i,x in enumerate(s['slots']) if x and x['id']=='minecraft:bowl'));pickup(7)
    progress=[];deadline=time.monotonic()+18
    while time.monotonic()<deadline:
        s=state();progress.append(s.get('dataValues'))
        if s['slots'][8] and s['slots'][8]['id']=='farmersdelight:cooked_rice' and s['slots'][8]['count']==2:break
        time.sleep(.6)
    a.check('fd_cooking_real_progress_two_servings',s['slots'][8] and s['slots'][8]['count']==2 and any(v and v[0]>0 for v in progress),progress)
    # Full component CAS rejects a stale window without taking anything.
    wrong={'windowId':s['windowId'],'expectedStateId':s['stateId']-1,'slot':8,'button':0,'expectedItemId':s['slots'][8]['id'],'expectedCount':2,'expectedSnbt':s['slots'][8]['snbt'],'expectedCarriedSnbt':''}
    refused=a.mutation('menu.pickup',wrong,expect=False);a.check('fd_stale_menu_rejected_without_loss',not refused['ok'] and refused['outcome']['code']=='stale_menu_state' and state()['slots'][8]['count']==2)
    pickup(8);s=state();destination=next(i for i in range(9,len(s['slots'])) if s['slots'][i] is None);pickup(destination);close();s=state()
    a.check('fd_take_real_food_components',total(s,'farmersdelight:cooked_rice')==2 and s['carried'] is None and any(x and x['id']=='farmersdelight:cooked_rice' and x.get('food') for x in s['slots']))
    # The same ordinary Mineflayer connection can open/read/close the actual pot.
    c('tp MawModQA 30.5 64 18.3');time.sleep(.3)
    a.player('call',operation='inventory.select',arguments={'hotbarSlot':8,'expectedId':'minecraft:air'})
    a.player('look',x=30.5,y=65.3,z=20.5)
    observed=a.player('call',operation='world.look');ps=a.player('call',operation='menu.current')
    opened=a.player('call',operation='world.interact',arguments={'position':observed['position'],'expectedBlockId':observed['block']['id'],'expectedProperties':observed['block']['properties'],'expectedHeldSnbt':'','expectedHotbarSlot':8})
    time.sleep(.3);ordinary=a.player('call',operation='menu.current')
    a.check('mineflayer_fd_native_menu_same_mechanics',opened['ok'] and ordinary['menuType']=='farmersdelight:cooking_pot' and ordinary['cookingPot']['isHeated'] and ordinary['playerUuid']==a.credentials['owner'])
    a.player('call',operation='menu.close')
    # Real powered Create millstone, fed through a native hopper inventory.
    c('clear MawModBody');c('setblock 40 63 20 create:creative_motor[facing=up]');c('setblock 40 64 20 create:millstone');c('setblock 40 65 20 minecraft:hopper[facing=down]')
    face('MawModBody',(40.5,64,18.2),(40.5,65.5,20.5));c('item replace entity MawModBody hotbar.0 with minecraft:wheat 1')
    interact();s=state();a.check('create_real_hopper_menu',s['menuType']=='minecraft:hopper')
    pickup(next(i for i,x in enumerate(s['slots']) if x and x['id']=='minecraft:wheat'));pickup(0);close()
    face('MawModBody',(40.5,64,18.2),(40.5,64.5,20.5));deadline=time.monotonic()+22;mill=None
    while time.monotonic()<deadline:
        mill=look();processing=mill.get('block',{}).get('processing',{})
        if 'wheat_flour' in str(processing):break
        time.sleep(.5)
    a.check('create_actual_power_and_milling',mill['ok'] and abs(mill['block']['kinetic']['speed'])>0 and 'wheat_flour' in str(mill['block'].get('processing')),mill)
    interact();time.sleep(.3);a.check('create_real_output_taken',total(state(),'create:wheat_flour')>=1 and total(state(),'minecraft:wheat')==0)
    # Real Domum materials: choose the native group/variant with full CAS, then
    # take the actual output. Preview templates must never become free items.
    def cutter_query(operation='domum.state',args=None):
        time.sleep(.65) # Respect the native shared 10-tick query budget.
        result=a.query(operation,args);assert result['ok'],result
        return result
    c('clear MawModBody');c('setblock 50 64 20 domum_ornamentum:architectscutter');face('MawModBody',(50.5,64,18.2),(50.5,64.5,20.5))
    c('item replace entity MawModBody hotbar.1 with minecraft:cobblestone 2');interact()
    cutter=cutter_query()['state'];group=next(g['groupId'] for g in cutter['groups'] if g['groupId'].endswith('panel'))
    def select_cutter(selection,**extra):
        current=cutter_query()['state']
        args={'selection':selection,'groupId':group,'windowId':current['windowId'],'expectedStateId':current['stateId'],'expectedPosition':current['position'],'expectedGroup':current['currentGroup'],'expectedVariantSnbt':current['currentVariant']['snbt'],'expectedInputsSnbt':[row['item']['snbt'] for row in current['inputs']],'expectedCarriedSnbt':current['carried']['snbt'],'expectedOutputSnbt':current['output']['snbt'],**extra}
        return a.mutation('domum.select',args)
    selected=select_cutter('group');a.check('numen_domum_group_selection_native',selected['ok'] and selected['outcome']['state']['currentGroup']==group)
    choices=cutter_query('domum.choices',{'groupId':group,'offset':0,'limit':24})
    choice=choices['choices'][0]
    selected=select_cutter('variant',variantIndex=choice['variantIndex'],choiceSnbt=choice['variant']['snbt'])
    a.check('numen_domum_variant_selection_native',selected['ok'])
    s=state();pickup(next(i for i,x in enumerate(s['slots']) if x and x['id']=='minecraft:cobblestone'));pickup(0)
    cutter=cutter_query()['state'];a.check('numen_domum_real_material_output',cutter['output']['id']=='domum_ornamentum:panel' and cutter['output']['count']==4 and 'texture_data' in cutter['output']['snbt'])
    a.check('native_menu_slot_owner_mapping',sum(row['owner']=='player_inventory' for row in state()['slotLayout'])==36)
    for _ in range(2):
        pickup(cutter['outputSlot']);s=state();pickup(next(row['slot'] for row in s['slotLayout'] if row['owner']=='player_inventory' and s['slots'][row['slot']] is None))
    close()
    a.check('numen_domum_exact_material_consumption',total(state(),'minecraft:cobblestone')==0 and total(state(),'domum_ornamentum:panel')==8)
    # Colony creation and orders are real native operations by a non-OP body.
    c('clear MawModBody');face('MawModBody',(600.5,64,598.5),(600.5,64,600.5));c('item replace entity MawModBody hotbar.0 with minecolonies:blockhuttownhall 1')
    s=state();args={'position':{'x':600,'y':64,'z':600},'name':'原生接口验收城','inventorySlot':0,'expectedSnbt':s['slots'][36]['snbt']}
    founded=a.mutation('colony.found',args,'colony-found-01');cid=founded['outcome']['colonyId']
    a.check('numen_colony_founding_consumes_real_item',founded['ok'] and total(state(),'minecolonies:blockhuttownhall')==0)
    replay=a.rpc('mod_action',{'companion':a.body,'lease_id':a.lease,'action_id':'colony-found-01','operation':'colony.found','arguments':dict(reversed(list(args.items())))})
    a.check('native_mutation_durable_dedup_canonical_args',replay['replayed'] and replay['phase']=='terminal' and replay['fingerprint']==founded['fingerprint'])
    conflict=a.rpc('mod_action',{'companion':a.body,'lease_id':a.lease,'action_id':'colony-found-01','operation':'colony.found','arguments':{**args,'name':'Different'}})
    a.check('native_same_id_changed_intent_rejected',not conflict['ok'] and conflict['code']=='action_id_conflict')
    c('item replace entity MawModBody hotbar.0 with minecolonies:blockhutbuilder 1');s=state()
    placed=a.mutation('colony.placeBuilder',{'position':{'x':603,'y':64,'z':600},'inventorySlot':0,'expectedSnbt':s['slots'][36]['snbt']})
    a.check('numen_colony_builder_real_item_and_registration',placed['ok'] and total(state(),'minecolonies:blockhutbuilder')==0)
    face('MawModBody',(604.5,64,598.5),(606.5,64,600.5));c('item replace entity MawModBody hotbar.0 with minecolonies:blockhutcitizen 1');s=state()
    placed=a.mutation('colony.placeHut',{'position':{'x':606,'y':64,'z':600},'hutType':'home','inventorySlot':0,'expectedSnbt':s['slots'][36]['snbt']})
    a.check('numen_colony_home_real_item_and_registration',placed['ok'] and total(state(),'minecolonies:blockhutcitizen')==0)
    premature=a.mutation('colony.requestBuild',{'buildingPosition':{'x':606,'y':64,'z':600},'builderPosition':{'x':603,'y':64,'z':600}},expect=False)
    a.check('colony_native_builder_level_prerequisite_preserved',not premature['ok'] and premature['outcome']['code']=='native_build_request_not_accepted')
    requested=a.mutation('colony.requestBuild',{'buildingPosition':{'x':603,'y':64,'z':600},'builderPosition':{'x':603,'y':64,'z':600}})
    a.check('numen_colony_real_work_order',requested['ok'] and requested['outcome']['workOrder']['id']>0)
    time.sleep(.6);managed=a.query('colony.management',{'buildingPosition':{'x':603,'y':64,'z':600}})
    a.check('numen_colony_native_management_read',managed['ok'] and managed['playerUuid']==a.body,managed)
    c('tp MawModQA 604.5 64 598.5');time.sleep(.4)
    visitor=a.player('call',operation='colony.management',arguments={'buildingPosition':{'x':603,'y':64,'z':600}})
    a.check('colony_visitor_private_data_denied',not visitor['ok'] and visitor['code']=='not_colony_member')
    # Native Curios and YSM read/control remain owner-bound, no invented slots/models.
    native=a.query('curios.state');a.check('numen_curios_real_slots',native['ok'] and 'state' in native)
    open_curios=a.mutation('curios.open',aid='curios-native-open-01');a.check('numen_curios_native_menu',open_curios['ok'] and state()['menuType']=='curios:curios_container');close()
    ysm=a.query('ysm.catalog',{'offset':0,'limit':3});a.check('numen_ysm_native_catalog',ysm['ok'] and 'state' in ysm)
    a.check('all_numen_receipts_same_body',all(not t['result'].get('playerUuid') or t['result']['playerUuid']==a.body for t in a.report['trace'] if t.get('kind')=='mcp' and t.get('operation')=='mod_query'))
    inspect=a.player('inspect');a.check('native_results_not_game_chat',not any('mod_receipt' in s or 'colony_receipt' in s or 'MC_PROTECT' in s for s in inspect['chatter']))
    a.rpc('dormant_companion',{'companion':a.body,'lease_id':a.lease})
