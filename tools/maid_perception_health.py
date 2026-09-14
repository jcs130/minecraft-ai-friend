"""Read only the managed maid inbox projection; never receive messages or wake a model."""
from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPORT = 'reports/maid-perception-inbox-smoke.json'
NATIVE_REPORT = 'reports/maid-perception-native-smoke.json'
NATIVE_FIXTURE = 'world/maid-bridge-src/qa/PerceptionQa.java'
NATIVE_TOOL = 'tools/smoke_maid_bridge.py'
NATIVE_HELPER = 'tools/smoke_maid_perception_checks.py'
NATIVE_JAR = 'server/mc/mods/qiandeng-maid-bridge-0.1.0.jar'
NATIVE_BUILD = 'world/maid-bridge-src/build/build-record.json'
NATIVE_BUILD_JAR = 'world/maid-bridge-src/build/qiandeng-maid-bridge-0.1.0.jar'
NATIVE_BUILD_SOURCES = (
    'world/maid-bridge-src/src/dev/qiandeng/maid/BridgeClient.java',
    'world/maid-bridge-src/src/dev/qiandeng/maid/BridgeProtocol.java',
    'world/maid-bridge-src/src/dev/qiandeng/maid/BoundedResponse.java',
    'world/maid-bridge-src/src/dev/qiandeng/maid/MaidBridge.java',
    'tools/build_maid_bridge.py',
)
NATIVE_CHECKS = (
    'real-neoforge-start', 'isolated-exact-yui-numen-pair',
    'native-bridge-site-for-both-characters', 'initial-history-and-bubbles-empty',
    'native-normal-manager-three-inputs-same-tick', 'native-waiting-bubble-created',
    'all-three-signed-inputs-accepted-concurrently', 'three-latest-inputs-preserved',
    'queue-sends-only-current-user-input', 'receipt-does-not-create-assistant-history',
    'receipt-clears-native-waiting-bubbles', 'accepted-receipts-do-not-trigger-native-failure',
    'other-character-preserves-sync-200', 'yui-callback-subclass-preserves-sync-200',
    'long-native-history-does-not-block-new-input',
    'invalid-receipt-is-failure-not-assistant-speech', 'invalid-receipt-no-automatic-retry',
    'isolated-save-written', 'isolated-services-removed',
)
STATES = ('pending', 'claimed', 'consumed', 'failed')
REQUIRED_SOURCES = (
    'world/sidecar/maid_perception_inbox.py',
    'world/sidecar/maid_agent_api.py',
    'world/sidecar/party_life.py',
    'world/sidecar/party_bridge.py',
    'tests/test_maid_perception_inbox.py',
    'tools/maid_perception_health.py',
    'tools/smoke_maid_perception_inbox.py',
)
_TEST_MODULE = 'test_maid_perception_inbox.'
_TEST_MAP = {
    'busy-signed-input-persisted': ('SignedQueueTests.test_signed_busy_receipt_zero_models_and_authentication_before_storage',),
    'concurrent-signed-inputs-retained': ('InboxTests.test_concurrent_requests_are_retained_without_duplicates',
        'SignedQueueTests.test_http_accumulates_while_legacy_model_lane_is_busy'),
    'exact-request-idempotence': ('InboxTests.test_repeated_id_is_idempotent_but_new_same_text_is_an_event',),
    'restart-keeps-inbox': ('InboxTests.test_durable_accept_no_speech_and_only_latest_user',
        'InboxTests.test_exact_batch_ack_preserves_late_arrivals_and_restart'),
    'native-signal-only': ('PerceptionLifeTests.test_inbox_alone_never_wakes_a_model',),
    'original-session-batch': ('PerceptionLifeTests.test_batch_in_original_session_exact_completion_and_late_input',),
    'exact-task-consumption': ('InboxTests.test_exact_batch_ack_preserves_late_arrivals_and_restart',
        'PerceptionLifeTests.test_completed_ack_can_recover_after_controller_write_failure'),
    'late-input-retained': ('PerceptionLifeTests.test_batch_in_original_session_exact_completion_and_late_input',),
    'bounded-complete-batch': ('InboxTests.test_batch_bounds_preserve_complete_head_and_tail',
        'InboxTests.test_capacity_is_explicit_and_never_drops_unread'),
    'unknown-not-replayed': ('PerceptionLifeTests.test_unknown_submission_keeps_frozen_batch_and_late_input',
        'InboxTests.test_failed_or_unknown_never_requeued'),
    'failed-batch-retained': ('PerceptionLifeTests.test_failed_model_leaves_audited_failed_inputs_not_a_retry',),
    'queued-response-has-no-character-speech': ('InboxTests.test_durable_accept_no_speech_and_only_latest_user',
        'SignedQueueTests.test_http_accumulates_while_legacy_model_lane_is_busy'),
    'legacy-dialogue-preserved': ('SignedQueueTests.test_legacy_dialogue_stays_on_original_completion_path',),
}
BEHAVIOR_TESTS = {key: tuple(_TEST_MODULE + name for name in names) for key, names in _TEST_MAP.items()}
SMOKE_CHECKS = tuple(BEHAVIOR_TESTS)


def adapter_health():
    """One fixed GET in the existing NPC container; no credentials or private files."""
    script = (
        "import json,urllib.request; "
        "r=urllib.request.build_opener(urllib.request.ProxyHandler({})).open("
        "'http://127.0.0.1:8091/healthz',timeout=5); "
        "raw=r.read(16385); assert len(raw)<=16384; "
        "print(json.dumps(json.loads(raw),ensure_ascii=True))"
    )
    result = subprocess.run(
        ['docker', 'exec', 'qiandengji-npc-1', 'python', '-c', script],
        capture_output=True, text=True, encoding='utf8', errors='replace', timeout=12,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
    if result.returncode != 0 or len(result.stdout.encode('utf8')) > 16384:
        raise ValueError('maid_perception_adapter_unavailable')
    value = json.loads(result.stdout)
    if not isinstance(value, dict):
        raise ValueError('maid_perception_adapter_shape')
    return value


def check(root=ROOT, fetch=adapter_health):
    """A backlog is normal; invalid identity/protocol or missing counts are not."""
    checks = dict.fromkeys(('adapter_ready', 'protocol', 'persistent_storage',
                            'no_input_wakeup', 'current_binding', 'bounded_counts',
                            'public_projection'), False)
    counts = {key: None for key in STATES}
    total = None
    try:
        value = fetch()
        checks['adapter_ready'] = isinstance(value, dict) and value.get('ok') is True
        inbox = value.get('perceptionInbox') if isinstance(value, dict) else None
        if not isinstance(inbox, dict):
            raise ValueError('maid_perception_projection_unavailable')
        checks['protocol'] = type(inbox.get('schema')) is int and inbox['schema'] == 1
        checks['persistent_storage'] = inbox.get('persistent') is True
        checks['no_input_wakeup'] = inbox.get('wakeOnInput') is False
        checks['current_binding'] = inbox.get('currentBindingValid') is True
        observed = inbox.get('counts')
        checks['bounded_counts'] = (isinstance(observed, dict) and set(observed) == set(STATES)
            and all(type(observed[key]) is int and 0 <= observed[key] <= 4096 for key in STATES)
            and type(inbox.get('totalRetained')) is int
            and 0 <= inbox['totalRetained'] <= 4096
            and sum(observed.values()) == inbox['totalRetained'])
        if checks['bounded_counts']:
            counts = {key: observed[key] for key in STATES}
            total = inbox['totalRetained']
        # The public contract has no text, identity document, request payload,
        # model output, or arbitrary nested extension to accidentally expose it.
        checks['public_projection'] = set(inbox) <= {
            'schema', 'persistent', 'wakeOnInput', 'currentBindingValid', 'counts', 'totalRetained',
            'capacity', 'maxBatch', 'assistantReply',
        } and (type(inbox.get('capacity')) is int and inbox['capacity'] == 4096
               and type(inbox.get('maxBatch')) is int and inbox['maxBatch'] == 8
               and inbox.get('assistantReply') is False)
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as error:
        error_type = type(error).__name__
    else:
        error_type = None
    return {'ok': all(checks.values()), 'checks': checks, 'counts': counts, 'totalRetained': total,
            'errorType': error_type, 'modelCalls': 0, 'worldActions': 0,
            'scope': 'Current private-inbox admission contract and aggregate counts; '
                     'pending input is not a completed model turn or an in-game reply.'}


def _file(root, name, limit):
    root, supplied = Path(root).resolve(), Path(name)
    target = root / supplied
    if (not isinstance(name, str) or supplied.is_absolute() or '..' in supplied.parts
            or not target.resolve().is_relative_to(root)
            or any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)()
                   for p in (target, *target.parents))
            or not target.is_file() or target.stat().st_size > limit):
        raise ValueError('invalid_maid_perception_evidence_path')
    return target


def behavior(root=ROOT):
    """Validate new isolated evidence, never update or borrow an older report."""
    checks = dict.fromkeys(('isolated_report', 'zero_external_effects', 'required_behavior',
                            'recorded_test_execution', 'current_sources'), False)
    try:
        report = json.loads(_file(root, REPORT, 1048576).read_text('utf-8-sig'))
        checks['isolated_report'] = (isinstance(report, dict) and type(report.get('schema')) is int
            and report['schema'] == 1 and report.get('kind') == 'isolated_maid_perception_inbox'
            and report.get('ok') is True and report.get('sourceUnchangedDuringRun') is True)
        checks['zero_external_effects'] = all(type(report.get(key)) is int and report[key] == 0
            for key in ('modelCalls', 'worldActions', 'productionMutations'))
        rows = report.get('checks')
        checks['required_behavior'] = (isinstance(rows, dict)
            and all(rows.get(name) is True for name in SMOKE_CHECKS))
        execution = report.get('execution') or {}
        cases = execution.get('tests') or []
        tests = {row['id']: row for row in cases if isinstance(row, dict)
                 and isinstance(row.get('id'), str)} if isinstance(cases, list) else {}
        checks['recorded_test_execution'] = (
            execution.get('runner') == 'unittest' and execution.get('caseSelection') == 'declared_methods_only'
            and type(execution.get('testsRun')) is int and 1 <= execution['testsRun'] <= 512
            and len(tests) == len(cases) == execution['testsRun']
            and all(row.get('outcome') == 'passed' for row in tests.values())
            and report.get('checkTests') == {name: list(ids) for name, ids in BEHAVIOR_TESTS.items()}
            and all(test in tests and tests[test].get('outcome') == 'passed'
                    for ids in BEHAVIOR_TESTS.values() for test in ids))
        hashes = report.get('sourceHashes')
        checks['current_sources'] = (isinstance(hashes, dict) and len(REQUIRED_SOURCES) <= len(hashes) <= 64
            and set(REQUIRED_SOURCES) <= set(hashes)
            and all(isinstance(digest, str) and re.fullmatch(r'[0-9a-f]{64}', digest)
                    and hashlib.sha256(_file(root, name, 4194304).read_bytes()).hexdigest() == digest
                    for name, digest in hashes.items()))
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        pass
    return {'ok': all(checks.values()), 'checks': checks, 'report': REPORT,
            'scope': 'Separate isolated inbox/protocol evidence with current source hashes; '
                     'not proof of live conversation delivery or a game goal.'}


def _digest(root, name, limit=4194304):
    return hashlib.sha256(_file(root, name, limit).read_bytes()).hexdigest()


def _fake_source_hashes(root):
    # Read the literal fixture generator; never import/execute the native smoke
    # helper from a health request. write_text uses LF or CRLF on the test host.
    tree = ast.parse(_file(root, NATIVE_HELPER, 262144).read_text('utf8'))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name == 'fake_server_source']
    if (len(functions) != 1 or len(functions[0].body) != 1
            or not isinstance(functions[0].body[0], ast.Return)):
        raise ValueError('native_fake_source_not_literal')
    source = ast.literal_eval(functions[0].body[0].value)
    if not isinstance(source, str) or not 1 <= len(source) <= 65536:
        raise ValueError('native_fake_source_invalid')
    source = source.replace('\r\n', '\n')
    return {hashlib.sha256(text.encode('utf8')).hexdigest()
            for text in (source, source.replace('\n', '\r\n'))}


def native_behavior(root=ROOT):
    """Require actual native callbacks tested with the currently installed JAR."""
    checks = dict.fromkeys(('isolated_native_report', 'zero_external_effects',
        'all_native_boundaries', 'installed_jar_matches_tested_build',
        'build_sources_current', 'fixture_and_tools_current', 'fake_npc_source_current'), False)
    jar = None
    try:
        report = json.loads(_file(root, NATIVE_REPORT, 2097152).read_text('utf-8-sig'))
        checks['isolated_native_report'] = (isinstance(report, dict) and report.get('ok') is True
            and isinstance(report.get('project'), str)
            and re.fullmatch(r'qiandengji-maid-qa-[a-f0-9]{12}', report['project']) is not None
            and report.get('liveAcceptanceScope') == 'fresh isolated world, actual installed mods and native callbacks, deterministic fake NPC; no physical client or audio')
        checks['zero_external_effects'] = all(type(report.get(key)) is int and report[key] == 0
            for key in ('modelCalls', 'ttsCalls', 'productionMutations'))
        cases = report.get('checks')
        checks['all_native_boundaries'] = (isinstance(cases, dict) and set(cases) == set(NATIVE_CHECKS)
            and all(cases[name] is True for name in NATIVE_CHECKS))
        build = json.loads(_file(root, NATIVE_BUILD, 1048576).read_text('utf-8-sig'))
        jar = _digest(root, NATIVE_JAR, 33554432)
        checks['installed_jar_matches_tested_build'] = (build.get('ok') is True
            and jar == build.get('sha256') == report.get('jarSha256')
            == _digest(root, NATIVE_BUILD_JAR, 33554432))
        sources = build.get('sources')
        checks['build_sources_current'] = (isinstance(sources, dict)
            and set(NATIVE_BUILD_SOURCES) <= set(sources) and len(sources) <= 128
            and all(isinstance(digest, str) and re.fullmatch(r'[0-9a-f]{64}', digest)
                    and _digest(root, name) == digest for name, digest in sources.items()))
        fixture = _digest(root, NATIVE_FIXTURE)
        checks['fixture_and_tools_current'] = (report.get('fixtureSha256') == fixture
            and report.get('fixtureHashes') == {NATIVE_FIXTURE: fixture}
            and report.get('toolSha256') == _digest(root, NATIVE_TOOL)
            and report.get('perceptionChecksSha256') == _digest(root, NATIVE_HELPER))
        checks['fake_npc_source_current'] = report.get('fakeNpcSha256') in _fake_source_hashes(root)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, SyntaxError):
        pass
    return {'ok': all(checks.values()), 'checks': checks, 'report': NATIVE_REPORT,
            'jarSha256': jar, 'modelCalls': 0, 'ttsCalls': 0, 'worldActions': 0,
            'scope': 'Installed artifact and source match isolated real NeoForge/TLM callback evidence; '
                     'physical client, audio and live private-message delivery are separate.'}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit(0 if result['ok'] else 1)
