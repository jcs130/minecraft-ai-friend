"""A slow active body is not an idle-presence opportunity."""
from datetime import datetime, timezone

import pytest
from test_review_speech import setup


def inference(now, *, active=True):
    return {'active': active, 'started_at': now, 'expires_at': now + 180}


def acknowledge(port, review=None):
    review = review or port.offer()['review']
    port.delivered(review['id'], True)
    assert port.decide(review['id'], 'continue', 'Continue actual work')['acknowledged']


@pytest.mark.parametrize('work', ['model', 'native'])
def test_idle_timer_starts_after_actual_work_ends(tmp_path, work):
    port, clock, publish = setup(tmp_path)
    publish()
    acknowledge(port)
    start = clock[0]
    busy = ({'planner_inference': inference(start)} if work == 'model' else
            {'pending': [{'kind': 'task', 'id': 'native-owned', 'phase': 'running'}]})
    # The native transition may legitimately trigger a state-change review;
    # here it was already inspected. No new change exists during the wait.
    publish(**busy)
    if work == 'native':
        clock[0] += 60
        publish(**busy)
        acknowledge(port)
    clock[0] = start + 110
    publish(**busy)
    assert not port.offer()['offered'], 'Active body work must not create idle_presence'
    # Preserve the previous signal for this test: complete the inference only.
    if work == 'native':
        return
    clock[0] += 1
    publish(planner_inference=inference(start, active=False))
    assert not port.offer()['offered']
    clock[0] += 44
    publish()
    assert not port.offer()['offered']
    clock[0] += 1
    publish()
    assert port.offer()['review']['trigger'] == 'idle_presence'


@pytest.mark.parametrize('kind', ['expired', 'future', 'malformed', 'inactive'])
def test_bad_or_ended_inference_cannot_suppress_idle_forever(tmp_path, kind):
    port, clock, publish = setup(tmp_path)
    publish()
    acknowledge(port)
    start = clock[0]
    clock[0] += 45
    signal = inference(start)
    if kind == 'expired':
        signal['expires_at'] = clock[0] - 1
    elif kind == 'future':
        signal['started_at'] = clock[0] + 1
    elif kind == 'malformed':
        signal['expires_at'] = 'unknown'
    else:
        signal['active'] = False
    publish(planner_inference=signal)
    assert port.offer()['review']['trigger'] == 'idle_presence'


def test_busy_does_not_defer_state_changes_or_periodic_review(tmp_path):
    port, clock, publish = setup(tmp_path)
    publish()
    acknowledge(port)
    start = clock[0]
    clock[0] += 60
    publish(planner_inference=inference(start), planner_error='new provider failure')
    review = port.offer()['review']
    assert review['trigger'] == 'state_changed'
    acknowledge(port, review)
    clock[0] += 180
    publish(planner_inference=inference(clock[0]), planner_error='new provider failure')
    assert port.offer()['review']['trigger'] == 'periodic_review'


@pytest.mark.parametrize('fails', [False, True])
def test_controller_publishes_and_releases_bounded_inference(framework_module, tmp_path, run_async, fails):
    from test_controller import setup as controller_setup

    records = []
    async def decide(*_):
        value = next(r['planner_inference'] for r in reversed(records) if 'planner_inference' in r)
        assert value['active'] is True
        assert 0 < value['expires_at'] - value['started_at'] <= 300
        if fails:
            raise RuntimeError('offline failure')
        return {'content': 'Wait', 'tool_calls': []}
    module, _, controller = controller_setup(framework_module, tmp_path, decide)
    controller.publish = lambda **value: records.append(value)
    controller.model_started_at = datetime.now(timezone.utc).isoformat()
    if fails:
        with pytest.raises(RuntimeError, match='offline failure'):
            run_async(controller.decide_with_events([], []))
    else:
        run_async(controller.decide_with_events([], []))
    assert [r['planner_inference']['active'] for r in records if 'planner_inference' in r] == [True, False]
