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

# The marked fixture uses the existing ArenaEconomy catalogue, whose food offers
# are cooked beef, golden carrots and golden apples. A weapon is not food.
FOOD_IDS={'minecraft:cooked_beef','minecraft:golden_carrot','minecraft:golden_apple'}


class ObjectiveProof:
    def __init__(self):
        self.delivered=False;self.sold=False;self.purchased=None;self.purchase_count=None;self.transferred=False;self.taken=False;self.goal=False

    def observe(self,receipt,actual):
        command=receipt.get('command',receipt.get('input',{}).get('command',''))
        evidence=receipt.get('serviceReceipt',{})
        count=lambda item:sum(x['count'] for x in actual if x['id']==item)
        if receipt.get('status')=='completed':
            if command=='guild claim' and evidence.get('goalCompleted') and evidence.get('before',{}).get('activeId')=='tm_resident_delivery':self.delivered=True
            if command.startswith('arena recycle sell ') and evidence.get('item',{}).get('id')=='minecraft:iron_sword':self.sold=True
            if command.startswith('arena shop buy ') and evidence.get('quantity',0)>0 and evidence.get('item',{}).get('id') in FOOD_IDS:
                self.purchased=evidence['item']['id'];self.purchase_count=count(self.purchased);self.transferred=False;self.taken=False
            if command.startswith('arena stash take ') and self.purchased and evidence.get('moved',0)>0:
                item=evidence.get('item',{}).get('id') or evidence.get('id') or evidence.get('baseId')
                if item==self.purchased:self.transferred=True
        return self.observe_inventory(actual)

    def observe_inventory(self,actual):
        # Native work-meal AI temporarily moves the entire stack to a hand.
        # A successful transfer still requires a later real bag delta, never a replay.
        count=lambda item:sum(x['count'] for x in actual if x['id']==item)
        if self.transferred and self.purchased and count(self.purchased)>self.purchase_count:self.taken=True
        self.goal=bool(self.delivered and self.sold and self.purchased and self.taken and count(self.purchased)>0 and count('minecraft:iron_sword')==0)
        return self.goal

    def parts(self):
        return {'commission':self.delivered,'recycled':self.sold,'purchased':self.purchased is not None,'postPurchaseTakeVerified':self.taken,'inRealBag':self.goal}


def repeated_failure(turns):
    """Bound failed inference, never replay a physical action to make a test pass."""
    recent=[row['receipt'] for row in turns[-3:]]
    if len(recent)!=3:return None
    if all(row.get('status') in ('failed','timeout','rejected') for row in recent):
        reasons={row.get('reason') for row in recent}
        if len(reasons)==1:return 'repeated_'+str(next(iter(reasons)))
    return None


def exercise(stage, actor, report, max_turns=14, scheduled=False, core_goal=False):
    spec=importlib.util.spec_from_file_location('gameplay',Path(__file__).with_name('resident-gameplay-stage.py'))
    suite=importlib.util.module_from_spec(spec);spec.loader.exec_module(suite)
    test=suite.Exercise(stage,report)
    read=test.resident
    profile=next(x for x in read('resident-admin list')['residents'] if x['id']==actor)
    seen=set()
    initial=read('resident '+actor+' status').get('lastReceipt',{})
    if initial.get('requestId'):seen.add(initial['requestId'])
    if core_goal:
        projection=json.loads((stage/'world/data/tlm-companion-memory'/actor/'core-goals.json').read_bytes())
        if projection.get('status')!='available' or projection.get('maidId')!=actor or not any(g.get('text')==GOAL for g in projection.get('goals',[])):
            raise AssertionError('The real core goal projection is required before enabling autonomous decisions')
    configured=profile['profile'].copy();configured.update(autonomous=scheduled,persona='你是温和务实的草药师禾穗，尊重同伴和自己的约定。' if core_goal else GOAL)
    changed=read('resident-admin apply '+actor+' '+str(uuid.uuid4())+' '+str(profile['revision'])+' '+json.dumps(configured,ensure_ascii=False))
    if changed['status']!='applied':raise AssertionError('synthetic profile not applied')
    turns=[];started=time.monotonic();goal=False;proof=ObjectiveProof()
    test.evidence.update(actor=actor,scenario='flowers_recycle_buy_take',goal=GOAL,maxTurns=max_turns,
        inferenceSource='server_configured_harness_requires_separate_http_evidence',scheduledAutonomy=scheduled,goalSource='mc_core_checkpoint' if core_goal else 'qa_persona')
    try:
        for number in range(max_turns):
            at=time.monotonic()
            if scheduled:
                # The real server timer owns every decision; the test only observes.
                def next_terminal():
                    row=read('resident '+actor+' status').get('lastReceipt',{})
                    if row.get('requestId') and row['requestId'] not in seen and row.get('status') not in (None,'accepted'):
                        return read('resident '+actor+' receipt '+row['requestId'])
                    return None
                receipt=test.stock.until(next_terminal,370)
                original=receipt['requestId'];seen.add(original)
            else:
                ack=read('resident '+actor+' plan')
                if ack['status']!='accepted':raise AssertionError(ack)
                original=ack['requestId']
                receipt=test.stock.until(lambda:(r if (r:=read('resident '+actor+' receipt '+original))['status']!='accepted' else None),100)
            command=receipt.get('command',receipt.get('input',{}).get('command',''))
            observed_at=time.time_ns()//1_000_000;actual=test.items(actor)
            initial_bag_read={'observedAt':observed_at,'actualItems':actual}
            goal=proof.observe(receipt,actual)
            post_action_reads=[]
            if receipt.get('status')=='completed' and command.startswith('arena stash take ') and proof.transferred and not proof.taken:
                deadline=time.monotonic()+8
                while not proof.taken and time.monotonic()<deadline:
                    time.sleep(0.25)
                    observed_at=time.time_ns()//1_000_000;actual=test.items(actor)
                    post_action_reads.append({'observedAt':observed_at,'actualItems':actual})
                    goal=proof.observe_inventory(actual)
            turns.append({'turn':number+1,'seconds':round(time.monotonic()-at,3),'requestId':original,
                'receipt':receipt,'actualItems':actual,'actualItemsObservedAt':observed_at,
                'initialBagRead':initial_bag_read,'postActionReads':post_action_reads,'goalVerified':goal})
            test.evidence.update(turns=turns,goalVerified=goal,purchased=proof.purchased,completedParts=proof.parts())
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
        cleanup_error=None
        if scheduled:
            # Disable the QA timer, without changing/replaying an in-flight action.
            try:
                current=next(x for x in read('resident-admin list')['residents'] if x['id']==actor)
                stopped=current['profile'].copy();stopped['autonomous']=False
                cleanup=read('resident-admin apply '+actor+' '+str(uuid.uuid4())+' '+str(current['revision'])+' '+json.dumps(stopped,ensure_ascii=False))
                test.evidence['scheduledCleanup']=cleanup.get('status')
                if cleanup.get('status')!='applied':raise AssertionError('QA timer stop was not confirmed')
            except Exception as error:
                cleanup_error=error;test.evidence['scheduledCleanup']='unconfirmed';test.evidence['cleanupErrorType']=type(error).__name__;test.evidence['passed']=False
        test.evidence['metrics']={'turns':len(turns),'elapsedSeconds':round(time.monotonic()-started,3),
            'completedActions':sum(x['receipt']['status']=='completed' for x in turns),
            'refusedOrFailedActions':sum(x['receipt']['status'] not in ('completed','accepted') for x in turns),
            'goalVerified':goal,'successRateSampleSize':1}
        test.save()
        if cleanup_error is not None:raise AssertionError('QA timer cleanup unconfirmed; inspect the marked fixture') from cleanup_error
    return test.evidence


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',type=Path,required=True)
    parser.add_argument('--resident',required=True)
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--max-turns',type=int,default=14)
    parser.add_argument('--scheduled',action='store_true',help='Observe actual timer decisions; never call plan from the test.')
    parser.add_argument('--core-goal',action='store_true',help='Use a real core goal projection; do not embed the objective in the persona.')
    args=parser.parse_args()
    if not 1<=args.max_turns<=24:parser.error('--max-turns must be 1..24')
    exercise(args.stage,str(uuid.UUID(args.resident)),args.report,args.max_turns,args.scheduled,args.core_goal)
