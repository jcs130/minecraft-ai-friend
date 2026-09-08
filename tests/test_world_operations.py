"""Native shift, immutable request and existing NPC planner integration: zero LLM/world actions."""
import asyncio
import ast
from copy import deepcopy
from datetime import date
import json
import os
from pathlib import Path
import random
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/'world/ops'), str(ROOT/'world/sidecar')]
from world_operations import WorldPlanning, world_job, validate_world_job, is_world_job
from world_operations_consumer import tick
from npc_planner import GuildPlanner
from qwen_tasks import read_json, write_json


class WorldOperationsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.public = self.root/'public'; self.public.mkdir()
        self.ops = self.root/'ops'; self.requests = self.ops/'world-requests'; self.requests.mkdir(parents=True)
        self.village = self.root/'village'; self.village.mkdir()
        self.now = 1788837430.0; self.today = date(2026, 9, 8); self.day = '2026-09-09'
        self.person = {'key': 'hesu', 'display': '禾叔', 'profession': 'farmer', 'entityBinding': {
            'uuid': '11111111-1111-1111-1111-111111111111', 'entityType': 'minecraft:villager',
            'dimension': 'minecraft:overworld', 'preservePosition': True, 'lastKnownPosition': [0, 64, 0]}}
        self.missing = deepcopy(self.person); self.missing.update(key='xiaoman', profession='shepherd')
        self.missing['entityBinding']['uuid'] = '22222222-2222-2222-2222-222222222222'
        self.npc = SimpleNamespace(VDIR=self.village, PROFILES=[self.person, self.missing],
            alive_pos=lambda p: [0,64,0] if p['key']=='hesu' else None)
        self.client = Mock(); self.client.poll.return_value = {'status': 'not_submitted'}
        self.client.submit.return_value = {'status': 'submitted', 'taskId': 'task-012345abcdef'}
        self.planner = GuildPlanner(self.village, self.client)
        self.tools = WorldPlanning(self.public, self.ops, lambda:self.now)
        self.proposal = {'date':self.day,'quests':[{'villager':'hesu','item':'wheat','count':8,'emerald':2,'pitch':'收八份小麦'}]}

    def tick(self):
        return tick(self.npc,self.planner,requests=self.requests,public=self.public/'world-planning.json',today=self.today,clock=lambda:self.now)

    def test_native_job_schema_and_role_are_fixed(self):
        spec=world_job();validate_world_job(spec,'default')
        self.assertTrue(is_world_job(SimpleNamespace(**spec),'default'))
        self.assertFalse(is_world_job(SimpleNamespace(**spec),'mc-priest'))
        for key,val in [('task_type','text'),('meta',{}),('text','other')]:
            with self.assertRaises(AssertionError):validate_world_job(spec|{key:val},'default')

    def test_stale_context_never_queues(self):
        self.tick();self.now+=91
        self.assertFalse(self.tools.request()['ok']);self.assertEqual(list(self.requests.iterdir()),[])

    def test_one_request_existing_professional_planner_collect_and_publish(self):
        self.assertEqual(self.tick()['eligibleIssuers'],['hesu'])
        self.assertEqual(self.tools.request()['code'],'requested')
        self.assertEqual(self.tools.request()['code'],'already_requested')
        row=self.tick();self.assertEqual(row['receipt']['status'],'submitted')
        self.tick();self.client.submit.assert_called_once()
        self.assertEqual(self.client.submit.call_args.args[:2],('guild_quest',self.day))
        self.assertNotIn('xiaoman',self.client.submit.call_args.args[2])
        self.client.poll.return_value={'status':'completed','text':json.dumps(self.proposal),'taskId':'task-012345abcdef'}
        self.planner.collect_pending(self.npc.PROFILES,self.today)
        self.assertEqual(self.tick()['receipt']['status'],'completed')
        self.assertFalse((self.village/('quests-'+self.day+'.json')).exists())
        # Exercise the actual existing economic publisher in a file-only fixture.
        source=ROOT/'world/sidecar/mc_npc.py'
        fn=next(n for n in ast.parse(source.read_text(encoding='utf8')).body if isinstance(n,ast.FunctionDef) and n.name=='gen_quests')
        space={'os':os,'CFG':{'quests':{'per_villager_chance':1,'daily_cap':6}},'PROFILES':self.npc.PROFILES,
            'random':random,'alive_pos':self.npc.alive_pos,'quests_path':lambda day:str(self.village/('quests-'+day+'.json')),
            'qwen_quests':lambda people,day:self.planner.plan(day,people)['quests']}
        exec(compile(ast.Module(body=[fn],type_ignores=[]),str(source),'exec'),space)
        published=space['gen_quests'](self.day)
        self.assertEqual(published['quests'][0]['source'],'qwenpaw-agent')
        self.assertEqual(published['quests'][0]['count'],8)
        previous=(self.village/('quests-'+self.day+'.json')).read_bytes()
        self.assertEqual(space['gen_quests'](self.day),published)
        self.assertEqual((self.village/('quests-'+self.day+'.json')).read_bytes(),previous)

    def test_existing_plan_is_byte_preserved_no_model(self):
        path=self.village/'agent-plans'/(self.day+'.json')
        write_json(path,{'status':'completed','quests':{'legacy':{}},'agentId':'qd-guild-planner'})
        raw=path.read_bytes();self.tick()
        self.assertEqual(self.tools.request()['code'],'existing_plan_preserved')
        self.client.submit.assert_not_called();self.assertEqual(path.read_bytes(),raw)

    def test_unknown_claim_survives_restart_without_post(self):
        self.tick();self.tools.request()
        self.planner.plan=Mock(side_effect=TimeoutError)
        self.assertEqual(self.tick()['receipt']['status'],'submission_unknown')
        self.tick();self.planner.plan.assert_called_once()

    def test_missing_issuer_between_context_and_consumption_is_not_replaced(self):
        self.tick();self.tools.request();self.npc.alive_pos=lambda p:None
        self.assertEqual(self.tick()['receipt']['status'],'no_online_qualified_issuers')
        self.client.submit.assert_not_called()

    def test_forged_request_never_submits(self):
        self.tick();self.tools.request();path=self.requests/(self.day+'.json')
        row=read_json(path);row['purpose']='give_items';write_json(path,row)
        with self.assertRaises(ValueError):self.tick()
        self.client.submit.assert_not_called()

    def test_finished_plan_accepts_original_subset_but_rejects_rebound_body(self):
        self.planner.plan(self.day,[self.person],submit=True)
        self.client.poll.return_value={'status':'completed','text':json.dumps(self.proposal)}
        self.assertEqual(self.planner.plan(self.day,self.npc.PROFILES)['status'],'completed')
        changed=deepcopy(self.person);changed['entityBinding']['uuid']='33333333-3333-3333-3333-333333333333'
        self.assertEqual(self.planner.plan(self.day,[changed,self.missing])['status'],'bindings_changed')

    def test_new_board_excludes_missing_issuers_and_preserves_existing_board(self):
        from npc_identity import contract_issuer, valid_position
        source=ROOT/'world/sidecar/mc_guild.py'
        fn=next(n for n in ast.parse(source.read_text(encoding='utf8')).body if isinstance(n,ast.FunctionDef) and n.name=='gen_board')
        reception=deepcopy(self.person);reception.update(key='guild_lan',profession='cartographer')
        quest=lambda key:{'id':key+'-day','villager':key,'display':key,'zh':'小麦','item':'wheat','count':8,'emerald':2}
        self.npc.PROFILES.append(reception);self.npc.quests_today=lambda:{'quests':[quest('hesu'),quest('xiaoman')]}
        self.npc.GUILD_AUTOGENERATE=False
        target=self.village/'board.json'
        space={'os':os,'json':json,'random':random,'BASIC_QUESTS':True,'N':self.npc,'GCFG':{},
            'guild_path':lambda _:target,'save_board':lambda row:write_json(target,row),
            'contract_issuer':contract_issuer,'valid_position':valid_position,
            'HUNT_POOL':[{'from':key,'title':'巡逻','mob':'zombie','count':2,'reward':1,'fame':1,'pitch':'巡视'} for key in ('hesu','xiaoman')],
            'HUNT_MOBS':{'zombie':('stat','id','僵尸')},'pick_visits':Mock(side_effect=AssertionError('missing visit issuer'))}
        exec(compile(ast.Module(body=[fn],type_ignores=[]),str(source),'exec'),space)
        board=space['gen_board'](self.day)
        self.assertEqual([r['from'] for r in board['board']],['hesu','hesu'])
        raw=target.read_bytes();self.npc.alive_pos=lambda _:None
        self.assertEqual(space['gen_board'](self.day),board);self.assertEqual(target.read_bytes(),raw)

    @unittest.skipIf(os.name=='nt','uses real Linux durable flock')
    def test_world_cron_bypasses_learning_evidence_but_not_serial_lease(self):
        import operations_native_tasks as native
        from cron_guard import guarded_execute
        spec=world_job();job=SimpleNamespace(**(spec|{'dispatch':SimpleNamespace(**spec['dispatch']),
            'runtime':SimpleNamespace(**spec['runtime'])}))
        workspace=self.root/'work/workspaces/default';workspace.mkdir(parents=True)
        tools=SimpleNamespace(root=workspace/'learning')
        executor=SimpleNamespace(_workspace=SimpleNamespace(agent_id='default',workspace_dir=workspace))
        async def original(*args):return {'delivery_status':'suppressed','run_id':'fixture'}
        with patch.object(native,'STATE',self.root),patch('cron_guard.reserve_review',side_effect=AssertionError('learning gate used')):
            out=asyncio.run(guarded_execute(executor,job,original,'operations',factory=lambda *a,**k:tools))
            self.assertEqual(out['run_id'],'fixture')
            with native.ledger() as rows:self.assertEqual(rows[-1]['status'],'completed')
            native.reserve_operation('default','other')
            out=asyncio.run(guarded_execute(executor,job,original,'operations',factory=lambda *a,**k:tools))
            self.assertEqual(out['qiandeng']['code'],'operations_task_unresolved')

    @unittest.skipIf(os.name=='nt','uses real Linux durable flock')
    def test_interrupted_native_cron_does_not_release_unknown_reservation(self):
        import operations_native_tasks as native
        from cron_guard import guarded_execute
        spec=world_job();job=SimpleNamespace(**(spec|{'dispatch':SimpleNamespace(**spec['dispatch']),
            'runtime':SimpleNamespace(**spec['runtime'])}))
        workspace=self.root/'work/workspaces/default';workspace.mkdir(parents=True)
        executor=SimpleNamespace(_workspace=SimpleNamespace(agent_id='default',workspace_dir=workspace))
        async def interrupted(*args):raise TimeoutError('native outcome uncertain')
        with patch.object(native,'STATE',self.root):
            with self.assertRaises(TimeoutError):asyncio.run(guarded_execute(executor,job,interrupted,'operations',
                factory=lambda *a,**k:SimpleNamespace(root=workspace/'learning')))
            with native.ledger() as rows:self.assertEqual(native.budget_check(rows,self.now),'operations_task_unresolved')

    @unittest.skipIf(os.name=='nt','uses real Linux durable flock')
    def test_failed_delivery_is_terminal_failure_not_success(self):
        import operations_native_tasks as native
        from cron_guard import guarded_execute
        spec=world_job();job=SimpleNamespace(**(spec|{'dispatch':SimpleNamespace(**spec['dispatch']),
            'runtime':SimpleNamespace(**spec['runtime'])}))
        workspace=self.root/'work/workspaces/default';workspace.mkdir(parents=True)
        executor=SimpleNamespace(_workspace=SimpleNamespace(agent_id='default',workspace_dir=workspace))
        async def original(*args):return {'delivery_status':'failed','run_id':'fixture'}
        with patch.object(native,'STATE',self.root):
            asyncio.run(guarded_execute(executor,job,original,'operations',
                factory=lambda *a,**k:SimpleNamespace(root=workspace/'learning')))
            with native.ledger() as rows:
                self.assertEqual(rows[-1]['status'],'failed')
                self.assertEqual(rows[-1]['executionStatus'],'returned')


if __name__=='__main__':unittest.main()
