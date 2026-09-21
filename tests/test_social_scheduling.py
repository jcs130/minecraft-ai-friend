"""Offline scheduling/receipt regressions; no model, network or world calls."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/survival'), str(ROOT / 'world/sidecar')]
from goal_agenda import GoalAgenda, goal_operation
from mcp_server import submit_goal
from numen_gateway import read_json, write_json
from social_attention import tick, proposal
from party_messages import PartyMessages
from test_party_messages import fixture_binding
from test_party_world import confirm_heard
import test_survival_controller as fixtures


class GoalAgendaTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.now = 100000.0
        write_json(self.root / 'settings.json', {'bodyUuid': 'body-a', 'ownerUuid': 'owner-a', 'memoryEpoch': 'one'})
        self.agenda = GoalAgenda(self.root, lambda: self.now)

    def test_two_requests_survive_restart_without_overwrite_and_advance_explicitly(self):
        first = self.agenda.request('收集木材', 'message-1')
        second = self.agenda.request('在湖边建房', 'message-2', after_goal_id=first['goalId'])
        current = GoalAgenda(self.root).select()
        self.assertEqual(current['goalId'], first['goalId'])
        self.assertEqual(self.agenda.snapshot()['counts'], {'active': 1, 'pending': 1})
        done = self.agenda.update(first['goalId'], 1, 'finish', 'finish-1', evidence='inventory observation: oak_log=16')
        self.assertFalse(done['completionVerified'])
        self.assertEqual(done['state'], 'completed_reported')
        self.assertEqual(self.agenda.select()['goalId'], second['goalId'])

    def test_idempotency_and_version_conflicts_do_not_overwrite_correction(self):
        row = self.agenda.request('建房', 'same')
        self.assertEqual(self.agenda.request('建房', 'same')['goalId'], row['goalId'])
        with self.assertRaisesRegex(ValueError, 'goal_request_conflict'):
            self.agenda.request('挖矿', 'same')
        changed = self.agenda.update(row['goalId'], 1, 'revise', 'correct', goal='在湖边建房')
        self.assertEqual(changed['revision'], 2)
        self.assertTrue(self.agenda.update(row['goalId'], 1, 'revise', 'correct', goal='在湖边建房')['duplicate'])
        with self.assertRaisesRegex(ValueError, 'goal_revision_conflict'):
            self.agenda.update(row['goalId'], 1, 'cancel', 'late-cancel')
        self.assertEqual(self.agenda.select()['goal'], '在湖边建房')

    def test_cancelled_dependency_does_not_activate_and_other_ready_goals_can_run(self):
        first = self.agenda.request('收木头', 'a')
        self.agenda.request('用木头建房', 'b', after_goal_id=first['goalId'])
        other = self.agenda.request('查看湖泊', 'c')
        self.agenda.update(first['goalId'], 1, 'cancel', 'cancel')
        self.assertEqual(self.agenda.select()['goalId'], other['goalId'])
        self.assertEqual(self.agenda.snapshot()['counts']['pending'], 1)

    def test_replace_supersedes_only_active_commitment(self):
        first = self.agenda.request('采矿', 'a'); self.agenda.select()
        later = self.agenda.request('建房', 'b')
        new = self.agenda.request('先回营地', 'c', mode='replace')
        self.assertEqual(self.agenda.select()['goalId'], new['goalId'])
        states = {r['goalId']: r['state'] for r in self.agenda.snapshot()['goals']}
        self.assertEqual(states[first['goalId']], 'superseded')
        self.assertEqual(states[later['goalId']], 'pending')

    def test_claimed_success_requires_active_goal_and_evidence(self):
        row = self.agenda.request('建房', 'a')
        for evidence in ('', 'looks complete'):
            result = goal_operation(self.root, 'finish', goal_id=row['goalId'], revision=1,
                                    request_id='done', evidence=evidence)
            self.assertFalse(result['ok'])
        self.assertEqual(self.agenda.snapshot()['counts'], {'pending': 1})

    def test_binding_change_hides_old_commitments_and_legacy_is_imported_once(self):
        legacy = {'id': str(uuid.uuid4()), 'goal': '原目标'}
        self.agenda.import_legacy(legacy, None)
        self.agenda.import_legacy(legacy, legacy['id'])
        self.assertEqual(len(self.agenda.snapshot()['goals']), 1)
        write_json(self.root / 'settings.json', {'bodyUuid': 'body-b', 'ownerUuid': 'owner-a', 'memoryEpoch': 'two'})
        self.agenda.import_legacy(legacy, None)
        self.assertIsNone(self.agenda.select())
        self.assertEqual(self.agenda.snapshot()['goals'], [])

    def test_read_does_not_create_a_store_and_queue_limit_does_not_discard(self):
        self.assertEqual(self.agenda.snapshot()['goals'], [])
        self.assertFalse(self.agenda.store.path.exists())
        for i in range(32):
            self.agenda.request('goal ' + str(i), 'request-' + str(i))
        with self.assertRaisesRegex(ValueError, 'goal_queue_full'):
            self.agenda.request('overflow', 'overflow')
        self.assertEqual(self.agenda.snapshot()['counts'], {'pending': 32})


class GoalBoundaryTests(unittest.TestCase):
    setUp = fixtures.ControllerTests.setUp
    create = fixtures.ControllerTests.create
    write = fixtures.ControllerTests.write

    def test_crash_after_control_write_reconstructs_switch_without_replaying_action(self):
        row = submit_goal(self.state, '新目标', clock=self.clock, request_id='new')
        self.assertTrue(row['ok'])
        self.controller.conversation_intent(read_json(self.state / 'control.json'))
        self.write('skill-job.json', {'status': 'running', 'name': 'old_skill'})
        # No controller.save(): simulate a crash between control and controller writes.
        restarted = self.create()
        restarted.conversation_intent(read_json(self.state / 'control.json'))
        self.assertTrue(restarted.data['goalSwitchPending'])
        restarted.switch_goal_at_boundary()
        self.assertEqual(read_json(self.state / 'skill-job.json')['status'], 'cancelled')
        self.assertEqual(self.gateway.actions, [])
        control = read_json(self.state / 'control.json')
        self.assertEqual(control['goalAgendaApplied'], control['goalAgendaSelection'])

    def test_queued_goal_waits_for_whole_skill_and_survives_restart(self):
        self.write('skill-job.json', {'status': 'running', 'name': 'old_skill'})
        row = submit_goal(self.state, '稍后建房', clock=self.clock, request_id='later')
        self.controller.conversation_intent(read_json(self.state / 'control.json'))
        self.assertNotIn('goalSwitchPending', self.controller.data)
        self.assertEqual(self.controller.goals.snapshot()['counts'], {'pending': 1})
        restarted = self.create()
        restarted.conversation_intent(read_json(self.state / 'control.json'))
        self.assertNotIn('goalSwitchPending', restarted.data)
        self.write('skill-job.json', {'status': 'done', 'name': 'old_skill'})
        restarted.conversation_intent(read_json(self.state / 'control.json'))
        self.assertEqual(restarted.data['goalSwitchPending'], row['goalId'])
        self.assertEqual(self.gateway.actions, [])

    def test_revision_waits_for_current_body_and_preserves_pause(self):
        row = submit_goal(self.state, '挖矿', clock=self.clock, request_id='a')
        self.gateway.body['task']['busy'] = True
        self.controller.tick()
        self.controller.goals.update(row['goalId'], 1, 'revise', 'b', goal='换个位置挖矿')
        self.controller.tick()
        self.assertTrue(self.controller.data['goalSwitchPending'])
        self.assertEqual(self.gateway.actions, [])
        self.assertEqual(self.backend.submitted, [])
        self.write('control.json', {**read_json(self.state / 'control.json'), 'enabled': False})
        self.controller.conversation_intent(read_json(self.state / 'control.json'))
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])

    def test_unreadable_agenda_does_not_dispatch_new_action(self):
        with patch.object(self.controller.goals, 'select', side_effect=OSError('unavailable')):
            self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'goal_confirmation_wait')
        self.assertEqual(self.gateway.actions, [])
        self.assertEqual(self.backend.submitted, [])


class AttentionQueueTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.binding = fixture_binding()
        self.now = 100000.0
        self.queue = PartyMessages(self.root, lambda: self.binding, lambda: self.now)
        self.sender, self.recipient = 'test-survivor', 'test-maid'

    def send(self, text='hello'):
        row = self.queue.enqueue(self.sender, text)
        confirm_heard(self.queue, row['messageId'])
        return row['messageId']

    def decide(self, identity, decision):
        self.assertTrue(self.queue.begin_attention(identity, self.recipient))
        return self.queue.finish_attention(identity, self.recipient, decision, {'source': 'fixture'})

    def test_new_relevant_reply_can_pass_deferred_chatter_but_oldest_is_not_starved(self):
        first = self.send('nice weather'); self.decide(first, 'later')
        self.now += .5
        second = self.send('where are you?'); self.decide(second, 'now')
        self.assertEqual(self.queue.next_pending(self.recipient)['messageId'], second)
        self.now += 31
        self.assertEqual(self.queue.next_pending(self.recipient)['messageId'], first)

    def test_no_reply_is_audited_without_qwen_reservation_or_fabricated_answer(self):
        identity = self.send('嗯，知道了'); self.decide(identity, 'observe')
        self.assertIsNone(self.queue.next_pending(self.recipient))
        result = self.queue.get_status(self.recipient, identity)
        self.assertEqual(result['status'], 'observed')
        self.assertIsNone(result['taskId']); self.assertIsNone(result['reply'])
        self.assertEqual(self.queue.overview(self.recipient)['counts']['observed'], 1)

    def test_lost_classifier_falls_back_after_restart_and_never_reclassifies(self):
        identity = self.send(); self.assertTrue(self.queue.begin_attention(identity, self.recipient))
        self.assertIsNone(self.queue.next_pending(self.recipient))
        self.now += 5
        reopened = PartyMessages(self.root, lambda: self.binding, lambda: self.now)
        self.assertEqual(reopened.next_pending(self.recipient)['messageId'], identity)
        self.assertIsNone(reopened.attention_candidate(self.recipient))
        reopened.finish_attention(identity, self.recipient, 'observe', {})
        self.assertEqual(reopened.get_status(self.recipient, identity)['status'], 'pending')

    def test_late_selection_cannot_modify_reserved_message(self):
        identity = self.send(); self.queue.begin_attention(identity, self.recipient)
        self.now += 6
        reservation = self.queue.reserve_dispatch(identity, self.recipient)
        self.assertTrue(reservation['claimed'])
        self.assertFalse(self.queue.finish_attention(identity, self.recipient, 'observe', {}))
        self.assertIsNotNone(self.queue.active_for_recipient(self.recipient))
        self.assertIsNone(self.queue.next_pending(self.recipient))

    def test_changed_binding_cannot_consume_an_old_message(self):
        identity = self.send(); self.queue.begin_attention(identity, self.recipient)
        self.binding['revision'] += 1
        self.assertFalse(self.queue.finish_attention(identity, self.recipient, 'observe', {}))
        self.assertIsNone(self.queue.next_pending(self.recipient))
        self.assertEqual(self.queue.get_status(self.recipient, identity)['status'], 'expired')

    def test_unheard_and_foreign_messages_cannot_be_classified(self):
        row = self.queue.enqueue(self.sender, 'not heard')
        self.assertFalse(self.queue.begin_attention(row['messageId'], self.recipient))
        identity = self.send()
        self.assertFalse(self.queue.begin_attention(identity, self.sender))


class AttentionWorkerTests(unittest.TestCase):
    setUp = fixtures.ControllerTests.setUp
    create = fixtures.ControllerTests.create
    write = fixtures.ControllerTests.write

    def prepare(self):
        from types import SimpleNamespace
        c = self.controller
        c.settings['socialAttentionMode'] = 'live'
        message = {'messageId': 'message', 'text': 'Where are you?', 'createdAt': self.clock(), 'sender': {'agentId': 'friend'}}
        self.decisions, self.submissions = [], []
        c.party = SimpleNamespace(attention_candidate=lambda: message,
            begin_attention=lambda m: True, validate_session=lambda *a: True,
            finish_attention=lambda m, d, e: self.decisions.append((d, e)) or True)
        def submit(*args):
            self.submissions.append(args)
            return 1
        self.worker = SimpleNamespace(result=None, submit=submit, poll=lambda t: self.worker.result)
        c.policy_worker = self.worker
        body = copy.deepcopy(self.gateway.body); body['task']['busy'] = True
        control = {'enabled': True, 'missionChangedAt': 100}
        return c, body, control

    def test_async_classifier_never_gets_actions_and_low_confidence_keeps_reply(self):
        c, body, control = self.prepare()
        tick(c, body, control)
        self.assertTrue(all(x['action'] is None for x in self.submissions[0][0]['candidates']))
        self.worker.result = {'code': 'policy_escalated', 'choice': 'observe', 'confidence': .2}
        tick(c, body, control)
        self.assertEqual(self.decisions[0][0], 'fallback')
        self.assertEqual(self.gateway.actions, [])

    def test_changed_goal_invalidates_classification_and_body_worker_has_priority(self):
        c, body, control = self.prepare()
        c.pending_policy = {'token': 99}
        tick(c, body, control); self.assertEqual(self.submissions, [])
        c.pending_policy = None
        tick(c, body, control)
        self.worker.result = {'code': 'policy_escalated', 'choice': 'observe', 'confidence': .99}
        tick(c, body, {**control, 'missionChangedAt': 101})
        self.assertEqual(self.decisions[0][0], 'fallback')

    def test_long_message_is_not_truncated_into_an_ignore_decision(self):
        self.assertIsNone(proposal({'text': '前文' * 3000 + '最后一句很紧急'}))

    def test_default_shadow_records_proposal_without_consuming_message(self):
        c, body, control = self.prepare()
        c.settings.pop('socialAttentionMode')
        tick(c, body, control)
        self.worker.result = {'code': 'policy_escalated', 'choice': 'observe', 'confidence': .99}
        tick(c, body, control)
        self.assertEqual(self.decisions[0][0], 'fallback')
        self.assertEqual(self.decisions[0][1]['proposed'], 'observe')
        self.assertEqual(self.decisions[0][1]['mode'], 'shadow')


if __name__ == '__main__':
    unittest.main()
