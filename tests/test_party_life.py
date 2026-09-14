import asyncio
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/sidecar'), str(ROOT / 'world/ops')]
from party_bridge import PartyBridge
from party_config import FIELDS
from party_life import PartyLife
from party_life_schedule import JOB_ID, ROLE, managed_job, validate_job, publish_signal, execute
from party_role_capabilities import YUI_BODY_UUID, SURVIVOR_BODY_UUID
from qwen_tasks import QwenTasks, write_json


class PartyLifeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.now = 1201
        self.members = [dict(agentId=ROLE, bodyUuid=YUI_BODY_UUID, ownerUuid=SURVIVOR_BODY_UUID,
            sessionId='maid-original-life', userId='maid-' + YUI_BODY_UUID, channel='console',
            displayName='结衣', kind='maid', mcpToken='y' * 48),
            dict(agentId='qd-survivor', bodyUuid=SURVIVOR_BODY_UUID, ownerUuid='00000000-0000-4000-8000-000000000001',
            sessionId='life-original', userId='survival-controller', channel='console',
            displayName='桐人', kind='survivor', mcpToken='s' * 48)]
        self.member = {key: self.members[0][key] for key in FIELDS}
        self.roster = [{key: m[key] for key in ('agentId', 'bodyUuid', 'displayName', 'kind')} for m in self.members]
        write_json(self.root / 'binding.json', {'schema': 1, 'enabled': True, 'partyId': 'kirito-travel-party',
            'revision': 1, 'limits': {}, 'members': self.members})
        registry = SimpleNamespace(resolve=lambda *a: {'agentId': ROLE, 'sessionId': self.member['sessionId']})
        self.owner_online = True; self.native_busy = False; self.posts = []; self.status = 'running'
        self.drop_post = False; self.drop_get = False
        def transport(method, path, role, payload=None):
            if method == 'POST':
                self.posts.append((role, payload))
                if self.drop_post: raise TimeoutError('lost acknowledgement')
                return {'task_id': 'task-%012x' % len(self.posts)}
            if path.endswith('/agent-status'):
                return {'status': 'running' if self.native_busy else 'idle', 'running_task_count': int(self.native_busy)}
            if self.drop_get: raise FileNotFoundError('old task absent after restart')
            return {'status': self.status, 'result': {'status': 'completed', 'output': [
                {'role': 'assistant', 'type': 'message', 'status': 'completed',
                 'content': [{'type': 'text', 'text': '记录了当前观察，下一步仍待验证。'}]}]}}
        route = self.root / 'routes.json'
        write_json(route, {'schema': 1, 'routes': {'maid_dialogue': {'runtime': 'game',
            'agentId': 'qd-maid-dialogue', 'apiUrl': 'http://qwenpaw:8088/api'}}})
        self.tasks = QwenTasks(self.root / 'qwen-tasks', routes=route, transport=transport,
            clock=lambda: self.now, maid_registry=registry)
        native = SimpleNamespace(invoke=lambda *a: {'ok': True, 'state': {'ownerOnline': self.owner_online}})
        self.bridge = PartyBridge(self.root, registry, native, self.tasks, clock=lambda: self.now,
            public=self.root / 'public.json')
        self.life = PartyLife(self.bridge, signals=self.root / 'signals', clock=lambda: self.now,
            world_clock=lambda: {'available': True, 'gameTime': 100000, 'day': 4, 'daytime': 4000})
        self.life._scope = lambda: ['maid_native__identity', 'memory_search', 'qd_party__party_send']

    def signal(self, slot=2):
        value = {'schema': 1, 'jobId': JOB_ID, 'role': ROLE, 'requestId': JOB_ID + ':600:' + str(slot),
                 'slot': slot, 'scheduledAt': slot * 600, 'members': self.roster}
        write_json(self.root / 'signals' / ROLE / 'latest-signal.json', value)
        return value

    def test_no_signal_means_no_model_even_with_heard_reply(self):
        with patch.object(self.bridge.queue, 'heard_replies', return_value=[{'eventId': 'not-consumed'}]):
            self.life.tick()
        self.assertFalse(self.posts)

    def test_original_identity_scope_and_private_summary(self):
        self.signal(); result = self.life.tick()
        role, payload = self.posts[0]
        self.assertEqual(role, ROLE)
        self.assertEqual(payload['session_id'], 'maid-original-life')
        self.assertEqual(payload['user_id'], self.member['userId'])
        self.assertIn('qd_party__party_send', payload['request_context']['subagent_allowed_tools'])
        self.assertEqual(result['active']['member'], self.member)
        self.assertNotIn('prompt', json.dumps(self.life.summary()))

    def test_round_dates_and_world_time_distinguish_old_game_history(self):
        self.signal()
        history = [{'messageId': 'historical-rescue', 'createdAt': 601, 'status': 'answered'}]
        with patch.object(self.bridge.queue, 'overview', return_value={'messages': history}):
            self.life.tick()
        prompt = self.posts[0][1]['input'][0]['content'][0]['text']
        context = json.loads(prompt.split('\n', 1)[1])
        self.assertEqual(context['round']['startedAt'], 1201)
        self.assertEqual(context['round']['startedAtIso'], '1970-01-01T08:20:01+08:00')
        self.assertTrue(context['round']['pastConversationIsNotCurrentAchievement'])
        self.assertEqual(context['worldClock']['gameTime'], 100000)
        self.assertEqual(context['historicalMessages'][0]['ageSecondsAtRoundStart'], 600)
        self.assertEqual(context['historicalMessages'][0]['createdAtIso'], '1970-01-01T08:10:01+08:00')
        self.assertIn('追加一条带日期的纠正', prompt)

    def test_world_clock_failure_is_explicit_and_never_invented(self):
        self.signal()
        def unavailable(): raise TimeoutError('native query unavailable')
        self.life.world_clock = unavailable
        self.life.tick()
        context = json.loads(self.posts[0][1]['input'][0]['content'][0]['text'].split('\n', 1)[1])
        self.assertFalse(context['worldClock']['available'])
        self.assertNotIn('gameTime', context['worldClock'])
        self.assertEqual(context['worldClock']['errorType'], 'TimeoutError')

    def test_new_timing_evidence_is_frozen_with_original_claim(self):
        self.signal(); self.native_busy = True
        with patch.object(self.life, 'world_clock', wraps=self.life.world_clock) as observe:
            self.life.tick(); self.now += 601; self.native_busy = False; self.life.tick()
            observe.assert_called_once()
        context = json.loads(self.posts[0][1]['input'][0]['content'][0]['text'].split('\n', 1)[1])
        self.assertEqual(context['round']['startedAt'], 1201)

    def test_busy_native_and_busy_managed_gate_do_not_submit(self):
        self.signal(); self.native_busy = True
        self.assertEqual(self.life.tick()['status'], 'native_busy'); self.assertFalse(self.posts)
        self.native_busy = False
        prior = self.tasks.submit('maid_dialogue', 'existing-input', 'one real input',
            maid_uuid=YUI_BODY_UUID, owner_uuid=SURVIVOR_BODY_UUID)
        self.assertEqual(prior['status'], 'submitted')
        self.assertEqual(self.life.tick()['status'], 'busy')
        self.assertEqual(len(self.posts), 1)

    def test_party_input_has_priority_over_new_life(self):
        self.signal()
        with patch.object(self.bridge.queue, 'next_pending', return_value={'messageId': 'pending'}):
            self.assertEqual(self.life.tick()['status'], 'party_input_priority')
        self.assertFalse(self.posts)

    def test_loaded_owner_required(self):
        self.signal(); self.owner_online = False
        self.assertEqual(self.life.tick()['status'], 'owner_unavailable'); self.assertFalse(self.posts)

    def test_post_unknown_survives_restart_and_new_signal_without_replay(self):
        self.signal(); self.drop_post = True
        self.assertEqual(self.life.tick()['status'], 'submission_uncertain')
        self.signal(3); self.now += 700
        restored = PartyLife(self.bridge, signals=self.root / 'signals', clock=lambda: self.now)
        self.assertEqual(restored.tick()['status'], 'submission_uncertain')
        self.assertEqual(len(self.posts), 1)

    def test_native_404_does_not_start_next_signal(self):
        self.signal(); self.life.tick(); self.signal(3)
        self.now += 700; self.drop_get = True
        self.assertEqual(self.life.tick()['status'], 'poll_unavailable')
        self.now += 11; self.life.tick(); self.assertEqual(len(self.posts), 1)

    def test_missing_record_after_ack_is_unknown_not_new_submission(self):
        self.signal(); self.life.tick()
        state = json.loads((self.root / 'life/controller.json').read_text())
        self.tasks._path('maid_dialogue', state['active']['key']).unlink()
        self.assertEqual(self.life.tick()['status'], 'request_ledger_missing')
        self.assertEqual(len(self.posts), 1)

    def test_latest_signal_coalesces_without_backlog(self):
        self.signal(); self.life.tick(); self.signal(7)
        self.now += 11; self.status = 'finished'; self.life.tick()
        self.status = 'running'; self.life.tick()
        self.assertEqual(len(self.posts), 2)
        self.assertEqual(self.life.summary()['active']['signalId'], JOB_ID + ':600:7')

    def test_reply_only_acknowledged_after_exact_completed_task(self):
        self.signal(); reply = {'eventId': 'reply-one', 'text': '真实听见', 'requiresReply': False}
        with patch.object(self.bridge.queue, 'heard_replies', return_value=[reply]), \
                patch.object(self.bridge.queue, 'consume_replies') as ack:
            self.life.tick(); ack.assert_not_called()
            self.assertIn('真实听见', self.posts[0][1]['input'][0]['content'][0]['text'])
            self.now += 11; self.life.tick(); ack.assert_not_called()
            self.now += 11; self.status = 'finished'; self.life.tick()
            ack.assert_called_once_with(ROLE, ['reply-one'], 'task-000000000001')
        self.assertTrue(self.life.summary()['lastResult']['finalSummaryIsPrivate'])
        self.assertFalse(self.life.summary()['lastResult']['automaticSpeech'])

    def test_failed_task_does_not_consume_reply_and_waits_next_tick_signal(self):
        self.signal()
        with patch.object(self.bridge.queue, 'heard_replies', return_value=[{'eventId': 'reply-one'}]), \
                patch.object(self.bridge.queue, 'consume_replies') as ack:
            self.life.tick(); self.now += 11; self.status = 'failed'; self.life.tick()
            ack.assert_not_called()
            self.life.tick(); self.assertEqual(len(self.posts), 1)

    def test_session_change_blocks_active_task(self):
        self.signal(); self.life.tick()
        self.members[0]['sessionId'] = 'other-session'
        config = json.loads((self.root / 'binding.json').read_text()); config['members'] = self.members
        write_json(self.root / 'binding.json', config)
        with self.assertRaisesRegex(ValueError, 'party_life_session_changed'): self.life.tick()
        self.assertEqual(len(self.posts), 1)

    def test_signal_wrong_body_or_identity_refused(self):
        value = self.signal(); value['members'][0]['bodyUuid'] = SURVIVOR_BODY_UUID
        write_json(self.root / 'signals' / ROLE / 'latest-signal.json', value)
        with self.assertRaisesRegex(ValueError, 'party_life_signal_invalid'): self.life.tick()
        self.assertFalse(self.posts)

    def test_recovery_between_claim_and_submit_uses_original_prompt(self):
        self.signal(); self.native_busy = True; self.life.tick()
        saved = json.loads((self.root / 'life/controller.json').read_text())
        self.native_busy = False; self.signal(3)
        self.life.tick()
        self.assertEqual(self.posts[0][1]['input'][0]['content'][0]['text'], saved['active']['prompt'])
        self.assertEqual(self.life.summary()['active']['signalId'], JOB_ID + ':600:2')

    def test_live_catalog_and_enabled_tools_are_bounded_observations_not_actions(self):
        original = self.tasks.transport
        self.tasks.transport = lambda method, path, role, payload=None: (
            [{'name': 'identity', 'enabled': True}, {'name': 'work', 'enabled': False}]
            if path == '/mcp/tools/maid_native' else original(method, path, role, payload))
        calls = []
        def observe(actor, op, args):
            calls.append((op, args))
            if op == 'task_catalog':
                return {'ok': True, 'tasks': [{'taskId': 'fixture:farming', 'enabled': True}],
                        'offset': 0, 'nextOffset': 1, 'total': 9, 'truncated': True, 'observedAt': 1201000}
            return {'ok': True, 'identity': {'position': [1, 64, 2]},
                    'state': {'ownerOnline': True, 'taskId': 'fixture:idle'}, 'observedAt': 1201000}
        self.bridge.native.invoke = observe
        self.signal(); self.life.tick()
        prompt = self.posts[0][1]['input'][0]['content'][0]['text']
        context = json.loads(prompt.split('\n', 1)[1])
        self.assertEqual(context['currentObservation']['identity']['position'], [1, 64, 2])
        self.assertEqual(context['capabilities']['enabledBodyTools'], ['maid_native__identity'])
        self.assertTrue(context['capabilities']['catalog']['truncated'])
        self.assertEqual(context['capabilities']['catalog']['nextOffset'], 1)
        self.assertEqual([op for op, args in calls].count('task_catalog'), 1)
        self.assertTrue(all(op in ('identity', 'task_catalog') for op, args in calls))
        self.assertNotIn('fixture:farming', prompt.split('\n', 1)[0])  # no automatic work selection
        self.assertIn('task_catalog(query=', prompt.split('\n', 1)[0])
        self.assertIn('truncated', prompt.split('\n', 1)[0])
        self.assertEqual(self.life.summary()['taskSearchVersion'], 1)

    def test_completed_summary_is_short_continuation_not_claimed_game_receipt(self):
        self.signal(); self.life.tick(); self.now += 11; self.status = 'finished'; self.life.tick()
        self.signal(3); self.now += 600; self.status = 'running'; self.life.tick()
        context = json.loads(self.posts[-1][1]['input'][0]['content'][0]['text'].split('\n', 1)[1])
        continuation = context['continuation']
        self.assertEqual(continuation['taskId'], 'task-000000000001')
        self.assertEqual(continuation['sourceSessionId'], 'maid-original-life')
        self.assertTrue(continuation['modelClaimNotActionReceipt'])
        self.assertFalse(continuation['summaryTruncated'])
        self.assertIn('下一步仍待验证', continuation['summary'])

    def test_failed_round_does_not_replace_previous_valid_continuation(self):
        self.signal(); self.life.tick(); self.now += 11; self.status = 'finished'; self.life.tick()
        before = json.loads((self.root / 'life/controller.json').read_text())['continuation']
        self.signal(3); self.now += 600; self.status = 'running'; self.life.tick()
        self.now += 11; self.status = 'failed'; self.life.tick()
        after = json.loads((self.root / 'life/controller.json').read_text())
        self.assertEqual(after['continuation'], before)
        self.assertEqual(after['lastResult']['status'], 'failed')


class PartyLifeScheduleTests(unittest.TestCase):
    def test_guard_routes_signal_without_original_model_executor(self):
        from cron_guard import guarded_execute
        with tempfile.TemporaryDirectory() as folder:
            executor = SimpleNamespace(_workspace=SimpleNamespace(agent_id=ROLE, workspace_dir=folder))
            value = managed_job()
            job = SimpleNamespace(id=JOB_ID, meta=value['meta'], task_type='text',
                model_dump=lambda **kw: deepcopy(value))
            async def original(*args): raise AssertionError('native model executor must not run')
            async def signal(*args): return {'qiandeng': {'modelCalls': 0}}
            with patch('world_team_hosts.logical_actor', return_value='game:' + ROLE), \
                    patch('party_life_schedule.execute', side_effect=signal) as send:
                result = asyncio.run(guarded_execute(executor, job, original, 'game',
                    factory=lambda *a, **kw: SimpleNamespace()))
            self.assertEqual(result['qiandeng']['modelCalls'], 0)
            send.assert_called_once()

    def test_fixed_zero_model_schedule_and_wrong_role_denied(self):
        value = managed_job(); validate_job(value, ROLE)
        self.assertEqual(value['schedule']['cron'], '7-57/10 * * * *')
        self.assertEqual(value['task_type'], 'text'); self.assertNotIn('request', value)
        value['enabled'] = False; validate_job(value, ROLE)
        with self.assertRaises(AssertionError): validate_job(value, 'qd-survivor')
        value['task_type'] = 'agent'
        with self.assertRaises(AssertionError): validate_job(value, ROLE)

    def test_signal_same_slot_and_backwards_clock_coalesce(self):
        with tempfile.TemporaryDirectory() as folder, patch('party_life_schedule.is_bound_yui', return_value=True):
            roster = [{'agentId': ROLE}]
            first = publish_signal(ROLE, root=folder, now=1201, members=roster)
            second = publish_signal(ROLE, root=folder, now=1300, members=roster)
            older = publish_signal(ROLE, root=folder, now=600, members=roster)
            self.assertEqual(first['requestId'], second['requestId'])
            self.assertEqual(first['requestId'], older['requestId'])
            self.assertTrue(second['coalesced'])

    def test_cron_only_publishes_and_keeps_workspace_receipt(self):
        calls = []
        def publish(role, now):
            calls.append((role, now)); return {'requestId': 'signal', 'coalesced': False}
        with tempfile.TemporaryDirectory() as folder:
            executor = SimpleNamespace(_workspace=SimpleNamespace(agent_id=ROLE, workspace_dir=folder))
            job = SimpleNamespace(model_dump=lambda **kw: deepcopy(managed_job()))
            result = asyncio.run(execute(executor, job, publish=publish, clock=lambda: 1201))
            self.assertEqual(calls, [(ROLE, 1201)])
            self.assertEqual(result['qiandeng']['modelCalls'], 0)
            self.assertEqual(result['qiandeng']['worldActions'], 0)
            self.assertEqual(result['delivery_status'], 'suppressed')
            self.assertTrue((Path(folder) / 'life-review/last-cron.json').exists())

    @unittest.skipUnless(importlib.util.find_spec('qwenpaw'), 'requires installed native Qwen schema')
    def test_native_schema(self):
        from qwenpaw.app.crons.models import CronJobSpec
        parsed = CronJobSpec.model_validate(managed_job())
        validate_job(parsed.model_dump(mode='json', exclude_none=True), ROLE)
        self.assertIsNone(parsed.request)


if __name__ == '__main__': unittest.main()
