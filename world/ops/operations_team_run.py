"""Manually delegate ONE task; native QwenPaw owns execution and cancellation.

Shared persisted delegation budget also applies to the coordinator's MCP calls.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
from operations_native_tasks import api, delegate, SPECIALISTS, TASK_TIMEOUT
from operations_team_mcp import read_json

STATE=Path('/state')


def usage():
    value=api('GET','/token-usage','default')
    return {key:value[key] for key in ('total_calls','total_prompt_tokens','total_completion_tokens')}


def run(role, task):
    before=usage()
    submission=delegate('default',role,task)
    if not submission['ok']:
        print(json.dumps(submission,ensure_ascii=False)); return 1
    began=time.monotonic()
    result={'role':role,'requestId':submission['requestId'],'taskId':submission['taskId'],'ok':False}
    try:
        while time.monotonic()-began < TASK_TIMEOUT+30:
            current=api('GET','/console/chat/task/'+submission['taskId'],role)
            if current.get('status')=='finished':
                result['nativeResultStatus']=(current.get('result') or {}).get('status')
                break
            time.sleep(5)  # HTTP only: no LLM polling loop.
        else:
            result['errorType']='TotalTimeout'
            api('POST','/console/chat/stop',role,params={'chat_id':submission['requestId']})
        report=read_json(STATE/'work/operations/reports'/role/(submission['requestId']+'.json'),32768)
        result['reportRecorded']=report.get('requestId')==submission['requestId'] and report.get('worldActionsExecuted')==0
        result['ok']=result['reportRecorded'] and result.get('nativeResultStatus')=='completed'
        result['summary']=report['summary'][:600]
    except Exception as exc:
        result['errorType']=type(exc).__name__
        try: result['stopRequested']=api('POST','/console/chat/stop',role,params={'chat_id':submission['requestId']}) is not None
        except Exception: result['stopRequested']=False
    result['elapsedSeconds']=round(time.monotonic()-began,1)
    try:
        after=usage()
        for dest,key in [('modelCalls','total_calls'),('promptTokens','total_prompt_tokens'),('completionTokens','total_completion_tokens')]:
            result[dest]=max(0,after[key]-before[key])
    except Exception: result['usageAvailable']=False
    report={'schema':1,'project':'qiandengji-ops','runId':submission['runId'],
        'startedAt':datetime.fromtimestamp(submission['startedAt'],timezone.utc).isoformat(),
        'finishedAt':datetime.now(timezone.utc).isoformat(),'ok':result['ok'],'roles':[result],
        'mode':'manual','maxConcurrentModels':1,'worldActionsExecuted':0,
        'backend':'qwenpaw-native-background-task','usageScope':'runtime counter delta during this experiment'}
    folder=STATE/'run-reports'; folder.mkdir(exist_ok=True)
    for name in (submission['runId'],'latest'):
        (folder/(name+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(report,ensure_ascii=False))
    return 0 if result['ok'] else 1


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role',choices=SPECIALISTS,default='mc-herald')
    parser.add_argument('--task',default='核对现有快照的时间、可用性和一项最值得优先处理的运营问题。')
    args=parser.parse_args()
    raise SystemExit(run(args.role,args.task))
