"""Review intake/known-terminal boundaries: no real model, game or cron calls."""
import copy
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from review import ReviewQueue
from numen_gateway import read_json
import test_survival_controller as fixtures


def sleep_receipt(action_id='a' * 32):
    return {'schema': 2, 'actionId': action_id, 'turnId': 'survival-' + 'b' * 32,
            'tool': 'sleep', 'status': 'completed', 'completionConfirmed': True,
            'result': {'ok': True, 'completionConfirmed': True,
                       'result': {'success': True, 'data': {'sleeping': True, 'verified': True}}}}


class ReviewQueueTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.state = Path(temp.name)
        self.queue = ReviewQueue(self.state, lambda: 1800000000)

    def test_exact_id_dedup_survives_terminal_and_restart(self):
        first = self.queue.request('cron:10-minute-slot')
        snapshot = self.queue.pending()
        self.queue.acknowledge(snapshot, 'task-first')
        again = ReviewQueue(self.state).request('cron:10-minute-slot')
        self.assertEqual(again['reviewId'], first['reviewId'])
        self.assertEqual(again['code'], 'review_already_requested')
        self.assertIsNone(self.queue.pending())

    def test_concurrent_intake_is_one_merged_batch_and_never_drops_newer_signal(self):
        with ThreadPoolExecutor(max_workers=4) as executor:
            rows = list(executor.map(lambda _: ReviewQueue(self.state).request('same-slot'), range(8)))
        self.assertTrue(all(r['ok'] for r in rows))
        self.assertEqual(self.queue.pending()['signalCount'], 1)
        self.queue.request('next-slot')
        original = self.queue.pending()
        self.assertEqual(original['signalCount'], 2)
        self.queue.request('during-active')
        self.queue.acknowledge(original, 'task-old')
        self.queue.acknowledge(original, 'task-old')
        pending = self.queue.pending()
        self.assertEqual(pending['signalCount'], 1)
        self.assertGreater(pending['watermark'], original['watermark'])
        with self.assertRaisesRegex(ValueError, 'task_mismatch'):
            self.queue.acknowledge(original, 'different-task')

    def test_invalid_or_spoofed_sleep_is_not_queued(self):
        for request in ('', '../escape', 'x' * 161, None, 'newline\n', 'sleep:' + 'a' * 32):
            self.assertFalse(self.queue.request(request)['ok'])
        for reason in ('sleep_completed', 'goal_changed', '', None):
            self.assertFalse(self.queue.request('same-id', reason)['ok'])
        base = sleep_receipt()
        rows = [None, {'tool': 'sleep', 'result': 'unknown'}, dict(base, status='unknown'),
                dict(base, completionConfirmed=False), dict(base, tool='eat'), dict(base, result='unknown')]
        for path in (('result', 'ok'), ('result', 'completionConfirmed'),
                     ('result', 'result', 'success'), ('result', 'result', 'data', 'verified'),
                     ('result', 'result', 'data', 'sleeping')):
            row = copy.deepcopy(base)
            field = row
            for key in path[:-1]:
                field = field[key]
            field[path[-1]] = False
            rows.append(row)
        for row in rows:
            self.assertIsNone(self.queue.sleep_receipt(row))
        self.assertIsNone(self.queue.pending())

    def test_real_sleep_entry_has_precise_fact_and_persistent_dedup(self):
        row = sleep_receipt()
        self.assertTrue(self.queue.sleep_receipt(row)['ok'])
        self.queue.sleep_receipt(row)
        snapshot = self.queue.pending()
        self.assertEqual(snapshot['signalCount'], 1)
        self.assertEqual(snapshot['sleepActionId'], row['actionId'])
        self.assertIn('not waking', snapshot['notice'])
        self.queue.acknowledge(snapshot, 'task-sleep-review')
        self.assertTrue(self.queue.sleep_receipt(row)['ok'])
        self.assertIsNone(self.queue.pending())

    def test_forged_ack_cannot_consume_queue(self):
        self.queue.request('slot')
        original = self.queue.pending()
        for row in ({'watermark': 1, 'reviewId': 'review-2'}, {'watermark': 999, 'reviewId': 'review-999'}):
            with self.assertRaises(ValueError):
                self.queue.acknowledge(row, 'task')
        self.assertEqual(self.queue.pending(), original)


class ControllerReviewTests(unittest.TestCase):
    create = fixtures.ControllerTests.create
    write = fixtures.ControllerTests.write

    def setUp(self):
        fixtures.ControllerTests.setUp(self)
        self.settings.update(dailyPlanningLimit=None, decisionCooldownSeconds=0, autonomous=True)
        self.write('settings.json', self.settings)
        self.controller = self.create()
        self.controller.data.update(lastDecisionSignature=self.controller.decision_signature(self.gateway.body, {}),
                                    lastReviewAt=self.clock.now)

    def finish(self, status='completed'):
        self.backend.reply = {'status': 'finished', 'result': {'status': status, 'output': [
            {'role': 'assistant', 'type': 'message', 'status': 'completed',
             'content': [{'type': 'text', 'text': 'Reviewed actual evidence; retain current mission.'}]}]}}
        self.controller.tick()

    def test_idle_signal_runs_one_same_session_task_without_changing_goal_or_control(self):
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 0)
        control = (self.state / 'control.json').read_bytes()
        session = copy.deepcopy(self.controller.session)
        self.controller.reviews.request('cron:1')
        self.controller.reviews.request('cron:2')
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        payload = self.backend.submitted[-1]
        context = json.loads(payload['prompt'].split('\n', 1)[1])
        self.assertEqual(payload['session'], session)
        self.assertEqual(context['mission'], self.settings['mission'])
        self.assertEqual(context['review']['signalCount'], 2)
        self.assertEqual(context['wakeReason'], 'requested_review')
        self.assertIn('memory/goals.md', context['instruction'])
        self.assertIn('MEMORY.md', context['instruction'])
        self.assertEqual((self.state / 'control.json').read_bytes(), control)
        self.finish()
        self.assertIsNone(self.controller.reviews.pending())
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)

    def test_active_task_serializes_and_late_signal_survives_exact_terminal_ack(self):
        self.controller.reviews.request('before-task')
        self.controller.tick()
        captured = copy.deepcopy(self.controller.data['active']['review'])
        self.controller.reviews.request('during-task')
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.finish()
        pending = self.controller.reviews.pending()
        self.assertEqual(pending['signalCount'], 1)
        self.assertGreater(pending['watermark'], captured['watermark'])

    def test_restart_polls_same_known_task_without_second_submission(self):
        self.controller.reviews.request('before-restart')
        self.controller.tick()
        task_id = self.controller.data['active']['taskId']
        self.controller = self.create()
        self.finish()
        self.assertEqual(self.backend.polled, [task_id])
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertIsNone(self.controller.reviews.pending())

    def test_unknown_submission_never_acknowledges_or_replays(self):
        self.controller.reviews.request('unknown-post')
        self.backend.on_submit = lambda *_: (_ for _ in ()).throw(SystemExit())
        with self.assertRaises(SystemExit):
            self.controller.tick()
        self.backend.cancel_reply = {'stopped': False, 'waitingForTerminal': True}
        self.controller = self.create()
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertIsNotNone(self.controller.reviews.pending())
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])

    def test_pause_busy_and_action_inflight_do_not_submit_or_consume(self):
        self.controller.reviews.request('blocked-boundary')
        self.write('control.json', {'schema': 1, 'enabled': False})
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 0)
        self.assertIsNotNone(self.controller.reviews.pending())
        self.write('control.json', {'schema': 1, 'enabled': True})
        self.gateway.body['task']['busy'] = True
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 0)
        self.gateway.body['task']['busy'] = False
        self.controller.data['actionExecution'] = {'inFlight': True, 'ok': True}
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 0)
        self.assertIsNotNone(self.controller.reviews.pending())

    def test_unknown_action_does_not_gain_a_new_lease(self):
        self.controller.reviews.request('blocked-unknown')
        self.write('unknown.json', {'schema': 1, 'result': 'unknown'})
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 0)
        self.assertEqual(self.gateway.opened, [])
        self.assertIsNotNone(self.controller.reviews.pending())

    def test_failed_native_terminal_consumes_exact_review_without_retry(self):
        self.controller.reviews.request('failure')
        self.controller.tick()
        self.finish('failed')
        self.assertIsNone(self.controller.reviews.pending())
        self.assertFalse(self.controller.data['lastDecision']['completed'])

    def test_sleep_receipt_is_collected_during_task_but_review_only_at_next_boundary(self):
        self.controller.data['lastDecisionSignature'] = None
        self.controller.tick()
        row = sleep_receipt()
        row['turnId'] = self.controller.data['active']['turnId']
        self.gateway.turn_receipts = lambda _: [row]
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(self.controller.reviews.pending()['reasons'], ['sleep_completed'])
        self.finish()
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)
        context = json.loads(self.backend.submitted[-1]['prompt'].split('\n', 1)[1])
        self.assertIn('不证明睡足或已醒', context['instruction'])
        self.assertEqual(context['review']['sleepActionId'], row['actionId'])

    def test_runtime_cooldown_and_unavailable_native_tools_preserve_pending(self):
        self.controller.reviews.request('wait-tools')
        self.controller.settings['decisionCooldownSeconds'] = 30
        self.controller.data['nextDecisionAt'] = self.clock.now + 30
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'cooldown')
        self.assertEqual(len(self.backend.submitted), 0)
        self.controller.settings['decisionCooldownSeconds'] = 0
        with patch.dict('os.environ', {'SURVIVOR_QWEN_MODE': 'external'}), patch('native_tools.require_ready', return_value=False):
            self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'waiting_for_tools')
        self.assertEqual(len(self.backend.submitted), 0)
        self.assertIsNotNone(self.controller.reviews.pending())

    @unittest.skipUnless(importlib.util.find_spec('mcp'), 'Actual MCP SDK is available in the survivor image')
    def test_registered_mcp_only_queues_and_cannot_claim_sleep_or_mutate_body(self):
        import mcp_server
        async def check():
            server = mcp_server.make_server(self.gateway)
            listed = await server.list_tools()
            self.assertEqual({tool.name for tool in listed}, set(mcp_server.TOOL_NAMES))
            tool = next(tool for tool in listed if tool.name == 'request_review')
            self.assertEqual(tool.inputSchema['required'], ['request_id'])
            self.assertEqual(set(tool.inputSchema['properties']), {'request_id', 'reason'})
            async def call(args):
                result = await server.call_tool('request_review', args)
                blocks = result[0] if isinstance(result, tuple) else result
                return json.loads(blocks[0].text)
            self.assertTrue((await call({'request_id': 'native-cron:slot'}))['ok'])
            self.assertEqual((await call({'request_id': 'native-cron:slot'}))['code'], 'review_already_requested')
            self.assertFalse((await call({'request_id': 'fake-sleep', 'reason': 'sleep_completed'}))['ok'])
        asyncio.run(check())
        self.assertEqual(self.gateway.actions, [])
        self.assertEqual(self.gateway.opened, [])
        self.assertEqual(self.backend.submitted, [])
        self.assertEqual(self.controller.reviews.pending()['signalCount'], 1)


if __name__ == '__main__':
    unittest.main()
