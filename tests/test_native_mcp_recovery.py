import asyncio
from copy import deepcopy
from pathlib import Path
import sys
from types import SimpleNamespace as Obj
import unittest
from unittest.mock import AsyncMock

sys.path[:0] = [str(Path(__file__).resolve().parents[1] / ('world/' + p)) for p in ('ops','sidecar')]
from native_mcp_recovery import wrap_update
from native_tool_connection import NativeTools


class NativeMcpTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_reload_keeps_full_card_and_is_rate_limited(self):
        card = Obj(enabled=True, config={'tools':['work']}, endpoint={'url':'http://npc:8091/mcp',
                   'headers':{'Authorization':'credential-binding'}}, policy={'private':True})
        before=deepcopy(card.__dict__)
        workspace=Obj(task_tracker=Obj(has_active_tasks=AsyncMock(return_value=False)),
                      driver_manager=Obj(reload_driver=AsyncMock()))
        service=Obj(_workspace=workspace, load_card=AsyncMock(return_value=card),
                    list_tools=AsyncMock(return_value=[{'name':'work'}]))
        update=wrap_update(AsyncMock(return_value=[]),clock=lambda:100)
        self.assertTrue(await update(service,'maid_native',['work']))
        self.assertEqual(card.__dict__,before)
        await update(service,'maid_native',['work'])
        workspace.driver_manager.reload_driver.assert_awaited_once_with('maid_native')

    async def test_native_busy_disabled_modified_and_foreign_cards_are_not_reloaded(self):
        for busy,enabled,tools,url,key in [(True,True,['work'],'http://npc:8091/mcp','maid_native'),
              (False,False,['work'],'http://npc:8091/mcp','maid_native'),
              (False,True,['different'],'http://npc:8091/mcp','maid_native'),
              (False,True,['work'],'http://foreign/mcp','maid_native')]:
            card=Obj(enabled=enabled,config={'tools':tools},endpoint={'url':url})
            manager=Obj(reload_driver=AsyncMock())
            service=Obj(load_card=AsyncMock(return_value=card),_workspace=Obj(driver_manager=manager,
                        task_tracker=Obj(has_active_tasks=AsyncMock(return_value=busy))))
            await wrap_update(AsyncMock(return_value=[]))(service,key,['work'])
            manager.reload_driver.assert_not_called()

    async def test_sidecar_same_whitelist_put_recovers_before_admission(self):
        calls=[];ready=False
        def transport(method,path,role,payload=None):
            nonlocal ready
            calls.append((method,path,payload))
            if method=='PUT':ready=True;return []
            if path.endswith('/agent-status'):return {'status':'idle','running_task_count':0}
            if path=='/mcp/maid_native':return {'key':'maid_native','enabled':True,'transport':'streamable_http',
                'url':'http://npc:8091/mcp','tools':['work'],'headers':{'do-not-copy':'private'}}
            return [{'name':'work','enabled':True}] if ready else []
        self.assertTrue(NativeTools(transport).ready('role','maid_native','http://npc:8091/mcp',['work']))
        self.assertEqual([c for c in calls if c[0]=='PUT'], [('PUT','/mcp/tools/maid_native',{'tools':['work']})])
