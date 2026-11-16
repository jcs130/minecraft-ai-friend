"""Bounded real-model NPC scenario; requires a configured online harness in a marked QA server.

The test specifies an outcome, never supplies the model's next game action.
Model/provider HTTP evidence must be recorded by the isolated harness separately.
No production credentials, forced task completion, automatic action replay or OP grant.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import time
import uuid

GOAL=('你是温和务实的草药师禾穗。今天想为冒险者公会交付鲜花，完成一份相关委托，'
      '然后把自己背包里不需要的铁剑卖给回收商，用得到的金币购买食物补给，'
      '并从个人箱实际取到自己背包里。先通过实际可用的查询找到任务和报价，之后按回执继续。'
      '自己有工具，不出售已装备物品。确认目标完成后休息。不得把接到任务当作已经完成，不要凭空猜任务ID。')


def repeated_failure(turns):
    """Bound failed inference, never replay a physical action to make a test pass."""
    recent=[row['receipt'] for row in turns[-3:]]
    if len(recent)!=3:return None
    if all(row.get('status') in ('failed','timeout','rejected') for row in recent):
        reasons={row.get('reason') for row in recent}
        if len(reasons)==1:return 'repeated_'+str(next(iter(reasons)))
    return None


def exercise(stage, actor, report, max_turns=14):
    spec=importlib.util.spec_from_file_location('gameplay',Path(__file__).with_name('resident-gameplay-stage.py'))
    suite=importlib.util.module_from_spec(spec);spec.loader.exec_module(suite)
    test=suite.Exercise(stage,report)
    read=test.resident
    profile=next(x for x in read('resident-admin list')['residents'] if x['id']==actor)
    configured=profile['profile'].copy();configured.update(autonomous=False,persona=GOAL)
    changed=read('resident-admin apply '+actor+' '+str(uuid.uuid4())+' '+str(profile['revision'])+' '+json.dumps(configured,ensure_ascii=False))
    if changed['status']!='applied':raise AssertionError('synthetic profile not applied')
    turns=[];started=time.monotonic();purchased=None;goal=False;delivered=False;sold=False
    test.evidence.update(actor=actor,scenario='flowers_recycle_buy_take',goal=GOAL,maxTurns=max_turns,
        inferenceSource='server_configured_harness_requires_separate_http_evidence',scheduledAutonomy=False)
    try:
        for number in range(max_turns):
            at=time.monotonic();ack=read('resident '+actor+' plan')
            if ack['status']!='accepted':raise AssertionError(ack)
            original=ack['requestId']
            receipt=test.stock.until(lambda:(r if (r:=read('resident '+actor+' receipt '+original))['status']!='accepted' else None),100)
            evidence=receipt.get('serviceReceipt',{})
            command=receipt.get('command',receipt.get('input',{}).get('command',''))
            if receipt.get('status')=='completed':
                if command=='guild claim' and evidence.get('goalCompleted') and evidence.get('before',{}).get('activeId')=='tm_resident_delivery':delivered=True
                if command.startswith('arena recycle sell ') and evidence.get('item',{}).get('id')=='minecraft:iron_sword':sold=True
                if command.startswith('arena shop buy ') and evidence.get('quantity',0)>0:purchased=evidence.get('item',{}).get('id')
            actual=test.items(actor)
            goal=bool(delivered and sold and purchased and any(x['id']==purchased and x['count']>0 for x in actual)
                and not any(x['id']=='minecraft:iron_sword' for x in actual))
            turns.append({'turn':number+1,'seconds':round(time.monotonic()-at,3),'requestId':original,
                'receipt':receipt,'actualItems':actual,'goalVerified':goal})
            test.evidence.update(turns=turns,goalVerified=goal,purchased=purchased,
                completedParts={'commission':delivered,'recycled':sold,'purchased':purchased is not None,'inRealBag':goal})
            test.save()
            print('Model turn '+str(number+1)+': '+receipt['status']+' '+command,flush=True)
            if receipt['status']=='unknown':raise AssertionError('unknown outcome: only query original request '+original)
            if goal:break
            stop=repeated_failure(turns)
            if stop:
                test.evidence['stoppedReason']=stop
                raise AssertionError(stop+': stop this benchmark; inspect original receipts')
            time.sleep(1)
        test.check('model_completes_verified_task_in_budget',goal)
        test.check('native_model_body_uses_no_player_connection',json.loads(test.cmd('companiontest player-count'))['onlinePlayers']==0)
        test.evidence['passed']=True
    finally:
        test.evidence['metrics']={'turns':len(turns),'elapsedSeconds':round(time.monotonic()-started,3),
            'completedActions':sum(x['receipt']['status']=='completed' for x in turns),
            'refusedOrFailedActions':sum(x['receipt']['status'] not in ('completed','accepted') for x in turns),
            'goalVerified':goal,'successRateSampleSize':1}
        test.save()
    return test.evidence


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',type=Path,required=True)
    parser.add_argument('--resident',required=True)
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--max-turns',type=int,default=14)
    args=parser.parse_args()
    if not 1<=args.max_turns<=24:parser.error('--max-turns must be 1..24')
    exercise(args.stage,str(uuid.UUID(args.resident)),args.report,args.max_turns)
