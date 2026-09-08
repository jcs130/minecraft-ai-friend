"""Offline, backed-up activation of one existing-role cron and two fixed tools.

Run in an isolated operations image after stopping only qwenpaw-ops. It never
starts a model or runs the job. Existing learning schedules and identities stay.
"""
import argparse
from datetime import datetime, timezone
import importlib.metadata
import json
from pathlib import Path
import shutil

from operations_team_mcp import role_tools
from world_operations import JOB_ID, world_job, validate_world_job


def configure(state=Path('/state'), apply=False):
    state=Path(state)
    assert json.loads((state/'init-manifest.json').read_text())['project']=='qiandengji-ops'
    assert importlib.metadata.version('qwenpaw')=='2.2.0'
    folder=state/'work/workspaces/default'
    profile_path=folder/'agent.json'; card_path=folder/'drivers/mcp/qiandeng_operations.yaml'; jobs_path=folder/'jobs.json'
    profile=json.loads(profile_path.read_text())
    assert profile['id']=='default' and profile['mcp']['clients']['qiandeng_operations']['enabled'] is True
    old=set(profile['mcp']['clients']['qiandeng_operations']['tools'])
    wanted=set(role_tools('default'))
    assert old <= wanted and wanted-old <= {'operations_world_planning','operations_request_guild_plan'}
    jobs=json.loads(jobs_path.read_text())
    for job in jobs['jobs']:
        if job['id']==JOB_ID:validate_world_job(job,'default')
        else:assert job['id']=='qd-learning-default', 'Unknown existing job is not overwritten'
    plan={'schema':1,'project':'qiandengji-ops','role':'default','job':JOB_ID,'addedTools':sorted(wanted-old),
          'modelCalls':0,'worldActions':0,'enabledAfterRestart':True,'applied':False}
    if not apply:return plan
    for process in Path('/proc').glob('[0-9]*/cmdline'):
        try:command=process.read_bytes().replace(b'\0',b' ')
        except (OSError,PermissionError):continue
        assert not any(s in command for s in (b'/ops/learning_service.py',b'qwenpaw app',b'uvicorn qwenpaw.app')), 'Stop operations app first'
    from qwenpaw.drivers.storage import load_card,dump_card
    from qwenpaw.drivers.contracts import DriverPolicy,PolicyRule,PolicyTarget
    from qwenpaw.app.crons.models import CronJobSpec,JobsFile
    card=load_card(card_path)
    assert card.enabled and card.policy.default_effect=='deny'
    assert {r.target.name for r in card.policy.rules if r.effect=='allow' and r.target.kind=='tool'} <= wanted
    backup=state/'world-operations-backups'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True)
    for p in (profile_path,card_path,jobs_path):shutil.copy2(p,backup/p.name)
    profile['mcp']['clients']['qiandeng_operations']['tools']=list(role_tools('default'))
    card.policy=DriverPolicy(default_effect='deny',rules=[PolicyRule(subject='*',effect='allow',
        target=PolicyTarget(kind='tool',name=n)) for n in role_tools('default')])
    profile_path.write_text(json.dumps(profile,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    dump_card(card,card_path)
    retained=[j for j in jobs['jobs'] if j['id']!=JOB_ID]
    prior=next((j for j in jobs['jobs'] if j['id']==JOB_ID),None)
    desired=world_job()
    if prior:desired['enabled']=prior['enabled']  # Preserve a later deliberate pause.
    normalized=JobsFile(jobs=[CronJobSpec.model_validate(j) for j in [*retained,desired]])
    jobs_path.write_text(normalized.model_dump_json(indent=2)+'\n',encoding='utf8')
    (state/'work/operations/world-requests').mkdir(parents=True,exist_ok=True)
    plan.update(applied=True,backup=str(backup))
    (backup/'result.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf8')
    return plan


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',choices=['qiandengji-ops'])
    args=parser.parse_args()
    print(json.dumps(configure(apply=bool(args.apply)),ensure_ascii=False))
