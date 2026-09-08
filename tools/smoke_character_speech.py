"""Character speech evidence: defaults to GETs, temporary fixtures and existing QA audio.

No LLM calls. --synthesize requests one fixed local MP3, without playback.
--exercise qiandengji explicitly submits one line from the bound game body using
an isolated lease; it never changes the survivor's production lease or budget.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
CHECKS = ('native-speech-tools', 'actor-voice-isolation', 'lease-bound-speech',
          'late-synthesis-cancelled', 'playback-queue-contract', 'local-audio-decoder')
TOOLS = {'speak', 'speech_status', 'stop_speaking'}
SVC = 'voicechat-neoforge-1.21.1-2.6.22.jar'
MAID = 'touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar'
FIXED_TEXT = '千灯纪角色语音接口验收。'
DEFAULT_AUDIO_EVIDENCE = 'runtime/maid-tts-qa-1f65e0324a9e/result.json'
JAVA_DECODER = r'''import java.io.FileInputStream;
import de.maxhenkel.lame4j.Mp3Decoder;
import de.maxhenkel.voicechat.plugins.impl.mp3.Mp3DecoderImpl;
public class DecodeSpeechAudio {
    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("One QA MP3 only");
        // Exact SVC wrapper + its exact native decoder, without initializing Minecraft,
        // a voice server, an audio channel, an encoder, or an audio device.
        try (var input = new FileInputStream(args[0]); var nativeDecoder = new Mp3Decoder(input)) {
            var constructor = Mp3DecoderImpl.class.getDeclaredConstructor(Mp3Decoder.class);
            constructor.setAccessible(true);
            var decoder = constructor.newInstance(nativeDecoder);
            short[] pcm = decoder.decode();
            var format = decoder.getAudioFormat();
            int peak = 0; double square = 0;
            for (short sample : pcm) { peak = Math.max(peak, Math.abs((int)sample)); square += (double)sample * sample; }
            double rate = format.getSampleRate(); int channels = format.getChannels();
            if (pcm.length < 480 || rate < 8000 || rate > 192000 || channels < 1 || channels > 2
                    || peak < 10 || pcm.length > rate * channels * 120) throw new AssertionError("Invalid/empty/silent decoded QA audio");
            System.out.println("{\"ok\":true,\"samples\":" + pcm.length + ",\"sampleRate\":" + rate
                + ",\"channels\":" + channels + ",\"peak\":" + peak + ",\"rms\":" + Math.sqrt(square / pcm.length)
                + ",\"playback\":false}");
        }
    }
}
'''


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def require(condition, code):
    if not condition:
        raise ValueError(code)


def json_file(path, limit=2 * 1024 * 1024):
    path = Path(path)
    require(not path.is_symlink() and path.is_file() and path.stat().st_size <= limit, 'evidence_file_invalid')
    value = json.loads(path.read_text(encoding='utf-8-sig'))
    require(isinstance(value, dict), 'evidence_object_required')
    return value


def contained(path, directory):
    path, directory = Path(path).resolve(), Path(directory).resolve()
    require(path.is_relative_to(directory), 'evidence_path_outside_project')
    return path


def http(url, payload=None, headers=None):
    require(url.startswith(('http://127.0.0.1:18089/', 'http://127.0.0.1:8100/')), 'nonlocal_endpoint_rejected')
    if payload is not None:
        require(url == 'http://127.0.0.1:8100/tts/maid', 'unexpected_mutating_endpoint')
    req = urllib.request.Request(url, data=None if payload is None else json.dumps(payload, ensure_ascii=False).encode(),
        headers={**({'Content-Type': 'application/json'} if payload is not None else {}), **(headers or {})})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=90 if payload is not None else 8) as response:
        data = response.read(4 * 1024 * 1024 + 1)
        require(len(data) <= 4 * 1024 * 1024, 'http_response_limit')
        return data, response.headers.get_content_type()


def get_json(url, headers=None):
    data, _ = http(url, headers=headers)
    require(len(data) <= 262144, 'json_response_limit')
    return json.loads(data)


def native_tools(fetch=get_json):
    rows = fetch('http://127.0.0.1:18089/api/mcp/tools/numen_survival', {'X-Agent-Id': 'qd-survivor'})
    require(isinstance(rows, list), 'native_tool_response_invalid')
    counts = {name: sum(1 for row in rows if isinstance(row, dict) and row.get('name') == name
                       and row.get('enabled') is True) for name in TOOLS}
    require(all(value == 1 for value in counts.values()), 'native_speech_tools_unavailable')
    return {'level': 'live_read_only', 'agentId': 'qd-survivor', 'enabled': sorted(counts), 'modelRequests': 0}


def load_shared(root=ROOT):
    for path in (root / 'world/sidecar', root / 'world/survival'):
        if str(path) not in sys.path:
            sys.path.insert(0, str(path))
    from character_speech import SpeechBroker, SpeechWorker, read, write
    from speech import SpeechTools
    from mcp_server import SkillTools
    return SpeechBroker, SpeechWorker, SpeechTools, SkillTools, read, write


def isolated_contracts(root=ROOT):
    Broker, Worker, Speech, Skills, read, write = load_shared(root)
    actors = ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
    observed = {}
    with tempfile.TemporaryDirectory(prefix='qd-speech-isolated-') as directory:
        base = Path(directory)
        clock = [time.time()]
        broker = Broker(base / 'voice', clock=lambda: clock[0])
        write(broker.root / 'speech-profiles.json', {'schema': 1, 'actors': {
            actors[0]: {'enabled': True, 'voiceId': 'qa_alpha', 'version': 'v1'},
            actors[1]: {'enabled': True, 'voiceId': 'qa_beta', 'version': 'v1'}}})
        calls = []
        worker = Worker(broker, lambda text, voice: (calls.append(voice) or b'ID3-isolated-metadata-only'))
        first = broker.submit(actors[0], 'one', '隔离测试甲。', 'minecraft:overworld')
        second = broker.submit(actors[1], 'two', '隔离测试乙。', 'minecraft:overworld')
        for result in (first, second):
            worker.process(read(broker.root / 'speech-requests' / (result['utteranceId'] + '.json')))
        denied = False
        try:
            broker.receipt(actors[1], first['utteranceId'])
        except ValueError as error:
            denied = str(error) == 'speech_not_owned'
        require(calls == ['qa_alpha', 'qa_beta'] and denied and first['utteranceId'] != second['utteranceId'], 'actor_voice_fixture_failed')
        observed['actor-voice-isolation'] = {'level': 'isolated_actual_python', 'distinctVoices': calls,
            'crossActorReceiptRejected': denied, 'productionQueueWritten': False, 'realTtsRequests': 0}

        # Exercise actual lease wrapper and actual broker without any real-world gateway.
        clock[0] += 11
        state = base / 'survival'
        turn = 'speech_smoke_turn_123456'
        write(state / 'control.json', {'schema': 1, 'enabled': True})
        lease = {'schema': 1, 'turnId': turn, 'status': 'open', 'expiresAt': (clock[0] + 180) * 1000,
                 'actionLimit': 1, 'actionsUsed': 0}
        write(state / 'lease.json', lease)
        class Gateway:
            def __init__(self):
                self.state, self.clock = state, lambda: clock[0]
            def _settings(self):
                return {'bodyName': 'QaSpeech', 'bodyUuid': actors[0]}
            def _check_binding(self):
                return 'QaSpeech', actors[0]
            def _invoke(self, name):
                require(name == 'get_self_status', 'fixture_unexpected_world_action')
                return {'dimension': 'minecraft:overworld'}
        gateway = Gateway()
        speech = Speech(gateway, Skills(state, clock=gateway.clock), broker)
        before = digest(state / 'lease.json')
        wrong = speech.speak('wrong', '错误租约。')
        valid = speech.speak(turn, '有效租约。')
        duplicate = speech.speak(turn, '有效租约。')
        conflict = speech.speak(turn, '冲突台词。')
        unchanged = digest(state / 'lease.json') == before
        write(state / 'control.json', {'schema': 1, 'enabled': False})
        paused = speech.speak(turn, '暂停不能说话。')
        require(wrong.get('code') == 'lease_invalid' and valid.get('ok') is True and duplicate == valid
                and conflict.get('code') == 'speech_request_conflict' and unchanged
                and paused.get('code') == 'autonomy_disabled', 'lease_fixture_failed')
        observed['lease-bound-speech'] = {'level': 'isolated_actual_python', 'invalidLeaseRejected': True,
            'idempotentSameTurn': duplicate == valid, 'conflictingTextRejected': True,
            'actionLeaseUnchanged': unchanged, 'pausedRejected': True, 'productionLeaseUsed': False}

        clock[0] += 11
        late = broker.submit(actors[0], 'late', '合成途中取消。', 'minecraft:overworld')
        late_job = read(broker.root / 'speech-requests' / (late['utteranceId'] + '.json'))
        count = [0]
        def delayed(text, voice):
            count[0] += 1
            broker.cancel(actors[0])
            return b'ID3-cancelled-before-publication'
        Worker(broker, delayed).process(late_job)
        result = broker.receipt(actors[0], late['utteranceId'])
        published = (broker.root / 'tts-queue' / (late['utteranceId'] + '.json')).exists()
        require(count[0] == 1 and result['status'] == 'cancelled' and not result['playbackCompleted'] and not published,
                'late_synthesis_fixture_failed')
        observed['late-synthesis-cancelled'] = {'level': 'isolated_actual_python', 'cancelledDuringSynthesis': True,
            'nativeJobPublished': published, 'playbackCompleted': result['playbackCompleted'], 'realTtsRequests': 0}
    return observed


def validate_build(root, record_path):
    record_path = contained(record_path, root / 'runtime')
    record = json_file(record_path)
    require(record.get('ok') is True and record.get('speech_schema') == 2 and record.get('speech_protocol') == 2,
            'speech_build_protocol_invalid')
    required_tests = {'CaptureFenceTest': 19, 'CaptureIntervalTest': 15, 'SpeechContractTest': 21,
        'SpeechQueueTest': 21, 'SpeechAudioPlayerContractTest': 8,
        'StaffBoundaryRegistrationTest_absent': 3, 'StaffBoundaryRegistrationTest_present': 4}
    results = record.get('tests', {})
    require(all(isinstance(results.get(name), dict) and results[name].get('ok') is True
            and type(results[name].get('assertions')) is int and results[name]['assertions'] >= minimum
            for name, minimum in required_tests.items()), 'speech_build_tests_incomplete')
    require(results['SpeechAudioPlayerContractTest'].get('liveAudio') is False, 'speech_build_test_scope_invalid')
    source = root / 'world/god-voice-src'
    expected = {p.relative_to(root).as_posix() for p in [*source.glob('dev/**/*.java'),
        *source.glob('tests/*.java'), *source.glob('tests-runtime/*.java'), source / 'build.py',
        source / 'source-origin.json', source / 'META-INF/neoforge.mods.toml']}
    rows = record.get('source_files', [])
    require(isinstance(rows, list) and len(rows) == len(expected)
            and {row.get('path') for row in rows if isinstance(row, dict)} == expected,
            'speech_build_source_coverage_mismatch')
    for row in rows:
        path = contained(root / row['path'], source)
        require(path.is_file() and digest(path) == row.get('sha256'), 'speech_build_source_changed')
    jar = contained(record.get('jar', ''), root / 'runtime')
    installed = root / 'server/mc/mods/god-voice-0.1.0.jar'
    require(jar.is_file() and digest(jar) == record.get('sha256') == digest(installed), 'installed_speech_jar_mismatch')
    protected = record.get('unchanged_server_bytecode', {})
    require(isinstance(protected, dict) and len(protected) >= 4 and all(v is True for v in protected.values()),
            'speech_protected_bytecode_not_verified')
    svc = root / 'server/mc/mods' / SVC
    matching = [row for row in record.get('classpath', []) if Path(row.get('path', '')).name == SVC]
    require(len(matching) == 1 and matching[0].get('sha256') == digest(svc), 'speech_svc_dependency_changed')
    return {'record': str(record_path), 'recordSha256': digest(record_path), 'jarSha256': digest(installed),
            'sourceFilesVerified': len(rows), 'assertions': sum(results[name]['assertions'] for name in required_tests),
            'installedSvcSha256': digest(svc), 'protectedClasses': len(protected)}


def playback_contract(root=ROOT, record_path=None, clock=time.time):
    heartbeat = json_file(root / 'server/mc/data/godvoice/.speech-health.json', 4096)
    stamp = heartbeat.get('updatedAt')
    require(heartbeat.get('schema') == 2 and heartbeat.get('protocol') == 2
            and type(stamp) in (int, float) and math.isfinite(stamp) and -5 <= clock() - stamp / 1000 <= 20
            and all(type(heartbeat.get(k)) is int and heartbeat[k] >= 0 for k in ('activeCount', 'queuedCount')),
            'live_speech_protocol_unavailable')
    candidates = [Path(record_path)] if record_path else sorted((root / 'runtime/god-voice-build').glob('speech-*/build-record.json'),
        key=lambda p: p.stat().st_mtime, reverse=True)
    require(bool(candidates), 'speech_build_record_missing')
    errors = []
    for candidate in candidates:
        try:
            build = validate_build(root, candidate)
            return {'level': 'live_protocol_and_hash_bound_java_contract_tests', **build,
                'heartbeatUpdatedAt': stamp, 'activeCount': heartbeat['activeCount'], 'queuedCount': heartbeat['queuedCount'],
                'physicalListeningTested': False}
        except (ValueError, OSError, KeyError, TypeError) as error:
            errors.append(type(error).__name__)
    raise ValueError('no_build_matches_installed_jar_and_current_source')


def command(args, timeout=30):
    result = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    require(result.returncode == 0, 'local_command_failed')
    require(len(result.stdout) <= 262144, 'command_response_limit')
    return result.stdout


def decode_audio(root, work, audio, run=command):
    require(audio.is_file() and 1 <= audio.stat().st_size <= 4 * 1024 * 1024, 'qa_audio_missing_or_large')
    source = work / 'DecodeSpeechAudio.java'
    source.write_text(JAVA_DECODER, encoding='utf-8')
    java = Path(os.environ.get('JDK21_BIN', r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')) / ('java.exe' if os.name == 'nt' else 'java')
    require(java.is_file(), 'jdk21_unavailable')
    output = run([str(java), '--class-path', str(root / 'server/mc/mods' / SVC), str(source), str(audio)], timeout=30)
    decoded = json.loads(output.strip().splitlines()[-1])
    require(decoded.get('ok') is True and decoded.get('playback') is False
            and type(decoded.get('samples')) is int and decoded['samples'] >= 480
            and type(decoded.get('peak')) is int and decoded['peak'] >= 10, 'native_audio_decode_failed')
    return {**decoded, 'decoderSourceSha256': digest(source), 'audioSha256': digest(audio), 'audioBytes': audio.stat().st_size}


def audio_contract(root, work, evidence_path=None, synthesize=False, fetch=get_json, request=http, decode=decode_audio):
    live = fetch('http://127.0.0.1:8100/health')
    require(isinstance(live, dict) and live.get('ok') is True and live.get('apiVersion') == 2
            and live.get('maidEndpoint') == '/tts/maid' and live.get('maidMediaType') == 'audio/mpeg', 'local_tts_v2_unavailable')
    if synthesize:
        data, media = request('http://127.0.0.1:8100/tts/maid', {
            'text': FIXED_TEXT, 'text_lang': 'zh', 'ref_audio_path': '/voices/touhou_little_maid.wav', 'media_type': 'mp3'})
        require(media == 'audio/mpeg' and 1 <= len(data) <= 4 * 1024 * 1024 and not data.startswith(b'RIFF'), 'local_tts_mp3_invalid')
        audio = work / 'live-maid.mp3'
        audio.write_bytes(data)
        evidence = {'level': 'one_live_local_tts_plus_installed_svc_decoder', 'localTtsRequests': 1,
                    'apiSourceSha256': digest(root / 'world/tts/tts_api.py')}
    else:
        path = contained(evidence_path or root / DEFAULT_AUDIO_EVIDENCE, root / 'runtime')
        previous = json_file(path)
        require(previous.get('ok') is True and previous.get('mode') == 'isolated_http_with_one_local_tts'
                and previous.get('llmRequests') == 0 and previous.get('localTtsRequests') == 1
                and previous.get('audioPlayback') is False and previous.get('isolatedServerStopped') is True,
                'prior_audio_evidence_scope_invalid')
        require(previous.get('apiSha256') == digest(root / 'world/tts/tts_api.py')
                and previous.get('installedMaidJarSha256') == digest(root / 'server/mc/mods' / MAID), 'prior_audio_source_or_jar_changed')
        audio = path.parent / 'maid.mp3'
        require(audio.is_file() and audio.stat().st_size == previous.get('maidMp3Bytes')
                and (path.parent / 'legacy.wav').is_file(), 'prior_audio_artifact_missing')
        evidence = {'level': 'prior_real_local_tts_artifact_redecoded_with_current_svc', 'localTtsRequests': 0,
            'priorReport': str(path), 'priorReportSha256': digest(path),
            'apiSourceSha256': previous['apiSha256'], 'maidJarSha256': previous['installedMaidJarSha256'],
            'note': 'Current health is live; synthesis bytes are from the verified earlier isolated adapter test.'}
    decoded = decode(root, work, audio)
    return {**evidence, 'liveApiVersion': live['apiVersion'], 'installedSvcSha256': digest(root / 'server/mc/mods' / SVC),
            'decoder': decoded, 'audioPlayback': False}


def exercise(root, work, project, wait_seconds=100):
    require(project == 'qiandengji', 'exercise_project_must_be_qiandengji')
    Broker, _, Speech, Skills, _, write = load_shared(root)
    from numen_gateway import NumenGateway
    production = root / 'server/survival-agent-state/survival'
    protected = [production / name for name in ('control.json', 'lease.json', 'budget.json', 'model-budget.json')]
    before = {str(path): digest(path) if path.is_file() else None for path in protected}
    settings = json_file(production / 'settings.json')
    require(isinstance(settings.get('bodyName'), str) and re.fullmatch(r'[A-Za-z0-9_]{1,16}', settings['bodyName']), 'exercise_body_invalid')
    require(str(uuid.UUID(settings['bodyUuid'])) == settings['bodyUuid'], 'exercise_body_uuid_invalid')
    actor = settings['bodyName']
    class ReadOnlyRcon:
        def cmd(self, value):
            require(value in ('numen_act list', f'numen_act invoke "{actor}" get_self_status {{}}'), 'exercise_world_mutation_rejected')
            return command(['docker', 'exec', 'qiandengji-mc-1', 'rcon-cli', value], timeout=12).strip()
    state = work / 'isolated-exercise-state'
    turn = 'speech_smoke_' + uuid.uuid4().hex
    write(state / 'settings.json', {'bodyName': actor, 'bodyUuid': settings['bodyUuid']})
    write(state / 'control.json', {'schema': 1, 'enabled': True})
    write(state / 'lease.json', {'schema': 1, 'turnId': turn, 'status': 'open', 'expiresAt': (time.time() + 180) * 1000,
        'actionLimit': 1, 'actionsUsed': 0})
    gateway = NumenGateway(state, rcon=ReadOnlyRcon())
    broker = Broker(root / 'server/mc/data/godvoice')
    speech = Speech(gateway, Skills(state), broker)
    receipt = speech.speak(turn, FIXED_TEXT)
    try:
        if receipt.get('ok') is True:
            deadline = time.monotonic() + wait_seconds
            while receipt.get('status') not in {'completed', 'cancelled', 'failed', 'expired'} and time.monotonic() < deadline:
                time.sleep(0.5)
                receipt = speech.status(receipt['utteranceId'])
        unchanged = all((digest(path) if path.is_file() else None) == before[str(path)] for path in protected)
        return {'ok': receipt.get('status') == 'completed' and receipt.get('playbackCompleted') is True and unchanged,
            'level': 'explicit_live_native_playback_receipt', 'receipt': receipt,
            'productionLeaseAndBudgetUnchanged': unchanged, 'temporaryLeaseUsed': True,
            'physicalListeningConfirmedByHuman': False, 'modelRequests': 0,
            'audioDispatchCount': int('utteranceId' in receipt), 'automaticRetry': False}
    finally:
        # Only our private test lease is closed; no production state or generation is changed here.
        private = json_file(state / 'lease.json')
        write(state / 'lease.json', {**private, 'status': 'closed'})


def run(root=ROOT, *, build_record=None, audio_evidence=None, synthesize=False, exercise_project=None,
        fetch=get_json, request=http, decode=decode_audio):
    root = Path(root).resolve()
    work = root / 'runtime' / ('character-speech-smoke-' + uuid.uuid4().hex[:12])
    work.mkdir(parents=True, exist_ok=False)
    report = {'schema': 1, 'project': 'qiandengji', 'startedAt': datetime.now(timezone.utc).isoformat(), 'ok': False,
        'checks': [], 'modelRequests': 0, 'localTtsRequests': 0, 'physicalListeningTested': False,
        'productionSpeechSubmitted': False, 'artifactDirectory': str(work), 'scriptSha256': digest(Path(__file__))}
    def check(name, operation):
        try:
            evidence = operation()
            report['checks'].append({'name': name, 'ok': True, **evidence})
        except Exception as error:
            # Codes/class only; never serialize provider config, credentials or private chats.
            code = str(error) if isinstance(error, ValueError) and re.fullmatch(r'[a-z0-9_]{1,100}', str(error)) else type(error).__name__
            report['checks'].append({'name': name, 'ok': False, 'error': code})
    check('native-speech-tools', lambda: native_tools(fetch))
    try:
        fixtures = isolated_contracts(root)
    except Exception as error:
        fixtures = {}
        fixture_error = type(error).__name__
    for name in ('actor-voice-isolation', 'lease-bound-speech', 'late-synthesis-cancelled'):
        if name in fixtures:
            report['checks'].append({'name': name, 'ok': True, **fixtures[name]})
        else:
            report['checks'].append({'name': name, 'ok': False, 'error': fixture_error})
    check('playback-queue-contract', lambda: playback_contract(root, build_record))
    def counted_request(*args, **kwargs):
        report['localTtsRequests'] += 1  # Count the actual POST attempt, including transport failure.
        return request(*args, **kwargs)
    check('local-audio-decoder', lambda: audio_contract(root, work, audio_evidence, synthesize, fetch, counted_request, decode))
    if exercise_project and all(row['ok'] is True for row in report['checks']):
        report['productionSpeechSubmitted'] = True  # This mode is explicitly side-effecting, including uncertain outcomes.
        report['speechWorkerTtsRequests'] = 'not_observed'  # The voice consumer may use its exact-audio cache.
        try:
            report['exercise'] = exercise(root, work, exercise_project)
        except Exception as error:
            report['exercise'] = {'ok': False, 'errorType': type(error).__name__, 'automaticRetry': False}
    elif exercise_project:
        report['exercise'] = {'ok': False, 'error': 'read_only_prerequisites_failed', 'automaticRetry': False}
    report['ok'] = (len(report['checks']) == len(CHECKS) and all(row['ok'] is True for row in report['checks'])
                    and (not exercise_project or report.get('exercise', {}).get('ok') is True))
    report['finishedAt'] = datetime.now(timezone.utc).isoformat()
    (work / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-record', type=Path)
    parser.add_argument('--audio-evidence', type=Path)
    parser.add_argument('--synthesize', action='store_true', help='Exactly one fixed local /tts/maid request, no playback')
    parser.add_argument('--exercise', choices=['qiandengji'], help='Explicitly submit one speech job from the bound body using a temporary lease')
    args = parser.parse_args()
    result = run(build_record=args.build_record, audio_evidence=args.audio_evidence,
        synthesize=args.synthesize, exercise_project=args.exercise)
    destination = ROOT / 'reports/character-speech-smoke.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(destination)
    print(json.dumps({'report': str(destination), 'ok': result['ok'], 'modelRequests': 0,
        'checks': [{'name': row['name'], 'ok': row['ok'], 'error': row.get('error')} for row in result['checks']]}, ensure_ascii=False))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
