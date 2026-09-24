"""Offline planning context and original-turn recall boundaries; no model/game I/O."""
import copy
import json
import unittest

import test_survival_controller as fixtures
from controller import life_planning_subject
from mcp_server import SkillTools, submit_goal
from numen_gateway import read_json


class PlanningSubjectTests(unittest.TestCase):
    def setUp(self):
        self.mission = 'Choose a long-term life from personality and actual experience'
        self.memory = {'schema': 1, 'source': 'agent_learning_data', 'updatedAt': 3000,
                       'goal': 'Establish a useful camp', 'nextFocus': 'Inspect a safe entrance',
                       'goalState': 'ongoing'}
        self.checkpoint()
        self.decisions = [{'turnId': 'turn-current', 'startedAt': 2}]

    def checkpoint(self):
        self.memory['history'] = [{key: self.memory[key] for key in ('goal', 'nextFocus', 'goalState')}
                                  | {'turnId': 'turn-current', 'at': self.memory['updatedAt']}]

    def subject(self, memory=None, decisions=None, changed=1000):
        return life_planning_subject(self.mission, self.memory if memory is None else memory,
                                     self.decisions if decisions is None else decisions, changed)

    def test_current_original_turn_uses_goal_not_old_next_focus_without_mutation(self):
        before = copy.deepcopy((self.memory, self.decisions))
        self.assertEqual(self.subject(), 'Establish a useful camp')
        self.assertEqual((self.memory, self.decisions), before)
        self.memory['nextFocus'] = ''
        self.checkpoint()
        self.assertEqual(self.subject(), 'Establish a useful camp')

    def test_new_mission_rejects_old_and_late_old_turn_memory(self):
        self.assertEqual(self.subject(changed=4000), self.mission)
        # Written after the new mission, but from a turn reserved before it.
        self.memory['updatedAt'] = 5000
        self.checkpoint()
        self.assertEqual(self.subject(changed=4000), self.mission)
        self.assertEqual(self.subject(decisions=[{'turnId': 'other-turn', 'startedAt': 4.5}]), self.mission)
        # Equal millisecond reservations are ambiguous, not proof of new intent.
        self.assertEqual(self.subject(changed=2000), self.mission)

    def test_completed_milestone_does_not_become_its_own_next_goal(self):
        self.memory['goalState'] = 'completed'
        self.checkpoint()
        self.assertEqual(self.subject(), self.mission)
        self.memory['nextFocus'] = '   '
        self.checkpoint()
        self.assertEqual(self.subject(), self.mission)

    def test_missing_or_invalid_provenance_falls_back_and_subject_is_bounded(self):
        for value in (None, '3000', True, -1, float('nan'), float('inf')):
            with self.subTest(updatedAt=value):
                self.assertEqual(self.subject(memory=dict(self.memory, updatedAt=value)), self.mission)
        self.assertEqual(self.subject(memory={}), self.mission)
        self.assertEqual(self.subject(decisions=[]), self.mission)
        self.assertEqual(self.subject(changed=True), self.mission)
        self.assertEqual(self.subject(decisions=[{'turnId': 'turn-current', 'startedAt': 4}]), self.mission)
        self.memory['goal'] = '  Inspect\n\tentrance  ' + 'x' * 500
        self.checkpoint()
        subject = self.subject()
        self.assertTrue(subject.startswith('Inspect entrance '))
        self.assertEqual(len(subject), 160)
        self.assertNotIn('\n', subject)

    def test_only_matching_last_real_checkpoint_supplies_turn_identity(self):
        for key, value in (('goal', 'different goal'), ('nextFocus', 'different focus'),
                           ('goalState', 'completed'), ('at', 2999), ('at', '3000'),
                           ('turnId', 'foreign-turn')):
            with self.subTest(field=key, value=value):
                memory = copy.deepcopy(self.memory)
                memory['history'][-1][key] = value
                self.assertEqual(self.subject(memory=memory), self.mission)
        for history in (None, [], {}, ['bad-row']):
            memory = dict(self.memory, history=history, turnId='turn-current')
            self.assertEqual(self.subject(memory=memory), self.mission)
        memory = copy.deepcopy(self.memory)
        memory['history'].append(dict(memory['history'][-1], turnId='foreign-turn'))
        memory['turnId'] = 'turn-current'  # A fabricated top-level ID cannot repair a bad last row.
        self.assertEqual(self.subject(memory=memory), self.mission)
        self.assertEqual(self.subject(memory=dict(self.memory, turnId='foreign-turn')), 'Establish a useful camp')

    def test_no_goal_never_promotes_old_running_claim_to_current_subject(self):
        self.memory.update(goal='', nextFocus='mine t557 running; HP 14 hunger 14; wait')
        self.checkpoint()
        self.assertEqual(self.subject(), self.mission)

    def test_fresh_body_precedes_subject_but_stale_and_unknown_are_not_asserted(self):
        body = {'ok': True, 'observedAt': 4000, 'hp': 6.5, 'hunger': 5,
                'task': {'busy': False, 'completionConfirmed': False}}
        args = (self.mission, self.memory, self.decisions, 1000)
        subject = life_planning_subject(*args, body=body, now_ms=5000)
        self.assertTrue(subject.startswith('实测 HP6.5 饥饿5 身体空闲'))
        self.assertIn('Establish a useful camp', subject)
        self.assertNotIn('Inspect a safe entrance', subject)
        self.assertNotIn('完成', subject)
        for change in ({'observedAt': -1}, {'observedAt': 6000}, {'observedAt': 1},
                       {'ok': False}, {'observedAt': None}):
            now = 30000 if change == {'observedAt': 1} else 5000
            self.assertEqual(life_planning_subject(*args, body=body | change, now_ms=now),
                             'Establish a useful camp')
        unknown = life_planning_subject(*args, body=body | {'task': {}}, now_ms=5000)
        self.assertNotIn('身体空闲', unknown)
        self.assertNotIn('身体忙碌', unknown)


class SelfPlanningContextTests(unittest.TestCase):
    setUp = fixtures.ControllerTests.setUp
    create = fixtures.ControllerTests.create
    write = fixtures.ControllerTests.write

    def finish_model(self):
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed', 'output': [
            {'role': 'assistant', 'type': 'message', 'status': 'completed',
             'content': [{'type': 'text', 'text': 'Current progress recorded.'}]}]}}
        self.controller.tick()

    def test_fixed_planning_pointer_does_not_read_write_or_choose_personal_goals(self):
        self.controller.data['wakeReason'] = 'world_or_goal_changed'
        before = {path.name: path.read_bytes() for path in self.state.iterdir() if path.is_file()}
        context = self.controller.life_context(self.gateway.body, {}, 'turn-planning')
        self.assertEqual(context['planning']['goalFile'], 'memory/goals.md')
        self.assertEqual(context['planning']['reference'],
                         'skills/qd-survivor-practice/references/long-term-planning.md')
        self.assertEqual(context['planning']['selectionAuthority'], 'model')
        self.assertEqual(context['planning']['version'], 1)
        self.assertEqual(context['mission'], self.settings['mission'])
        self.assertEqual(context['longTermMission'], self.settings['mission'])
        self.assertEqual({path.name: path.read_bytes() for path in self.state.iterdir() if path.is_file()}, before)
        self.assertEqual(self.backend.submitted, [])
        self.assertEqual(self.gateway.actions, [])

    def test_real_submission_uses_fresh_memory_but_preserves_mission_session_and_lease(self):
        now = self.clock.now
        mission = 'Autonomously choose useful long-term progress'
        control = {'schema': 1, 'enabled': True, 'mission': mission,
                   'missionChangedAt': int((now - 30) * 1000)}
        self.write('control.json', control)
        self.controller.tick()
        turn_id = self.controller.data['active']['turnId']
        self.clock.now += 1
        recorded = SkillTools(self.state, clock=self.clock).remember(
            turn_id, goal='Find a useful route', next_focus='Inspect the camp approach')
        self.assertTrue(recorded['ok'])
        memory = read_json(self.state / 'memory.json')
        self.assertNotIn('turnId', memory)
        self.assertEqual(memory['history'][-1]['turnId'], turn_id)
        self.assertEqual(memory['history'][-1]['at'], memory['updatedAt'])
        self.finish_model()
        self.clock.now += 121
        self.gateway.body['hunger'] = 12
        # Original reservation and working memory remain usable after restart.
        self.controller = self.create()
        session = copy.deepcopy(self.controller.session)
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)
        payload = self.backend.submitted[-1]
        self.assertIn('Find a useful route', payload['prompt'].split('\n', 1)[0])
        self.assertNotIn('Inspect the camp approach', payload['prompt'].split('\n', 1)[0])
        context = json.loads(payload['prompt'].split('\n', 1)[1])
        self.assertEqual(context['mission'], mission)
        self.assertEqual(context['longTermMission'], self.settings['mission'])
        self.assertEqual(payload['session'], session)
        self.assertEqual(self.controller.data['active']['mission'], mission)
        self.assertEqual(read_json(self.state / 'lease.json')['actionLimit'], 6)
        self.assertEqual(read_json(self.state / 'control.json'), control)
        self.assertEqual(read_json(self.state / 'memory.json'), memory)
        self.assertEqual(self.gateway.actions, [])

    def test_late_old_memory_cannot_front_run_new_user_mission(self):
        mission = 'Choose broader progress from actual experience'
        self.controller.tick()
        old_turn = self.controller.data['active']['turnId']
        self.clock.now += 1
        self.assertTrue(submit_goal(self.state, mission, clock=self.clock)['ok'])
        self.controller.tick()  # Intake changes mission while the original turn still owns its lease.
        self.clock.now += 1
        self.assertTrue(SkillTools(self.state, clock=self.clock).remember(
            old_turn, goal='Old farm test', next_focus='Repeat the old farm test')['ok'])
        self.finish_model()
        self.clock.now += 121
        self.controller = self.create()
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)
        self.assertIn(mission, self.backend.submitted[-1]['prompt'].split('\n', 1)[0])

    def test_embodied_wake_labels_old_focus_without_rewriting_memory(self):
        self.controller.settings.update(contextProtocol=2, brainProtocol=1, memoryEpoch='current')
        now_ms = int(self.clock() * 1000)
        memory = {'schema': 1, 'source': 'agent_learning_data', 'memoryEpoch': 'current',
                  'goal': '', 'goalState': 'ongoing', 'nextFocus': 'mine t557 running; HP14 hunger14',
                  'updatedAt': now_ms - 2700000, 'history': []}
        self.write('memory.json', memory)
        self.gateway.body.update(hp=6.5, hunger=5, observedAt=now_ms,
                                 task={'busy': False, 'completionConfirmed': False})
        self.controller.tick()
        prompt = self.backend.submitted[-1]['prompt']
        header, raw = prompt.split('\n', 1)
        context = json.loads(raw)
        self.assertTrue(header.startswith('实测 HP6.5 饥饿5 身体空闲'))
        self.assertNotIn('t557', header)
        intent = context['updates']['intent']
        self.assertEqual(intent['source'], 'agent_reported')
        self.assertEqual(intent['recordedAt'], memory['updatedAt'])
        self.assertEqual(intent['ageSeconds'], 2700)
        self.assertEqual(intent['nextFocus'], memory['nextFocus'])
        self.assertIn('当前', intent['notice'])
        self.assertEqual(read_json(self.state / 'memory.json'), memory)

    def test_heartbeat_only_attests_loaded_planning_protocol(self):
        self.controller.publish()
        heartbeat = read_json(self.state / 'heartbeat.json')
        self.assertEqual(heartbeat['selfPlanningVersion'], 1)
        self.assertEqual(heartbeat['fastSystemProtocol'], 1)
        self.assertNotIn('planning', heartbeat)
        self.assertNotIn('goal', heartbeat)
        self.assertEqual(self.backend.submitted, [])


if __name__ == '__main__':
    unittest.main()
