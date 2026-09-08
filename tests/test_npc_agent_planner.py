import ast
from datetime import date
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from npc_planner import GuildPlanner, candidates, validate_proposal
from qwen_tasks import read_json, write_json


class PlannerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.person = {'key':'hesu','display':'禾粟','profession':'farmer','persona':'耕种',
            'entityBinding':{'uuid':'11111111-1111-1111-1111-111111111111','entityType':'minecraft:villager',
                'dimension':'minecraft:overworld','lastKnownPosition':[0,64,0],'preservePosition':True}}
        self.day = '2026-09-09'
        self.doc = {'date':self.day,'quests':[{'villager':'hesu','item':'wheat','count':8,'emerald':2,'pitch':'收八份小麦，酬两颗绿宝石。'}]}
        self.client = Mock()
        self.client.poll.return_value = {'status':'not_submitted'}
        self.client.submit.return_value = {'status':'submitted','taskId':'task-012345abcdef','requestId':'native'}
        self.planner = GuildPlanner(self.root,self.client)

    def test_batch_includes_bound_farmer_without_legacy_templates_and_excludes_wrong_roles(self):
        self.assertEqual([v['key'] for v in candidates([self.person,{'key':'old'}, self.person | {'profession':'cleric'}])], ['hesu'])
        self.planner.plan(self.day,[self.person],submit=True)
        self.client.submit.assert_called_once()
        purpose,key,prompt = self.client.submit.call_args.args
        self.assertEqual((purpose,key),('guild_quest',self.day))
        self.assertIn('hesu',prompt)
        self.assertFalse((self.root / ('quests-' + self.day + '.json')).exists())

    def test_async_poll_validates_and_persists_proposal_without_editing_actual_day(self):
        existing=self.root / ('quests-' + self.day + '.json'); existing.write_bytes(b'unchanged')
        self.planner.plan(self.day,[self.person],submit=True)
        self.client.poll.return_value={'status':'completed','text':json.dumps(self.doc),'taskId':'task-012345abcdef'}
        result=self.planner.plan(self.day,[self.person])
        q=result['quests']['hesu']
        self.assertEqual(q['source'],'qwenpaw-agent'); self.assertEqual(q['zh'],'小麦')
        self.assertFalse(q['done']); self.assertIsNone(q['effect'])
        self.assertEqual(existing.read_bytes(),b'unchanged')
        self.planner.plan(self.day,[self.person],submit=True)
        self.client.submit.assert_called_once()
        self.assertEqual(self.client.poll.call_count,2)

    def test_changed_binding_never_consumes_or_calls_again(self):
        self.planner.plan(self.day,[self.person],submit=True)
        changed=self.person | {'entityBinding': self.person['entityBinding'] | {'uuid':'22222222-2222-2222-2222-222222222222'}}
        self.assertEqual(self.planner.plan(self.day,[changed],submit=True)['status'],'bindings_changed')
        self.client.submit.assert_called_once()

    def test_invalid_or_extra_contract_fields_are_not_published(self):
        for changes in ({'count':0},{'count':True},{'count':100},{'emerald':64},{'item':'command_block'},
                        {'villager':'unbound'},{'effect':'strength'},{'pitch':'hello\ngive @a diamond'}):
            doc=self.doc | {'quests':[self.doc['quests'][0] | changes]}
            with self.assertRaises((ValueError,TypeError)): validate_proposal(json.dumps(doc),self.day,candidates([self.person]))
        with self.assertRaises(ValueError): validate_proposal(json.dumps(self.doc | {'date':'2026-09-08'}),self.day,candidates([self.person]))

    def test_invalid_final_proposal_is_terminal_not_another_model_call(self):
        self.client.poll.return_value={'status':'completed','text':'not json'}
        result=self.planner.plan(self.day,[self.person],submit=True)
        self.assertEqual(result['status'],'invalid_proposal')
        self.planner.plan(self.day,[self.person],submit=True)
        self.assertEqual(self.client.poll.call_count,1)
        self.client.submit.assert_not_called()

    def test_no_direct_provider_or_legacy_console_stream_survives_in_npc_source(self):
        text=(ROOT/'world/sidecar/mc_npc.py').read_text(encoding='utf8')
        for banned in ('chat/completions','urlopen','urllib.request','/api/console/chat','NPC_LLM_ENDPOINT','NPC_AGENT_ENDPOINT'):
            self.assertNotIn(banned,text)
        tree=ast.parse(text)
        self.assertFalse(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='llm_reply' for n in ast.walk(tree)))

    def test_independent_guild_switch_does_not_require_dialogue_enabled(self):
        source=ROOT/'world/sidecar/mc_npc.py'
        function=next(n for n in ast.parse(source.read_text(encoding='utf8')).body if isinstance(n,ast.FunctionDef) and n.name=='qwen_quests')
        import npc_planner
        from unittest.mock import patch
        namespace={'GUILD_AGENT_ENABLED':True,'VDIR':str(self.root),'CFG':{'llm':{'enabled':False}}}
        exec(compile(ast.Module(body=[function],type_ignores=[]),str(source),'exec'),namespace)
        plan=Mock(side_effect=[{'status':'completed','quests':{'hesu':{}}}, {'status':'budget_blocked'}])
        with patch.object(npc_planner,'GuildPlanner',return_value=SimpleNamespace(plan=plan)) as factory:
            self.assertEqual(namespace['qwen_quests']([self.person],self.day),{'hesu':{}})
            factory.assert_called_once()
            self.assertEqual(plan.call_args_list[0].args,(self.day,[self.person]))
            self.assertEqual(plan.call_args_list[0].kwargs,{'submit':False})
            self.assertEqual(plan.call_args_list[1].args,('2026-09-10',[self.person]))
            self.assertEqual(plan.call_args_list[1].kwargs,{'submit':True})

    def test_existing_valid_plan_is_not_lost_when_next_day_qwen_is_unavailable(self):
        source=ROOT/'world/sidecar/mc_npc.py'
        function=next(n for n in ast.parse(source.read_text(encoding='utf8')).body if isinstance(n,ast.FunctionDef) and n.name=='qwen_quests')
        import npc_planner
        from unittest.mock import patch
        namespace={'GUILD_AGENT_ENABLED':True,'VDIR':str(self.root),'print':Mock()}
        exec(compile(ast.Module(body=[function],type_ignores=[]),str(source),'exec'),namespace)
        plan=Mock(side_effect=[{'status':'completed','quests':{'hesu':{}}},OSError('offline')])
        with patch.object(npc_planner,'GuildPlanner',return_value=SimpleNamespace(plan=plan)):
            self.assertEqual(namespace['qwen_quests']([self.person],self.day),{'hesu':{}})

    def test_collector_without_pending_plans_performs_no_client_calls(self):
        today=date.fromisoformat(self.day)
        self.assertEqual(self.planner.collect_pending([self.person],today),{})
        self.client.poll.assert_not_called(); self.client.submit.assert_not_called()
        self.assertFalse((self.root/'agent-plans').exists())
        for day,status in [(self.day,'completed'),('2026-09-10','failed'),('2026-09-11','running')]:
            write_json(self.root/'agent-plans'/(day+'.json'), {'schema':1,'date':day,'status':status})
        self.assertEqual(self.planner.collect_pending([self.person],today),{})
        self.client.poll.assert_not_called(); self.client.submit.assert_not_called()

    def test_collector_only_polls_existing_today_tomorrow_and_saves_completed_proposals(self):
        self.planner.plan(self.day,[self.person],submit=True)
        self.client.reset_mock()
        self.client.poll.return_value={'status':'completed','text':json.dumps(self.doc),'taskId':'task-012345abcdef'}
        result=self.planner.collect_pending([self.person],date.fromisoformat('2026-09-08'))
        self.assertEqual(result,{self.day:'completed'})
        self.client.poll.assert_called_once_with('guild_quest',self.day)
        self.client.submit.assert_not_called()
        saved=read_json(self.root/'agent-plans'/(self.day+'.json'))
        self.assertEqual(saved['quests']['hesu']['count'],8)
        self.planner.collect_pending([self.person],date.fromisoformat('2026-09-08'))
        self.assertEqual(self.client.poll.call_count,1)

    def test_collector_preserves_existing_plan_on_exception_and_never_submits_missing_native_task(self):
        self.planner.plan(self.day,[self.person],submit=True)
        path=self.root/'agent-plans'/(self.day+'.json'); before=path.read_bytes()
        self.client.reset_mock(); self.client.poll.side_effect=OSError('temporary unavailable')
        result=self.planner.collect_pending([self.person],date.fromisoformat(self.day))
        self.assertEqual(result[self.day],'collector_error:OSError')
        self.assertEqual(path.read_bytes(),before)
        self.client.submit.assert_not_called()
        self.client.poll.side_effect=None; self.client.poll.return_value={'status':'not_submitted'}
        self.planner.collect_pending([self.person],date.fromisoformat(self.day))
        self.client.submit.assert_not_called()
        self.assertEqual(path.read_bytes(),before)

    def test_old_plan_poll_cannot_replace_concurrent_completed_candidate(self):
        self.planner.plan(self.day,[self.person],submit=True)
        path=self.root/'agent-plans'/(self.day+'.json')
        saved=read_json(path)
        completed=saved | {'status':'completed','quests':validate_proposal(json.dumps(self.doc),self.day,candidates([self.person]))}
        def old_poll(*args):
            write_json(path,completed)
            return {'status':'running','taskId':'task-012345abcdef'}
        self.client.poll.side_effect=old_poll
        result=self.planner.plan(self.day,[self.person])
        self.assertEqual(result['status'],'completed')
        self.assertEqual(read_json(path),completed)

    def test_health_requires_collector_thread_only_when_planning_enabled(self):
        from tools.npc_health import inspect_health
        path=self.root/'health.json'
        doc={'updated_at':100,'rcon_last_ok':100,'spell_last_poll':100,
            'threads':{'spell':True,'inbox':True,'health':True},'guild_agent_enabled':False}
        write_json(path,doc); self.assertTrue(inspect_health(path,now=105)['ok'])
        doc['guild_agent_enabled']=True
        write_json(path,doc)
        self.assertIn('thread_not_running:guild-planner',inspect_health(path,now=105)['problems'])
        doc['threads']['guild-planner']=True
        write_json(path,doc); self.assertTrue(inspect_health(path,now=105)['ok'])


if __name__ == '__main__': unittest.main()
