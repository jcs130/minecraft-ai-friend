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
OBSERVATION_TOOLS = ('inspect_block', 'inspect_container', 'sense')
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
    # The declared sensor validation is part of the executable proposal contract.
    return hashlib.sha256(Path(__file__).read_bytes() + b'\0'
                          + Path(__file__).with_name('world_adapter.py').read_bytes() + b'\0'
                          + Path(__file__).with_name('system_one.py').read_bytes()).hexdigest()


def _wait_seconds(value):
    if type(value) is not int or not MIN_WAIT_SECONDS <= value <= MAX_WAIT_SECONDS:
        raise SkillError('invalid_skill_wait')
    return value


def _observation(value):
    """Validate only a proposal. Physical reach and ownership remain gateway work."""
    if (not isinstance(value, dict) or set(value) != {'tool', 'args'}
            or value['tool'] not in OBSERVATION_TOOLS or not isinstance(value['args'], dict)):
        raise SkillError('invalid_skill_observation')
    if value['tool'] == 'sense':
        from world_adapter import validate_sensor
        try:
            if set(value['args']) != {'sensor', 'arguments'}:
                raise ValueError('invalid_sensor_arguments')
            validate_sensor(value['args']['sensor'], value['args']['arguments'])
        except (ValueError, TypeError):
            raise SkillError('invalid_skill_observation')
        return value
    if set(value['args']) != {'x', 'y', 'z'}:
        raise SkillError('invalid_skill_observation')
    for key, low, high in (('x', -29999984, 29999984), ('y', -64, 319), ('z', -29999984, 29999984)):
        coordinate = value['args'][key]
        if type(coordinate) is not int or not low <= coordinate <= high:
            raise SkillError('invalid_skill_observation')
    return value


def _validate_result(value):
    if not isinstance(value, dict) or set(value) - {
            'action', 'memory', 'done', 'replan', 'reason', 'waitSeconds', 'observe', 'choose'}:
        raise SkillError('invalid_skill_result')
    if (not isinstance(value.get('memory'), dict)
            or not any(key in value for key in ('action', 'waitSeconds', 'observe', 'choose'))):
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
    if 'choose' in value:
        from system_one import validate_choice
        try:
            extra['choose'] = validate_choice(value['choose'])
        except ValueError as exc:
            raise SkillError('invalid_skill_choice') from exc
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
                'expectedMemory', 'expectedWaitSeconds', 'expectedObserve', 'expectedChoice'}:
            raise SkillError('invalid_fixture')
        if not isinstance(row.get('state'), dict) or not isinstance(row.get('memory', {}), dict):
            raise SkillError('invalid_fixture_input')
        if not any(key in row for key in ('expectedActionTool', 'done', 'expectedWaitSeconds', 'expectedObserve', 'expectedChoice')):
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
        if 'expectedChoice' in row:
            from system_one import validate_choice
            try:
                validate_choice(row['expectedChoice'])
            except ValueError as exc:
                raise SkillError('invalid_fixture_choice') from exc
        inputs.add(_json({'state': row['state'], 'memory': row.get('memory', {})}))
    if len(inputs) < 2:
        raise SkillError('distinct_fixture_inputs_required')
    _json(fixtures, 131072)
    return fixtures


class SkillLibrary:
    """Immutable versions and separately recorded tests/promotion references."""
    def __init__(self, root=None, world_root=None):
        self.root = Path(root or '/state/survival/skills').absolute()
        # Never follow a link out of the dedicated skill store, even if a local
        # administrator has accidentally pointed it at another runtime folder.
        for path in (self.root, *self.root.parents):
            if path.is_symlink():
                raise SkillError('linked_skill_store')
        self.root.mkdir(parents=True, exist_ok=True)
        # P2: an optional shared store, read here and written only by publish().
        # One agent's tested skill becomes usable by the others without any agent
        # being able to write into another's store: sharing is explicit, and reads
        # always prefer our own copy so a local fix is never shadowed.
        self.world_root = Path(world_root).absolute() if world_root else None
        if self.world_root == self.root:
            raise SkillError('shared_skill_store_must_be_distinct')
        if self.world_root is not None:
            for path in (self.world_root, *self.world_root.parents):
                if path.is_symlink():
                    raise SkillError('linked_skill_store')
            self.world_root.mkdir(parents=True, exist_ok=True)
        # One-time initialization/migration only. Normal catalog reads never
        # enumerate directories; all managed mutations maintain this manifest.
        for base in dict.fromkeys(p for p in (self.root, self.world_root) if p is not None):
            self._ensure_index(base)

    def _ensure_index(self, base):
        if not self._at(base, 'catalog.json').exists():
            with self._lock(base):
                if not self._at(base, 'catalog.json').exists():
                    self._rebuild_index(base)

    def _at(self, base, *parts):
        path = base
        for part in parts:
            path = path / part
            if path.is_symlink():
                raise SkillError('linked_skill_store')
        if not path.resolve().is_relative_to(Path(base).resolve()):
            raise SkillError('invalid_skill_path')
        return path

    def _path(self, *parts):
        return self._at(self.root, *parts)

    def _base_for(self, name):
        """Which store holds this skill: our own first, then the shared one."""
        _identifier(name, NAME, 'skill_name')
        if (self.root / name).exists():
            return self.root, False
        if self.world_root is not None and (self.world_root / name).exists():
            return self.world_root, True
        return self.root, False

    @contextmanager
    def _lock(self, base=None):
        with self._at(base or self.root, '.lock').open('a+b') as stream:
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

    def _head(self, name, base=None):
        _identifier(name, NAME, 'skill_name')
        base = base or self._base_for(name)[0]
        return self._load(self._at(base, name, 'head.json'),
                          {'schema': 1, 'name': name, 'draftVersion': None,
                           'activeVersion': None, 'promotions': []})

    def _record(self, name, version, base=None):
        _identifier(name, NAME, 'skill_name')
        _identifier(version, VERSION, 'skill_version')
        base = base or self._base_for(name)[0]
        record = self._load(self._at(base, name, 'versions', version + '.json'))
        if record.get('name') != name or _hash(record) != version:
            raise SkillError('skill_version_changed')
        return record

    def _index(self, base):
        index = self._load(self._at(base, 'catalog.json'))
        if (index.get('schema') != 1 or not isinstance(index.get('skills'), list)
                or len(index['skills']) > 64 or not isinstance(index.get('unavailable'), list)):
            raise SkillError('invalid_skill_catalog_index')
        names = set()
        for row in index['skills']:
            if not isinstance(row, dict):
                raise SkillError('invalid_skill_catalog_index')
            name = _identifier(row.get('name'), NAME, 'skill_name')
            if name in names or not isinstance(row.get('description'), str):
                raise SkillError('invalid_skill_catalog_index')
            names.add(name)
            for key in ('activeVersion', 'draftVersion'):
                if row.get(key) is not None:
                    _identifier(row[key], VERSION, 'skill_version')
        for row in index['unavailable']:
            if not isinstance(row, dict) or not isinstance(row.get('code'), str):
                raise SkillError('invalid_skill_catalog_index')
            name = _identifier(row.get('name'), NAME, 'skill_name')
            if name in names:
                raise SkillError('invalid_skill_catalog_index')
            names.add(name)
        return index

    @staticmethod
    def _index_row(head, record):
        return ({key: head[key] for key in ('name', 'draftVersion', 'activeVersion')}
                | {'description': record['description']}
                | ({'routing': record['routing']} if 'routing' in record else {}))

    def _rebuild_index(self, base):
        """Explicit migration/repair, called under the store lock, never per tick."""
        rows, unavailable = [], []
        for folder in sorted(base.iterdir()):
            if not NAME.fullmatch(folder.name):
                continue
            try:
                head = self._head(folder.name, base)
                version = head.get('activeVersion') or head.get('draftVersion')
                if version:
                    rows.append(self._index_row(head, self._record(folder.name, version, base)))
            except (SkillError, OSError, ValueError, TypeError, KeyError) as exc:
                unavailable.append({'name': folder.name, 'code': getattr(exc, 'code', 'invalid_skill_store')})
        self._write(self._at(base, 'catalog.json'), {'schema': 1, 'skills': rows, 'unavailable': unavailable})

    def rebuild_index(self):
        """Maintenance repair after restoring a store outside the managed API."""
        with self._lock():
            self._rebuild_index(self.root)
        return self.catalog()

    def _index_head(self, base, head):
        index = self._index(base)
        version = head.get('activeVersion') or head.get('draftVersion')
        row = self._index_row(head, self._record(head['name'], version, base))
        index['skills'] = sorted([r for r in index['skills'] if r['name'] != head['name']] + [row], key=lambda r: r['name'])
        index['unavailable'] = [r for r in index['unavailable'] if r.get('name') != head['name']]
        self._write(self._at(base, 'catalog.json'), index)

    def catalog(self):
        # Read one small manifest per store. Exact source/report/head checks
        # remain admission/execution work, never a recursive directory scan.
        rows, unavailable = [], []
        local = self._index(self.root)
        rows.extend(local['skills']); unavailable.extend(local['unavailable'])
        local_names = {r['name'] for r in rows} | {r.get('name') for r in unavailable}
        if self.world_root is not None and self.world_root != self.root:
            shared = self._index(self.world_root)
            rows.extend(r | {'shared': True} for r in shared['skills'] if r['name'] not in local_names)
            unavailable.extend(r | {'shared': True} for r in shared['unavailable'] if r.get('name') not in local_names)
        return {'skills': rows, 'unavailable': unavailable,
                'contract': 'next(state,memory) -> {action?,memory,done?,replan?,reason?,waitSeconds?,observe?,choose?}; '
                            'one action, wait, observation, choice or terminal result per step; '
                            'routing={intents:[keywords],maintenance:boolean} opts into catalog selection; '
                            'empty-memory preview must propose an applicable action',
                'actionTools': list(ACTION_TOOLS), 'observationTools': list(OBSERVATION_TOOLS),
                'waitSeconds': {'minimum': MIN_WAIT_SECONDS, 'maximum': MAX_WAIT_SECONDS},
                'engine': ENGINE_PACKAGE + '==' + ENGINE_VERSION}

    def read(self, name, version=None):
        with self._lock():
            head = self._head(name)
            version = version or head.get('draftVersion') or head.get('activeVersion')
            if not version:
                raise SkillError('skill_not_found')
            base, shared = self._base_for(name)
            record = self._record(name, version, base)
            return record | {'version': version, 'active': head.get('activeVersion') == version,
                             'shared': shared,
                             'promoted': any(row['version'] == version for row in head['promotions'])}

    def draft(self, name, source, fixtures, description='', routing=None):
        _identifier(name, NAME, 'skill_name')
        if not isinstance(source, str) or not source.strip() or len(source.encode('utf-8')) > MAX_SOURCE_BYTES:
            raise SkillError('invalid_skill_source')
        if not isinstance(description, str) or len(description) > 400:
            raise SkillError('invalid_skill_description')
        record = {'schema': 1, 'name': name, 'source': source, 'fixtures': _fixtures(fixtures),
                  'description': description}
        if routing is not None:
            from skill_router import validate_routing
            record['routing'] = validate_routing(routing)
            # Automatic admission needs both a usable initial state and a
            # refusal case. Test() still executes every assertion in the kernel.
            initial = [f for f in fixtures if not f.get('memory')]
            if (not any(f.get('expectedActionTool') in ACTION_TOOLS for f in initial)
                    or not any('expectedActionTool' in f and f['expectedActionTool'] is None
                               and f.get('replan') is True for f in initial)):
                raise SkillError('routing_positive_and_refusal_fixtures_required')
        version = _hash(record)
        with self._lock():
            if not self._path(name).exists() and len(self._index(self.root)['skills']) >= 64:
                raise SkillError('skill_catalog_full')
            # A local refinement starts its own history; do not inherit shared
            # promotion pointers whose source/report files are in another store.
            head = self._head(name, self.root)
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
            self._index_head(self.root, head)
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
                    passed = passed and ('expectedChoice' not in fixture
                                         or result.get('choose') == fixture['expectedChoice'])
                    cases.append({'index': index, 'passed': passed, 'actual': result})
                except SkillError as exc:
                    cases.append({'index': index, 'passed': False, 'error': str(exc),
                                  'generatedProgramLine': exc.line})
            report = {'schema': 1, 'name': name, 'version': version, 'passed': all(c['passed'] for c in cases),
                      'cases': cases, 'kernelVersion': _kernel_version(), 'engineVersion': ENGINE_VERSION,
                      'testedAt': time.time()}
            self._write(self._path(name, 'reports', version + '.json'), report)
            return report

    def _tested(self, name, version, base=None):
        base = base or self._base_for(name)[0]
        self._record(name, version, base)
        report = self._load(self._at(base, name, 'reports', version + '.json'))
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
            self._index_head(self.root, head)
            return {'name': name, 'version': version, 'activeVersion': version,
                    'previousVersion': previous, 'promoted': True}

    def publish(self, name, version=None):
        """Copy one of our promoted skills into the world store, explicitly.

        This is the only path that writes there, and it only ever copies a skill we
        already own: no agent can write into another's store, and nothing is shared
        until someone says so. Idempotent for a version already published.
        """
        if self.world_root is None:
            raise SkillError('shared_skill_store_unavailable')
        with self._lock(), self._lock(self.world_root):
            head = self._head(name)
            version = version or head.get('activeVersion')
            if not version or not any(row['version'] == version for row in head['promotions']):
                raise SkillError('promoted_skill_required')
            self._tested(name, version)
            record = self._record(name, version)
            target = self._at(self.world_root, name)
            head_path = self._at(self.world_root, name, 'head.json')
            # _load's `default=None` means "raise when missing", so absence has to
            # be tested here rather than passed in as a default.
            existing = self._load(head_path) if head_path.exists() else None
            if existing is None and len(self._index(self.world_root)['skills']) >= 64:
                raise SkillError('skill_catalog_full')
            if existing is not None and existing.get('activeVersion') == version:
                self._index_head(self.world_root, existing)
                return {'name': name, 'version': version, 'shared': True, 'published': False,
                        'reason': 'already_published'}
            self._write(self._at(self.world_root, name, 'versions', version + '.json'), record)
            self._write(self._at(self.world_root, name, 'reports', version + '.json'),
                        self._load(self._path(name, 'reports', version + '.json')))
            published = existing or {'schema': 1, 'name': name, 'draftVersion': None,
                                     'activeVersion': None, 'promotions': []}
            published['activeVersion'] = version
            if not any(row.get('version') == version for row in published.setdefault('promotions', [])):
                published['promotions'].append({'version': version, 'promotedAt': time.time(),
                                                'publishedBy': 'local'})
            self._write(self._at(self.world_root, name, 'head.json'), published)
            self._index_head(self.world_root, published)
            return {'name': name, 'version': version, 'shared': True, 'published': True,
                    'path': str(target)}

    def run(self, name, state, memory=None, version=None):
        with self._lock():
            base, shared = self._base_for(name)
            head = self._head(name, base)
            version = version or head.get('activeVersion')
            if not version or not any(row['version'] == version for row in head['promotions']):
                raise SkillError('promoted_skill_required')
            self._tested(name, version, base)
            record = self._record(name, version, base)
            result = evaluate(record['source'], state, memory)
            # ``shared`` tells the caller this body came from the world store, so a
            # skill another agent wrote can be used - and audited - here.
            return result | {'skill': {'name': name, 'version': version, 'shared': shared}}
