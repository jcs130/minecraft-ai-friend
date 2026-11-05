"""Synthetic audit inputs. These tests never count as real Agent acceptance."""
import copy
import importlib.util
import json
import struct
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'diagnostics/party4_diagnostics.py'
spec = importlib.util.spec_from_file_location('party4_diagnostics', MODULE)
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)


def write(path, value):
    path.write_text(json.dumps(value), encoding='utf-8')
    return path


def pool(symbols):
    values = [s.encode() for s in symbols]
    return b'\xca\xfe\xba\xbe\x00\x00\x00\x41' + struct.pack('>H', len(values) + 1) + b''.join(b'\x01' + struct.pack('>H', len(v)) + v for v in values)


class DiagnosticsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = {'verifiedAt': '2026-11-05T12:00:00Z', 'runtime': {}, 'liveArtifactDigests': {}}

    def jars(self):
        files = {}
        for key, component in diag.COMPONENTS.items():
            file = self.root / (component + '-fixture.jar')
            with zipfile.ZipFile(file, 'w') as jar:
                jar.writestr('plugin.yml', f'name: {component}\nversion: fixture\n')
                for entry, symbols in diag.REQUIREMENTS[key].items():
                    jar.writestr(entry, pool(symbols))
            self.manifest['liveArtifactDigests'][str(file)] = diag.digest(file.read_bytes())
            files[key] = file
        return files

    def bundle(self):
        ids = [f'00000000-0000-4000-8000-{i:012d}' for i in range(1, 5)]
        actors, hosts, events = [], [], []
        def at(s):
            return f'2026-11-05T12:00:{s:02d}Z'
        for i, uid in enumerate(ids):
            account = 'FixturePeer' + str(i)
            metadata = {}
            actor = {'account': account, 'uuid': uid, 'host': f'host-{i}.json', 'events': f'events-{i}.jsonl'}
            for key in ('entrypoint', 'hostPackage', 'corePackage'):
                file = write(self.root / f'{i}-{key}.json', {'version': 'test-only'})
                actor[key] = file.name
                metadata[key] = diag.digest(file.read_bytes())
            host = {'schema': 'party4-host-capture/v1', 'account': account, 'uuid': uid, 'runId': 'fixture',
                    'serverId': 'isolated-fixture', 'connectionId': str(i), 'capturedAt': at(0),
                    'family': 'synthetic-test', 'version': 'test-only', 'coreVersion': 'test-only',
                    'modelRoute': 'test-only', 'wakePolicy': {'categories': ['chat-other'], 'privateToken': 'must-not-export'},
                    'process': {'pid': 1, 'startedAt': at(0)}, 'installationSha256': metadata}
            base = {'account': account, 'uuid': uid, 'runId': 'fixture', 'serverId': 'isolated-fixture', 'connectionId': str(i)}
            records = [{**base, 'id': 'party', 'at': at(1), 'kind': 'party.status', 'value': {
                'type': 'party', 'queryOnly': True, 'selfUuid': uid, 'inParty': True, 'partyId': 'fixture-party',
                'memberCount': 4, 'members': [{'uuid': other} for other in ids]}}]
            peers = [u for u in ids if u != uid]
            for n, peer in enumerate(peers):
                records.append({**base, 'id': 'receive' + str(n), 'kind': 'chat.received', 'at': at(2),
                    'event': {'type': 'minecraft.chat', 'run': 'fixture-native', 'cursor': n, 'ts': at(2),
                              'text': 'SYNTHETIC TEST INPUT',
                              'meta': {'senderUuid': peer, 'identityEvidence': 'packet-sender', 'channel': 'public'}}})
            records += [
                {**base, 'id': 'input', 'kind': 'model.input', 'at': at(3), 'turnId': 'turn1', 'receivedEventIds': ['receive0', 'receive1', 'receive2']},
                {**base, 'id': 'result', 'kind': 'model.result', 'at': at(4), 'turnId': 'turn1', 'inputId': 'input',
                 'status': 'completed', 'modelInvocation': 'real', 'providerRequestId': 'fixture-request', 'chatToolCalls': [{'id': 'call1'}]},
                {**base, 'id': 'sent', 'kind': 'chat.sent', 'at': at(5), 'turnId': 'turn1', 'toolCallId': 'call1',
                 'chatDelivery': {'protocol': 'agent-mc/chat-delivery/v1', 'status': 'sent', 'boundary': 'client-transport',
                                  'id': 'fixture-delivery', 'text': 'SYNTHETIC TEST OUTPUT', 'channel': 'public', 'sentAt': at(5)}},
                {**base, 'id': 'terminal', 'kind': 'task.receipt', 'at': at(6), 'taskId': 'task1', 'status': 'completed', 'receipt': {'synthetic': True}},
                {**base, 'id': 'activity', 'kind': 'activity.completed', 'at': at(7), 'taskId': 'task1', 'status': 'completed', 'nativeReceiptRef': 'terminal', 'activity': 'gather'},
            ]
            actors.append(actor)
            hosts.append(host)
            events.append(records)
        bundle = {'schema': 'party4-evidence-spec/v1', 'runId': 'fixture', 'serverId': 'isolated-fixture',
                  'environment': 'fixture', 'window': {'start': at(0), 'end': at(59)}, 'actors': actors}
        return bundle, hosts, events

    def run_audit(self, bundle, hosts, events):
        for actor, host, records in zip(bundle['actors'], hosts, events):
            write(self.root / actor['host'], host)
            (self.root / actor['events']).write_text('\n'.join(json.dumps(e) for e in records) + '\n', encoding='utf-8')
        file = write(self.root / 'spec.json', bundle)
        before = {p: p.read_bytes() for p in self.root.iterdir()}
        result = diag.audit(file)
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.iterdir()})
        return result

    def test_missing_artifacts_are_unknown_not_absent_function(self):
        report = diag.inspect_artifacts(self.manifest, {})
        self.assertIsNone(report['components']['bridge']['symbolsPresent'])
        self.assertEqual(report['status'], 'needs_artifact_review')

    def test_artifact_symbols_never_claim_jvm_or_live_acceptance(self):
        files = self.jars()
        report = diag.inspect_artifacts(self.manifest, files)
        self.assertEqual(report['status'], 'recorded_artifact_symbols_present')
        self.assertFalse(report['binaryCompatibilityVerified'])
        self.assertFalse(report['runtimeVerified'])

    def test_stale_version_cannot_pass_using_historical_hash(self):
        files = self.jars()
        current = copy.deepcopy(self.manifest)
        current['history'] = copy.deepcopy(current)
        current['liveArtifactDigests'] = {k: 'a' * 64 for k in current['liveArtifactDigests']}
        report = diag.inspect_artifacts(current, files)
        self.assertFalse(report['components']['bridge']['matchesRecordedDigest'])
        self.assertEqual(report['status'], 'needs_artifact_review')

    def test_class_pool_corruption_rejected(self):
        for value in (b'bad', b'\xca\xfe\xba\xbe', pool(['hello'])[:-2]):
            with self.subTest(value=value), self.assertRaises((ValueError, struct.error, IndexError)):
                diag.class_symbols(value)

    def test_fixture_cannot_pass_as_real_host_even_with_all_relations(self):
        report = self.run_audit(*self.bundle())
        self.assertEqual(report['directedReceiveRelations'], 12)
        self.assertEqual(report['directedModelRelations'], 12)
        self.assertTrue(report['recordedMembershipConsistent'])
        self.assertEqual(report['status'], 'incomplete')
        self.assertFalse(report['runtimeVerified'])
        self.assertNotIn('must-not-export', json.dumps(report))

    def test_consistent_exports_still_require_authenticity_and_quality_review(self):
        bundle, hosts, events = self.bundle()
        # Exercising the parser only: these remain synthetic test data, never a real report.
        bundle['environment'] = 'isolated-real-hosts'
        report = self.run_audit(bundle, hosts, events)
        self.assertEqual(report['status'], 'evidence_complete_pending_human_review')
        self.assertFalse(report['evidenceAuthenticityVerified'])
        self.assertFalse(report['naturalConversationQualityVerified'])
        self.assertEqual(report['crossClientAcknowledgement'], 'not_inferred')

    def test_transport_or_narration_alone_cannot_prove_receive_or_response(self):
        bundle, hosts, events = self.bundle()
        events[0] = [e for e in events[0] if e['kind'] not in ('chat.received', 'model.result')]
        report = self.run_audit(bundle, hosts, events)
        self.assertEqual(report['actors'][0]['receivedFrom'], [])
        self.assertEqual(report['actors'][0]['replyTurns'], [])

    def test_unknown_or_fake_model_result_does_not_count(self):
        for change in ({'status': 'unknown'}, {'modelInvocation': 'fixture'}, {'providerRequestId': ''}, {'inputId': 'missing'}):
            with self.subTest(change=change):
                bundle, hosts, events = self.bundle()
                next(e for e in events[0] if e['kind'] == 'model.result').update(change)
                row = self.run_audit(bundle, hosts, events)['actors'][0]
                self.assertEqual(row['modelObservedFrom'], [])
                self.assertEqual(row['replyTurns'], [])

    def test_local_model_can_use_original_host_trace_id_without_provider_request_id(self):
        bundle, hosts, events = self.bundle()
        result = next(e for e in events[0] if e['kind'] == 'model.result')
        result.update(providerRequestId=None, modelTraceId='original-local-model-trace')
        row = self.run_audit(bundle, hosts, events)['actors'][0]
        self.assertEqual(len(row['modelObservedFrom']), 3)
        self.assertEqual(row['replyTurns'], ['turn1'])

    def test_commands_empty_receipts_and_unrelated_private_speech_are_not_replies(self):
        for changes in ({'text': '/mycli guild party accept'}, {'channel': 'command'},
                        {'text': ''}, {'channel': 'private', 'to': 'unrelated'},
                        {'sentAt': '2026-11-05T11:00:00Z'}):
            with self.subTest(changes=changes):
                bundle, hosts, events = self.bundle()
                sent = next(e for e in events[0] if e['kind'] == 'chat.sent')
                sent['chatDelivery'].update(changes)
                self.assertEqual(self.run_audit(bundle, hosts, events)['actors'][0]['replyTurns'], [])

    def test_wrong_uuid_unverified_identity_stale_and_foreign_connection_rejected(self):
        for change in ('uuid', 'identity', 'stale', 'connection'):
            with self.subTest(change=change):
                bundle, hosts, events = self.bundle()
                event = next(e for e in events[0] if e['kind'] == 'chat.received')
                if change == 'uuid':
                    event['event']['meta']['senderUuid'] = 'other'
                elif change == 'identity':
                    event['event']['meta']['identityEvidence'] = 'display-name'
                elif change == 'stale':
                    event['event']['meta']['staleEpoch'] = True
                else:
                    event['connectionId'] = 'foreign'
                self.assertEqual(len(self.run_audit(bundle, hosts, events)['actors'][0]['receivedFrom']), 2)

    def test_matching_count_but_wrong_member_sets_and_fifth_player_rejected(self):
        for extra in (False, True):
            bundle, hosts, events = self.bundle()
            value = events[0][0]['value']
            if extra:
                value['members'].append({'uuid': 'fifth'})
            else:
                value['members'][0]['uuid'] = 'wrong'
            self.assertFalse(self.run_audit(bundle, hosts, events)['recordedMembershipConsistent'])

    def test_broken_reply_link_and_unbacked_survival_claim_rejected(self):
        bundle, hosts, events = self.bundle()
        next(e for e in events[0] if e['kind'] == 'chat.sent')['toolCallId'] = 'unrelated'
        next(e for e in events[0] if e['kind'] == 'activity.completed')['nativeReceiptRef'] = 'missing'
        row = self.run_audit(bundle, hosts, events)['actors'][0]
        self.assertEqual(row['replyTurns'], [])
        self.assertEqual(row['survivalTasks'], [])

    def test_host_version_or_hash_mismatch_does_not_get_inferred(self):
        bundle, hosts, events = self.bundle()
        hosts[0]['coreVersion'] = 'different'
        report = self.run_audit(bundle, hosts, events)
        self.assertFalse(report['actors'][0]['hostCaptureConsistent'])
        self.assertEqual(report['actors'][0]['receivedFrom'], [])

    def test_duplicate_event_id_is_reported(self):
        bundle, hosts, events = self.bundle()
        events[0].append(events[0][1])
        report = self.run_audit(bundle, hosts, events)
        self.assertTrue(any(e['reason'] == 'missing_or_duplicate_event_id' for e in report['errors']))

    def test_later_party_conflict_supersedes_previous_success(self):
        bundle, hosts, events = self.bundle()
        later = copy.deepcopy(events[0][0])
        later.update(id='new-party', at='2026-11-05T12:00:08Z')
        later['value']['inParty'] = False
        events[0].append(later)
        self.assertFalse(self.run_audit(bundle, hosts, events)['recordedMembershipConsistent'])

    def test_duplicate_native_cursor_does_not_manufacture_another_peer(self):
        bundle, hosts, events = self.bundle()
        received = [e for e in events[0] if e['kind'] == 'chat.received']
        received[1]['event']['cursor'] = received[0]['event']['cursor']
        report = self.run_audit(bundle, hosts, events)
        self.assertEqual(len(report['actors'][0]['receivedFrom']), 2)
        self.assertTrue(any(e['reason'] == 'duplicate_native_receive_cursor' for e in report['errors']))

    def test_missing_original_uuid_remains_gap(self):
        bundle, hosts, events = self.bundle()
        bundle['actors'][0]['uuid'] = None
        report = self.run_audit(bundle, hosts, events)
        self.assertIn('actual_uuid_not_supplied', report['actors'][0]['gaps'])
        self.assertFalse(report['recordedMembershipConsistent'])

    def test_fixture_builder_rejects_old_jars_before_creating_output(self):
        builder_spec = importlib.util.spec_from_file_location('build_party4_fixture', MODULE.with_name('build_party4_fixture.py'))
        builder = importlib.util.module_from_spec(builder_spec)
        with patch.dict(sys.modules, {'party4_diagnostics': diag}):
            builder_spec.loader.exec_module(builder)
        files = self.jars()
        self.manifest['liveArtifactDigests'] = {k: 'a' * 64 for k in self.manifest['liveArtifactDigests']}
        manifest = write(self.root / 'current.json', self.manifest)
        output = self.root / 'output'
        with patch.object(builder.subprocess, 'run', side_effect=AssertionError('must not compile')):
            with self.assertRaisesRegex(ValueError, 'current_artifact_mismatch'):
                builder.build(manifest, self.root / 'server', **files, jdk=self.root / 'jdk', output=output)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
