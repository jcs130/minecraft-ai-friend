"""Tests for the maid body guardian (5-consecutive-miss rule, persistence flag, rate limit)."""
import json, sys, tempfile, time, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/sidecar'))
from maid_guardian import MaidGuardian, SCHEMA

BODY = 'e6ef6001-47c6-4f13-823c-1b724520d164'
OWNER = 'd4ac9523-4962-43ed-98c5-19b49e104048'


class FakeRcon:
    """Minimal RCON stand-in: records commands, answers from a scripted world state."""

    def __init__(self, present=True, persistence='1'):
        self.present = present
        self.persistence_flag = persistence
        self.commands = []

    def __call__(self, command):
        self.commands.append(command)
        if command.startswith('data get entity') and 'UUID' in command and command.endswith('UUID'):
            if self.present:
                return 'Kirito has the following entity data: [I; 1, 2, 3, 4]'
            raise RuntimeError('No entity was found')
        if 'PersistenceRequired' in command and command.startswith('data get entity'):
            if not self.present:
                raise RuntimeError('No entity was found')
            return 'Maid has the following entity data: %sb' % self.persistence_flag
        if 'PersistenceRequired set value' in command:
            self.persistence_flag = '1'
            return 'Modified entity data'
        if command.startswith('data get entity') and 'Pos' in command:
            return 'Kirito has the following entity data: [-640.5d, 63.0d, 1050.5d]'
        if command.startswith('summon '):
            self.present = True
            return 'Summoned new Maid'
        return 'ok'


class GuardianHarness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config_path = self.root / 'companion-guardian.json'
        self.state_path = self.root / 'state.json'
        self.backups = self.root / 'maid_backups'
        self.write_config()

    def write_config(self, **overrides):
        value = {'schema': SCHEMA, 'enabled': True, 'bodyUuid': BODY, 'ownerUuid': OWNER,
                 'bodyName': '结衣', 'missThreshold': 5, 'checkIntervalSeconds': 60,
                 'maxRestoresPerDay': 4, 'bodyNbt': 'UUID:[I;-1,-2,-3,-4],Owner:[I;5,6,7,8]'}
        value.update(overrides)
        self.config_path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')

    def guardian(self, rcon):
        return MaidGuardian(rcon, self.config_path, self.state_path, self.backups)


class PresenceTests(GuardianHarness):
    def test_present_body_resets_misses_and_reports(self):
        rcon = FakeRcon(present=True)
        state = self.state_path
        self.state_path.write_text(json.dumps({'schema': SCHEMA, 'misses': 3, 'restores': []}), encoding='utf-8')
        result = self.guardian(rcon).check_once()
        self.assertEqual(result['action'], 'present')
        saved = json.loads(self.state_path.read_text(encoding='utf-8'))
        self.assertEqual(saved['misses'], 0)

    def test_transient_miss_does_not_summon(self):
        """The heal_npcs R011 lesson: one miss is not a loss (unloaded chunk)."""
        rcon = FakeRcon(present=False)
        result = self.guardian(rcon).check_once()
        self.assertEqual(result['action'], 'miss-pending')
        self.assertEqual(result['misses'], 1)
        self.assertFalse(any(c.startswith('summon ') for c in rcon.commands))

    def test_four_consecutive_misses_still_do_not_summon(self):
        rcon = FakeRcon(present=False)
        guardian = self.guardian(rcon)
        for _ in range(4):
            result = guardian.check_once()
            self.assertEqual(result['action'], 'miss-pending')
        self.assertFalse(any(c.startswith('summon ') for c in rcon.commands))

    def test_fifth_consecutive_miss_summons_with_persistence(self):
        rcon = FakeRcon(present=False)
        guardian = self.guardian(rcon)
        for _ in range(4):
            guardian.check_once()
        result = guardian.check_once()
        self.assertEqual(result['action'], 'restored')
        summons = [c for c in rcon.commands if c.startswith('summon ')]
        self.assertEqual(len(summons), 1)
        # The 2026-09-17 root cause: without this flag the body is despawned again.
        self.assertIn('PersistenceRequired:1b', summons[0])
        self.assertIn('Invulnerable:1b', summons[0])
        self.assertIn('结衣', summons[0])

    def test_a_hit_between_misses_clears_the_counter(self):
        rcon = FakeRcon(present=False)
        guardian = self.guardian(rcon)
        for _ in range(4):
            guardian.check_once()
        rcon.present = True
        self.assertEqual(guardian.check_once()['action'], 'present')
        rcon.present = False
        self.assertEqual(guardian.check_once()['misses'], 1)

    def test_missing_persistence_on_a_live_body_is_repaired(self):
        rcon = FakeRcon(present=True, persistence='0')
        result = self.guardian(rcon).check_once()
        self.assertEqual(result['action'], 'present')
        self.assertTrue(result.get('persistenceRepaired'))
        self.assertTrue(any('PersistenceRequired set value 1b' in c for c in rcon.commands))


class SafetyTests(GuardianHarness):
    def test_disabled_config_is_a_noop(self):
        self.write_config(enabled=False)
        rcon = FakeRcon(present=False)
        result = self.guardian(rcon).check_once()
        self.assertEqual(result['action'], 'disabled')
        self.assertEqual(rcon.commands, [])

    def test_malformed_config_disables_instead_of_acting(self):
        self.config_path.write_text('{"schema": 99}', encoding='utf-8')
        rcon = FakeRcon(present=False)
        self.assertEqual(self.guardian(rcon).check_once()['action'], 'disabled')

    def test_oversized_config_is_refused(self):
        self.config_path.write_text('x' * 5000, encoding='utf-8')
        rcon = FakeRcon(present=False)
        self.assertEqual(self.guardian(rcon).check_once()['action'], 'disabled')

    def test_daily_rate_limit_stops_repeated_restores(self):
        guardian = self.guardian(FakeRcon(present=False))
        # Four restores already spent today.
        state = {'schema': SCHEMA, 'misses': 0, 'restores': [
            {'at': time.time() - 60 * i, 'verified': True} for i in range(4)]}
        self.state_path.write_text(json.dumps(state), encoding='utf-8')
        rcon = FakeRcon(present=False)
        guardian = self.guardian(rcon)
        for _ in range(5):
            result = guardian.check_once()
        self.assertEqual(result['action'], 'restore-limited')
        self.assertFalse(any(c.startswith('summon ') for c in rcon.commands))

    def test_no_anchor_means_no_blind_summon(self):
        self.write_config(fallbackPosition=None)
        rcon = FakeRcon(present=False)

        def failing_owner(command):
            rcon.commands.append(command)
            if command.startswith('data get entity') and 'Pos' in command:
                raise RuntimeError('No entity was found')
            return rcon(command)
        guardian = MaidGuardian(failing_owner, self.config_path, self.state_path, self.backups)
        for _ in range(5):
            result = guardian.check_once()
        self.assertEqual(result['action'], 'no_anchor')
        self.assertFalse(any(c.startswith('summon ') for c in rcon.commands))

    def test_receipt_records_the_backup_source(self):
        """TLM backup (MaidBackupIntervalSeconds=180) is the recovery source of record."""
        folder = self.backups / OWNER / BODY
        folder.mkdir(parents=True)
        (folder / '2026-09-17-12-52-33.dat').write_bytes(b'nbt')
        rcon = FakeRcon(present=False)
        guardian = self.guardian(rcon)
        for _ in range(5):
            result = guardian.check_once()
        self.assertEqual(result['action'], 'restored')
        self.assertIsNotNone(result['backupSource'])
        self.assertIn('2026-09-17-12-52-33.dat', result['backupSource']['path'])


if __name__ == '__main__':
    unittest.main()
