import dataclasses
import hashlib
import json
import sqlite3
import uuid

import pytest

from test_controller import Bridge, choose


def fixture(tmp_path, framework_module):
    from agent_mc_autonomy.mailbox import Mailbox
    settings = dataclasses.replace(framework_module.Settings(), host='example.test', username='Alice', enabled=True, max_decisions=1)
    host = tmp_path/'sessions'/settings.identity/'host'
    host.mkdir(parents=True)
    session, run = [str(uuid.uuid4()) for _ in range(2)]
    request = 'fd81655b-fc62-40a8-937f-dc747a5360a4'
    task = 'd48caefd-1030-428d-9c4f-8df1e54efd35:9'
    state = {'stopped': True, 'pending': [], 'inflight_request': None, 'uncertain': True}
    status = {'phase': 'failed', 'settings_identity': settings.identity, 'runtime_session': session, 'native_run': run,
              'game_connected': False, 'autonomy_running': False,
              'pending': [{'kind': 'task', 'id': task, 'phase': 'accepted', 'terminal': False,
                           'goalCompleted': False, 'evidence': {'localId': 9}}], 'error': 'PermissionError'}
    for name, data in [('host-state.json', state), ('status.json', status)]:
        (host/name).write_text(json.dumps(data), encoding='utf-8')
    mailbox = Mailbox(host)
    feedback = str(uuid.uuid4())
    mailbox.submit('feedback', {'goal': 'PRIVATE fresh planning', 'mode': 'insert', 'origin': 'host_review'}, feedback)
    client = host.parent/'client'
    (client/'requests').mkdir(parents=True)
    (client/f'events-{run}.jsonl').write_text(json.dumps({'run': run, 'cursor': 1, 'type': 'minecraft.task',
        'execution': {'id': 'old:8', 'terminal': True, 'phase': 'completed'}})+'\n', encoding='utf-8')
    (client/'requests'/(hashlib.sha256(request.encode()).hexdigest()+'.json')).write_text(json.dumps({
        'requestId': request, 'phase': 'returned', 'outcome': {'execution': {'id': task, 'phase': 'accepted', 'terminal': False}}}), encoding='utf-8')
    options = dict(expected_identity=settings.identity, expected_session=session, expected_run=run,
                   expected_state_sha256=hashlib.sha256((host/'host-state.json').read_bytes()).hexdigest(),
                   expected_status_sha256=hashlib.sha256((host/'status.json').read_bytes()).hexdigest(),
                   acknowledgement_id=str(uuid.uuid4()), operator='fixture-operator', reason='accepted task outcome unknown',
                   evidence_id='sha256:'+('a'*64), attest_prior_processes_exited=True,
                   choice='acknowledge-unknown', native_request_ids=[request])
    return settings, host, mailbox, feedback, options


def test_assess_unknown_ack_audit_retry_and_fresh_planning(tmp_path, framework_module, run_async):
    from agent_mc_autonomy.recovery import acknowledge_unknown, assess
    from agent_mc_autonomy.controller import Controller
    settings, host, box, feedback, options = fixture(tmp_path, framework_module)
    command_before = box.get(feedback)
    with sqlite3.connect(box.path) as db:
        payload_before = db.execute('SELECT payload FROM commands WHERE id=?', (feedback,)).fetchone()[0]
    before = (host/'host-state.json').read_bytes(), (host/'status.json').read_bytes()
    observed = assess(settings, tmp_path, native_request_ids=options['native_request_ids'])
    assert observed['classification'] == 'unknown' and observed['old_work'][0]['classification'] == 'accepted_only_unknown'
    assert (host/'host-state.json').read_bytes() == before[0]
    receipt = acknowledge_unknown(settings, tmp_path, **options)
    assert receipt['classification'] == 'acknowledged_unknown' and receipt['verified'] is False
    assert json.loads((host/'host-state.json').read_text()) == {'stopped': True, 'uncertain': False, 'pending': [], 'inflight_request': None}
    assert (host/'status.json').read_bytes() == before[1] and box.get(feedback) == command_before
    with sqlite3.connect(box.path) as db:
        assert db.execute('SELECT payload FROM commands WHERE id=?', (feedback,)).fetchone()[0] == payload_before
    bridge = Bridge()
    async def decide(*_):
        return choose()
    controller = Controller(bridge, decide, settings, host, lambda **_: None, lambda: False, box)
    run_async(controller.run('fixture'))
    assert all(c[2].get('request_id') not in options['native_request_ids'] for c in bridge.calls)
    assert len([c for c in bridge.calls if c[0] == 'mc_do']) == 1
    # A retry returns the original committed receipt even after later state changes.
    after_run = (host/'host-state.json').read_bytes()
    assert acknowledge_unknown(settings, tmp_path, **options) == receipt
    assert (host/'host-state.json').read_bytes() == after_run


@pytest.mark.parametrize('field,value', [
    ('expected_identity', 'wrong'), ('expected_session', str(uuid.uuid4())), ('expected_run', str(uuid.uuid4())),
    ('expected_state_sha256', '0'*64), ('expected_status_sha256', '0'*64), ('choice', 'force'),
    ('attest_prior_processes_exited', False), ('operator', ''), ('reason', ''), ('evidence_id', ''),
    ('acknowledgement_id', '../escape'), ('native_request_ids', [])])
def test_ack_refuses_wrong_operator_contract(tmp_path, framework_module, field, value):
    from agent_mc_autonomy.recovery import acknowledge_unknown
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    before = (host/'host-state.json').read_bytes()
    options[field] = value
    with pytest.raises((ValueError, RuntimeError)):
        acknowledge_unknown(settings, tmp_path, **options)
    assert (host/'host-state.json').read_bytes() == before


@pytest.mark.parametrize('state_change,status_change,dispatching', [
    ({'pending': [{'id': 'live'}]}, {}, False), ({'inflight_request': 'live'}, {}, False),
    ({'stopped': False}, {}, False), ({'uncertain': False}, {}, False),
    ({}, {'phase': 'running'}, False), ({}, {'settings_identity': 'wrong'}, False),
    ({}, {'game_connected': True}, False), ({}, {'autonomy_running': True}, False), ({}, {}, True)])
def test_ack_refuses_nonempty_or_unbound_state(tmp_path, framework_module, state_change, status_change, dispatching):
    from agent_mc_autonomy.recovery import acknowledge_unknown
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    for filename, change, digest in [('host-state.json', state_change, 'expected_state_sha256'), ('status.json', status_change, 'expected_status_sha256')]:
        path = host/filename
        path.write_text(json.dumps({**json.loads(path.read_text()), **change}), encoding='utf-8')
        options[digest] = hashlib.sha256(path.read_bytes()).hexdigest()
    if dispatching:
        with sqlite3.connect(host/'commands.sqlite3') as db:
            db.execute("UPDATE commands SET state='dispatching'")
    before = (host/'host-state.json').read_bytes()
    with pytest.raises((ValueError, RuntimeError)):
        acknowledge_unknown(settings, tmp_path, **options)
    assert (host/'host-state.json').read_bytes() == before


def test_held_owner_and_cas_race_refuse(tmp_path, framework_module, monkeypatch):
    import agent_mc_autonomy.recovery as recovery
    from agent_mc_autonomy.ownership import session_lease
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    with session_lease(host), pytest.raises(RuntimeError):
        recovery.acknowledge_unknown(settings, tmp_path, **options)
    original = recovery._replace_state
    def race(path, body, expected):
        path.write_text('{"stopped":false}', encoding='utf-8')
        return original(path, body, expected)
    monkeypatch.setattr(recovery, '_replace_state', race)
    with pytest.raises(RuntimeError):
        recovery.acknowledge_unknown(settings, tmp_path, **options)
    assert json.loads((host/'host-state.json').read_text()) == {'stopped': False}


def test_terminal_evidence_is_truthful_but_not_automatic_ack(tmp_path, framework_module):
    from agent_mc_autonomy.recovery import assess
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    path = host.parent/'client'/f"events-{options['expected_run']}.jsonl"
    with path.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'run': options['expected_run'], 'cursor': 2,
            'execution': {'id': 'd48caefd-1030-428d-9c4f-8df1e54efd35:9', 'terminal': True, 'phase': 'blocked'}})+'\n')
    result = assess(settings, tmp_path, native_request_ids=options['native_request_ids'])
    assert result['old_work'][0]['classification'] == 'archived_terminal'
    assert result['old_work'][0]['terminal_phase'] == 'blocked'
    assert result['classification'] == 'unknown' and result['verified'] is False
    assert json.loads((host/'host-state.json').read_text())['uncertain'] is True


@pytest.mark.parametrize('damage', ['missing', 'wrong_run', 'request_mismatch', 'oversize'])
def test_invalid_evidence_never_acknowledges(tmp_path, framework_module, damage):
    from agent_mc_autonomy.recovery import acknowledge_unknown
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    path = host.parent/'client'/f"events-{options['expected_run']}.jsonl"
    if damage == 'missing':
        path.unlink()
    elif damage == 'wrong_run':
        path.write_text(json.dumps({'run': str(uuid.uuid4()), 'cursor': 1}), encoding='utf-8')
    elif damage == 'oversize':
        path.write_bytes(b'x'*(4*1024*1024+1))
    else:
        request = host.parent/'client/requests'/(hashlib.sha256(options['native_request_ids'][0].encode()).hexdigest()+'.json')
        request.write_text('{}', encoding='utf-8')
    with pytest.raises((OSError, RuntimeError, ValueError)):
        acknowledge_unknown(settings, tmp_path, **options)
    assert json.loads((host/'host-state.json').read_text())['uncertain'] is True


def test_pending_gate_prevents_bridge_construction_and_changed_sources(tmp_path, framework_module, monkeypatch, run_async):
    import agent_mc_autonomy.recovery as recovery
    from agent_mc_autonomy.runner import run_session
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    write = recovery._write_immutable
    def fail(path, body):
        if path.name == 'committed.json':
            raise PermissionError('fixture')
        write(path, body)
    monkeypatch.setattr(recovery, '_write_immutable', fail)
    with pytest.raises(OSError):
        recovery.acknowledge_unknown(settings, tmp_path, **options)
    def forbidden(*_):
        pytest.fail('Pending acknowledgement must block native construction')
    with pytest.raises(RuntimeError, match='outcome_unknown'):
        run_async(run_session(settings, tmp_path/'fake', tmp_path, None, 'fixture', lambda **_: None,
                              lambda: False, bridge_factory=forbidden))
    assert not (host/'client.json').exists()
    monkeypatch.setattr(recovery, '_write_immutable', write)
    archive = host.parent/'client'/f"events-{options['expected_run']}.jsonl"
    with archive.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'run': options['expected_run'], 'cursor': 2})+'\n')
    with pytest.raises(RuntimeError, match='evidence_changed'):
        recovery.acknowledge_unknown(settings, tmp_path, **options)


def test_admin_cli_is_local_and_does_not_start_runtime(tmp_path, framework_module, monkeypatch, capsys):
    from agent_mc_autonomy.cli import main
    import agent_mc_autonomy.cli as cli
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    config = tmp_path/'fixture.toml'
    config.write_text('[runtime]\nenabled=false\n[server]\nhost="example.test"\nusername="Alice"\n', encoding='utf-8')
    monkeypatch.setattr(cli.Settings, 'parse', lambda *_: settings)
    def forbidden(*_):
        pytest.fail('Admin CLI must not construct model/body')
    monkeypatch.setattr(cli, 'play', forbidden)
    monkeypatch.setattr(cli, 'HttpPlannerConfig', forbidden)
    common = ['--config', str(config), '--data', str(tmp_path), '--native-request-id', options['native_request_ids'][0]]
    tree_before = {str(p.relative_to(tmp_path)): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}
    directories_before = {str(p.relative_to(tmp_path)) for p in tmp_path.rglob('*') if p.is_dir()}
    assert main(['recovery-assess', *common]) == 0
    assert json.loads(capsys.readouterr().out)['classification'] == 'unknown'
    assert tree_before == {str(p.relative_to(tmp_path)): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}
    assert directories_before == {str(p.relative_to(tmp_path)) for p in tmp_path.rglob('*') if p.is_dir()}
    absent = tmp_path/'absent-data'
    assert main(['recovery-assess', '--config', str(config), '--data', str(absent)]) == 1
    assert json.loads(capsys.readouterr().out)['error'] == 'RuntimeError'
    assert not absent.exists()
    args = ['acknowledge-unknown', *common, '--request-id', options['acknowledgement_id'], '--attest-prior-processes-exited', '--acknowledge-unknown']
    for key in ['expected_identity', 'expected_session', 'expected_run', 'expected_state_sha256', 'expected_status_sha256', 'operator', 'reason', 'evidence_id']:
        args.extend(['--'+key.replace('_', '-'), options[key]])
    assert main(args) == 0
    assert json.loads(capsys.readouterr().out)['classification'] == 'acknowledged_unknown'
    assert not (host/'client.json').exists()


@pytest.mark.parametrize('failure', ['prepared.json', 'host-state.json', 'committed.json'])
def test_write_failures_stay_fenced_and_stable_id_can_finish(tmp_path, framework_module, monkeypatch, run_async, failure):
    import agent_mc_autonomy.recovery as recovery
    from agent_mc_autonomy.controller import Controller
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    immutable, replace = recovery._write_immutable, recovery._replace_state
    def fail_immutable(path, body):
        if path.name == failure:
            raise PermissionError('fixture disk unavailable')
        return immutable(path, body)
    def fail_replace(*_):
        raise PermissionError('fixture state unavailable')
    monkeypatch.setattr(recovery, '_write_immutable', fail_immutable)
    if failure == 'host-state.json':
        monkeypatch.setattr(recovery, '_replace_state', fail_replace)
    with pytest.raises(OSError):
        recovery.acknowledge_unknown(settings, tmp_path, **options)
    with pytest.raises(RuntimeError, match='outcome_unknown'):
        run_async(Controller(Bridge(), None, settings, host, lambda **_: None, lambda: False).run('fixture'))
    monkeypatch.setattr(recovery, '_write_immutable', immutable)
    monkeypatch.setattr(recovery, '_replace_state', replace)
    if failure != 'prepared.json':
        other = {**options, 'acknowledgement_id': str(uuid.uuid4())}
        with pytest.raises(RuntimeError):
            recovery.acknowledge_unknown(settings, tmp_path, **other)
    assert recovery.acknowledge_unknown(settings, tmp_path, **options)['classification'] == 'acknowledged_unknown'


def test_pending_ack_cannot_clear_new_run(tmp_path, framework_module, monkeypatch):
    import agent_mc_autonomy.recovery as recovery
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    write = recovery._write_immutable
    def fail(path, body):
        if path.name == 'committed.json':
            raise PermissionError('fixture')
        write(path, body)
    monkeypatch.setattr(recovery, '_write_immutable', fail)
    with pytest.raises(OSError):
        recovery.acknowledge_unknown(settings, tmp_path, **options)
    monkeypatch.setattr(recovery, '_write_immutable', write)
    status = json.loads((host/'status.json').read_text())
    status['runtime_session'] = str(uuid.uuid4())
    (host/'status.json').write_text(json.dumps(status), encoding='utf-8')
    with pytest.raises(RuntimeError):
        recovery.acknowledge_unknown(settings, tmp_path, **options)


@pytest.mark.parametrize('filename', ['prepared.json', 'committed.json'])
def test_record_fsync_failure_is_not_published_and_retry_is_stable(tmp_path, framework_module, monkeypatch, filename):
    import agent_mc_autonomy.recovery as recovery
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    immutable, sync = recovery._write_immutable, recovery.os.fsync
    operation = []
    def write(path, body):
        operation.append(path.name)
        try:
            immutable(path, body)
        finally:
            operation.pop()
    def fail_sync(fd):
        if operation and operation[-1] == filename:
            raise PermissionError('fixture fsync failure')
        sync(fd)
    monkeypatch.setattr(recovery, '_write_immutable', write)
    monkeypatch.setattr(recovery.os, 'fsync', fail_sync)
    with pytest.raises(OSError):
        recovery.acknowledge_unknown(settings, tmp_path, **options)
    transaction = host/'recovery-acknowledgements'/options['acknowledgement_id']
    assert not (transaction/filename).exists()
    assert (transaction/(filename+'.staging')).exists()
    monkeypatch.setattr(recovery.os, 'fsync', sync)
    receipt = recovery.acknowledge_unknown(settings, tmp_path, **options)
    assert recovery.acknowledge_unknown(settings, tmp_path, **options) == receipt


def test_corrupt_commit_and_same_id_changed_contract_refuse(tmp_path, framework_module):
    import agent_mc_autonomy.recovery as recovery
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    recovery.acknowledge_unknown(settings, tmp_path, **options)
    with pytest.raises(RuntimeError, match='stable_id_conflict'):
        recovery.acknowledge_unknown(settings, tmp_path, **{**options, 'reason': 'different choice'})
    receipt = host/'recovery-acknowledgements'/options['acknowledgement_id']/'committed.json'
    receipt.write_text('{', encoding='utf-8')
    with pytest.raises(RuntimeError, match='outcome_unknown'):
        recovery.require_no_pending_acknowledgement(host)
    with pytest.raises(ValueError):
        recovery.acknowledge_unknown(settings, tmp_path, **options)


def test_status_race_after_preparation_keeps_fence(tmp_path, framework_module, monkeypatch):
    import agent_mc_autonomy.recovery as recovery
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    original = recovery._write_immutable
    def race(path, body):
        original(path, body)
        if path.name == 'prepared.json':
            (host/'status.json').write_text('{}', encoding='utf-8')
    monkeypatch.setattr(recovery, '_write_immutable', race)
    with pytest.raises(RuntimeError, match='status_changed'):
        recovery.acknowledge_unknown(settings, tmp_path, **options)
    assert json.loads((host/'host-state.json').read_text())['uncertain'] is True
    with pytest.raises(RuntimeError, match='outcome_unknown'):
        recovery.require_no_pending_acknowledgement(host)


def test_other_body_provider_requires_its_own_reconciliation_contract(tmp_path, framework_module):
    from agent_mc_autonomy.recovery import assess
    settings, _, _, _, _ = fixture(tmp_path, framework_module)
    with pytest.raises(RuntimeError, match='generic_local_body_required'):
        assess(dataclasses.replace(settings, body_provider='java-client'), tmp_path)


@pytest.mark.parametrize('suffix', ['-wal', '-shm'])
def test_assessment_refuses_wal_without_creating_sqlite_sidecars(tmp_path, framework_module, suffix):
    from agent_mc_autonomy.recovery import assess
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    (host/('commands.sqlite3'+suffix)).write_bytes(b'fixture foreign WAL')
    before = {str(p.relative_to(host)): p.read_bytes() for p in host.rglob('*') if p.is_file()}
    with pytest.raises(RuntimeError, match='quiescent_rollback_mailbox_required'):
        assess(settings, tmp_path, native_request_ids=options['native_request_ids'])
    assert before == {str(p.relative_to(host)): p.read_bytes() for p in host.rglob('*') if p.is_file()}


def test_missing_inflight_field_is_not_proven_empty(tmp_path, framework_module):
    from agent_mc_autonomy.recovery import acknowledge_unknown
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    path = host/'host-state.json'
    state = json.loads(path.read_text())
    del state['inflight_request']
    path.write_text(json.dumps(state), encoding='utf-8')
    options['expected_state_sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    with pytest.raises(RuntimeError, match='empty_stopped_unknown_required'):
        acknowledge_unknown(settings, tmp_path, **options)
    assert json.loads(path.read_text())['uncertain'] is True
