"""Qwen-owned stdio project collaboration tools, with identity bound at startup."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
from world_team import members, TeamStore

COMMON_TOOLS = ('team_roster', 'team_context', 'team_cases', 'team_case', 'team_report', 'team_update')


def survivor_snapshot(public=Path('/public'), clock=time.time):
    """Read fixed public controller metadata; never include model or gameplay text."""
    source = '/public/survivor.json'
    unknown = {'ok': False, 'fresh': False, 'status': 'unknown', 'source': source}
    try:
        root = Path(public)
        path = root / 'survivor.json'
        if not root.is_absolute() or any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)()
                                        for p in (path, *path.parents)):
            return unknown | {'code': 'survivor_snapshot_invalid_path'}
        size_limit = 2 * 1024 * 1024
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > size_limit:
            return unknown | {'code': 'survivor_snapshot_invalid_file'}
        with path.open('rb') as handle:
            before = os.fstat(handle.fileno())
            raw = handle.read(size_limit + 1)
            after = os.fstat(handle.fileno())
        if len(raw) > size_limit or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            return unknown | {'code': 'survivor_snapshot_changed_or_oversized'}
        value = json.loads(raw.decode('utf-8-sig'))
        if not isinstance(value, dict) or value.get('schema') != 1 or value.get('project') != 'qiandengji-survivor':
            raise ValueError('invalid_schema')
        stamp = value['generatedAt']
        if not isinstance(stamp, str) or len(stamp) > 64:
            raise ValueError('invalid_timestamp')
        at = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
        if at.tzinfo is None:
            raise ValueError('timestamp_without_timezone')
        age = clock() - at.timestamp()
        if not -5 <= age <= 120:
            return unknown | {'code': 'survivor_snapshot_stale', 'timestamp': stamp, 'ageSeconds': round(age, 1)}

        def metadata(row, codes=(), flags=()):
            if row is None:
                return {}
            if not isinstance(row, dict):
                raise ValueError('invalid_metadata')
            result = {}
            for key in codes:
                item = row.get(key)
                if item is None:
                    continue
                if not isinstance(item, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}', item):
                    raise ValueError('invalid_metadata_code')
                result[key] = item
            for key in flags:
                if key not in row:
                    continue
                if type(row[key]) is not bool:
                    raise ValueError('invalid_metadata_flag')
                result[key] = row[key]
            return result

        result = metadata(value, ('status', 'pauseReason', 'cancellationStatus', 'wakeReason', 'goalState'),
                          ('enabled', 'autonomous'))
        if 'status' not in result or 'enabled' not in result:
            raise ValueError('missing_controller_state')
        result['lastDecision'] = metadata(value.get('lastDecision'), ('taskId',),
            ('completed', 'nativeTaskCompleted', 'modelCompleted'))
        result['actionExecution'] = metadata(value.get('actionExecution'), flags=('ok', 'inFlight'))
        result['body'] = metadata(value.get('body'), flags=('ok', 'online'))
        result['bodyReconnect'] = metadata(value.get('bodyReconnect'), ('status', 'reason'))
        return result | {'ok': True, 'fresh': True, 'source': source, 'timestamp': stamp,
            'ageSeconds': round(age, 1), 'sha256': hashlib.sha256(raw).hexdigest(),
            'notice': 'Controller metadata only. lastDecision is the last recorded decision, not proof of an active task; '
                      'paused or unavailable does not mean the body is dead. No model thoughts or dialogue are included.'}
    except (OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
        return unknown | {'code': 'survivor_snapshot_unavailable'}


def register_team_tools(app, actor, state=Path('/team')):
    store = TeamStore(actor, state)

    @app.tool()
    def team_roster() -> dict:
        """Read exact project identities and responsibilities; runtime:role disambiguates mc-god."""
        return store.roster()

    @app.tool()
    def team_context() -> dict:
        """Read world/service snapshots, survivor controller state and assigned cases. Missing or stale life metadata is unknown."""
        from operations_team_mcp import OperationsTools
        snapshot = OperationsTools('mc-god').snapshot()
        snapshot.pop('worldActionsAllowed', None)
        snapshot['worldActionsExecuted'] = 0
        sections = snapshot.get('snapshots') if isinstance(snapshot.get('snapshots'), dict) else {}
        stale = sorted(name for name, section in sections.items()
                       if isinstance(section, dict) and section.get('fresh') is False)
        snapshot['staleSnapshots'] = stale
        return {'ok': True, 'actor': actor, 'world': snapshot, 'survivor': survivor_snapshot(), 'work': store.cases(),
            'notice': 'In-world dialogue must use game channels. These documents are project feedback. '
                      'A report or tested commit is not proof of a deployed game fix.'
                      + (' Sections listed in staleSnapshots are expired inspection records, '
                         'not current health or current faults; re-verify before reporting.'
                         if stale else '')}

    @app.tool()
    def team_cases(owner: str = 'mine', include_closed: bool = False, limit: int = 12) -> dict:
        """Read a short work index. Use mine, all, or a qualified teammate identity, then team_case for details."""
        return store.cases(owner, include_closed, limit)

    @app.tool()
    def team_case(case_id: str) -> dict:
        """Read one issue and attributed updates, including current version for a safe handoff."""
        return store.case(case_id)

    @app.tool()
    def team_report(request_id: str, dedupe_key: str, title: str, category: str,
                    observed: str, expected: str, evidence: list[str]) -> dict:
        """Write an attributed Markdown feedback document and durable case. Categories: bug/gameplay/content/operations/improvement.

        Include actual task/action IDs, times and reproducible observations. Reuse a stable dedupe_key for the same issue;
        request_id identifies this exact report. Missing features and suggested fixes are not completed results.
        """
        return store.report(request_id, dedupe_key, title, category, observed, expected, evidence)

    @app.tool()
    def team_update(request_id: str, case_id: str, expected_version: int, status: str,
                    note: str, evidence: list[str], assign_to: str | None = None) -> dict:
        """Update owned work with receipts. Status: open/working/blocked/needs_review; coordinators may resolve or merge duplicates.

        Only Goddess or the project coordinator assigns work or closes a reviewed case. Code changes need testing;
        deployments and gameplay outcomes need independent receipts. On case_changed read again; do not overwrite.
        """
        return store.update(request_id, case_id, expected_version, status, note, evidence, assign_to)
    return list(COMMON_TOOLS)


def main():
    from mcp.server.fastmcp import FastMCP
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', choices=members(), required=True)
    parser.add_argument('--native-runtime', choices=['game', 'operations'])
    parser.add_argument('--native-role')
    args = parser.parse_args()
    app = FastMCP('qiandengji-project-team')
    from world_team_hosts import host_tool_app
    bound = host_tool_app(app, args.actor, args.native_runtime, args.native_role)
    register_team_tools(bound, args.actor)
    if args.actor == 'game:mc-god':
        from world_admin_tools import register_admin_tools
        register_admin_tools(app, args.actor)
    if args.actor in ('game:mc-god', 'game:qd-guild-planner', 'operations:mc-priest'):
        from world_content_tools import register_content_tools
        register_content_tools(app, args.actor)
    app.run(transport='stdio')


if __name__ == '__main__':
    main()
