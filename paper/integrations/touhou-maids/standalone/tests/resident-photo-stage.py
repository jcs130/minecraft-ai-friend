"""Real native-rendered photograph + original NPC ownership and physical stash delivery.

Caller must configure an independent native camera and ImageFrame in the marked QA server.
Never substitutes a synthetic PNG or bypasses the camera's identity/model/lease checks.
"""
import importlib.util, json, time, uuid
from pathlib import Path


def exercise(stage,actor,peer,report):
    spec=importlib.util.spec_from_file_location('gameplay',Path(__file__).with_name('resident-gameplay-stage.py'))
    suite=importlib.util.module_from_spec(spec);spec.loader.exec_module(suite)
    test=suite.Exercise(stage,report);test.evidence.update(actor=actor,peer=peer)
    before=json.loads(test.cmd('companiontest body '+actor))
    test.evidence['beforeBody']=before
    baseline=json.loads(test.cmd('companiontest player-count'))['onlinePlayers']
    test.check('camera_connections_are_distinct_from_native_body',baseline==2)
    name='Resident_'+uuid.uuid4().hex[:12]
    original=str(uuid.uuid4());payload={'action':'cli','command':'photo take '+name+' third 1 --story 在自己生活的世界留下真实照片。'}
    ack=test.resident('resident '+actor+' act '+original+' '+json.dumps(payload,ensure_ascii=False))
    test.check('photo_accepted_under_original_request',ack['status']=='accepted')
    row=test.stock.until(lambda:(r if (r:=test.resident('resident '+actor+' receipt '+original))['status']!='accepted' else None),115)
    test.evidence['receipt']=row;test.save()
    test.check('real_photo_reports_completion',row['status']=='completed')
    maps=json.loads(test.cmd('companiontest photo-proof '+actor))['maps']
    test.check('real_imageframe_map_is_owned_by_npc',any(x['owner']==actor and x['name']==name and x['valid'] for x in maps))
    peer_maps=json.loads(test.cmd('companiontest photo-proof '+peer))['maps']
    test.check('no_photo_credited_to_peer_or_creator',not any(x['name']==name for x in peer_maps))
    test.service(actor,'arena stash collect')
    stash=test.service(actor,'arena stash list 1')['serviceReceipt']['items']
    photo=next((x for x in stash if x['baseId']=='minecraft:filled_map'),None)
    test.check('actual_map_in_own_personal_box',photo is not None and photo['count']==1)
    transfer=test.service(actor,'arena stash take '+str(photo['slot'])+' 1')
    test.check('actual_map_can_be_taken_to_native_bag',transfer['status']=='completed' and transfer['serviceReceipt']['moved']==1
        and any(x['id']=='minecraft:filled_map' and x['count']==1 for x in test.items(actor)))
    repeated=test.resident('resident '+actor+' receipt '+original)
    test.check('original_photo_receipt_not_rewritten_or_replayed',repeated==row)
    after=json.loads(test.cmd('companiontest body '+actor))
    test.evidence['afterBody']=after;test.save()
    test.check('photo_preserves_original_body',all(after[k]==before[k] for k in ('uuid','owner','ysm','dimension')))
    test.check('photo_releases_its_motion_hold',not after['residentHoldsPosition'] and not after['noAi'])
    request=str(uuid.uuid4());target={'x':101,'y':81,'z':100}
    moved=test.resident('resident '+actor+' act '+request+' '+json.dumps({'action':'walk','at':target}))
    test.check('post_photo_native_walk_accepted',moved['status']=='accepted')
    moved=test.stock.until(lambda:(r if (r:=test.resident('resident '+actor+' receipt '+request))['status']!='accepted' else None),95)
    walking=json.loads(test.cmd('companiontest body '+actor));test.evidence['afterWalk']=walking
    test.check('post_photo_native_walk_really_reaches_target',moved['status']=='completed' and abs(walking['position'][0]-101.5)<1.6)
    test.check('photo_did_not_create_an_npc_player_connection',json.loads(test.cmd('companiontest player-count'))['onlinePlayers']==baseline)
    test.evidence.update(passed=True,maps=maps,stashItem=photo);test.save()


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',type=Path,required=True);parser.add_argument('--resident',type=uuid.UUID,required=True)
    parser.add_argument('--peer',type=uuid.UUID,required=True);parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    if args.resident==args.peer:parser.error('distinct synthetic bodies required')
    exercise(args.stage,str(args.resident),str(args.peer),args.report)
