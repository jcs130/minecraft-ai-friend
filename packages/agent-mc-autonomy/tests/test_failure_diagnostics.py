import dataclasses
import json
from pathlib import Path

import pytest

from test_controller import Bridge, choose


@pytest.mark.parametrize('seam', ['status.publish', 'host_state.persist'])
def test_first_failure_survives_cleanup(framework_module, tmp_path, monkeypatch, run_async, seam):
    from agent_mc_autonomy.runner import run_session

    first = PermissionError(13, 'PRIVATE provider/persona/credential', '/PRIVATE/credentials/config')
    first.winerror = 5
    secondary = OSError(28, 'PRIVATE cleanup')
    replaced = Path.replace
    failures = []

    def replace(path, target):
        if Path(target).name in {'status.json', 'host-state.json'}:
            state = json.loads(path.read_text(encoding='utf-8'))
            fail_state = (seam == 'host_state.persist' and Path(target).name == 'host-state.json'
                          and state.get('uncertain') is False and state.get('inflight_request') is None)
            fail_status = seam == 'status.publish' and Path(target).name == 'status.json' and state.get('viewer_action')
            if not failures and (fail_state or fail_status):
                failures.append(first)
                raise first
            if len(failures) == 1 and Path(target).name == 'status.json':
                failures.append(secondary)
                raise secondary
        return replaced(path, target)

    monkeypatch.setattr(Path, 'replace', replace)
    settings = dataclasses.replace(framework_module.Settings(), enabled=True, host='example.test', username='Alice', max_decisions=1)
    body = Bridge()

    class Planner:
        async def decide(self, *_):
            return choose()

        async def aclose(self):
            pass

    with pytest.raises(PermissionError) as raised:
        run_async(run_session(settings, tmp_path/'fake', tmp_path, Planner(), 'fixture', lambda **_: None,
                              lambda: False, bridge_factory=lambda *_: body))
    assert raised.value is first
    host = tmp_path/'sessions'/settings.identity/'host'
    records = list((host/'runtime-diagnostics').glob('*.json'))
    assert len(records) == 1
    record = json.loads(records[0].read_text(encoding='utf-8'))
    assert [r['class'] for r in record['exceptions']] == ['PermissionError', 'OSError']
    assert record['exceptions'][0]['operation'] == seam
    assert record['exceptions'][0]['winerror'] == 5
    assert record['exceptions'][1]['secondary'] is True
    assert 'PRIVATE' not in records[0].read_text(encoding='utf-8')
    state = json.loads((host/'host-state.json').read_text(encoding='utf-8'))
    assert state['stopped'] is True
    assert state['uncertain'] is (seam == 'host_state.persist')
    assert (state['inflight_request'] is not None) is (seam == 'host_state.persist')
    assert len([c for c in body.calls if c[0] == 'mc_do']) == 1
    assert body.closed


def test_diagnostic_bounds_and_write_failure_keep_original(tmp_path, monkeypatch):
    from agent_mc_autonomy.failure_diagnostics import FailureDiagnostics

    record = FailureDiagnostics(tmp_path, 'session')
    first = PermissionError(13, 'PRIVATE' * 10000, '/PRIVATE/config')
    record.capture(first, 'status.publish')
    diagnostic_id = record.id
    for _ in range(100):
        record.capture(OSError(5, 'PRIVATE'), 'cleanup')
    assert record.first is first and record.id == diagnostic_id
    text = record.path.read_text(encoding='utf-8')
    assert len(text.encode()) < 16000 and 'PRIVATE' not in text
    assert len(json.loads(text)['exceptions']) <= 16
    monkeypatch.setattr(Path, 'replace', lambda *_: (_ for _ in ()).throw(OSError('PRIVATE disk')))
    failing = FailureDiagnostics(tmp_path, 'other-session')
    failing.capture(first, 'status.publish')
    assert failing.first is first and failing.reference()['diagnostic_available'] is False
