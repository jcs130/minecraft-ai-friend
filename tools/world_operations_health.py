"""Read-only daily operations evidence. Never run cron, a model, or a world action."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'world/ops'))
from world_operations import JOB_ID, validate_world_job

SOURCES = (
    'world/ops/operations_native_tasks.py', 'world/ops/cron_guard.py',
    'world/ops/world_operations.py', 'world/ops/configure_world_operations.py',
    'world/ops/operations_team_mcp.py', 'world/ops/role_learning_profiles.py',
    'world/ops/sync_role_learning.py', 'world/sidecar/world_operations_consumer.py',
    'world/sidecar/npc_planner.py', 'world/sidecar/mc_npc.py', 'world/sidecar/mc_guild.py',
    'tests/test_world_operations.py', 'tests/test_operations_native_tasks.py')
CHECKS = ('native_daily_job_enabled', 'native_planning_tools_enabled', 'consumer_fresh',
          'planning_state_verified', 'publication_file_verified', 'daily_run_and_report_verified', 'source_current')


def read(path, maximum=262144):
    path=Path(path)
    if any(p.is_symlink() or getattr(p,'is_junction',lambda:False)() for p in (path,*path.parents)):
        raise ValueError('linked_probe_file')
    with path.open('rb') as handle:raw=handle.read(maximum+1)
    if len(raw)>maximum:raise ValueError('probe_file_too_large')
    return json.loads(raw.decode('utf-8-sig'))


def get(route):
    request=urllib.request.Request('http://127.0.0.1:18090/api'+route,headers={'X-Agent-Id':'default'})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):raise ValueError('redirect_not_allowed')
    with urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect()).open(request,timeout=8) as response:
        raw=response.read(262145)
    if len(raw)>262144:raise ValueError('native_response_too_large')
    return json.loads(raw)


def fresh(value,now,age=90):
    return type(value) in (int,float) and math.isfinite(value) and -5<=now-value<=age


def check(root=ROOT,request=get,clock=time.time):
    root=Path(root);now=clock()
    today=datetime.fromtimestamp(now,timezone(timedelta(hours=8))).date()
    day=today.isoformat();next_day=(today+timedelta(days=1)).isoformat()
    checks=dict.fromkeys(CHECKS,False)
    native={}
    evidence={'dailyRun':'not_verified','dailyReport':False,'guildPlan':'not_verified',
              'publishedQuests':None,'agentPublishedQuests':None,'nextDayPublication':'not_due'}
    try:
        native=request('/cron/jobs/'+JOB_ID)
        spec=native['spec'];validate_world_job(spec,'default')
        checks['native_daily_job_enabled']=spec['enabled'] is True
        tools=request('/mcp/tools/qiandeng_operations')
        checks['native_planning_tools_enabled']=isinstance(tools,list) and {
            'operations_world_planning','operations_request_guild_plan'} <= {
                row.get('name') for row in tools if row.get('enabled') is True}
    except (OSError,ValueError,KeyError,TypeError,AssertionError):pass
    village=root/'server/mcdata/village'
    try:
        context=read(root/'server/panel-state/world-planning.json')
        heartbeat=read(root/'server/mcdata/npc-health.json')
        checks['consumer_fresh']=(context.get('schema')==1 and fresh(context.get('updatedAt'),now)
            and context.get('today')==day and context.get('nextDay')==next_day
            and fresh(heartbeat.get('updated_at'),now) and heartbeat.get('guild_agent_enabled') is True
            and heartbeat.get('threads',{}).get('guild-planner') is True)
        keys=context.get('eligibleIssuers')
        assert isinstance(keys,list) and len(keys)==len(set(keys)) and set(keys) <= {'hesu','shilei','zhujiu','jingshui','xiaoman'}
        plan_path=village/'agent-plans'/(next_day+'.json')
        plan=read(plan_path) if plan_path.exists() else None
        brief=None if plan is None else {'status':plan.get('status'),'questCount':len(plan.get('quests',{})),
                                         'agentId':plan.get('agentId')}
        assert context.get('existingPlan')==brief
        receipt_path=village/'world-operations-receipts'/(next_day+'.json')
        receipt=read(receipt_path) if receipt_path.exists() else None
        public_receipt=None if receipt is None else {k:receipt.get(k) for k in
            ('day','requestId','observedAt','agentId','status','selectedIssuers','worldActionsExecuted') if k in receipt}
        assert context.get('receipt')==public_receipt
        checks['planning_state_verified']=True
        evidence['guildPlan']=brief['status'] if brief else 'not_requested'
        evidence['eligibleIssuerCount']=len(keys)
        evidence['planningReceipt']=None if receipt is None else receipt.get('status')
        document=read(village/('quests-'+day+'.json'))
        quests=document['quests'];assert document['date']==day and isinstance(quests,list)
        count=len(quests);agent_count=sum(q.get('source')=='qwenpaw-agent' for q in quests)
        checks['publication_file_verified']=context.get('publication')=={
            'day':day,'status':'published','questCount':count,'agentQuestCount':agent_count}
        evidence.update(publishedQuests=count,agentPublishedQuests=agent_count)
    except (OSError,ValueError,KeyError,TypeError,AssertionError,AttributeError):pass
    try:
        state=root/'server/operations-agent-state'
        rows=read(state/'operations-budget/delegations.json')
        matches=[r for r in rows if r.get('jobId')==JOB_ID
                 and r.get('role')=='default' and r.get('source')=='native-qwen-world-cron']
        assert matches
        # Weekly learning uses the shared last-cron marker too. Its later
        # maintenance must not erase the daily job's durable evidence.
        run=max(matches,key=lambda r:r['startedAt']);evidence['dailyRun']=run.get('status','unknown')
        assert (run.get('status')=='completed' and run.get('executionStatus')=='returned'
                and run.get('deliveryStatus') not in ('failed','error'))
        start=run['startedAt'];finish=run['finishedAt']
        assert type(start) in (int,float) and type(finish) in (int,float) and 0<=now-finish<=172800
        native_state=native['state']
        native_finish=datetime.fromisoformat(native_state['last_run_at'].replace('Z','+00:00'))
        assert (native_state['last_status']=='success' and native_state.get('last_error') is None
                and native_finish.tzinfo is not None and abs(native_finish.timestamp()-finish)<=5)
        # A saved cron state alone cannot prove a useful task ran: require its
        # own newly authored attributed report in the execution interval.
        for path in sorted((state/'work/operations/reports/default').glob('*.json'))[:200]:
            report=read(path,32768)
            if report.get('schema')!=1 or report.get('role')!='default' or report.get('status')!='proposed':continue
            stamp=datetime.fromisoformat(report['createdAt'].replace('Z','+00:00')).timestamp()
            if (start<=stamp<=finish+5 and isinstance(report.get('requestId'),str)
                    and report['requestId'].startswith('world-daily-') and report.get('worldActionsExecuted')==0):
                evidence['dailyReport']=True;break
        checks['daily_run_and_report_verified']=evidence['dailyReport']
    except (OSError,ValueError,KeyError,TypeError,AssertionError,AttributeError):pass
    try:
        report=read(root/'runtime/reports/world-daily-operations-candidate-20260908.json')
        hashes=report['sourceHashes']
        checks['source_current']=(report.get('totalTests',0)>=87 and report.get('modelCalls')==0
            and all(hashes.get(name)==hashlib.sha256((root/name).read_bytes()).hexdigest() for name in SOURCES))
    except (OSError,ValueError,KeyError,TypeError):pass
    ready=all(checks[k] for k in CHECKS if k!='daily_run_and_report_verified')
    return {'schema':1,'project':'qiandengji','ok':all(checks.values()),'ready':ready,
            'checks':checks,'evidence':evidence,'sourceCurrent':checks['source_current'],
            'modelRequests':0,'worldActions':0,
            'scope':'Native schedule/tools, fresh consumer, matching files and actual daily report; future-day publication is not yet due. Source alignment refers to the verified candidate, not a JVM/module-cache attestation.'}


if __name__=='__main__':
    result=check();print(json.dumps(result,ensure_ascii=False));raise SystemExit(0 if result['ok'] else 1)
