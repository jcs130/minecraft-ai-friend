"""Read-only RCON protocol and command-isolation evidence for the deployed JAR."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRAME_CHECKS = (
    'fragmented_header_and_auth_body', 'failed_reauthentication_revokes_command_access',
    'three_frames_one_tcp_write_ordered_auth_and_commands', 'large_unicode_storage_command_executed',
    'negative_length_connection_closed', 'short_length_connection_closed', 'oversized_length_connection_closed',
    'overflow_length_connection_closed', 'truncated_header_connection_closed', 'truncated_body_connection_closed',
    'invalid_terminator_connection_closed', 'incomplete_frame_deadline',
)
TRANSACTION_CHECKS = (
    'old_native_race_reproduced', 'old_commands_not_replayed', 'new_all_native_replies_exact',
    'new_commands_execute_once', 'native_error_releases_transaction', 'failed_command_not_replayed',
    'native_auth_preserved', 'production_jar_unchanged', 'isolated_services_removed',
)
SOURCES = ('dev/god/botgate/RconCommandTransaction.java', 'dev/god/botgate/mixin/RconFrameReadMixin.java')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check(root=ROOT):
    root = Path(root)
    checks, errors = {}, {}
    def verify(name, action):
        try:
            checks[name] = action() is True
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            checks[name] = False
            errors[name] = type(error).__name__
    def read(name):
        return json.loads((root / name).read_text('utf-8-sig'))
    frames = transaction = build = {}
    try:
        frames = read('reports/rcon-live-smoke.json')
        transaction = read('reports/rcon-transaction-smoke.json')
        build = read('world/botgate-src/build-record.json')
    except (OSError, ValueError):
        # Each check remains explicit below; absent new evidence cannot inherit
        # an old passing framing-only report.
        pass
    verify('framing_behavior_verified', lambda: frames.get('ok') is True
        and frames.get('project') == 'qiandengji'
        and set(FRAME_CHECKS) <= {row.get('name') for row in frames.get('checks', []) if row.get('ok') is True}
        and frames.get('cleanup', {}).get('uniqueStorageKeyRemoved') is True)
    verify('transaction_behavior_verified', lambda: transaction.get('ok') is True
        and all(transaction.get('checks', {}).get(name) is True for name in TRANSACTION_CHECKS)
        and transaction.get('productionActions') == 0 and transaction.get('modelCalls') == 0
        and transaction.get('details', {}).get('old', {}).get('exact', 96) < 96
        and transaction.get('details', {}).get('new', {}).get('exact') == 96
        and transaction.get('details', {}).get('new', {}).get('total') == 96)
    verify('deployed_jar_matches_both_behaviors', lambda: digest(root / 'server/mc/mods/botgate.jar')
        == frames.get('jarSha256') == transaction.get('candidateSha256') == build.get('sha256'))
    verify('transaction_implementation_sources_current', lambda: all(
        digest(root / 'world/botgate-src' / name) == build['sources'][name] for name in SOURCES))
    verify('transaction_fixture_sources_current', lambda:
        digest(root / 'world/botgate-src/tests/RconReplyQa.java') == transaction.get('fixtureSha256')
        and digest(root / 'world/botgate-src/tests/RconConcurrentClient.java') == transaction.get('driverSha256')
        and digest(root / 'tools/smoke_rcon_transaction.py') == transaction.get('toolSha256'))
    return {'ok': all(checks.values()), 'checks': checks, 'errors': errors,
            'reports': ['rcon-live-smoke.json', 'rcon-transaction-smoke.json'],
            'scope': 'Native framing/authentication and complete command-response isolation for the deployed botgate; read-only evidence check.'}


if __name__ == '__main__':
    print(json.dumps(check(), ensure_ascii=False, indent=2))
