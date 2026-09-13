"""Exercise each installed MCP/skill binding and reject extra delegation without LLM calls."""
import asyncio
import json
from pathlib import Path
from datetime import datetime, timezone
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from operations_team_mcp import ROLES, role_tools, read_json
from operations_native_tasks import api


def decoded(result):
    assert not result.isError
    if result.structuredContent is not None: return result.structuredContent
    return json.loads(next(c.text for c in result.content if c.type=='text'))


async def main():
    before=api('GET','/token-usage','default')['total_calls']
    expected=read_json(Path('/ops/operations-role-skills.json'))['roles']
    roles=[]
    for role in ROLES:
        params=StdioServerParameters(command='python',args=['/ops/operations_team_mcp.py','--role',role])
        async with stdio_client(params) as (reader,writer):
            async with ClientSession(reader,writer) as session:
                await session.initialize()
                listed=await session.list_tools()
                assert {t.name for t in listed.tools}==set(role_tools(role))
                skills=decoded(await session.call_tool('operations_reference',{'topic':'my-skills'}))
                assert {s['name'] for s in skills['skills']}==set(expected[role])
                snapshot=decoded(await session.call_tool('operations_snapshot',{}))
                assert snapshot['role']==role and not snapshot['worldActionsAllowed'] and snapshot['ok']
                raw_bytes=sum((Path('/public')/(n+'.json')).stat().st_size for n in ('world','health','operations'))
                row={'role':role,'tools':len(listed.tools),'skills':len(skills['skills']),
                     'snapshotBytes':len(json.dumps(snapshot,ensure_ascii=False).encode()),'sourceBytes':raw_bytes}
                if role=='default':
                    rejected=decoded(await session.call_tool('operations_delegate',{'to_role':'default','task':'拒绝自调用测试'}))
                    assert rejected.get('code')=='role_not_allowed'
                    # Never submit an otherwise valid paid task in this reusable smoke.
                    # Cooldown/24-hour windows are exercised with mocked APIs in Linux tests.
                    unknown=decoded(await session.call_tool('operations_task',{'task_id':'unknown-smoke-task'}))
                    assert unknown.get('code')=='unknown_task'
                    row['roleBoundaryRejected']=True
                    row['unknownTaskRejected']=True
                roles.append(row)
    after=api('GET','/token-usage','default')['total_calls']
    assert before==after
    value={'schema':1,'project':'qiandengji-ops','ok':True,'finishedAt':datetime.now(timezone.utc).isoformat(),
           'roles':roles,'modelCalls':after-before,'scope':'Actual MCP protocol and installed skills; zero model calls'}
    Path('/state/protocol-smoke.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(value,ensure_ascii=False))


if __name__=='__main__': asyncio.run(main())
