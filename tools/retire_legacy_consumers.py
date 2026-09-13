"""Retire three verified idle old-world consumers; preserve their data and dependencies."""
from pathlib import Path
from datetime import datetime, timezone
import argparse,json,subprocess
from operations import ROOT, command, inspect_containers, probe_shared_tts, KNOWN

TARGETS={
 'shadow-gate':'dc2a89ffa8199d4f27e29726ddcfa02c564ada3d94d55d58b4c3bab755456117',
 'shadow-voice':'4cc395d6d20d927328637bc3f62bc971c790f6d71aec9f88de9e66541133b22f',
 'shadow-asr':'8ed0428001e013aaae40179b988d5eb2b9305294a425aa8a48398784e8e2c648'}
LEGACY=Path('C:/Users/lzl19/.copaw/workspaces/default/minecraft-ai-friend/ops/docker/shadow')


def inspect(names):return {r['Name'].lstrip('/'):r for r in json.loads(command(['docker','inspect',*names]))}
def now():return datetime.now(timezone.utc).isoformat()


def rollback_stopped(stopped):
    """Attempt every acknowledged stop's rollback; retain only safe outcomes.

    A failed start acknowledgement may still have started the container, so the
    command result and observed state are separate. Unknown stop outcomes are
    deliberately not added to this list by the caller.
    """
    names={ident:name for name,ident in TARGETS.items()}
    results=[]
    for ident in stopped:
        result={'id':ident,'name':names.get(ident),'attempted':False,
                'startCommandOk':False,'stateVerified':False,
                'finalState':'unknown','restored':False}
        if ident not in names:
            result['startErrorType']='UnregisteredTarget'
            results.append(result)
            continue
        result['attempted']=True
        try:
            command(['docker','start',ident],timeout=60)
            result['startCommandOk']=True
        except Exception as exc:
            result['startErrorType']=type(exc).__name__
        try:
            rows=inspect([ident])
            actual=next((row for row in rows.values() if row.get('Id')==ident),None)
            if actual is None:
                result['verifyErrorType']='IdentityMismatch'
            else:
                state=actual.get('State',{}).get('Status')
                if state in ('created','restarting','running','removing','paused','exited','dead'):
                    result.update(stateVerified=True,finalState=state,restored=state=='running')
                else:
                    result['verifyErrorType']='UnknownContainerState'
        except Exception as exc:
            result['verifyErrorType']=type(exc).__name__
        results.append(result)
    return results


def preflight():
    assert ROOT.resolve()==Path('D:/Projects/QiandengJi').resolve()
    assert not (ROOT/'server/world-data/.qiandengji-smoke.lock').exists()
    audit=json.loads((ROOT/'reports/host-runtime-audit.json').read_text('utf-8-sig'))
    assert set(audit['interpretation']['eligibleForControlledStop'])==set(TARGETS)
    allrows=inspect([*TARGETS,'shadow-mc','shadow-world'])
    assert all(allrows[n]['State']['Status']=='exited' for n in ['shadow-mc','shadow-world'])
    queues=LEGACY/'mc/data/godvoice'
    for rel in ['text-queue','text-queue/.claimed','mic/inbox','mic/outbox']:
        path=queues/rel
        assert path.is_dir() and not any(p.is_file() for p in path.iterdir()), 'Old input queue is not empty'
    safe=[]
    for name,expected in TARGETS.items():
        row=allrows[name];labels=row['Config'].get('Labels',{}) or {}
        assert row['Id']==expected and row['State']['Status']=='running'
        assert labels.get('com.docker.compose.project')=='shadow'
        assert Path(labels.get('com.docker.compose.project.working_dir','')).resolve()==LEGACY.resolve()
        assert labels.get('com.docker.compose.service')==name.removeprefix('shadow-')
        assert row['HostConfig']['RestartPolicy']['Name']=='unless-stopped'
        assert not any('qiandengji' in str(m.get('Source','')).lower() for m in row.get('Mounts',[]))
        sockets=command(['docker','exec',expected,'cat','/proc/net/tcp','/proc/net/tcp6'])
        assert not any(len(fields:=line.split())>3 and fields[3]=='01' for line in sockets.splitlines()), 'Old consumer has an established connection'
        safe.append({'name':name,'id':expected,'state':row['State']['Status'],'project':'shadow','restart':'unless-stopped'})
    current=inspect_containers(['qiandengji-'+n+'-1' for n in KNOWN])
    assert all(v['project']=='qiandengji' and v['state']=='running' for v in current.values())
    assert probe_shared_tts()['ok']
    return safe,current


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--execute',choices=['qiandengji']);args=parser.parse_args()
    safe,current=preflight()
    record={'schema':1,'project':'qiandengji','startedAt':now(),'ok':False,'executed':bool(args.execute),'targets':safe,
        'preserved':['All old input/output/audio history','shadow-tts','shadow-qwenpaw','shadow-npc','mc-direct','Host QwenPaw and non-game tasks'],
        'scope':'Stop only verified idle old consumers, not containers, volumes or files deletion. Explicit stops persist under unless-stopped.',
        'rollbackCommands':[['docker','start',row['id']] for row in safe]}
    if not args.execute:
        print(json.dumps(record,ensure_ascii=False,indent=2));return
    stopped=[]
    try:
        for row in safe:
            # Resolve immutable IDs again, then stop by ID, never broad names.
            latest=inspect([row['name']])[row['name']];assert latest['Id']==row['id']
            command(['docker','stop',row['id']],timeout=60);stopped.append(row['id'])
        after=inspect_containers(list(current))
        assert all(after[n]['id']==v['id'] and after[n]['state']=='running' for n,v in current.items())
        assert probe_shared_tts()['ok']
        retired=inspect(list(TARGETS));assert all(r['State']['Status']=='exited' for r in retired.values())
        record.update(ok=True,currentProjectUnchanged=True,sharedTtsHealthy=True,dataDeleted=False)
    except Exception as exc:
        record['errorType']=type(exc).__name__
        record['rollbackAttempted']=bool(stopped)
        record['rollbackScope']='Only containers whose stop command acknowledged success; uncertain stop outcomes are not automatically restarted.'
        record['rollbackResults']=rollback_stopped(stopped)
        record['rollbackComplete']=bool(stopped) and all(row['restored'] for row in record['rollbackResults'])
        raise
    finally:
        record['finishedAt']=now()
        (ROOT/'reports/legacy-consumer-retirement.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(record,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
