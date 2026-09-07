"""Operations-only MCP: bounded public snapshots and attributed reports.

No RCON, Docker, arbitrary files, commands, network or world write interface.
The role is bound by the process arguments, not by model-supplied parameters.
"""
from datetime import datetime, timezone
import argparse
import hashlib
import json
from pathlib import Path
import re

ROLES = ('mc-god', 'default', 'mc-herald', 'mc-priest', 'mc-guard-kirito', 'mc-guard-naruto')
TOOLS = ('operations_snapshot', 'operations_reports', 'submit_operations_report', 'operations_reference')


def role_tools(role):
    return TOOLS + (('operations_delegate', 'operations_task') if role == 'default' else ())


def read_json(path, limit=2*1024*1024):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError('snapshot_unavailable')
    value = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(value, dict):
        raise ValueError('invalid_snapshot')
    return value


class OperationsTools:
    def __init__(self, role, public=Path('/public'), state=Path('/state/work/operations')):
        if role not in ROLES:
            raise ValueError('unknown_role')
        self.role, self.public, self.state = role, Path(public), Path(state)

    def snapshot(self):
        result = {'schema': 1, 'role': self.role, 'observedAt': datetime.now(timezone.utc).isoformat(),
                  'mode': 'observation_and_proposals', 'worldActionsAllowed': False, 'snapshots': {}}
        for name in ('world', 'health', 'operations'):
            try:
                source = read_json(self.public / (name + '.json'))
                stamp = source.get('generatedAt') or source.get('checked_at') or source.get('timestamp') or source.get('ts')
                if isinstance(stamp, (int, float)):
                    at = datetime.fromtimestamp(stamp / 1000, timezone.utc)
                else:
                    at = datetime.fromisoformat(str(stamp).replace('Z', '+00:00'))
                    if at.tzinfo is None: raise ValueError('timestamp_without_timezone')
                age = (datetime.now(timezone.utc) - at).total_seconds()
                fresh = -5 <= age <= 300
                if name == 'operations':
                    body = {k: source.get(k) for k in ('checks', 'services', 'issues')}
                    body['services'] = [{k:s[k] for k in ('id','label','group','state','health','ready') if k in s}
                        for s in source.get('services', []) if s.get('group') not in ('legacy-team', 'retired')]
                    body['issues'] = [s for s in source.get('issues', []) if s.get('code') not in ('runtime_versions_differ', 'host_non_game_jobs')]
                elif name == 'health':
                    body = {k: source.get(k) for k in ('ok', 'services', 'scope', 'unverified')}
                else:
                    # Avoid resending the full archived skill catalog every model round.
                    body = {k:source[k] for k in ('available','world','npc','players','waypoints','guild','warnings') if k in source}
                    skills=source.get('skills',{})
                    body['skills']={k:skills[k] for k in ('available','featured','archivedCount','passiveCount') if k in skills}
                result['snapshots'][name] = {'fresh': fresh, 'ageSeconds': round(age, 1), 'timestamp': stamp,
                    'sha256': hashlib.sha256(json.dumps(source, sort_keys=True, ensure_ascii=False).encode()).hexdigest(), 'data': body}
            except (OSError, ValueError, TypeError, OverflowError):
                result['snapshots'][name] = {'fresh': False, 'code': 'snapshot_unavailable'}
        result['ok'] = all(v['fresh'] for v in result['snapshots'].values())
        return result

    def reports(self):
        rows = []
        for role in ROLES:
            folder = self.state / 'reports' / role
            valid=[]
            for file in sorted(folder.glob('*.json'))[:200]:
                try:
                    value = read_json(file, 32768)
                    if value.get('role') == role and value.get('schema') == 1:
                        at=datetime.fromisoformat(value['createdAt'].replace('Z','+00:00'))
                        if at.tzinfo is not None: valid.append((at.timestamp(),value))
                except (OSError, ValueError, KeyError, TypeError): pass
            rows.extend(value for _,value in sorted(valid,key=lambda pair:pair[0],reverse=True)[:4])
        return {'schema': 1, 'ok': True, 'reports': rows, 'notice': 'Agent reports are proposals, not execution receipts.'}

    def reference(self, topic):
        references = {'gameplay': 'LANGUAGE-INTERFACE.md', 'world': 'WORLD-CONTENT-STATUS.md',
                      'services': 'SERVER-MANAGEMENT.md'}
        if topic == 'my-skills':
            root = Path('/state/work/workspaces') / self.role
            manifest = read_json(root/'skill.json')
            return {'ok': True, 'skills': [{'name': name, 'content': (root/'skills'/name/'SKILL.md').read_text(encoding='utf8')[:9000]}
                for name, entry in manifest.get('skills', {}).items() if entry.get('enabled')]}
        if topic not in references: return {'ok': False, 'code': 'unknown_reference'}
        file = Path('/reference/docs')/references[topic]
        if not file.is_file(): return {'ok': False, 'code': 'reference_unavailable'}
        content = file.read_text(encoding='utf8')
        return {'ok': True, 'source': 'docs/'+file.name, 'content': content[:9000],
                'truncated': len(content)>9000, 'notice': 'Implementation documentation, not live gameplay evidence.'}

    def submit(self, request_id, summary, findings, proposed_actions):
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,80}', request_id):
            raise ValueError('invalid_request_id')
        if not isinstance(summary, str) or not 1 <= len(summary.strip()) <= 2000:
            raise ValueError('invalid_summary')
        for values in (findings, proposed_actions):
            if not isinstance(values, list) or len(values) > 12 or any(not isinstance(s, str) or len(s) > 1500 for s in values):
                raise ValueError('invalid_report_items')
        payload = {'summary': summary.strip(), 'findings': findings, 'proposedActions': proposed_actions}
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        folder = self.state / 'reports' / self.role
        folder.mkdir(parents=True, exist_ok=True)
        if folder.is_symlink(): raise ValueError('linked_report_directory')
        file = folder / (request_id + '.json')
        if file.is_symlink(): raise ValueError('linked_report')
        if file.exists():
            old = read_json(file, 32768)
            if old.get('payloadSha256') != fingerprint: raise ValueError('request_conflict')
            return {'ok': True, 'code': 'already_recorded', 'role': self.role, 'requestId': request_id}
        if len(list(folder.glob('*.json'))) >= 200:
            return {'ok': False, 'code': 'report_capacity', 'summary': '本角色报告已满，请由管理员归档后继续。'}
        row = {'schema': 1, 'role': self.role, 'requestId': request_id, 'createdAt': datetime.now(timezone.utc).isoformat(),
               'status': 'proposed', 'worldActionsExecuted': 0, 'payloadSha256': fingerprint, **payload}
        encoded = json.dumps(row, ensure_ascii=False, indent=2)
        if len(encoded.encode('utf8')) > 32768: raise ValueError('report_byte_limit')
        with file.open('x', encoding='utf8') as handle:
            handle.write(encoded)
        return {'ok': True, 'code': 'report_recorded', 'role': self.role, 'requestId': request_id, 'worldActionsExecuted': 0}


def main():
    from mcp.server.fastmcp import FastMCP
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', choices=ROLES, required=True)
    args = parser.parse_args()
    tools = OperationsTools(args.role)
    app = FastMCP('qiandengji-operations')

    @app.tool()
    def operations_snapshot() -> dict:
        """Read current project snapshots, their age and evidence hashes. Stale data is not live evidence."""
        return tools.snapshot()

    @app.tool()
    def operations_reports() -> dict:
        """Read recent attributed operations proposals from the six project roles."""
        return tools.reports()

    @app.tool()
    def submit_operations_report(request_id: str, summary: str, findings: list[str], proposed_actions: list[str]) -> dict:
        """Record an attributed, idempotent operations proposal. Does not execute any proposed action."""
        return tools.submit(request_id, summary, findings, proposed_actions)

    @app.tool()
    def operations_reference(topic: str) -> dict:
        """Read assigned skills or fixed project docs: my-skills, gameplay, world, services."""
        return tools.reference(topic)

    if args.role == 'default':
        from operations_native_tasks import delegate, task_status

        @app.tool()
        def operations_delegate(to_role: str, task: str) -> dict:
            """Delegate one bounded task to a fixed teammate via native QwenPaw tasks. 30-minute cooldown, 4 per 24 hours, no retries."""
            return delegate(args.role, to_role, task)

        @app.tool()
        def operations_task(task_id: str) -> dict:
            """Read a task created by operations_delegate. Minimum 30 seconds between polls. No model call by this tool."""
            return task_status(args.role, task_id)

    app.run(transport='stdio')


if __name__ == '__main__': main()
