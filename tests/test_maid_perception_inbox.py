from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import hmac
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.request import Request, urlopen
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/sidecar'), str(ROOT / 'world/ops'), str(ROOT / 'tests')]
from maid_agent_api import MaidAdapter, make_handler, _ACTIVE
from maid_identity import IdentityVerifier
from maid_perception_inbox import MaidPerceptionInbox, DELIVERY
from party_role_capabilities import YUI_AGENT_ID, YUI_BODY_UUID, SURVIVOR_BODY_UUID
import test_party_life as life_tests


def binding():
    return {'agentId': YUI_AGENT_ID, 'maidUuid': YUI_BODY_UUID, 'ownerUuid': SURVIVOR_BODY_UUID,
            'sessionId': 'maid-original-life'}


def input_event(text='来自游戏的私有观察', event_id=None):
    actor = {'schema': 1, 'maidUuid': YUI_BODY_UUID, 'ownerUuid': SURVIVOR_BODY_UUID,
             'displayName': '结衣', 'hasCustomName': True, 'modelId': 'fixture:yui',
             'loaded': True, 'entityId': 2, 'observedAt': 1201000,
             'dimension': 'minecraft:overworld', 'position': [1, 64, 2]}
    body = {'qd_identity': actor, 'qd_delivery': DELIVERY, 'model': 'qd-maid-dialogue', 'stream': False,
            'messages': [{'role': 'system', 'content': '仅作历史的人设文字'},
                         {'role': 'user', 'content': '旧历史不要再次累计'},
                         {'role': 'assistant', 'content': '旧回调'}, {'role': 'user', 'content': text}]}
    raw = json.dumps(body, ensure_ascii=False).encode('utf8')
    return {'requestId': event_id or str(uuid.uuid4()), 'bodySha256': hashlib.sha256(raw).hexdigest(),
            'identity': actor, 'body': body}, raw


class InboxTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.inbox = MaidPerceptionInbox(self.root / 'inbox', clock=lambda: 1201)
        self.batch = 'party-life-' + 'a' * 64

    def accept(self, text='新消息', event_id=None):
        event, _ = input_event(text, event_id)
        self.inbox.accept(event, binding())
        return event

    def test_durable_accept_no_speech_and_only_latest_user(self):
        event, _ = input_event()
        receipt = self.inbox.accept(event, binding())
        self.assertEqual(receipt, {'schema': 1, 'object': 'qiandeng.maid.input_receipt',
            'request_id': event['requestId'], 'state': 'queued', 'persisted': True,
            'wake_requested': False, 'assistant_reply': False})
        restored = MaidPerceptionInbox(self.inbox.root)
        data = restored.pending(binding())
        self.assertEqual(len(data['events']), 1)
        self.assertFalse(data['events'][0]['speakerVerified'])
        self.assertEqual(data['events'][0]['visibility'], 'private')
        self.assertNotIn('旧历史', json.dumps(data, ensure_ascii=False))
        self.assertNotIn('旧回调', json.dumps(data, ensure_ascii=False))

    def test_repeated_id_is_idempotent_but_new_same_text_is_an_event(self):
        event = self.accept()
        self.inbox.accept(event, binding()); self.accept()
        self.assertEqual(self.inbox.summary(binding())['counts']['pending'], 2)
        changed, _ = input_event('不同正文', event['requestId'])
        with self.assertRaisesRegex(ValueError, 'conflict'): self.inbox.accept(changed, binding())

    def test_concurrent_requests_are_retained_without_duplicates(self):
        items = [input_event(str(i))[0] for i in range(20)]
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda event: self.inbox.accept(event, binding()), items + items))
        self.assertEqual(self.inbox.summary(binding())['counts']['pending'], 20)

    def test_exact_batch_ack_preserves_late_arrivals_and_restart(self):
        early = [self.accept(str(i))['requestId'] for i in range(3)]
        self.inbox.reserve(binding(), early, self.batch)
        late = self.accept('晚到')['requestId']
        restored = MaidPerceptionInbox(self.inbox.root)
        restored.finish(binding(), early, self.batch, 'task-first', 'completed')
        restored.finish(binding(), early, self.batch, 'task-first', 'completed')
        self.assertEqual([e['eventId'] for e in restored.pending(binding())['events']], [late])
        self.assertEqual(restored.summary(binding())['counts']['consumed'], 3)
        with self.assertRaisesRegex(ValueError, 'conflict'):
            restored.finish(binding(), early, self.batch, 'task-other', 'completed')

    def test_binding_change_cannot_consume_or_expose_old_inputs(self):
        event = self.accept()['requestId']
        changed = binding() | {'sessionId': 'other-session'}
        self.assertFalse(self.inbox.pending(changed)['events'])
        self.assertFalse(self.inbox.summary(changed)['currentBindingValid'])
        with self.assertRaisesRegex(ValueError, 'conflict'): self.inbox.reserve(changed, [event], self.batch)
        for altered in ({'ownerUuid': str(uuid.uuid4())}, {'agentId': 'someone-else'}):
            with self.assertRaises(ValueError): self.inbox.pending(binding() | altered)

    def test_failed_or_unknown_never_requeued(self):
        event = self.accept()['requestId']
        self.inbox.reserve(binding(), [event], self.batch)
        with self.assertRaisesRegex(ValueError, 'terminal'):
            self.inbox.finish(binding(), [event], self.batch, 'task-first', 'poll_unavailable')
        self.assertFalse(self.inbox.pending(binding())['events'])
        self.inbox.finish(binding(), [event], self.batch, 'task-first', 'failed')
        self.assertFalse(self.inbox.pending(binding())['events'])
        self.assertEqual(self.inbox.summary(binding())['counts']['failed'], 1)

    def test_batch_bounds_preserve_complete_head_and_tail(self):
        long = self.accept('树' * 7999)['requestId']
        for i in range(10): self.accept(str(i))
        self.assertFalse(self.inbox.pending(binding(), max_chars=100)['events'])
        batch = self.inbox.pending(binding())
        self.assertEqual(batch['events'][0]['eventId'], long)
        self.assertEqual(batch['events'][0]['text'], '树' * 7999)
        self.assertLessEqual(len(batch['events']), 8)
        self.assertEqual(len(batch['events']) + batch['remainingCount'], 11)
        self.assertLessEqual(len(json.dumps(batch['events'], ensure_ascii=False)), 10000)

    def test_capacity_is_explicit_and_never_drops_unread(self):
        with patch('maid_perception_inbox.MAX_RETAINED', 2):
            first = self.accept('第一'); self.accept('第二')
            with self.assertRaisesRegex(ValueError, 'full'): self.accept('第三')
            self.inbox.accept(first, binding())  # receipt retries still work at capacity
        self.assertEqual([e['text'] for e in self.inbox.pending(binding())['events']], ['第一', '第二'])

    def test_escaped_oversized_input_cannot_block_the_queue_head(self):
        with self.assertRaisesRegex(ValueError, 'size_limit'): self.accept('"' * 8000)
        self.accept('后续正常消息')
        self.assertEqual([e['text'] for e in self.inbox.pending(binding())['events']], ['后续正常消息'])

    def test_summary_has_no_text_and_is_readonly(self):
        self.accept('严格私有正文')
        before = self.inbox.path.read_bytes()
        summary = self.inbox.summary(binding())
        self.assertEqual(before, self.inbox.path.read_bytes())
        self.assertNotIn('严格私有正文', json.dumps(summary, ensure_ascii=False))


class SignedQueueTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name); self.key = b'fixture-secret-never-a-production-key'
        keyfile = self.root / 'key'; keyfile.write_bytes(self.key)
        self.tasks = Mock(); self.tasks.submit.side_effect = AssertionError('no model POST on input')
        self.tasks.poll.side_effect = AssertionError('no old-task poll on input')
        self.registry = SimpleNamespace(root=self.root / 'registry', resolve=lambda *args: binding())
        self.party = SimpleNamespace(config=SimpleNamespace(member=lambda role: binding()),
            perception_inbox=MaidPerceptionInbox(self.root / 'inbox'))
        self.adapter = MaidAdapter(self.root / 'tasks', tasks=self.tasks, registry=self.registry,
            verifier=IdentityVerifier(keyfile, clock=lambda: 1201), party=self.party)

    def signed(self, text='输入', event_id=None):
        event, raw = input_event(text, event_id)
        headers = {'X-QD-Request-Id': event['requestId'], 'X-QD-Issued-At': '1201000000'}
        # IdentityVerifier expects a 10+ digit epoch millis timestamp.
        body = event['body']; body['qd_identity']['observedAt'] = 1201000000
        raw = json.dumps(body, ensure_ascii=False).encode('utf8')
        self.adapter.verifier.clock = lambda: 1201000
        base = (event['requestId'] + '\n1201000000\n' + hashlib.sha256(raw).hexdigest()).encode()
        headers['X-QD-Signature'] = hmac.new(self.key, base, hashlib.sha256).hexdigest()
        return raw, headers

    def test_signed_busy_receipt_zero_models_and_authentication_before_storage(self):
        raw, headers = self.signed()
        with self.assertRaises(ValueError): self.adapter.complete_signed(raw + b' ', headers)
        self.assertEqual(self.party.perception_inbox.summary(binding())['counts']['pending'], 0)
        self.assertEqual(self.adapter.complete_signed(raw, headers)[0], 202)
        self.tasks.submit.assert_not_called(); self.tasks.poll.assert_not_called()

    def test_http_accumulates_while_legacy_model_lane_is_busy(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(self.adapter, 'x' * 48))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def cleanup(): server.shutdown(); server.server_close(); thread.join(2)
        self.addCleanup(cleanup)
        def send(i):
            raw, headers = self.signed('第' + str(i) + '条')
            request = Request('http://127.0.0.1:' + str(server.server_port) + '/v1/maid/chat/completions',
                data=raw, headers=headers | {'Content-Type': 'application/json'})
            with urlopen(request, timeout=10) as result:
                return result.status, json.load(result)
        self.assertTrue(_ACTIVE.acquire(False))
        try:
            with ThreadPoolExecutor(max_workers=4) as pool: results = list(pool.map(send, range(4)))
        finally:
            _ACTIVE.release()
        self.assertTrue(all(code == 202 and not row['assistant_reply'] for code, row in results))
        self.assertEqual(self.party.perception_inbox.summary(binding())['counts']['pending'], 4)
        self.tasks.submit.assert_not_called(); self.tasks.poll.assert_not_called()

    def test_wrong_consumer_and_unknown_delivery_fail_closed(self):
        raw, headers = self.signed()
        self.party.config.member = lambda role: binding() | {'sessionId': 'different'}
        with self.assertRaisesRegex(ValueError, 'binding_changed'): self.adapter.complete_signed(raw, headers)
        self.assertEqual(self.party.perception_inbox.summary(binding())['totalRetained'], 0)

    def test_legacy_dialogue_stays_on_original_completion_path(self):
        event, _ = input_event('原同步请求')
        event['body'].pop('qd_delivery')
        raw = json.dumps(event['body'], ensure_ascii=False).encode('utf8')
        event['bodySha256'] = hashlib.sha256(raw).hexdigest()
        self.adapter.verifier = SimpleNamespace(verify=lambda *a: event)
        self.registry.ensure = lambda actor: binding()
        self.tasks.submit.side_effect = None
        self.tasks.submit.return_value = {'status': 'completed', 'text': '原同步回答',
            'requestId': 'request-original', 'taskId': 'task-original', 'startedAt': 1201}
        code, reply = self.adapter.complete_signed(raw, {})
        self.assertEqual(code, 200)
        self.assertEqual(reply['choices'][0]['message']['content'], '原同步回答')
        self.tasks.submit.assert_called_once()
        self.assertEqual(self.party.perception_inbox.summary(binding())['totalRetained'], 0)


class PerceptionLifeTests(life_tests.PartyLifeTests):
    def enqueue(self, text):
        event, _ = input_event(text)
        self.bridge.perception_inbox.accept(event, self.member)
        return event['requestId']

    def test_inbox_alone_never_wakes_a_model(self):
        self.enqueue('等下一轮正常感知')
        self.life.tick(); self.now += 600; self.life.tick()
        self.assertFalse(self.posts)
        self.assertEqual(self.bridge.perception_inbox.summary(self.member)['counts']['pending'], 1)

    def test_batch_in_original_session_exact_completion_and_late_input(self):
        early = [self.enqueue('观察' + str(i)) for i in range(3)]
        self.signal(); self.life.tick()
        prompt = self.posts[0][1]['input'][0]['content'][0]['text']
        context = json.loads(prompt.split('\n', 1)[1])
        self.assertEqual([e['eventId'] for e in context['privateDialogueInputs']['events']], early)
        self.assertEqual(self.posts[0][1]['session_id'], self.member['sessionId'])
        self.assertIn('不要把原文、私有内容或对此的回答转发', prompt)
        late = self.enqueue('在模型执行期间新到的消息')
        self.now += 11; self.life.tick()
        self.assertEqual(len(self.posts), 1)
        self.now += 11; self.status = 'finished'; self.life.tick()
        self.assertEqual([e['eventId'] for e in self.bridge.perception_inbox.pending(self.member)['events']], [late])
        self.assertEqual(self.bridge.perception_inbox.summary(self.member)['counts']['consumed'], 3)

    def test_unknown_submission_keeps_frozen_batch_and_late_input(self):
        first = self.enqueue('原输入'); self.signal(); self.drop_post = True; self.life.tick()
        self.enqueue('后来输入'); self.signal(3); self.now += 700
        self.life.tick()
        self.assertEqual(len(self.posts), 1)
        counts = self.bridge.perception_inbox.summary(self.member)['counts']
        self.assertEqual((counts['claimed'], counts['pending']), (1, 1))
        self.assertEqual(self.life.tick()['active']['inputIds'], [first])

    def test_completed_ack_can_recover_after_controller_write_failure(self):
        self.enqueue('待完成'); self.signal(); self.life.tick()
        self.now += 11; self.status = 'finished'
        with patch.object(self.life, '_save', side_effect=OSError('simulated durable write failure')):
            with self.assertRaises(OSError): self.life.tick()
        self.life.tick()
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.bridge.perception_inbox.summary(self.member)['counts']['consumed'], 1)

    def test_failed_model_leaves_audited_failed_inputs_not_a_retry(self):
        self.enqueue('待核查'); self.signal(); self.life.tick()
        self.now += 11; self.status = 'failed'; self.life.tick()
        self.assertEqual(self.bridge.perception_inbox.summary(self.member)['counts']['failed'], 1)
        self.signal(3); self.now += 600; self.status = 'running'; self.life.tick()
        context = json.loads(self.posts[-1][1]['input'][0]['content'][0]['text'].split('\n', 1)[1])
        self.assertFalse(context['privateDialogueInputs']['events'])


if __name__ == '__main__':
    unittest.main()
