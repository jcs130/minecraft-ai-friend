import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/survival'), str(ROOT / 'tools')]
from embodiment import observation_meta, working_memory, validate_sensor
from behavior_context import acknowledge, prepare
from numen_gateway import read_json, write_json, GatewayError
from sensors import sense
import test_survival_life_session as life_tests
from archive_survivor_memory import archive, inventory, EXPERIENCE


class EmbodiedControllerTests(unittest.TestCase):
    setUp = life_tests.LifeSessionTests.setUp
    create = life_tests.LifeSessionTests.create
    write = life_tests.LifeSessionTests.write
    finish = life_tests.LifeSessionTests.finish

    def enable(self):
        self.controller.settings.update(contextProtocol=2, brainProtocol=1, memoryEpoch='new-generation')

    def test_actual_controller_uses_grounded_context_without_legacy_learning_pressure(self):
        self.enable()
        self.write('memory.json', {'goal': 'LEGACY-POLLUTION', 'lesson': 'OLD-CLAIM', 'history': []})
        with patch.object(self.controller, '_evolution_quota', side_effect=AssertionError('legacy quota called')):
            self.controller.tick()
        message = self.backend.submitted[-1]
        value = json.loads(message['prompt'].split('\n', 1)[1])
        self.assertEqual(value['brainProtocol'], 1)
        self.assertEqual(value['updates']['brain']['memoryEpoch'], 'new-generation')
        self.assertNotIn('LEGACY-POLLUTION', message['prompt'])
        self.assertNotIn('OLD-CLAIM', message['prompt'])
        self.assertNotIn('evolutionQuota', value['updates'])
        self.assertNotIn('body', value)
        self.assertIn('self', value['updates'])
        self.assertIn('observations', value)

    def test_unchanged_body_is_incremental_but_freshness_always_delivered(self):
        self.enable()
        self.controller.data['wakeReason'] = 'test'
        body = copy.deepcopy(self.gateway.body)
        body['observedAt'] = int(self.clock() * 1000)
        body['bodyControl'] = {'kind': 'idle', 'observedAt': body['observedAt'], 'gameTime': 20, 'bodyTickCount': 4}
        self.controller.environment = {'ok': True, 'observedAt': body['observedAt'], 'bodyUuid': body.get('bodyUuid'),
                                       'world': {'dimension': body.get('dimension'), 'game_time': 20, 'weather': 'clear'}}
        context = self.controller.life_context(body, {}, 'survival-' + '1' * 32)
        session, first, delivery = prepare(self.state, self.controller.session, context, {})
        acknowledge(self.state, self.controller.session, delivery)
        body['observedAt'] += 1000
        body['bodyControl'].update(observedAt=body['observedAt'], gameTime=40, bodyTickCount=24)
        self.controller.environment['world']['game_time'] = 40
        context = self.controller.life_context(body, {}, 'survival-' + '2' * 32)
        _, second, _ = prepare(self.state, self.controller.session, context, {})
        self.assertNotIn('self', second['updates'])
        self.assertNotIn('scene', second['updates'])
        self.assertEqual(second['observations']['bodyControl']['gameTime'], 40)
        self.assertEqual(second['observations']['scene']['gameTime'], 40)
        self.assertEqual(second['observations']['self']['observedAt'], body['observedAt'])
        self.assertNotIn('instruction', second)
        self.assertLess(len(json.dumps(second)), len(json.dumps(first)))
        context['brain']['memoryEpoch'] = 'next-generation'
        other, fresh, _ = prepare(self.state, self.controller.session, context, {})
        self.assertNotEqual(session['primarySessionId'], other['primarySessionId'])
        self.assertIsNone(fresh['baseTurn'])

    def test_unavailable_or_cross_dimension_scene_is_not_current_world(self):
        self.enable()
        self.controller.data['wakeReason'] = 'test'
        self.controller.environment = {'ok': True, 'observedAt': 1, 'bodyUuid': 'different',
                                       'world': {'dimension': 'other'}, 'hostiles': []}
        value = self.controller.life_context(self.gateway.body, {}, 'survival-' + '1' * 32)
        self.assertIsNone(value['scene'])
        self.assertFalse(value['observations']['scene']['fresh'])

    def test_body_episode_changes_cognition_but_keeps_party_address(self):
        from life_cycle import rotate_session
        self.enable()
        self.controller.data['wakeReason'] = 'test'
        context = self.controller.life_context(self.gateway.body, {}, 'survival-' + '1' * 32)
        first, _, _ = prepare(self.state, self.controller.session, context, {})
        rotated = rotate_session(self.state, self.controller.settings, {'id': 'new-body-episode'}, now=self.clock())
        self.assertEqual(rotated['primarySessionId'], self.controller.session['primarySessionId'])
        second, _, _ = prepare(self.state, rotated, context, {})
        self.assertNotEqual(first['primarySessionId'], second['primarySessionId'])


class SensorTests(unittest.TestCase):
    def test_unknown_is_not_a_fresh_empty_observation(self):
        for value in ({}, {'ok': True}, {'ok': True, 'observedAt': float('nan')},
                      {'ok': False, 'observedAt': 1000}, {'ok': True, 'observedAt': 100000}):
            self.assertFalse(observation_meta(value, 2000, 10000, 'test')['fresh'])
        self.assertTrue(observation_meta({'ok': True, 'observedAt': 1000}, 2000, 10000, 'test')['fresh'])
        self.assertEqual(working_memory({'goal': 'old'}, 'new'), {})

    def test_catalog_and_contract_are_shared_and_do_not_accept_commands(self):
        catalog = sense(None)
        self.assertEqual(set(catalog['sensors']), {'self', 'scene', 'block', 'container', 'storage', 'menu'})
        for sensor, args in (('shell', {}), ('menu', {'command': 'stop'}), ('scene', {'radius': 200}),
                             ('block', {'x': True, 'y': 0, 'z': 0})):
            self.assertFalse(sense(None, sensor, args)['ok'])

    def test_storage_and_menu_only_use_existing_native_read_tools(self):
        class Gateway:
            state = Path('.')
            def __init__(self): self.calls = []
            def snapshot(self):
                return {'ok': True, 'bodyUuid': 'body', 'dimension': 'world', 'onGround': True,
                        'position': {'x': 0, 'y': 64, 'z': 0}}
            def _check_binding(self): return 'Kirito', 'body'
            def _area(self, *args, **kw): pass
            def _now(self): return 1000
            def _invoke(self, tool, args):
                self.calls.append(tool)
                return {'success': True, 'message': 'data values: [1, 2]'}
        gateway = Gateway()
        self.assertTrue(sense(gateway, 'storage', {'x': 1, 'y': 64, 'z': 0})['ok'])
        self.assertTrue(sense(gateway, 'menu')['ok'])
        self.assertFalse(sense(gateway, 'storage', {'x': 100, 'y': 64, 'z': 0})['ok'])
        self.assertEqual(gateway.calls, ['inspect_block_storage', 'inspect_gui'])

    def test_program_can_query_scene_without_a_model_or_action(self):
        from skill_library import evaluate, SkillError
        proposal = {'memory': {}, 'observe': {'tool': 'sense', 'args': {'sensor': 'scene', 'arguments': {'radius': 8}}}}
        result = evaluate('function next(){return ' + json.dumps(proposal) + ';}', {})
        self.assertEqual(result['observe'], proposal['observe'])
        proposal['observe']['args']['sensor'] = 'task_stop'
        with self.assertRaises(SkillError):
            evaluate('function next(){return ' + json.dumps(proposal) + ';}', {})


class DialogueTests(EmbodiedControllerTests):
    def start_dialogue(self):
        self.enable()
        self.controller.party = life_tests.FakeParty()
        self.gateway.body['task']['busy'] = True
        self.controller.tick()

    def test_can_answer_while_body_busy_without_touching_body_lease(self):
        self.start_dialogue()
        self.assertTrue(self.controller.data.get('dialogueActive'))
        self.assertIsNone(self.controller.data.get('active'))
        self.assertEqual(self.gateway.opened, [])
        tools = self.backend.submitted[-1]['requestContext']['subagent_allowed_tools']
        self.assertIn('numen_survival__sense', tools)
        self.assertNotIn('numen_survival__move', tools)
        self.assertNotIn('numen_survival__remember', tools)
        self.finish()
        self.assertIsNone(self.controller.data.get('dialogueActive'))
        self.assertEqual(self.controller.data['partyDelivery']['heard'], True)
        self.assertEqual(self.gateway.closed, [])
        self.assertEqual(self.gateway.actions, [])

    def test_unknown_submission_survives_restart_without_second_post(self):
        self.enable()
        self.controller.party = life_tests.FakeParty()
        self.backend.on_submit = lambda *_: (_ for _ in ()).throw(OSError('lost_ack'))
        self.gateway.body['task']['busy'] = True
        self.controller.tick()
        self.assertEqual(self.controller.data['dialogueStatus'], 'submission_unknown')
        restarted = self.create()
        restarted.settings.update(contextProtocol=2, brainProtocol=1, memoryEpoch='new-generation')
        restarted.party = self.controller.party
        restarted.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(restarted.data['dialogueStatus'], 'submission_unknown')

    def test_drain_waits_for_social_terminal_and_creates_no_new_dialogue(self):
        self.start_dialogue()
        self.gateway.body['task']['busy'] = False
        control = read_json(self.state / 'control.json')
        control['drain'] = {'status': 'requested', 'requestId': 'test'}
        self.write('control.json', control)
        self.controller.tick()
        self.assertTrue(read_json(self.state / 'control.json')['enabled'])
        self.finish()
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])
        self.assertEqual(len(self.backend.submitted), 1)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.workspace = self.root / 'server/agents/work/workspaces/qd-survivor'
        self.state = self.root / 'server/survival-agent-state/survival'
        memory = dict(zip(('metadata_dir', 'session_dir', 'mem_session_dir', 'resource_dir', 'daily_dir', 'digest_dir'),
                          ('mem_metadata', 'mem_session', 'mem_agent', 'resource', 'memory', 'digest')))
        self.profile = {'id': 'qd-survivor', 'workspace_dir': '/state/work/workspaces/qd-survivor',
                        'running': {'reme_light_memory_config': memory,
                                    'light_context_config': {'scroll_config': {'db_filename': 'history.db'}}}}
        write_json(self.workspace / 'agent.json', self.profile)
        for name in ('memory/old.md', 'mem_metadata/index', 'sessions/old.json', 'notes/old.md',
                     'SOUL.md', 'PROFILE.md', 'skills/proven/SKILL.md'):
            path = self.workspace / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('LEGACY-SOURCE-' + name, encoding='utf8')
        write_json(self.workspace / 'chats.json', {'version': 1, 'chats': [], 'groups': []})
        for name, value in {
            'settings.json': {'bodyUuid': 'body', 'contextProtocol': 2},
            'controller.json': {'active': None, 'decisions': [{'startedAt': 1}], 'episodes': [{'old': True}], 'lastDecision': {'old': True}},
            'control.json': {'enabled': False}, 'lease.json': {'status': 'closed'},
            'life-session.json': {'primarySessionId': 'life-' + '1' * 32},
            'memory.json': {'goal': 'OLD'}, 'action-receipts/immutable.json': {'actual': True},
            'perception.json': {'cursors': {'chat': 99}, 'pending': [{'old': True}], 'seen': ['id']},
        }.items(): write_json(self.state / name, value)

    def test_archive_is_hash_verified_outside_retrieval_and_idempotent(self):
        before = inventory(self.workspace)
        result = archive(self.root, apply=True, stopped=lambda _: None)
        backup = Path(result['archive'])
        self.assertEqual(inventory(backup / 'workspace'), before)
        self.assertFalse((self.workspace / 'sessions/old.json').exists())
        self.assertFalse((self.workspace / 'mem_metadata/index').exists())
        self.assertTrue((self.workspace / 'skills/proven/SKILL.md').exists())
        self.assertEqual(read_json(self.workspace / 'agent.json'), self.profile)
        self.assertEqual(read_json(self.state / 'controller.json')['decisions'], [{'startedAt': 1}])
        self.assertEqual(read_json(self.state / 'perception.json')['cursors'], {'chat': 99})
        self.assertEqual(read_json(self.state / 'perception.json')['pending'], [])
        self.assertEqual(read_json(self.state / 'action-receipts/immutable.json'), {'actual': True})
        self.assertEqual(archive(self.root, apply=True, stopped=lambda _: None)['memoryEpoch'], result['memoryEpoch'])

    def test_preview_never_mutates_and_busy_body_cannot_cutover(self):
        before = inventory(self.root)
        self.assertFalse(archive(self.root)['applied'])
        self.assertEqual(inventory(self.root), before)
        write_json(self.state / 'skill-job.json', {'status': 'running'})
        with self.assertRaisesRegex(ValueError, 'drained'):
            archive(self.root, apply=True, stopped=lambda _: None)
        self.assertTrue((self.workspace / 'sessions/old.json').exists())


if __name__ == '__main__':
    unittest.main()
