"""Plan/install/query one Windows inventory task; default invocation is read-only.

The internal `run` action executes only tools/operations.py snapshot. No model
calls, service lifecycle commands, permanent Python worker, or arbitrary shell.
"""
from __future__ import annotations
import argparse
import base64
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
TASK_NAME = 'QiandengJi-Operations-Inventory'
MARKER = 'QiandengJi managed read-only operations inventory v1'
TIMEOUT = 90
LOG_LIMIT = 256 * 1024
NS = 'http://schemas.microsoft.com/windows/2004/02/mit/task'


def utc():
    return datetime.now(timezone.utc).isoformat()


def runtime_paths(root=ROOT, executable=None):
    python = Path(executable or sys.executable).resolve().with_name('python.exe')
    pythonw = python.with_name('pythonw.exe')
    script = Path(root).resolve() / 'tools/operations_inventory_task.py'
    collector = Path(root).resolve() / 'tools/operations.py'
    return python, pythonw, script, collector


def plan(root=ROOT, executable=None):
    python, pythonw, script, collector = runtime_paths(root, executable)
    return {'schema': 1, 'project': 'qiandengji', 'taskName': TASK_NAME,
            'applied': False, 'intervalSeconds': 120, 'executionTimeLimitSeconds': 100,
            'collectorTimeoutSeconds': TIMEOUT, 'multipleInstances': 'IgnoreNew',
            'logonType': 'InteractiveToken', 'runLevel': 'LeastPrivilege',
            'requiresLoggedInUser': True, 'hiddenWindow': True,
            'action': {'executable': str(pythonw),
                       'arguments': subprocess.list2cmdline(['-X', 'utf8', '-B', str(script), 'run']),
                       'workingDirectory': str(Path(root).resolve())},
            'collector': [str(python), '-X', 'utf8', '-B', str(collector), 'snapshot'],
            'log': str(Path(root) / 'runtime/operations-inventory-task.log'),
            'receipt': str(Path(root) / 'runtime/operations-inventory-task.json'),
            'logLimitBytes': LOG_LIMIT,
            'filesReady': all(p.is_file() for p in (python, pythonw, script, collector)),
            'scope': 'One read-only snapshot per run; does not start services or call models'}


def task_xml(spec, user_sid, start=None):
    if not re.fullmatch(r'S-1-[0-9]+(?:-[0-9]+)+', user_sid):
        raise ValueError('Windows SID required')
    ET.register_namespace('', NS)
    task = ET.Element(f'{{{NS}}}Task', {'version': '1.2'})
    def add(parent, name, text=None, **attrs):
        node = ET.SubElement(parent, f'{{{NS}}}{name}', attrs)
        if text is not None:
            node.text = str(text)
        return node
    info = add(task, 'RegistrationInfo')
    add(info, 'Description', MARKER)
    add(info, 'URI', '\\' + TASK_NAME)
    triggers = add(task, 'Triggers')
    trigger = add(triggers, 'TimeTrigger')
    repetition = add(trigger, 'Repetition')
    add(repetition, 'Interval', 'PT2M')
    add(repetition, 'StopAtDurationEnd', 'false')
    add(trigger, 'StartBoundary', (start or datetime.now().astimezone() + timedelta(minutes=1)).isoformat(timespec='seconds'))
    add(trigger, 'Enabled', 'true')
    principals = add(task, 'Principals')
    principal = add(principals, 'Principal', id='Author')
    add(principal, 'UserId', user_sid)
    add(principal, 'LogonType', 'InteractiveToken')
    add(principal, 'RunLevel', 'LeastPrivilege')
    settings = add(task, 'Settings')
    for key, value in [('MultipleInstancesPolicy', 'IgnoreNew'), ('DisallowStartIfOnBatteries', 'false'),
                       ('StopIfGoingOnBatteries', 'false'), ('AllowHardTerminate', 'true'),
                       ('StartWhenAvailable', 'true'), ('RunOnlyIfNetworkAvailable', 'false'),
                       ('AllowStartOnDemand', 'true'), ('Enabled', 'true'), ('Hidden', 'false'),
                       ('WakeToRun', 'false'), ('ExecutionTimeLimit', 'PT100S')]:
        add(settings, key, value)
    actions = add(task, 'Actions', Context='Author')
    action = add(actions, 'Exec')
    add(action, 'Command', spec['action']['executable'])
    add(action, 'Arguments', spec['action']['arguments'])
    add(action, 'WorkingDirectory', spec['action']['workingDirectory'])
    return ET.tostring(task, encoding='unicode')


def powershell(script):
    if os.name != 'nt':
        raise OSError('Task Scheduler requires Windows')
    executable = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    prefix = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); "
    encoded = base64.b64encode((prefix + script).encode('utf-16-le')).decode('ascii')
    proc = subprocess.run([str(executable), '-NoLogo', '-NoProfile', '-NonInteractive',
                           '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
                          capture_output=True, text=True, encoding='utf-8', errors='replace',
                          timeout=20, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if proc.returncode:
        raise RuntimeError('Task Scheduler command failed')
    return json.loads(proc.stdout.lstrip('\ufeff'))


def query_raw():
    # Query only the fixed root task. An inaccessible Scheduler is an error,
    # never reported as "not installed". No unrelated task actions are listed.
    return powershell(r"""
    $service=New-Object -ComObject 'Schedule.Service'; $service.Connect();
    try { $task=$service.GetFolder('\').GetTask('QiandengJi-Operations-Inventory') }
    catch { if ($_.Exception.HResult -eq -2147024894) { @{exists=$false}|ConvertTo-Json -Compress; exit 0 }; throw }
    $definition=$task.Definition; $triggerEnabled=$null;
    if ($definition.Triggers.Count -eq 1) { $triggerEnabled=$definition.Triggers.Item(1).Enabled }
    @{exists=$true; xml=$task.Xml; state=[int]$task.State; enabled=[bool]$task.Enabled;
      effective=@{runLevel=$definition.Principal.RunLevel; settingsEnabled=$definition.Settings.Enabled;
                  wakeToRun=$definition.Settings.WakeToRun; triggerEnabled=$triggerEnabled};
      lastRunAt=$task.LastRunTime.ToUniversalTime().ToString('o'); nextRunAt=$task.NextRunTime.ToUniversalTime().ToString('o');
      lastTaskResult=[long]$task.LastTaskResult}|ConvertTo-Json -Compress
    """)


def duration_seconds(value):
    # Task Scheduler normalizes PT100S to PT1M40S. Compare the duration,
    # while rejecting malformed, fractional or calendar-dependent durations.
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r'P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?', value)
    if not match or not any(match.groups()):
        return None
    return sum(int(part or 0)*factor for part, factor in zip(match.groups(), (86400, 3600, 60, 1)))


def task_identity(raw, spec):
    if raw.get('exists') is not True:
        return {'exists': False, 'managed': False, 'definitionMatches': False}
    tree = ET.fromstring(raw['xml'])
    def value(path):
        return tree.findtext('/'.join(f'{{{NS}}}{part}' for part in path.split('/')))
    def matches_effective(path, xml_expected, key, effective_expected):
        # Windows omits default-valued XML elements on export. Only use the
        # actual COM property as fallback; missing evidence is not a default.
        xml_value = value(path)
        if xml_value is not None:
            return xml_value == xml_expected
        effective = raw.get('effective')
        if not isinstance(effective, dict):
            return False
        observed = effective.get(key)
        return type(observed) is type(effective_expected) and observed == effective_expected
    actions = tree.findall(f'{{{NS}}}Actions/*')
    action_matches = (len(actions) == 1 and actions[0].tag == f'{{{NS}}}Exec'
                      and value('Actions/Exec/Command') == spec['action']['executable']
                      and value('Actions/Exec/Arguments') == spec['action']['arguments']
                      and value('Actions/Exec/WorkingDirectory') == spec['action']['workingDirectory'])
    managed = value('RegistrationInfo/Description') == MARKER and action_matches
    triggers = tree.findall(f'{{{NS}}}Triggers/*')
    definition_matches = (managed and len(triggers) == 1 and triggers[0].tag == f'{{{NS}}}TimeTrigger'
        and duration_seconds(value('Triggers/TimeTrigger/Repetition/Interval')) == 120
        and value('Triggers/TimeTrigger/Repetition/Duration') is None
        and value('Triggers/TimeTrigger/EndBoundary') is None
        and matches_effective('Triggers/TimeTrigger/Enabled', 'true', 'triggerEnabled', True)
        and value('Settings/MultipleInstancesPolicy') == 'IgnoreNew'
        and duration_seconds(value('Settings/ExecutionTimeLimit')) == 100
        and matches_effective('Settings/Enabled', 'true', 'settingsEnabled', True)
        and value('Settings/DisallowStartIfOnBatteries') == 'false'
        and value('Settings/StopIfGoingOnBatteries') == 'false'
        and value('Settings/StartWhenAvailable') == 'true'
        and matches_effective('Settings/WakeToRun', 'false', 'wakeToRun', False)
        and value('Principals/Principal/LogonType') == 'InteractiveToken'
        and matches_effective('Principals/Principal/RunLevel', 'LeastPrivilege', 'runLevel', 0))
    return {'exists': True, 'managed': managed, 'definitionMatches': definition_matches,
            'enabled': raw.get('enabled') is True,
            'state': {0:'unknown', 1:'disabled', 2:'queued', 3:'ready', 4:'running'}.get(raw.get('state'), 'unknown'),
            'lastRunAt': raw.get('lastRunAt'), 'nextRunAt': raw.get('nextRunAt'),
            'lastTaskResult': raw.get('lastTaskResult'), 'actionMatches': action_matches,
            'interval': value('Triggers/TimeTrigger/Repetition/Interval'),
            'multipleInstances': value('Settings/MultipleInstancesPolicy'),
            'executionTimeLimit': value('Settings/ExecutionTimeLimit')}


def query(spec):
    result = task_identity(query_raw(), spec)
    return {'schema': 1, 'project': 'qiandengji', 'taskName': TASK_NAME, 'queriedAt': utc(),
            'ok': result.get('definitionMatches') is True and result.get('enabled') is True, **result}


def install(spec):
    if ROOT.resolve() != Path('D:/Projects/QiandengJi').resolve() or not spec['filesReady']:
        raise ValueError('Expected D project and installed Python/Pythonw are required')
    existing = task_identity(query_raw(), spec)
    if existing['exists'] and not existing['managed']:
        raise ValueError('Fixed task name is already owned by a different definition')
    sid = powershell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value | ConvertTo-Json -Compress')
    xml64 = base64.b64encode(task_xml(spec, sid).encode('utf-8')).decode('ascii')
    # Register with CREATE (2) for a new name so a concurrent unrelated task
    # cannot be overwritten. UPDATE (4) only after an exact owned-action check.
    flags = 4 if existing['exists'] else 2
    powershell("$service=New-Object -ComObject 'Schedule.Service'; $service.Connect(); "
               "$xml=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + xml64 + "')); "
               "$null=$service.GetFolder('\\').RegisterTask('" + TASK_NAME + "',$xml," + str(flags) +
               ",$null,$null,3,$null); @{registered=$true}|ConvertTo-Json -Compress")
    result = query(spec)
    result['applied'] = True
    return result


class TailBuffer:
    def __init__(self, limit=LOG_LIMIT - 8192):
        self.limit = limit
        self.data = bytearray()
        self.total = 0
    def append(self, block):
        self.total += len(block)
        self.data.extend(block[-self.limit:])
        del self.data[:-self.limit]
    def text(self):
        return bytes(self.data).decode('utf-8', errors='replace')


def stop_owned_tree(process):
    if os.name == 'nt':
        try:
            subprocess.run([str(Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/taskkill.exe'),
                            '/PID', str(process.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        except (OSError, subprocess.TimeoutExpired):
            pass
    if process.poll() is None:
        process.kill()
    process.wait(timeout=2)


def run_collector(spec, popen=None):
    """Bounded one-shot wrapper. The CLI, not this wrapper, owns inventory_lock."""
    root = Path(spec['action']['workingDirectory'])
    runtime = root / 'runtime'
    runtime.mkdir(parents=True, exist_ok=True)
    log_path = runtime / 'operations-inventory-task.log'
    receipt_path = runtime / 'operations-inventory-task.json'
    record = {'schema': 1, 'project': 'qiandengji', 'taskName': TASK_NAME,
              'startedAt': utc(), 'finishedAt': None, 'ok': False, 'status': 'running'}
    # A killed wrapper leaves an explicit running receipt, not yesterday's OK.
    receipt_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    log_path.write_text(json.dumps(record, ensure_ascii=False) + '\n', encoding='utf-8')
    tail = TailBuffer()
    process = None
    reader = None
    returncode = 1
    try:
        process = (popen or subprocess.Popen)(spec['collector'], cwd=root,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        def drain():
            while True:
                block = process.stdout.read(4096)
                if not block:
                    break
                tail.append(block)
        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        try:
            returncode = process.wait(timeout=TIMEOUT)
            record['status'] = 'skipped' if returncode == 75 else 'complete' if returncode == 0 else 'failed'
        except subprocess.TimeoutExpired:
            record['status'] = 'timeout'
            returncode = 124
            stop_owned_tree(process)
        reader.join(timeout=2)
        record['ok'] = returncode == 0
        record['exitCode'] = returncode
    except Exception as exc:
        record['status'] = 'failed'
        record['errorType'] = type(exc).__name__
        if process is not None and process.poll() is None:
            stop_owned_tree(process)
    finally:
        record['finishedAt'] = utc()
        record['outputBytes'] = tail.total
        record['outputTruncated'] = tail.total > tail.limit
        receipt_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        header = (json.dumps(record, ensure_ascii=False) + '\n').encode('utf-8')
        # The tail may begin inside a multibyte character. Re-encode replacement
        # text, then bound once more while retaining valid UTF-8.
        content = tail.text().encode('utf-8')[-(LOG_LIMIT - len(header)):].decode('utf-8', 'ignore').encode('utf-8')
        log_path.write_bytes(header + content)
    return record, returncode


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', nargs='?', default='plan', choices=['plan', 'install', 'query', 'run'])
    parser.add_argument('--execute', choices=['qiandengji'])
    args = parser.parse_args(argv)
    try:
        spec = plan()
        if args.action != 'install' and args.execute:
            raise ValueError('--execute applies only to install')
        if args.action == 'install' and args.execute:
            result = install(spec)
        elif args.action == 'query':
            result = query(spec)
        elif args.action == 'run':
            if not spec['filesReady']:
                raise ValueError('Collector files are unavailable')
            result, code = run_collector(spec)
            if sys.stdout is not None:
                print(json.dumps(result, ensure_ascii=False))
            return code
        else:
            result = spec
        if sys.stdout is not None:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get('ok', True) else 1
    except Exception as exc:
        if sys.stdout is not None:
            print(json.dumps({'schema': 1, 'project': 'qiandengji', 'taskName': TASK_NAME,
                              'ok': False, 'errorType': type(exc).__name__,
                              'error': 'Inventory task action failed; no unrelated tasks were changed'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
