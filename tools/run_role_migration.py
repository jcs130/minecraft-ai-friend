"""Phased live migration of one predefined operations role onto the game instance.

Run from the host with run-python.bat. Each phase is explicit, receipted under
runtime/single-qwenpaw-consolidation-<date>/<role>/, and fail-closed: an unclear
outcome stops the chain and is never retried blindly. Model calls: zero.

Phase order (mirrors the engineer migration precedent):
  precheck -> retire -> inventory -> backup -> stage -> import
  -> verify-restore -> activate -> verify-live
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'world/ops'), str(ROOT / 'world/sidecar')]
import migrate_role_to_game as migration  # noqa: E402

GAME = 'http://127.0.0.1:18089/api'
OPS = 'http://127.0.0.1:18090/api'
OPS_STATE = ROOT / 'server/operations-agent-state/work'
GAME_STATE = ROOT / 'server/agents/work'
HOSTS_FILE = ROOT / 'server/team-state/runtime-hosts.json'


def now_stamp():
    return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')


class Runner:
    def __init__(self, role, evidence=None):
        self.entry = migration.entry_for(role)
        self.role = role
        self.target = self.entry['target']['agentId']
        day = datetime.now(timezone.utc).strftime('%Y%m%d')
        self.dir = Path(evidence or (ROOT / 'runtime' / ('single-qwenpaw-consolidation-' + day) / role))
        self.dir.mkdir(parents=True, exist_ok=True)

    def receipt(self, name, value):
        path = self.dir / (name + '.json')
        path.write_bytes(migration.encoded(value))
        print(json.dumps({'phase': name, 'ok': value.get('ok', True), 'receipt': str(path)}, ensure_ascii=False))
        return value

    def api(self, base, method, path, body=None, agent=None, raw=False, timeout=60):
        headers = {'Content-Type': 'application/json'}
        if agent:
            headers['X-Agent-Id'] = agent
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
        req = urllib.request.Request(base + path, method=method, headers=headers, data=data)
        with urllib.request.urlopen(req, timeout=timeout) as response:
            payload = response.read(64 * 1024 * 1024)
        return payload if raw else (json.loads(payload) if payload else None)

    def require(self, condition, code):
        if not condition:
            raise ValueError(code)

    # ---- phases ----

    def precheck(self):
        status = self.api(OPS, 'GET', '/agents/%s/agent-status' % self.role, agent=self.role)
        self.require(status.get('running_task_count', -1) == 0, 'source_role_busy')
        profile = self.api(OPS, 'GET', '/agents/' + self.role, agent=self.role)
        self.require(profile['id'] == self.role, 'source_identity_mismatch')
        self.require(set(profile.get('mcp', {}).get('clients', {})) == migration.BASE_DRIVERS,
                     'unexpected_source_driver_inventory')
        (self.dir / 'source-agent-before.json').write_bytes(migration.encoded(profile))
        jobs = self.api(OPS, 'GET', '/cron/jobs', agent=self.role)
        rows = jobs if isinstance(jobs, list) else jobs['jobs']
        rows = [row.get('spec', row) for row in rows]
        self.require({row['id'] for row in rows} == migration.expected_source_jobs(self.role), 'unexpected_source_jobs')
        (self.dir / 'source-jobs-before.json').write_bytes(migration.encoded({'version': 2, 'jobs': rows}))
        agents = self.api(GAME, 'GET', '/agents')['agents']
        self.require(all(a['id'] != self.target for a in agents), 'target_already_exists')
        model = profile.get('active_model') or {}
        provider, name = model.get('provider_id'), model.get('model') or model.get('model_name')
        catalog = None
        for folder in ('builtin', 'custom'):
            path = GAME_STATE.parent / ('secret/providers/%s/%s.json' % (folder, provider))
            if path.exists():
                catalog = json.loads(path.read_text(encoding='utf-8'))
                break
        self.require(catalog is not None, 'target_provider_missing')
        models = {(m.get('model') or m.get('id')) if isinstance(m, dict) else str(m)
                  for m in (catalog.get('models') or [])}
        self.require(not models or name in models, 'target_model_missing')
        self.require((OPS_STATE / 'workspaces' / self.role / 'agent.json').exists(), 'source_workspace_missing')
        return self.receipt('precheck', {'ok': True, 'role': self.role, 'target': self.target,
            'runningTaskCount': 0, 'provider': provider, 'model': name, 'jobs': sorted(
                migration.expected_source_jobs(self.role)), 'at': now_stamp()})

    def retire(self):
        agents = self.api(OPS, 'GET', '/agents')['agents']
        disabled = any(a['id'] == self.role and a['enabled'] is False for a in agents)
        jobs_path = OPS_STATE / 'workspaces' / self.role / 'jobs.json'
        disk = json.loads(jobs_path.read_text(encoding='utf-8-sig'))
        note = None
        if not disabled:
            if not all(row['enabled'] is False for row in disk['jobs']):
                before = json.loads((self.dir / 'source-jobs-before.json').read_bytes())['jobs']
                for job in before:
                    self.api(OPS, 'PUT', '/cron/jobs/' + job['id'], dict(job, enabled=False), agent=self.role)
            if self.role == 'default':
                # Native toggle refuses to disable the instance's active default
                # agent; halted schedules plus the phase flip retire the host.
                note = 'active_default_agent_cannot_toggle'
            else:
                self.api(OPS, 'PATCH', '/agents/%s/toggle' % self.role, {'enabled': False})
        else:
            note = 'already_retired_before_phase'
        # A disabled agent cannot answer native cron routes; the on-disk
        # schedule is the authoritative retirement evidence.
        disk = json.loads(jobs_path.read_text(encoding='utf-8-sig'))
        self.require(all(row['enabled'] is False for row in disk['jobs']), 'jobs_not_paused')
        if self.role != 'default':
            agents = self.api(OPS, 'GET', '/agents')['agents']
            self.require(any(a['id'] == self.role and a['enabled'] is False for a in agents), 'toggle_unverified')
        return self.receipt('retire', {'ok': True, 'pausedJobs': [row['id'] for row in disk['jobs']],
                                       'toggledDisabled': self.role != 'default', 'note': note, 'at': now_stamp()})

    def inventory(self):
        result = migration.workspace_inventory(OPS_STATE / 'workspaces' / self.role, self.role)
        (self.dir / 'source-inventory.json').write_bytes(migration.encoded(result))
        return self.receipt('inventory', {'ok': True, 'files': len(result['files']),
                                          'logicalActor': result['logicalActor'], 'at': now_stamp()})

    def backup(self):
        job = self.api(OPS, 'POST', '/backups/jobs', {
            'name': '%s native host migration %s' % (self.role, now_stamp()),
            'description': 'Only existing %s; before move to game %s' % (self.role, self.target),
            'scope': {'include_agents': True, 'include_global_config': False,
                      'include_secrets': False, 'include_skill_pool': False},
            'agents': [self.role]})
        job_id = job['job_id']
        deadline = time.time() + 600
        while True:
            state = self.api(OPS, 'GET', '/backups/jobs/' + job_id)
            if state['status'] == 'completed':
                break
            self.require(state['status'] not in ('failed', 'cancelled'), 'backup_job_' + state['status'])
            self.require(time.time() < deadline, 'backup_job_timeout')
            time.sleep(4)
        backup_id = state.get('backup_id') or (state.get('result') or {}).get('id')
        self.require(isinstance(backup_id, str) and backup_id, 'backup_id_missing')
        payload = self.api(OPS, 'GET', '/backups/%s/export' % backup_id, raw=True, timeout=300)
        archive = self.dir / 'source-native.zip'
        with archive.open('xb') as stream:
            stream.write(payload)
        digest = hashlib.sha256(payload).hexdigest()
        (self.dir / 'backup-completed.json').write_bytes(migration.encoded(state))
        return self.receipt('backup', {'ok': True, 'jobId': job_id, 'backupId': backup_id,
                                       'sha256': digest, 'bytes': len(payload), 'at': now_stamp()})

    def stage(self):
        source = self.dir / 'source-native.zip'
        digest = migration.sha_file(source)
        prior = json.loads((self.dir / 'source-jobs-before.json').read_bytes())
        inventory = json.loads((self.dir / 'source-inventory.json').read_bytes())
        report = migration.stage(source, self.dir / 'staged', digest, self.entry,
                                 source_inventory=inventory, prior_jobs=prior)
        return self.receipt('stage', {'ok': True, 'archiveSha256': report['archiveSha256'],
            'targetBackupId': report['targetBackupId'], 'changed': report['changedWorkspaceFiles'],
            'preservedCount': len(report['preservedFiles']), 'at': now_stamp()})

    def do_import(self):
        report = json.loads((self.dir / 'staged' / 'migration.json').read_bytes())
        archive = self.dir / 'staged' / ('qd-%s-quarantined.zip' % self.target)
        boundary = uuid.uuid4().hex
        body = b''.join([
            ('--%s\r\nContent-Disposition: form-data; name="file"; filename="%s"\r\n'
             'Content-Type: application/zip\r\n\r\n' % (boundary, archive.name)).encode(),
            archive.read_bytes(),
            ('\r\n--%s\r\nContent-Disposition: form-data; name="trust_mode"\r\n\r\nlegacy' % boundary).encode(),
            ('\r\n--%s--\r\n' % boundary).encode()])
        req = urllib.request.Request(GAME + '/backups/import', method='POST', data=body, headers={
            'Content-Type': 'multipart/form-data; boundary=' + boundary, 'X-Agent-Id': 'mc-god'})
        with urllib.request.urlopen(req, timeout=300) as response:
            meta = json.loads(response.read(4 * 1024 * 1024))
        self.require(meta.get('id') == report['targetBackupId'], 'imported_id_mismatch')
        (self.dir / 'native-import.json').write_bytes(migration.encoded(meta))
        restored = self.api(GAME, 'POST', '/backups/%s/restore' % meta['id'], report['nativeRestore'], agent='mc-god',
                            timeout=600)
        (self.dir / 'native-restore.json').write_bytes(migration.encoded(restored if isinstance(restored, dict)
                                                                        else {'raw': str(restored)}))
        return self.receipt('import', {'ok': True, 'backupId': meta['id'], 'restore': restored, 'at': now_stamp()})

    def verify_restore(self):
        report = json.loads((self.dir / 'staged' / 'migration.json').read_bytes())
        folder = GAME_STATE / 'workspaces' / self.target
        self.require(folder.is_dir(), 'restored_workspace_missing')
        agent = json.loads((folder / 'agent.json').read_text(encoding='utf-8-sig'))
        self.require(agent['id'] == self.target and agent['workspace_dir'] == str('/state/work/workspaces/' + self.target),
                     'restored_identity_mismatch')
        self.require(all(c['enabled'] is False for c in agent['mcp']['clients'].values()), 'restored_drivers_not_quarantined')
        jobs = json.loads((folder / 'jobs.json').read_text(encoding='utf-8-sig'))
        self.require(all(row['enabled'] is False for row in jobs['jobs']), 'restored_jobs_not_quarantined')
        self.require({row['id'] for row in jobs['jobs']} == migration.expected_source_jobs(self.role), 'restored_jobs_mismatch')
        verified = 0
        for relative, digest in report['preservedFiles'].items():
            path = folder / relative
            self.require(path.is_file() and not path.is_symlink(), 'preserved_file_missing:' + relative[:80])
            self.require(migration.sha_file(path) == digest, 'preserved_bytes_differ:' + relative[:80])
            verified += 1
        for key in report['readyCards']:
            self.require((folder / ('drivers/mcp/%s.yaml' % key)).is_file(), 'restored_card_missing:' + key)
        return self.receipt('verify-restore', {'ok': True, 'preservedVerified': verified,
                                               'driversQuarantined': True, 'jobsQuarantined': True, 'at': now_stamp()})

    def activate(self):
        from mcp_configuration import wait_active, _verify_policy
        from world_team_profiles import policy_payload
        report = json.loads((self.dir / 'staged' / 'migration.json').read_bytes())
        ready = json.loads((self.dir / 'staged' / 'ready-agent.json').read_bytes())
        ready_jobs = json.loads((self.dir / 'staged' / 'ready-jobs.json').read_bytes())['jobs']
        current = {row['id'] for row in self.api(GAME, 'GET', '/agents')['agents']}
        self.require(self.target in current, 'target_not_restored')
        # 1) Flip the exact host mapping; from now on the retired source has no
        #    authority and the target is the only executable host.
        raw = json.loads(HOSTS_FILE.read_text(encoding='utf-8-sig')) if HOSTS_FILE.exists() else None
        phases = {}
        if raw and raw.get('schema') == 1:
            phases[raw['migration']] = raw['phase']
        elif raw and raw.get('schema') == 2:
            phases = dict(raw['phases'])
        elif raw:
            raise ValueError('unknown_host_manifest_schema')
        phases[self.entry['migration']] = 'active'
        temporary = HOSTS_FILE.with_suffix('.tmp-' + uuid.uuid4().hex[:8])
        temporary.write_bytes(migration.encoded({'schema': 2, 'phases': phases}))
        os.replace(temporary, HOSTS_FILE)
        (self.dir / 'host-phase-active.json').write_bytes(migration.encoded({'ok': True, 'phases': phases}))
        # 2) Apply the ready native profile while schedules stay paused.
        self.api(GAME, 'PUT', '/agents/' + self.target, ready, agent=self.target)

        def call(method, route, selected, body=None):
            return self.api(GAME, method, route, body, agent=selected)

        # Restored drivers exist but are quarantined-disabled; the reactivation
        # path is an explicit save of the ready client, then wait for native
        # active tools, then pin the exact policy (never the exists-branch of
        # configure_client, which waits on an already-connecting client).
        for key, client in sorted(ready['mcp']['clients'].items()):
            self.api(GAME, 'PUT', '/mcp/' + key, client, agent=self.target, timeout=60)
            wait_active(call, self.target, key, client['tools'], timeout=120)
            if key == 'qd_learning':
                # The learning card contract uses unconditional wildcard rules;
                # native expresses those as console tool defaults, never as
                # channel-principal overrides (source_type is Literal[channel]).
                policy = {'default_effect': 'deny', 'client_overrides': [],
                          'tool_defaults': [{'tool_name': name, 'effect': 'allow'} for name in client['tools']],
                          'tool_overrides': []}
            else:
                policy = policy_payload(client['tools'])
            _verify_policy(self.api(GAME, 'PUT', '/mcp/policy/' + key, policy, agent=self.target), policy)
            _verify_policy(self.api(GAME, 'GET', '/mcp/policy/' + key, agent=self.target), policy)
        for job in ready_jobs:
            self.api(GAME, 'PUT', '/cron/jobs/' + job['id'], job, agent=self.target)
        # 3) Enable the role; drivers run under the active host mapping.
        self.api(GAME, 'PATCH', '/agents/%s/toggle' % self.target, {'enabled': True})
        tools = {}
        for key in sorted(ready['mcp']['clients']):
            rows = self.api(GAME, 'GET', '/mcp/tools/' + key, agent=self.target, timeout=90)
            tools[key] = len([row for row in rows if row.get('enabled') is True])
        self.require(all(count > 0 for count in tools.values()), 'driver_tools_not_active')
        return self.receipt('activate', {'ok': True, 'phase': 'active', 'drivers': tools,
                                         'jobsPaused': [job['id'] for job in ready_jobs if not job['enabled']],
                                         'modelCalls': 0, 'at': now_stamp()})

    def verify_live(self):
        ready = json.loads((self.dir / 'staged' / 'ready-agent.json').read_bytes())
        profile = self.api(GAME, 'GET', '/agents/' + self.target, agent=self.target)
        for key in ('id', 'name', 'language'):
            self.require(profile.get(key) == ready.get(key), 'live_profile_drift:' + key)
        self.require(profile['active_model'] == ready['active_model'], 'live_model_drift')
        self.require(set(profile['mcp']['clients']) == migration.BASE_DRIVERS, 'live_driver_inventory_drift')
        status = self.api(GAME, 'GET', '/agents/%s/agent-status' % self.target, agent=self.target)
        jobs = self.api(GAME, 'GET', '/cron/jobs', agent=self.target)
        rows = [row.get('spec', row) for row in (jobs if isinstance(jobs, list) else jobs['jobs'])]
        self.require({row['id'] for row in rows} == migration.expected_source_jobs(self.role), 'live_jobs_mismatch')
        ops_agents = self.api(OPS, 'GET', '/agents')['agents']
        if self.role != 'default':
            self.require(any(a['id'] == self.role and a['enabled'] is False for a in ops_agents), 'source_not_retired')
        from world_team_hosts import native_host, logical_actor, registry_config
        os.environ['TEAM_RUNTIME_HOSTS_FILE'] = str(HOSTS_FILE)
        self.require(native_host('operations:' + self.role) == self.entry['target'], 'mapping_not_active')
        self.require(logical_actor('game', self.target) == 'operations:' + self.role, 'reverse_mapping_broken')
        return self.receipt('verify-live', {'ok': True, 'target': self.target, 'runningTaskCount':
            status.get('running_task_count'), 'jobs': {row['id']: row['enabled'] for row in rows},
            'registryPhases': registry_config(), 'at': now_stamp()})


PHASES = {'precheck': 'precheck', 'retire': 'retire', 'inventory': 'inventory', 'backup': 'backup',
          'stage': 'stage', 'import': 'do_import', 'verify-restore': 'verify_restore',
          'activate': 'activate', 'verify-live': 'verify_live'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', required=True)
    parser.add_argument('--phase', required=True, choices=sorted(PHASES))
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    runner = Runner(args.role, args.evidence)
    try:
        getattr(runner, PHASES[args.phase])()
    except Exception as exc:
        code = str(exc) if isinstance(exc, ValueError) else 'phase_failed'
        runner.receipt(args.phase + '-FAILED', {'ok': False, 'errorType': type(exc).__name__, 'code': code,
                                                'modelCalls': 0, 'at': now_stamp()})
        raise SystemExit(1)
