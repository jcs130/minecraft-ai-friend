"""Existing-worker integration: no models, server writes or new worker threads."""
from contextlib import nullcontext
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/'world/sidecar'), str(ROOT/'world/ops')]
import npc_planner
import world_admin_consumer
import world_content
import world_operations_consumer
from world_admin_tools import WorldAdminTools
spec = importlib.util.spec_from_file_location('team_consumer_health_fixture', ROOT/'world/ops/health/health_mon.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.npc = SimpleNamespace(VDIR=str(self.root/'village'), PROFILES=[])
        self.planner = Mock()
        self.planner.collect_pending.return_value = {}
        self.guild = SimpleNamespace(state_lock=Mock(side_effect=AssertionError('outer guild lock prohibited')))

    def test_each_stage_is_isolated_and_content_has_no_outer_guild_lock(self):
        for broken in ('admin', 'content', 'planning', 'operations'):
            with self.subTest(stage=broken):
                calls = []
                def stage(name):
                    def perform(*args, **kwargs):
                        calls.append(name)
                        if name == 'content':
                            self.assertIs(args[1], self.guild)
                            self.guild.state_lock.assert_not_called()
                            self.assertEqual(kwargs['state'], self.root)
                        if name == broken:
                            raise OSError('private exception detail must not be published')
                        return {}
                    return perform
                self.planner.collect_pending.side_effect = stage('planning')
                admin = SimpleNamespace(tick=stage('admin'))
                with patch.dict('os.environ', {'NPC_WORLD_OPERATIONS_REQUESTS': '/fixture'}), \
                        patch.object(world_content, 'tick', side_effect=stage('content')), \
                        patch.object(world_operations_consumer, 'tick', side_effect=stage('operations')):
                    result = npc_planner.collect_once(self.npc, self.planner, state=self.root,
                                                     admin=admin, guild=self.guild, clock=lambda:100)
                self.assertEqual(calls, ['admin', 'content', 'planning', 'operations'])
                self.assertFalse(result['ok'])
                self.assertFalse(result['stages'][broken]['ok'])
                self.assertTrue(all(v['ok'] for k,v in result['stages'].items() if k != broken))
                self.assertNotIn('private exception', json.dumps(result))
                self.assertEqual(json.loads((self.root/'collector-health.json').read_text())['newThreads'], 0)

    def test_real_idle_consumers_publish_metadata_without_model_or_rcon(self):
        def forbidden(command):
            raise AssertionError('No requests: no RCON read/write expected')
        guild = SimpleNamespace(PLAZA=(0,64,0), state_lock=nullcontext,
                                guild_path=lambda day: self.root/(day+'-board.json'))
        self.npc.quests_path = lambda day: self.root/(day+'-quests.json')
        admin = world_admin_consumer.WorldAdminConsumer(self.root, run=forbidden, clock=lambda:100)
        with patch.dict('os.environ', {'NPC_WORLD_OPERATIONS_REQUESTS': ''}):
            result = npc_planner.collect_once(self.npc, self.planner, state=self.root,
                                             admin=admin, guild=guild, clock=lambda:100)
        self.assertTrue(result['ok'])
        self.assertEqual(json.loads((self.root/'admin/consumer.json').read_text())['completed'], 0)
        content = json.loads((self.root/'content/status.json').read_text())
        self.assertEqual(content['publications'], [])
        self.assertFalse(content['capabilities']['boss']['ready'])
        self.planner.collect_pending.assert_called_once_with([])
        self.planner.plan.assert_not_called()

    def test_queued_admin_uses_once_only_transport_factory_not_npc_rcon(self):
        self.npc.R = SimpleNamespace(cmd=Mock(side_effect=AssertionError('legacy retrying RCON forbidden')))
        tools = WorldAdminTools('game:mc-god', self.root)
        tools.submit('rule-in-collector', 'rule', {'rule':'keepInventory','value':True})
        answers = ['Gamerule keepInventory is currently set to: true',
                   'Gamerule keepInventory is now set to: true',
                   'Gamerule keepInventory is currently set to: true']
        run = Mock(side_effect=answers)
        with patch.dict('os.environ', {'NPC_WORLD_OPERATIONS_REQUESTS': ''}), \
                patch.object(world_admin_consumer, 'NativeAdminRcon', return_value=run), \
                patch.object(world_content, 'tick', return_value={}):
            result = npc_planner.collect_once(self.npc, self.planner, state=self.root, guild=self.guild)
        self.assertTrue(result['ok'])
        self.assertTrue(tools.receipt('rule-in-collector')['executionConfirmed'])
        self.assertEqual(run.call_count, 3)
        self.npc.R.cmd.assert_not_called()

    def test_planner_collected_error_remains_visible_but_other_stages_complete(self):
        self.planner.collect_pending.return_value = {'2026-09-09':'collector_error:TimeoutError'}
        with patch.dict('os.environ', {'NPC_WORLD_OPERATIONS_REQUESTS': ''}), \
                patch.object(world_content, 'tick', return_value={}):
            result = npc_planner.collect_once(self.npc, self.planner, state=self.root,
                                             admin=SimpleNamespace(tick=lambda:{}), guild=self.guild)
        self.assertFalse(result['stages']['planning']['ok'])
        self.assertTrue(result['stages']['admin']['ok'])
        self.assertTrue(result['stages']['content']['ok'])

    def test_health_publication_failure_does_not_crash_collection(self):
        with patch.dict('os.environ', {'NPC_WORLD_OPERATIONS_REQUESTS': ''}), \
                patch.object(world_content, 'tick', return_value={}), \
                patch.object(npc_planner, 'write_json', side_effect=OSError('disk full')):
            result = npc_planner.collect_once(self.npc, self.planner, state=self.root,
                                             admin=SimpleNamespace(tick=lambda:{}), guild=self.guild)
        self.assertFalse(result['ok'])
        self.assertEqual(result['publicationError'], 'OSError')

    def test_existing_loop_recovers_constructor_and_tick_failure_without_new_thread(self):
        class Stop(BaseException): pass
        with patch.object(npc_planner, 'GuildPlanner', side_effect=[OSError('init failure'), self.planner]), \
                patch.object(npc_planner, 'collect_once', side_effect=ValueError('tick failure')) as once, \
                patch.object(npc_planner.time, 'sleep', side_effect=[None, Stop]) as sleep:
            with self.assertRaises(Stop):
                npc_planner.collect_loop(self.npc)
        self.assertEqual(sleep.call_count, 2)
        once.assert_called_once()


class TeamHealthTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.now = 1800000000
        self.addCleanup(patch.stopall)
        patch.object(health, 'PROJECT', self.root).start()
        patch.object(health.time, 'time', return_value=self.now).start()
        self.docs = {
            'server/mcdata/npc-health.json': {'updated_at':self.now, 'guild_agent_enabled':True, 'threads':{'guild-planner':True}},
            'server/team-state/collector-health.json': {'schema':1,'protocol':1,'updatedAt':self.now,
                'ok':True,'owner':'npc:guild-planner','newThreads':0,'contentOuterGuildLock':False,
                'stages':{k:{'ok':True,'checkedAt':self.now} for k in ('admin','content','planning','operations')}},
            'server/team-state/admin/consumer.json': {'schema':1,'protocol':1,'updatedAt':self.now*1000,
                'actor':'game:mc-god','pending':0,'unresolved':0,'completed':0,'modelCalls':0,'retriesWorldWrites':False},
            'server/team-state/content/status.json': {'schema':1,'updatedAt':self.now,'publications':[],
                'capabilities':{k:{'ready':k not in ('boss','chest')} for k in ('story','gather','hunt','visit','existing','boss','chest')}},
            'server/team-state/content/context.json': {'schema':1,'updatedAt':self.now,'receptionReady':False,'private':'DO_NOT_PROJECT'},
            'server/world-data/world-heartbeat.json': {'ts':self.now*1000,'automaticModelJobs':{'review':False,'dailyReport':False}},
            'server/engineering/receipts/_runner.json': {'schema':1,'updatedAt':self.now*1000,'enabled':True,'busy':False,'error':None},
        }
        self.save()

    def save(self):
        for relative, value in self.docs.items():
            path = self.root/relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(value), encoding='utf8')

    def test_available_without_executed_work_is_not_claimed_gameplay_proof(self):
        before = {str(p):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = health.probe_world_team()
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['evidence']['admin']['completed'], 0)
        self.assertEqual(result['evidence']['contentPublications']['published'], 0)
        self.assertFalse(result['evidence']['contentCapabilities']['boss'])
        self.assertNotIn('DO_NOT_PROJECT', json.dumps(result))
        self.assertEqual(result['worldActions'], 0)
        self.assertEqual(before, {str(p):p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_missing_protocol_or_failed_stage_cannot_use_healthy_npc_as_proof(self):
        self.docs['server/team-state/collector-health.json']['protocol'] = 0
        self.save()
        self.assertFalse(health.probe_world_team()['checks']['team_collector'])
        self.docs['server/team-state/collector-health.json']['protocol'] = 1
        self.docs['server/team-state/collector-health.json']['stages']['content']['ok'] = False
        self.save()
        self.assertFalse(health.probe_world_team()['checks']['team_collector'])

    def test_stale_admin_or_unknown_write_is_red(self):
        admin = self.docs['server/team-state/admin/consumer.json']
        admin['updatedAt'] = (self.now-121)*1000
        self.save()
        self.assertFalse(health.probe_world_team()['checks']['admin_consumer'])
        admin['updatedAt'] = self.now*1000
        admin['unresolved'] = 1
        self.save()
        self.assertFalse(health.probe_world_team()['checks']['admin_no_unresolved_write'])

    def test_content_unknown_and_legacy_model_jobs_are_not_silently_green(self):
        self.docs['server/team-state/content/status.json']['publications'] = [{'status':'publication_unconfirmed'}]
        self.docs['server/world-data/world-heartbeat.json']['automaticModelJobs']['dailyReport'] = True
        self.save()
        result = health.probe_world_team()
        self.assertFalse(result['checks']['content_no_unknown_publication'])
        self.assertFalse(result['checks']['legacy_automatic_models_disabled'])

    def test_busy_engineering_has_bounded_longer_age_but_not_infinite_or_failed(self):
        runner = self.docs['server/engineering/receipts/_runner.json']
        runner.update(busy=True, updatedAt=(self.now-300)*1000)
        self.save()
        self.assertTrue(health.probe_world_team()['checks']['engineering_runner'])
        runner['updatedAt'] = (self.now-331)*1000
        self.save()
        self.assertFalse(health.probe_world_team()['checks']['engineering_runner'])
        runner.update(busy=False, updatedAt=(self.now-46)*1000)
        self.save()
        self.assertFalse(health.probe_world_team()['checks']['engineering_runner'])
        runner.update(updatedAt=self.now*1000,error='private details')
        self.save()
        result = health.probe_world_team()
        self.assertFalse(result['checks']['engineering_runner'])
        self.assertNotIn('private details', json.dumps(result))

    def test_wrong_actor_future_stamp_or_invalid_count_fails_closed(self):
        admin = self.docs['server/team-state/admin/consumer.json']
        for changes in ({'actor':'operations:mc-god'},{'updatedAt':(self.now+10)*1000},{'completed':True}):
            original = dict(admin)
            admin.update(changes)
            self.save()
            self.assertFalse(health.probe_world_team()['checks']['admin_consumer'])
            admin.clear(); admin.update(original)


if __name__ == '__main__':
    unittest.main()
