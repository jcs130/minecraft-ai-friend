"""Use native Scroll for the existing life pair, without another runtime."""
from copy import deepcopy
import json
from pathlib import Path
import sqlite3

from life_memory_policy import in_scope

VERSION = 1


def _context(profile, role):
    if (profile.get('id') != role
            or profile.get('workspace_dir') != '/state/work/workspaces/' + role):
        raise ValueError('life_context_identity_mismatch')
    context = profile.get('running', {}).get('light_context_config')
    if (not isinstance(context, dict) or context.get('strategy') not in ('native', 'scroll')
            or not isinstance(context.get('scroll_config'), dict)
            or not isinstance(context.get('tool_result_pruning_config'), dict)):
        raise ValueError('existing_life_context_config_required')
    scroll = context['scroll_config']
    if (scroll.get('db_filename') != 'history.db' or scroll.get('allow_unsandboxed') is not False
            or profile.get('security', {}).get('sandbox_enabled') is not False):
        raise ValueError('structured_recall_only_required')
    history_days = scroll.get('history_retention_days')
    artifact_days = context['tool_result_pruning_config'].get('offload_retention_days')
    if (type(history_days) is not int or history_days < 0
            or type(artifact_days) is not int or not 1 <= artifact_days <= 365):
        raise ValueError('existing_context_retention_required')
    return context


def apply_profile(profile, role, runtime='game'):
    result = deepcopy(profile)
    if not in_scope(role, runtime):
        return result
    context = _context(result, role)
    context['strategy'] = 'scroll'
    context['scroll_config']['history_retention_days'] = 0
    # Qwen 2.2.1's public schema requires artifact retention in 1..365 days.
    # Keep the user's existing value; only SQLite history supports zero.
    validate_profile(result, role, runtime)
    return result


def validate_profile(profile, role, runtime='game'):
    if not in_scope(role, runtime):
        return False
    context = _context(profile, role)
    if (context['strategy'] != 'scroll'
            or context['scroll_config']['history_retention_days'] != 0):
        raise ValueError('life_scroll_policy_drift')
    return True


def validate_history(workspace):
    """Inspect native metadata only; never construct HistoryStore or write DBs."""
    workspace = Path(workspace)
    database, marker = workspace / 'history.db', workspace / 'sessions/.synced.json'
    if not database.is_file() or database.is_symlink():
        raise ValueError('native_scroll_history_missing')
    if not marker.is_file() or marker.is_symlink() or marker.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('native_scroll_sync_marker_missing')
    try:
        manifest = json.loads(marker.read_text(encoding='utf8'))
        if (not isinstance(manifest, dict) or manifest.get('version') != 2
                or not isinstance(manifest.get('files'), dict)):
            raise ValueError('native_scroll_sync_marker_invalid')
        with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=5) as connection:
            connection.execute('PRAGMA query_only=ON')
            columns = {row[1] for row in connection.execute('PRAGMA table_info(conversation_history)')}
            if not {'seq', 'session_id', 'agent_id', 'kind', 'content', 'blocks', 'dedup_key'} <= columns:
                raise ValueError('native_scroll_history_schema_invalid')
            if connection.execute('PRAGMA quick_check(1)').fetchone() != ('ok',):
                raise ValueError('native_scroll_history_integrity_failed')
            rows, sessions, first, last = connection.execute(
                'SELECT COUNT(*), COUNT(DISTINCT session_id), MIN(seq), MAX(seq) FROM conversation_history').fetchone()
    except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
        raise ValueError('native_scroll_history_unreadable') from error
    return {'available': True, 'rows': rows, 'sessions': sessions, 'firstSeq': first,
            'lastSeq': last, 'syncedFiles': len(manifest['files']),
            'manifestVersion': manifest['version'], 'integrity': 'ok'}
