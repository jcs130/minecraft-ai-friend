"""Versioned programs learned by the embodied Agent, evaluated without host IO.

JavaScript implements next(state, memory). It can calculate one proposed Numen
action, bounded wait, or whitelisted observation; only the separately maintained
controller/gateway can execute that proposal. No
Python callbacks, filesystem, process, network, or game objects enter QuickJS.
Tests certify the supplied examples, not general correctness in a live world.
"""
from contextlib import contextmanager
import hashlib
from importlib.metadata import version as package_version
import json
import os
from pathlib import Path
import re
import time
import uuid


ENGINE_PACKAGE = 'quickjs-ng'
ENGINE_VERSION = '0.16.2.1'
MAX_SOURCE_BYTES = 16384
MAX_JSON_BYTES = 65536
MAX_STORE_BYTES = 262144
MEMORY_BYTES = 16 * 1024 * 1024
STACK_BYTES = 256 * 1024
CPU_SECONDS = 0.10
from numen_gateway import TOOLS as ACTION_TOOLS
OBSERVATION_TOOLS = ('inspect_block', 'inspect_container')
MIN_WAIT_SECONDS = 15
MAX_WAIT_SECONDS = 300
NAME = re.compile(r'[a-z][a-z0-9_-]{0,47}\Z')
VERSION = re.compile(r'[0-9a-f]{64}\Z')


class SkillError(ValueError):
    def __init__(self, code, line=None):
        self.code = code
        self.line = line
        super().__init__(code)


def _json(value, limit=MAX_JSON_BYTES):
    try:
        text = json.dumps(value, ensure_ascii=True, sort_keys=True,
                          separators=(',', ':'), allow_nan=False)
    except (ValueError, TypeError, RecursionError) as exc:
        raise SkillError('invalid_json') from exc
    if len(text.encode('utf-8')) > limit:
        raise SkillError('json_too_large')
    return text


def _hash(value):
    return hashlib.sha256(_json(value, MAX_STORE_BYTES).encode('utf-8')).hexdigest()


def _identifier(value, pattern, label):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise SkillError('invalid_' + label)
    return value


def _engine():
    try:
        installed = package_version(ENGINE_PACKAGE)
        import quickjs
    except ImportError as exc:
        raise SkillError('skill_engine_unavailable') from exc
    if installed != ENGINE_VERSION:
        raise SkillError('skill_engine_version_mismatch')
    return quickjs


def _kernel_version():
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def _wait_seconds(value):
    if type(value) is not int or not MIN_WAIT_SECONDS <= value <= MAX_WAIT_SECONDS:
        raise SkillError('invalid_skill_wait')
    return value


def _observation(value):
    """Validate only a proposal. Physical reach and ownership remain gateway work."""
    if (not isinstance(value, dict) or set(value) != {'tool', 'args'}
            or value['tool'] not in OBSERVATION_TOOLS or not isinstance(value['args'], dict)
            or set(value['args']) != {'x', 'y', 'z'}):
        raise SkillError('invalid_skill_observation')
    for key, low, high in (('x', -29999984, 29999984), ('y', -64, 319), ('z', -29999984, 29999984)):
        coordinate = value['args'][key]
        if type(coordinate) is not int or not low <= coordinate <= high:
            raise SkillError('invalid_skill_observation')
    return value


def _validate_result(value):
    if not isinstance(value, dict) or set(value) - {
            'action', 'memory', 'done', 'replan', 'reason', 'waitSeconds', 'observe'}:
        raise SkillError('invalid_skill_result')
    if (not isinstance(value.get('memory'), dict)
            or not any(key in value for key in ('action', 'waitSeconds', 'observe'))):
        raise SkillError('invalid_skill_result')
    action = value.get('action')
    if action is not None:
        if not isinstance(action, dict) or set(action) != {'tool', 'args'}:
            raise SkillError('invalid_skill_action')
        if action['tool'] not in ACTION_TOOLS or not isinstance(action['args'], dict):
            raise SkillError('invalid_skill_action')
        _json(action['args'], 4096)
    for flag in ('done', 'replan'):
        if flag in value and type(value[flag]) is not bool:
            raise SkillError('invalid_skill_result')
    if not isinstance(value.get('reason', ''), str) or len(value.get('reason', '')) > 400:
        raise SkillError('invalid_skill_reason')
    if action is not None and (value.get('done') or value.get('replan')):
        raise SkillError('action_with_terminal_result')
    if value.get('done') and value.get('replan'):
        raise SkillError('conflicting_terminal_result')
    extra = {}
    if 'waitSeconds' in value:
        extra['waitSeconds'] = _wait_seconds(value['waitSeconds'])
    if 'observe' in value:
        extra['observe'] = _observation(value['observe'])
    if extra and (len(extra) > 1 or action is not None or value.get('done') or value.get('replan')):
        raise SkillError('conflicting_skill_requests')
    _json(value['memory'], 16384)
    return dict(action=action, memory=value['memory'], done=value.get('done', False),
                replan=value.get('replan', False), reason=value.get('reason', '')) | extra


def evaluate(source, state, memory=None):
    """Run pure skill code once. This function never sends a game command."""
    if not isinstance(source, str) or not source.strip() or len(source.encode('utf-8')) > MAX_SOURCE_BYTES:
        raise SkillError('invalid_skill_source')
    if not isinstance(state, dict) or (memory is not None and not isinstance(memory, dict)):
        raise SkillError('invalid_skill_input')
    packed = _json({'state': state, 'memory': {} if memory is None else memory})
    engine = _engine()
    context = engine.Context()
    context.set_memory_limit(MEMORY_BYTES)
    context.set_max_stack_size(STACK_BYTES)
    context.set_time_limit(CPU_SECONDS)
    # One eval includes parsing, the submitted source, invocation, and result
    # serialization: an expensive getter/toJSON cannot escape the CPU budget.
    program = '''(() => {
      "use strict";
      const serialize = JSON.stringify.bind(JSON);
      const input = JSON.parse(%s);
      globalThis.Date = undefined;
      Math.random = () => { throw new Error("random_unavailable"); };
      Object.freeze(Math);
      const step = (() => { %s\n;
        if (typeof next !== "function") throw new Error("next_required");
        return next;
      })();
      return serialize(step(input.state, input.memory));
    })()''' % (json.dumps(packed), source)
    try:
        encoded = context.eval(program)
    except Exception as exc:
        # Engine exceptions can contain submitted text. Return bounded generic
        # categories instead of reflecting arbitrary program content into logs.
        detail = str(exc).lower()
        if 'interrupted' in detail:
            code = 'skill_cpu_limit'
        elif 'memory' in detail or 'allocation' in detail:
            code = 'skill_memory_limit'
        elif 'stack' in detail:
            code = 'skill_stack_limit'
        elif detail.startswith('syntaxerror:'):
            code = 'skill_syntax_error'
        elif detail.startswith('referenceerror:'):
            code = 'skill_reference_error'
        elif detail.startswith('typeerror:'):
            code = 'skill_type_error'
        else:
            code = 'skill_execution_failed'
        location = re.search(r'<input>:(\d+)', detail)
        raise SkillError(code, int(location[1]) if location else None) from None
    if not isinstance(encoded, str) or len(encoded.encode('utf-8')) > MAX_JSON_BYTES:
        raise SkillError('invalid_skill_result')
    try:
        value = json.loads(encoded)
    except (ValueError, RecursionError):
        raise SkillError('invalid_skill_result') from None
    return _validate_result(value)


def _fixtures(fixtures):
    if not isinstance(fixtures, list) or not 2 <= len(fixtures) <= 12:
        raise SkillError('two_to_twelve_fixtures_required')
    inputs = set()
    for row in fixtures:
        if not isinstance(row, dict) or set(row) - {
                'state', 'memory', 'expectedActionTool', 'done', 'replan', 'expectedAction',
                'expectedMemory', 'expectedWaitSeconds', 'expectedObserve'}:
            raise SkillError('invalid_fixture')
        if not isinstance(row.get('state'), dict) or not isinstance(row.get('memory', {}), dict):
            raise SkillError('invalid_fixture_input')
        if not any(key in row for key in ('expectedActionTool', 'done', 'expectedWaitSeconds', 'expectedObserve')):
            raise SkillError('fixture_expectation_required')
        if 'expectedActionTool' in row and row['expectedActionTool'] not in (None, *ACTION_TOOLS):
            raise SkillError('invalid_fixture_expectation')
        for flag in ('done', 'replan'):
            if flag in row and type(row[flag]) is not bool:
                raise SkillError('invalid_fixture_expectation')
        if 'expectedMemory' in row and not isinstance(row['expectedMemory'], dict):
            raise SkillError('invalid_fixture_expectation')
        if row.get('expectedWaitSeconds') is not None:
            _wait_seconds(row['expectedWaitSeconds'])
        if row.get('expectedObserve') is not None:
            _observation(row['expectedObserve'])
        inputs.add(_json({'state': row['state'], 'memory': row.get('memory', {})}))
    if len(inputs) < 2:
        raise SkillError('distinct_fixture_inputs_required')
    _json(fixtures, 131072)
    return fixtures


class SkillLibrary:
    """Immutable versions and separately recorded tests/promotion references."""
    def __init__(self, root=None):
        self.root = Path(root or '/state/survival/skills').absolute()
        # Never follow a link out of the dedicated skill store, even if a local
        # administrator has accidentally pointed it at another runtime folder.
        for path in (self.root, *self.root.parents):
            if path.is_symlink():
                raise SkillError('linked_skill_store')
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, *parts):
        path = self.root
        for part in parts:
            path = path / part
            if path.is_symlink():
                raise SkillError('linked_skill_store')
        if not path.resolve().is_relative_to(self.root.resolve()):
            raise SkillError('invalid_skill_path')
        return path

    @contextmanager
    def _lock(self):
        with self._path('.lock').open('a+b') as stream:
            if os.name == 'nt':
                import msvcrt
                if stream.tell() == 0:
                    stream.write(b'0'); stream.flush()
                stream.seek(0)
                try:
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                except OSError:
                    raise SkillError('skill_library_busy') from None
            else:
                import fcntl
                try:
                    fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise SkillError('skill_library_busy') from None
            try:
                yield
            finally:
                if os.name == 'nt':
                    stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream, fcntl.LOCK_UN)

    def _load(self, path, default=None):
        if not path.exists():
            if default is not None:
                return default
            raise SkillError('skill_not_found')
        if not path.is_file() or path.stat().st_size > MAX_STORE_BYTES:
            raise SkillError('invalid_skill_store')
        try:
            value = json.loads(path.read_text(encoding='utf-8'))
        except (ValueError, OSError, RecursionError):
            raise SkillError('invalid_skill_store') from None
        if not isinstance(value, dict):
            raise SkillError('invalid_skill_store')
        return value

    def _write(self, path, value):
        content = _json(value, MAX_STORE_BYTES)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            with temporary.open('x', encoding='utf-8') as stream:
                stream.write(content + '\n'); stream.flush(); os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def _head(self, name):
        _identifier(name, NAME, 'skill_name')
        return self._load(self._path(name, 'head.json'),
                          {'schema': 1, 'name': name, 'draftVersion': None,
                           'activeVersion': None, 'promotions': []})

    def _record(self, name, version):
        _identifier(name, NAME, 'skill_name')
        _identifier(version, VERSION, 'skill_version')
        record = self._load(self._path(name, 'versions', version + '.json'))
        if record.get('name') != name or _hash(record) != version:
            raise SkillError('skill_version_changed')
        return record

    def catalog(self):
        # Heads are atomically replaced only after their immutable version exists.
        # Read-only observation need not acquire the writer lock: a concurrent
        # skill test must never shut down the embodied Agent's controller.
        rows, unavailable = [], []
        for folder in sorted(self.root.iterdir()):
            if not NAME.fullmatch(folder.name):
                continue
            try:
                head = self._head(folder.name)
                version = head.get('activeVersion') or head.get('draftVersion')
                if version:
                    record = self._record(folder.name, version)
                    rows.append({key: head[key] for key in ('name', 'draftVersion', 'activeVersion')}
                                | {'description': record['description']})
            except (SkillError, OSError, ValueError, TypeError, KeyError) as exc:
                unavailable.append({'name': folder.name,
                                    'code': exc.code if isinstance(exc, SkillError) else 'invalid_skill_store'})
        return {'skills': rows, 'unavailable': unavailable,
                'contract': 'next(state,memory) -> {action?,memory,done?,replan?,reason?,waitSeconds?,observe?}; '
                            'one action, wait, observation or terminal result per step; '
                            'action may be omitted only for waitSeconds or observe',
                'actionTools': list(ACTION_TOOLS), 'observationTools': list(OBSERVATION_TOOLS),
                'waitSeconds': {'minimum': MIN_WAIT_SECONDS, 'maximum': MAX_WAIT_SECONDS},
                'engine': ENGINE_PACKAGE + '==' + ENGINE_VERSION}

    def read(self, name, version=None):
        with self._lock():
            head = self._head(name)
            version = version or head.get('draftVersion') or head.get('activeVersion')
            if not version:
                raise SkillError('skill_not_found')
            record = self._record(name, version)
            return record | {'version': version, 'active': head.get('activeVersion') == version,
                             'promoted': any(row['version'] == version for row in head['promotions'])}

    def draft(self, name, source, fixtures, description=''):
        _identifier(name, NAME, 'skill_name')
        if not isinstance(source, str) or not source.strip() or len(source.encode('utf-8')) > MAX_SOURCE_BYTES:
            raise SkillError('invalid_skill_source')
        if not isinstance(description, str) or len(description) > 400:
            raise SkillError('invalid_skill_description')
        record = {'schema': 1, 'name': name, 'source': source, 'fixtures': _fixtures(fixtures),
                  'description': description}
        version = _hash(record)
        with self._lock():
            if not self._path(name).exists() and sum(bool(NAME.fullmatch(p.name)) for p in self.root.iterdir()) >= 64:
                raise SkillError('skill_catalog_full')
            head = self._head(name)
            target = self._path(name, 'versions', version + '.json')
            if target.exists():
                self._record(name, version)
            else:
                folder = self._path(name, 'versions')
                if folder.exists() and len(list(folder.iterdir())) >= 128:
                    raise SkillError('skill_version_limit')
                self._write(target, record)
            head['draftVersion'] = version
            self._write(self._path(name, 'head.json'), head)
            return {'name': name, 'version': version, 'draftVersion': version,
                    'activeVersion': head.get('activeVersion')}

    def test(self, name, version=None):
        with self._lock():
            head = self._head(name)
            version = version or head.get('draftVersion')
            record = self._record(name, version)
            cases = []
            for index, fixture in enumerate(_fixtures(record['fixtures'])):
                try:
                    result = evaluate(record['source'], fixture['state'], fixture.get('memory', {}))
                    actual_tool = result['action']['tool'] if result['action'] else None
                    passed = ('expectedActionTool' not in fixture or actual_tool == fixture['expectedActionTool'])
                    passed = passed and all(result[key] == fixture[key] for key in ('done', 'replan') if key in fixture)
                    passed = passed and ('expectedAction' not in fixture or result['action'] == fixture['expectedAction'])
                    passed = passed and ('expectedMemory' not in fixture or result['memory'] == fixture['expectedMemory'])
                    passed = passed and ('expectedWaitSeconds' not in fixture
                                         or result.get('waitSeconds') == fixture['expectedWaitSeconds'])
                    passed = passed and ('expectedObserve' not in fixture
                                         or result.get('observe') == fixture['expectedObserve'])
                    cases.append({'index': index, 'passed': passed, 'actual': result})
                except SkillError as exc:
                    cases.append({'index': index, 'passed': False, 'error': str(exc),
                                  'generatedProgramLine': exc.line})
            report = {'schema': 1, 'name': name, 'version': version, 'passed': all(c['passed'] for c in cases),
                      'cases': cases, 'kernelVersion': _kernel_version(), 'engineVersion': ENGINE_VERSION,
                      'testedAt': time.time()}
            self._write(self._path(name, 'reports', version + '.json'), report)
            return report

    def _tested(self, name, version):
        self._record(name, version)
        report = self._load(self._path(name, 'reports', version + '.json'))
        if (report.get('version') != version or report.get('passed') is not True
                or report.get('kernelVersion') != _kernel_version()
                or report.get('engineVersion') != ENGINE_VERSION
                or len(report.get('cases', [])) < 2
                or not all(c.get('passed') is True for c in report['cases'])):
            raise SkillError('matching_passed_tests_required')
        _engine()

    def promote(self, name, version):
        with self._lock():
            head = self._head(name)
            self._tested(name, version)
            previous = head.get('activeVersion')
            head['activeVersion'] = version
            if not any(row['version'] == version for row in head['promotions']):
                head['promotions'].append({'version': version, 'promotedAt': time.time()})
            self._write(self._path(name, 'head.json'), head)
            return {'name': name, 'version': version, 'activeVersion': version,
                    'previousVersion': previous, 'promoted': True}

    def run(self, name, state, memory=None, version=None):
        with self._lock():
            head = self._head(name)
            version = version or head.get('activeVersion')
            if not version or not any(row['version'] == version for row in head['promotions']):
                raise SkillError('promoted_skill_required')
            self._tested(name, version)
            record = self._record(name, version)
            result = evaluate(record['source'], state, memory)
            return result | {'skill': {'name': name, 'version': version}}
