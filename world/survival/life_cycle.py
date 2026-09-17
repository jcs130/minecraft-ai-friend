"""One life per conversation: a death closes with a written record, then a new one.

Creator's directive (2026-09-17): every death should summarise what was learned and
then open a new session. Two things follow from that, and they are deliberately
not the same thing:

* The **record** is deterministic and written by this module: what killed the body,
  where, what the last actions were, and what the world had been saying (the
  environment-penalty signals). Facts, not narration.
* The **reflection** stays the agent's own. The new session's first turn carries
  the record, so the summary is written by the one who died, resting on evidence
  instead of on recollection.

Rotating the session keeps the next life's context clean without discarding
memory: the conversation identity changes, the durable memory files do not.
"""
import json
import time
import uuid
from pathlib import Path

SCHEMA = 1
DEATHS_DIR = 'deaths'
LIFE_LOG = 'life-log.jsonl'
LIFE_STATE = 'life-cycle.json'
CHECK_INTERVAL_SECONDS = 60
RECENT_ACTIONS = 8
def _read(path, default=None):
    try:
        value = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return default
    return value


def _tail_jsonl(path, limit):
    try:
        lines = Path(path).read_text(encoding='utf-8', errors='replace').strip().splitlines()
    except OSError:
        return []
    rows = []
    for line in lines[-limit:]:
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            rows.append(value)
    return rows


def _receipts(state_dir, limit=RECENT_ACTIONS):
    """The newest receipts, oldest first: the tail of the life that ended."""
    directory = Path(state_dir) / 'action-receipts'
    try:
        files = sorted(directory.glob('*.json'), key=lambda p: p.stat().st_mtime)[-limit:]
    except OSError:
        return []
    rows = []
    for path in files:
        value = _read(path)
        if isinstance(value, dict):
            rows.append(value)
    return rows


def _inner_message(receipt):
    result = receipt.get('result') if isinstance(receipt.get('result'), dict) else {}
    inner = result.get('result') if isinstance(result.get('result'), dict) else {}
    message = inner.get('message')
    return message[:200] if isinstance(message, str) else ''


def environment_evidence(state_dir):
    """What the world had been saying, over the receipts already on disk.

    Reuses the penalty detector rather than inventing a second reading of the
    same data, so the death record and the live triggers cannot disagree.
    """
    try:
        import environment_penalty
        records = environment_penalty.parse(Path(state_dir) / 'action-receipts')
        return environment_penalty.detect(records)
    except Exception:
        return []


def collect(state_dir, reason, now=None, body=None):
    """Deterministic facts about the life that just ended."""
    state_dir = Path(state_dir)
    now = time.time() if now is None else now
    settings = _read(state_dir / 'settings.json', {}) or {}
    controller = _read(state_dir / 'controller.json', {}) or {}
    reconnect = _read(state_dir / 'body-reconnect.json', {}) or {}
    session = _read(state_dir / 'life-session.json', {}) or {}
    receipts = _receipts(state_dir)

    last_position = None
    hp_series = []
    for receipt in receipts:
        after = receipt.get('after') if isinstance(receipt.get('after'), dict) else {}
        before = receipt.get('before') if isinstance(receipt.get('before'), dict) else {}
        if isinstance(after.get('position'), dict):
            last_position = after['position']
        for side in (before, after):
            hp = side.get('hp')
            if type(hp) in (int, float):
                hp_series.append(hp)
    if body is not None and isinstance(body.get('position'), dict):
        last_position = body['position']

    return {
        'schema': SCHEMA,
        'id': uuid.uuid4().hex,
        'at': int(now * 1000),
        'reason': reason,
        'bodyName': settings.get('bodyName'),
        'bodyUuid': settings.get('bodyUuid'),
        'ownerUuid': settings.get('ownerUuid'),
        'sessionId': session.get('primarySessionId'),
        'lastPosition': last_position,
        'healthLowest': min(hp_series) if hp_series else None,
        'healthLast': hp_series[-1] if hp_series else None,
        'turnId': (controller.get('lastDecision') or {}).get('turnId'),
        'decisions': len(controller.get('decisions') or []),
        'restoreAttempts': len(reconnect.get('attempts') or []),
        'lastActions': [{'tool': r.get('tool'),
                         'args': r.get('args') if isinstance(r.get('args'), dict) else {},
                         'code': ((r.get('result') or {}) if isinstance(r.get('result'), dict) else {}).get('code'),
                         'message': _inner_message(r)} for r in receipts],
        'environment': environment_evidence(state_dir),
    }


def record(state_dir, facts):
    """Archive one death immutably and append the life log."""
    state_dir = Path(state_dir)
    directory = state_dir / DEATHS_DIR
    directory.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(facts, ensure_ascii=False, sort_keys=True) + '\n'
    path = directory / ('%d-%s.json' % (facts['at'], facts['id']))
    if not path.exists():
        path.write_text(raw, encoding='utf-8')
    with (state_dir / LIFE_LOG).open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'id': facts['id'], 'at': facts['at'], 'reason': facts['reason'],
                                 'sessionId': facts.get('sessionId'),
                                 'lastPosition': facts.get('lastPosition'),
                                 'healthLowest': facts.get('healthLowest'),
                                 'environment': [s.get('kind') for s in facts.get('environment') or []]},
                                ensure_ascii=False, sort_keys=True) + '\n')
    return path


def note(facts):
    """The compact, agent-facing death note carried into the new session."""
    where = facts.get('lastPosition') or {}
    position = '(%s, %s, %s)' % (where.get('x'), where.get('y'), where.get('z')) if where else '未知'
    said = []
    for signal in facts.get('environment') or []:
        if signal.get('kind') == 'damage':
            said.append('掉血 %s 点（最低 %s）' % (signal.get('total'), signal.get('lowest')))
        elif signal.get('kind') == 'repeated_rejection':
            said.append('%s 被同一原因挡了 %s 次' % (signal.get('tool'), signal.get('repeats')))
        elif signal.get('kind') == 'no_output':
            said.append('约 %d 分钟没有任何产出' % (int(signal.get('span', 0)) // 60))
    last = (facts.get('lastActions') or [])[-3:]
    tail = '；'.join('%s【%s】' % (a.get('tool'), a.get('code')) for a in last) or '无'
    return ('【上一世 · 死亡记录】你死了：%s。死在 %s，血最低 %s。'
            '临死前的动作：%s。这一世结束前，环境一直在说：%s。'
            '先把这些写进你自己的教训里（哪些地方危险、哪些做法不奏效），再开始新的一世。'
            % (facts.get('reason'), position, facts.get('healthLowest'), tail,
               '；'.join(said) if said else '没有明显信号'))


def rotate_session(state_dir, settings, death, now=None):
    """Open a new conversation for the next life, keeping the durable binding.

    The previous identity is preserved in the record, not reused: a new life gets
    a clean context, while memory files and the archive stay where they are.
    """
    state_dir = Path(state_dir)
    now = time.time() if now is None else now
    path = state_dir / 'life-session.json'
    session = _read(path, {}) or {}
    previous = session.get('primarySessionId')
    session.update(schema=1, agentId='qd-survivor', bodyUuid=settings.get('bodyUuid'),
                   userId='survival-controller', channel='console',
                   primarySessionId='life-' + uuid.uuid4().hex, chatId=None,
                   previousSessionId=previous, lifeStartedAt=int(now * 1000),
                   freshFromDeath=death.get('id'))
    path.write_text(json.dumps(session, ensure_ascii=False) + '\n', encoding='utf-8')
    return session


def latest_death(state_dir):
    """The newest archived death, or None."""
    directory = Path(state_dir) / DEATHS_DIR
    try:
        files = sorted(directory.glob('*.json'), key=lambda p: p.stat().st_mtime)
    except OSError:
        return None
    if not files:
        return None
    return _read(files[-1])


def pending_note(session, state_dir):
    """The note for the first turn of a life that began with a death. One-shot."""
    death_id = (session or {}).get('freshFromDeath')
    if not death_id:
        return None
    death = latest_death(state_dir)
    if not isinstance(death, dict) or death.get('id') != death_id:
        return None
    return note(death)


def consume(session):
    """Clear the pending note once the new life has taken its first turn."""
    if isinstance(session, dict) and session.pop('freshFromDeath', None) is not None:
        return True
    return False


def parse_roster_deaths(raw, body_name=None):
    """Deaths as the body's own roster reports them.

    The mod keeps the authoritative death state (CompanionRegistry.diedAt plus
    CompanionRoster.respawnInMs) on the server, and the roster line is the
    body-side way to say it. Keys are read tolerantly: a roster line that does
    not carry them means "no death reported", never "no death happened".

    Returns a list of {'name', 'uuid', 'cause', 'respawnMs'}.
    """
    if not isinstance(raw, str):
        return []
    out = []
    for line in raw.strip().splitlines()[1:]:
        fields = line.split('|')
        if len(fields) < 2:
            continue
        values = {}
        for part in fields[1:]:
            if '=' in part:
                key, _, value = part.partition('=')
                values[key.strip()] = value.strip()
        name = fields[0].strip()
        if body_name and name != body_name:
            continue
        respawn = values.get('respawnMs') or values.get('respawn')
        dead = values.get('dead') in ('1', 'true', 'yes') or (respawn not in (None, '', '-1'))
        if not dead:
            continue
        try:
            respawn_ms = int(respawn) if respawn not in (None, '') else 0
        except ValueError:
            respawn_ms = 0
        out.append({'name': name, 'uuid': values.get('uuid'), 'cause': values.get('cause'),
                    'respawnMs': respawn_ms, 'diedAt': values.get('diedAt')})
    return out


def check(state_dir, read_roster, now=None, body_name=None):
    """Detect a death from the body's own roster.

    ``read_roster`` is the transport (a callable returning the raw native roster
    reply), keeping this testable and keeping the survivor off the server
    administration surface: a life boundary is the body's business to report, not
    something to be inferred from the server's own bookkeeping.
    """
    state_dir = Path(state_dir)
    now = time.time() if now is None else now
    path = state_dir / LIFE_STATE
    state = _read(path, {}) or {}
    # A death can only be observed while the body is gone, and the roster read is
    # an RCON round trip: throttle it instead of paying one per tick.
    if now < state.get('nextCheckAt', 0):
        return None
    state['nextCheckAt'] = now + CHECK_INTERVAL_SECONDS
    try:
        deaths = parse_roster_deaths(read_roster(), body_name)
    except Exception:
        return None
    state.update(schema=SCHEMA, checkedAt=int(now * 1000))
    fresh = None
    # The roster reports the state, not the transition, so one death is recorded
    # once: the death's own identity is its name plus the respawn window it was
    # first seen with.
    for death in deaths:
        # One death is recorded once. The registry stamps each death with the tick it
        # happened on, so two deaths of the same body are two different records even
        # when no respawn window is reported.
        stamp = death.get('diedAt') or death.get('respawnMs')
        identity = '%s:%s' % (death['name'], stamp)
        if state.get('lastDeathKey') == identity:
            continue
        state['lastDeathKey'] = identity
        facts = collect(state_dir, 'roster death%s%s' % (
            ' by ' + str(death['cause']) if death.get('cause') else '',
            ' (respawn in %dms)' % death['respawnMs']), now=now)
        record(state_dir, facts)
        state['pendingDeathId'] = facts['id']
        state['lastDeathAt'] = facts['at']
        fresh = facts
    path.write_text(json.dumps(state, ensure_ascii=False) + '\n', encoding='utf-8')
    return fresh


def take_rotation(state_dir, settings, now=None):
    """Open the next life's session once, for the death that was detected.

    Called only when the body is back, so a new conversation never starts while
    the previous life's body is still missing.
    """
    state_dir = Path(state_dir)
    now = time.time() if now is None else now
    path = state_dir / LIFE_STATE
    state = _read(path, {}) or {}
    death_id = state.get('pendingDeathId')
    if not death_id:
        return None
    death = latest_death(state_dir)
    if not isinstance(death, dict) or death.get('id') != death_id:
        return None
    session = _read(state_dir / 'life-session.json', {}) or {}
    if session.get('freshFromDeath') == death_id:
        return None  # this death already opened its session
    rotated = rotate_session(state_dir, settings, death, now=now)
    state.pop('pendingDeathId', None)
    state['lastRotatedDeathId'] = death_id
    path.write_text(json.dumps(state, ensure_ascii=False) + '\n', encoding='utf-8')
    return rotated
