"""Maid body guardian — keep the authorized companion body present in the world.

Two precedents shaped this design:

* ``body_reconnect.py`` (survivor sidecar) restores a missing numen fake-player
  body with the full saved identity and verifies by re-query.
* ``heal_npcs`` in ``mc_npc.py`` learned the harder lesson: a single query miss
  is NOT a loss. An entity can sit in an unloaded chunk and reappear by itself,
  so the naive "miss -> re-summon" loop produced 259 duplicate villagers in two
  hours (R011, 2026-09-01). It now requires five consecutive misses and resets
  the counter on any hit.

Root cause this guardian exists for (2026-09-17): the restored maid lacked the
vanilla ``PersistenceRequired`` flag, so the server despawned her once her chunk
had been unloaded for a while — while every other maid (which had the flag)
survived. Re-summoning therefore always writes the persistence flag; otherwise
each recovery would be undone again.

The guardian never moves, teleports, retames or mutates a live body. It only
observes and, after the miss threshold, recreates the authorized body.
"""
import json
import re
import time
from pathlib import Path

SCHEMA = 1
MAX_CONFIG_BYTES = 4096
DEFAULT_INTERVAL = 60
DEFAULT_MISS_THRESHOLD = 5
DEFAULT_MAX_RESTORES_PER_DAY = 4
DAY_SECONDS = 86400


class MaidGuardian:
    """Observes the authorized maid body and re-summons it after confirmed loss."""

    def __init__(self, cmd, config_path, state_path, backup_root=None, clock=time.time):
        self.cmd = cmd
        self.config_path = Path(config_path)
        self.state_path = Path(state_path)
        self.backup_root = Path(backup_root) if backup_root else None
        self.clock = clock

    # ---- config / state ----

    def config(self):
        """Read the bounded guardian config. A malformed file disables the guardian."""
        try:
            path = self.config_path
            if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
                return {'enabled': False}
            if not path.exists() or not path.is_file() or path.stat().st_size > MAX_CONFIG_BYTES:
                return {'enabled': False}
            value = json.loads(path.read_text(encoding='utf-8-sig'))
        except (OSError, ValueError):
            return {'enabled': False}
        if not isinstance(value, dict) or value.get('schema') != SCHEMA:
            return {'enabled': False}
        return value

    def state(self):
        try:
            value = json.loads(self.state_path.read_text(encoding='utf-8-sig'))
            if isinstance(value, dict) and value.get('schema') == SCHEMA:
                return value
        except (OSError, ValueError):
            pass
        return {'schema': SCHEMA, 'misses': 0, 'restores': [], 'lastSeenAt': None, 'lastResult': None}

    def _save(self, state):
        state['schema'] = SCHEMA
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(self.state_path)

    # ---- observation ----

    def present(self, body_uuid):
        """True when the body is visible to a direct entity query (loaded chunk)."""
        try:
            answer = self.cmd('data get entity %s UUID' % body_uuid)
        except Exception:
            return False
        return 'UUID' in str(answer) or 'has the following' in str(answer)

    def persistence(self, body_uuid):
        """Current persistence flag: '1' set, '0' missing, None unknown.

        Vanilla answers a scalar path with the bare value
        (``<name> has the following entity data: 0b``); the field name is not
        echoed, so match the value rather than a ``field: value`` pair.
        """
        try:
            answer = str(self.cmd('data get entity %s PersistenceRequired' % body_uuid))
        except Exception:
            return None
        match = re.search(r'entity data:\s*([01])b', answer)
        if match:
            return match.group(1)
        if 'PersistenceRequired: 1b' in answer:
            return '1'
        if 'PersistenceRequired: 0b' in answer:
            return '0'
        return None

    def backup_source(self, owner_uuid, body_uuid):
        """Newest TLM maid-backup file for this pair, if the backup mechanism is on."""
        if not self.backup_root:
            return None
        folder = self.backup_root / owner_uuid / body_uuid
        try:
            files = sorted(folder.glob('*.dat'), key=lambda p: p.stat().st_mtime)
        except OSError:
            return None
        if not files:
            return None
        newest = files[-1]
        return {'path': str(newest), 'bytes': newest.stat().st_size,
                'ageSeconds': int(self.clock() - newest.stat().st_mtime)}

    def owner_position(self, owner_uuid):
        try:
            answer = str(self.cmd('data get entity %s Pos' % owner_uuid))
        except Exception:
            return None
        import re
        match = re.search(r'\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]', answer)
        if not match:
            return None
        return [float(match.group(i)) for i in (1, 2, 3)]

    # ---- actions ----

    def summon_command(self, config, position):
        """Full authorized identity, always including the persistence flag.

        The flag is the whole point: without it the server despawns the body once
        its chunk stays unloaded (the 2026-09-17 root cause).
        """
        name = str(config.get('bodyName', 'companion'))
        return ('summon touhou_little_maid:maid %d %d %d {%s,CustomName:\'{"text":"%s"}\','
                'Invulnerable:1b,PersistenceRequired:1b}'
                % (int(position[0]), int(position[1]), int(position[2]),
                   config.get('bodyNbt', ''), name))

    def restores_today(self, state, now):
        day_start = now - DAY_SECONDS
        return [r for r in state.get('restores', []) if r.get('at', 0) >= day_start]

    # ---- main entry ----

    def check_once(self, owner_position_hint=None):
        """One observation cycle. Returns a receipt dict describing what happened."""
        now = self.clock()
        config = self.config()
        state = self.state()
        receipt = {'at': now, 'action': None}

        if not config.get('enabled'):
            state['lastResult'] = 'disabled'
            self._save(state)
            return dict(receipt, action='disabled')

        body_uuid = config.get('bodyUuid')
        owner_uuid = config.get('ownerUuid')
        if not body_uuid or not owner_uuid:
            state['lastResult'] = 'invalid_config'
            self._save(state)
            return dict(receipt, action='invalid_config')

        threshold = int(config.get('missThreshold', DEFAULT_MISS_THRESHOLD))

        if self.present(body_uuid):
            state['misses'] = 0
            state['lastSeenAt'] = now
            # A loaded body must carry the persistence flag, otherwise the next
            # chunk unload despawns it again. Enforce defensively here too.
            if self.persistence(body_uuid) == '0':
                self.cmd('data modify entity %s PersistenceRequired set value 1b' % body_uuid)
                receipt['persistenceRepaired'] = True
            state['lastResult'] = 'present'
            self._save(state)
            return dict(receipt, action='present')

        state['misses'] = int(state.get('misses', 0)) + 1
        misses = state['misses']
        receipt['misses'] = misses
        if misses < threshold:
            # Transient miss: the body may simply sit in an unloaded chunk and
            # come back on its own (heal_npcs R011 lesson).
            state['lastResult'] = 'miss-pending'
            self._save(state)
            return dict(receipt, action='miss-pending', threshold=threshold)

        today = self.restores_today(state, now)
        limit = int(config.get('maxRestoresPerDay', DEFAULT_MAX_RESTORES_PER_DAY))
        if len(today) >= limit:
            state['lastResult'] = 'restore-limited'
            self._save(state)
            return dict(receipt, action='restore-limited', restoresToday=len(today), limit=limit)

        position = owner_position_hint or self.owner_position(owner_uuid) or config.get('fallbackPosition')
        if not position:
            state['lastResult'] = 'no_anchor'
            self._save(state)
            return dict(receipt, action='no_anchor')

        source = self.backup_source(owner_uuid, body_uuid)
        try:
            self.cmd(self.summon_command(config, position))
        except Exception as error:
            state['lastResult'] = 'summon-failed'
            self._save(state)
            return dict(receipt, action='summon-failed', error=type(error).__name__)

        restored = self.present(body_uuid)
        state['misses'] = 0
        state['restores'] = (state.get('restores') or [])[-15:] + [{
            'at': now, 'misses': misses, 'position': [round(v, 1) for v in position],
            'verified': restored, 'backupSource': source}]
        state['lastResult'] = 'restored' if restored else 'summon-unverified'
        self._save(state)
        return dict(receipt, action='restored' if restored else 'summon-unverified',
                    position=[round(v, 1) for v in position], backupSource=source)


def loop(guardian, interval=None, stop=None):
    """Blocking observation loop for the npc sidecar thread supervisor."""
    while stop is None or not stop():
        receipt = guardian.check_once()
        if receipt.get('action') not in ('disabled', 'present', 'miss-pending'):
            print('[maid-guardian]', json.dumps(receipt, ensure_ascii=False), flush=True)
        wait = interval or int(guardian.config().get('checkIntervalSeconds', DEFAULT_INTERVAL))
        time.sleep(max(15, int(wait)))
