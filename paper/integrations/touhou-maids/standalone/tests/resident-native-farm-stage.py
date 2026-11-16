"""Native TLM farm work -> own guild evidence; only a marked disposable loopback world."""
from pathlib import Path
import importlib.util
import json
import time
import uuid

TASK_MARKET = '''schema-version: 1
sites: {}
tasks:
  resident_farm:
    scope: personal
    repeat: once
    title: 收获与补种
    description: 亲自收获成熟小麦并在同一块田补种。
    icon: WHEAT
    reward: {fame: 6, emeralds: 2, bonus: BREAD, bonus-count: 2}
    steps:
      - {title: 收获, description: 收获一格成熟小麦。, goal: harvest, crop: WHEAT, target: 1}
      - {title: 补种, description: 在自己收获的田地补种。, goal: replant, crop: WHEAT, target: 1}
'''


def exercise(stage, actor, peer, report, protected_fixture=False):
    spec=importlib.util.spec_from_file_location('gameplay',Path(__file__).with_name('resident-gameplay-stage.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    test=module.Exercise(stage,report)
    test.evidence.update(actor=actor,peer=peer)
    def act(payload):
        request=str(uuid.uuid4())
        call=test.resident
        ack=call('resident '+actor+' act '+request+' '+json.dumps(payload))
        if ack['status']!='accepted':raise AssertionError(ack)
        return test.stock.until(lambda:(r if (r:=call('resident '+actor+' receipt '+request))['status']!='accepted' else None),90)
    def ready():
        value=test.service(actor,'guild status')['serviceReceipt']['after']
        return value if value.get('status')=='ready_to_submit' else None
    test.cmd('time set noon');test.cmd('gamerule doDaylightCycle false');test.cmd('gamerule doMobSpawning false')
    test.cmd('forceload add 96 96 120 120');test.cmd('companiontest resident-fixture '+actor+' 104')
    initial_xp=test.resident('resident '+actor+' status')['rpg']['workXp']
    test.cmd('setblock 107 81 100 air')
    test.cmd('companiontest item-fixture '+actor+' 3 minecraft:iron_hoe 1')
    result=act({'action':'equip','equipmentSlot':'mainhand','slot':3,'expectedItem':'minecraft:iron_hoe'})
    test.check('native_hoe_equipped',result['status']=='completed')
    result=test.service(actor,'guild accept tm_resident_farm')
    test.check('native_farm_contract_accepted',result['status']=='completed')
    # An immature field is not proof; neither is selecting the working mode.
    test.cmd('setblock 108 80 103 farmland[moisture=7]');test.cmd('setblock 108 81 103 wheat[age=0]')
    test.cmd('setblock 108 80 104 water');test.cmd('gamerule randomTickSpeed 0')
    access=json.loads(test.cmd('companiontest native-permission '+actor+' 108 81 103'))
    test.check('native_gate_initial_permission_matches_fixture',access['destroy'] is (not protected_fixture))
    result=act({'action':'task','task':'touhou_little_maid:farm'})
    time.sleep(4)
    status=test.service(actor,'guild status')['serviceReceipt']['after']
    test.check('selecting_work_and_immature_crops_are_not_progress',result['status']=='completed' and status.get('progress',0)==0)
    test.check('selecting_work_does_not_grant_experience',test.resident('resident '+actor+' status')['rpg']['workXp']==initial_xp)
    # Now allow the original crop AI to act on a physically ripe fixture.
    test.cmd('setblock 108 81 103 wheat[age=7]')
    if protected_fixture:
        time.sleep(5)
        observed=json.loads(test.cmd('companiontest native-permission '+actor+' 108 81 103'))
        test.check('creator_land_rights_not_inherited_by_npc',not observed['destroy'] and 'age=7' in observed['blockState'])
        test.check('denied_native_harvest_does_not_progress',test.service(actor,'guild status')['serviceReceipt']['after'].get('progress',0)==0)
        test.check('denied_harvest_does_not_grant_experience',test.resident('resident '+actor+' status')['rpg']['workXp']==initial_xp)
        test.cmd('rg addmember -w world resident_farm_gate '+actor)
        access=json.loads(test.cmd('companiontest native-permission '+actor+' 108 81 103'))
        test.check('grant_to_npc_own_uuid_enables_native_work',access['destroy'])
    result=test.stock.until(ready,90)
    test.check('original_farming_creates_real_guild_proof',result['progress']==1)
    test.check('native_harvest_advances_own_work_experience',test.resident('resident '+actor+' status')['rpg']['workXp']==initial_xp+1)
    test.check('harvest_yields_real_native_items',any(x['id']=='minecraft:wheat' and x['count']>0 for x in test.items(actor)))
    other=test.service(peer,'guild status')['serviceReceipt']['after']
    test.check('farm_progress_uses_body_not_owner_or_peer',not other['joined'])
    result=test.service(actor,'guild claim')
    test.check('first_stage_does_not_claim_whole_goal',result['status']=='completed' and not result['serviceReceipt']['goalCompleted'])
    # Original TLM planting can precede or follow the claim. Neither requires a
    # second harvest, a simulated player or a synthetic event from this test.
    result=test.stock.until(ready,90)
    test.check('native_replant_at_own_harvest_location_counted',result['progress']==1)
    observed=json.loads(test.cmd('companiontest native-permission '+actor+' 108 81 103'))
    test.check('replant_is_a_real_crop_not_a_counter', 'minecraft:wheat' in observed['blockState'] and 'age=0' in observed['blockState'])
    act({'action':'task','task':'touhou_little_maid:idle'})
    test.cmd('gamerule randomTickSpeed 3')
    result=test.service(actor,'guild claim')
    if result['status']=='blocked' and result['reason']=='verification_throttled':
        detail=result['serviceReceipt']
        test.check('throttle_has_exact_retry_diagnostic',result['retryable'] and 0<result['retryAfterMs']<=1000 and detail['changed'] is False)
        test.check('throttled_request_remains_immutable',test.service(actor,None,result['requestId'])==result)
        time.sleep(detail['retryAfterMs']/1000+.05)
        result=test.service(actor,'guild claim')
    test.check('actual_farm_goal_rewarded_once',result['status']=='completed' and result['serviceReceipt']['goalCompleted'] and result['serviceReceipt']['fame']==6)
    repeated=test.service(actor,None,result['requestId'])
    test.check('farm_goal_original_request_not_rewarded_twice',repeated==result)
    # A resident must sustain a farm when no real player is connected. Accelerate
    # only this disposable world's normal random ticks, never inject growth/events.
    test.cmd('gamerule randomTickSpeed 600')
    def grown():
        value=json.loads(test.cmd('companiontest native-permission '+actor+' 108 81 103'))
        return value if 'age=7' in value['blockState'] else None
    observed=test.stock.until(grown,70)
    test.cmd('gamerule randomTickSpeed 3')
    test.check('real_crop_grows_without_player_connection',observed['light']>=9 and json.loads(test.cmd('companiontest player-count'))['onlinePlayers']==0)
    if protected_fixture:
        test.cmd('rg removemember -w world resident_farm_gate '+actor)
        access=json.loads(test.cmd('companiontest native-permission '+actor+' 108 81 103'))
        test.check('revoked_native_permission_takes_effect',not access['destroy'])
    test.check('farm_does_not_use_player_slot',json.loads(test.cmd('companiontest player-count'))['onlinePlayers']==0)
    test.evidence['passed']=True;test.save()


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',type=Path,required=True);parser.add_argument('--resident',type=uuid.UUID,required=True)
    parser.add_argument('--peer',type=uuid.UUID,required=True);parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--protected-fixture',action='store_true',help='Requires the documented resident_farm_gate fixture in WorldGuard')
    args=parser.parse_args()
    if args.resident==args.peer:parser.error('distinct synthetic bodies required')
    exercise(args.stage,str(args.resident),str(args.peer),args.report,args.protected_fixture)
