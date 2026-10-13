"""Read-only finite trial and production-preservation check; never calls a model or dispatches actions."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import subprocess
from urllib.request import urlopen
from society_lab import DEFAULT_ROOT

def probe(directory):
    checks = {}
    expected_checks = 10
    result = {'ok': False, 'checks': checks, 'modelRequestsDispatched': 0, 'worldActionsDispatched': 0}
    try:
        directory = directory.resolve()
        config = json.loads((directory / 'config.json').read_text('utf-8'))
        expected_checks = 13 if config.get('task') else 10
        status = json.loads((directory / 'status.json').read_text('utf-8'))
        process = json.loads((directory / 'process.json').read_text('utf-8'))
        world = json.loads(Path(config['worldConfigFile']).read_text('utf-8'))
        checks['owned_state_directory'] = Path(config['stateDirectory']).resolve() == directory
        checks['same_explicit_body'] = config['username'] == world['username'] == status['username'] and status.get('current', {}).get('bodyId') == world['expectedUuid']
        checks['exact_model_no_qwenpaw'] = status['model'] == 'qwen3.7-plus' and status['qwenpawConnected'] is False
        checks['finite_model_budget'] = status.get('modelState', {}).get('calls', 0) <= config['maxModelCalls'] <= 1280
        terminal = status['phase'] in ['stopped', 'blocked']
        checks['healthy_lifecycle'] = status['pid'] == process['pid'] and (
            not terminal and time.time() - __import__('datetime').datetime.fromisoformat(status['updatedAt']).timestamp() < 30 and (directory / 'runner.lock').exists()
            or terminal and not (directory / 'runner.lock').exists() and status['phase'] == 'stopped')
        baseline = json.loads((directory / 'production-baseline.json').read_text('utf-8'))
        protected = {name: digest for name, digest in baseline['files'].items() if name.replace('\\', '/') != 'agents/maw-explorer/state.json'}
        checks['existing_service_configs_and_pause_preserved'] = all(hashlib.sha256((DEFAULT_ROOT / name).read_bytes()).hexdigest() == digest for name, digest in protected.items())
        old = (DEFAULT_ROOT / 'agents/maw-explorer/actions.jsonl').read_bytes()
        checks['original_agent_ledger_preserved'] = hashlib.sha256(old[:baseline['oldLedger']['bytes']]).hexdigest() == baseline['oldLedger']['sha256']
        checks['original_agent_remains_round_464'] = json.loads((DEFAULT_ROOT / 'agents/maw-explorer/state.json').read_text('utf-8'))['round'] == 464
        for port, owner in baseline['owners'].items():
            with urlopen(f'http://127.0.0.1:{port}/healthz', timeout=5) as response:
                current = json.load(response)
            checks[f'production_owner_{port}_healthy'] = current['runId'] == owner and current['healthy'] and not current['paused'] and time.time() - current['heartbeatEpoch'] < 30
        result.update(phase=status['phase'], username=status['username'], model=status.get('modelState'),
                      consecutivePlanErrors=status.get('consecutivePlanErrors', 0),
                      position=status.get('current', {}).get('position'), health=status.get('current', {}).get('health'), error=status.get('error'))
        if config.get('task'):
            report_script = Path(config['worldPackageFile']).with_name('task-report.mjs')
            completed = subprocess.run([config['node'], str(report_script), '--directory', str(directory / 'task-monitor')],
                                       capture_output=True, text=True, encoding='utf-8', timeout=15)
            task_report = json.loads(completed.stdout)
            checks['task_monitor_healthy'] = completed.returncode == 0 and task_report['health']['ok']
            checks['task_monitor_current_attempt'] = status.get('task', {}).get('id') == config['task']['id'] and task_report['attempts'] >= 1
            checks['task_monitor_costs_not_reset'] = task_report['totalModelCalls'] <= status['modelState']['calls']
            result['taskStatistics'] = task_report
    except Exception as error:
        result['errorType'] = type(error).__name__
    result['ok'] = 'errorType' not in result and len(checks) == expected_checks and all(checks.values())
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-directory', type=Path, required=True)
    report = probe(parser.parse_args().state_directory)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report['ok'] else 1)
