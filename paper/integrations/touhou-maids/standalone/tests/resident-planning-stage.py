"""Failure-injection acceptance against a marked, loopback-only native NPC world.

The launcher supplies Fixture as the synthetic LLM endpoint, creates real test
bodies, and calls first_run / after_restart around a normal server restart.
No online inference or production credentials are used. Successful fixture
responses test dispatch only; they are not evidence of model autonomy.
"""
import importlib.util
import json
from http.server import BaseHTTPRequestHandler
from pathlib import Path
import time
import uuid


class Fixture(BaseHTTPRequestHandler):
    mode = 'unavailable'
    calls = []

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
        type(self).calls.append({'mode': self.mode, 'at': time.time()})
        status = 503 if self.mode == 'unavailable' else 200
        content = 'not valid JSON' if self.mode == 'malformed' else json.dumps({'action': 'cli', 'command': 'status'})
        payload = {'error': {'message': 'synthetic inference outage'}} if status == 503 else {
            'id': 'synthetic', 'object': 'chat.completion', 'model': 'qa',
            'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': content}}]}
        kind = 'application/json'
        data = json.dumps(payload).encode()
        if status == 200 and request.get('stream'):
            kind = 'text/event-stream'
            data = ('data: ' + json.dumps({'choices': [{'index': 0, 'delta': {'content': content}, 'finish_reason': None}]})
                    + '\n\ndata: ' + json.dumps({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]})
                    + '\n\ndata: [DONE]\n\n').encode()
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


def suite(stage, report):
    spec = importlib.util.spec_from_file_location('gameplay_planning', Path(__file__).with_name('resident-gameplay-stage.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Exercise(stage, report)


def plan(test, actor):
    ack = test.resident('resident ' + actor + ' plan')
    test.check('inference_request_accepted', ack['status'] == 'accepted')
    request = ack['requestId']
    result = test.stock.until(lambda: (r if (r := test.resident('resident ' + actor + ' receipt ' + request))['status'] != 'accepted' else None), 85)
    test.evidence['receipts'].append(result)
    test.save()
    return result


def first_run(stage, actor, peer, report):
    test = suite(stage, report)
    read = lambda: test.resident('resident ' + actor + ' status')
    initial = read()
    test.check('fresh_planner_ready', initial['planning']['status'] == 'ready')
    test.check('no_player_connection', json.loads(test.cmd('companiontest player-count'))['onlinePlayers'] == 0)
    before_items = test.items(actor)
    first = plan(test, actor)
    test.check('failed_inference_is_not_a_body_action', first['status'] == 'failed' and first['reason'] == 'model_unavailable' and first['actionDispatched'] is False and first['completed'] is False)
    test.check('failure_preserves_real_inventory', before_items == test.items(actor))
    count = len(Fixture.calls)
    blocked = test.resident('resident ' + actor + ' plan')
    test.check('immediate_retry_returns_bounded_backoff', blocked['status'] == 'blocked' and blocked['reason'] == 'model_backoff_no_action' and 0 < blocked['retryAfterMs'] <= 30_000)
    time.sleep(1)
    test.check('backoff_does_not_call_model', len(Fixture.calls) == count)
    test.check('other_resident_not_rate_limited', test.resident('resident ' + peer + ' status')['planning']['status'] == 'ready')
    position = initial['position']
    request = str(uuid.uuid4())
    ack = test.resident('resident ' + actor + ' act ' + request + ' ' + json.dumps({'action': 'walk', 'at': {**position, 'x': position['x'] + 3}}))
    test.check('native_action_allowed_during_backoff', ack['status'] == 'accepted')
    walked = test.stock.until(lambda: (r if (r := test.resident('resident ' + actor + ' receipt ' + request))['status'] != 'accepted' else None), 45)
    test.check('native_pathfinding_reaches_target_during_backoff', walked['status'] == 'completed' and read()['position']['x'] >= position['x'] + 2)
    old = test.resident('resident ' + actor + ' receipt ' + first['requestId'])
    test.check('old_failure_survives_new_action', old['status'] == 'failed' and old['reason'] == first['reason'] and old['actionDispatched'] is False)
    wait = read()['planning']['retryAfterMs'] / 1000
    time.sleep(wait + .2)
    Fixture.mode = 'malformed'
    second = plan(test, actor)
    test.check('invalid_model_output_has_diagnosis_not_action', second['status'] == 'rejected' and second['reason'] == 'invalid_model_action' and second['validation']['executed'] is False)
    test.check('second_failure_increases_delay', second['retryAfterMs'] == 60_000 and second['planning']['consecutiveFailures'] == 2)
    test.evidence.update(actor=actor, peer=peer, first=first, second=second, calls=len(Fixture.calls), passed=True, realModel=False)
    test.save()


def after_restart(stage, original, report):
    saved = json.loads(original.read_text(encoding='utf8'))
    actor = saved['actor']
    test = suite(stage, report)
    state = test.resident('resident ' + actor + ' status')
    test.check('failure_count_survives_cold_restart', state['planning']['consecutiveFailures'] == 2)
    for key in ('first', 'second'):
        receipt = test.resident('resident ' + actor + ' receipt ' + saved[key]['requestId'])
        test.check('cold_restart_keeps_original_' + key, receipt['status'] == saved[key]['status'] and receipt['actionDispatched'] is False and receipt['reason'] == saved[key]['reason'])
    count = len(Fixture.calls)
    if state['planning']['retryAfterMs'] > 0:
        blocked = test.resident('resident ' + actor + ' plan')
        test.check('restart_cannot_bypass_backoff', blocked['reason'] == 'model_backoff_no_action')
    test.check('restart_does_not_replay_inference', len(Fixture.calls) == count)
    time.sleep(state['planning']['retryAfterMs'] / 1000 + .2)
    Fixture.mode = 'healthy'
    good = plan(test, actor)
    test.check('valid_decision_executes_ordinary_read', good['status'] == 'completed' and good['input']['command'] == 'status')
    health = test.resident('resident ' + actor + ' status')['planning']
    test.check('healthy_decision_resets_failure_streak', health['status'] == 'ready' and health['consecutiveFailures'] == 0)
    test.evidence.update(passed=True, realModel=False)
    test.save()
