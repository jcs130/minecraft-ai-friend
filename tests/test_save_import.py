"""Focused migration tests: no live server, all fixtures below the project."""
import gzip
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import struct
import sys
import tempfile
import tomllib
import unittest
import zipfile

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'tools'))
import import_save as saves
import server_snapshot as snapshots


def nbt_string(value):
    value = value.encode('utf-8')
    return struct.pack('>H', len(value)) + value


def fixture_world(root):
    root.mkdir(parents=True)
    data = b'\x0a\x00\x00\x0a' + nbt_string('Data')
    data += b'\x03' + nbt_string('DataVersion') + struct.pack('>i', 3955)
    data += b'\x08' + nbt_string('LevelName') + nbt_string('original')
    data += b'\x00\x00'
    (root / 'level.dat').write_bytes(gzip.compress(data))
    for relative in ['region/r.0.0.mca', 'DIM-1/region/r.0.0.mca', 'DIM1/region/r.0.0.mca',
                     'dimensions/custom/dream/region/r.0.0.mca', 'playerdata/player.dat',
                     'advancements/player.json', 'stats/player.json', 'datapacks/pack/pack.mcmeta']:
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b'original-game-data')
    (root / 'session.lock').write_bytes(b'old')
    return root


def fixture_jar(path, mod_id='testmod', payload='first'):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, 'w') as jar:
        jar.writestr('META-INF/neoforge.mods.toml', f'modLoader="javafml"\nloaderVersion="[4,)"\nlicense="MIT"\n[[mods]]\nmodId="{mod_id}"\nversion="1.0"\n')
        jar.writestr('payload.txt', payload)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix='migration-test-', dir=PROJECT / 'tests'))

    def tearDown(self):
        # This resolved directory is a test-created child inside the project.
        self.assertTrue(self.temp.resolve().is_relative_to(PROJECT / 'tests'))
        shutil.rmtree(self.temp)

    def test_import_preserves_players_dimensions_and_datapacks(self):
        source = fixture_world(self.temp / 'source')
        report = saves.import_save(source, self.temp / 'saves', 'new-save', source_quiesced=True)
        target = Path(report['destination'])
        self.assertEqual((target / 'playerdata/player.dat').read_bytes(), b'original-game-data')
        self.assertTrue((target / 'dimensions/custom/dream/region/r.0.0.mca').is_file())
        self.assertTrue((target / 'datapacks/pack/pack.mcmeta').is_file())
        self.assertFalse((target / 'session.lock').exists())
        self.assertEqual(report['data_version'], 3955)
        self.assertIn('dimensions/custom/dream', report['dimensions'])
        self.assertTrue((source / 'session.lock').is_file())

    def test_existing_target_and_outside_project_are_rejected(self):
        source = fixture_world(self.temp / 'source')
        existing = self.temp / 'saves' / 'used'
        existing.mkdir(parents=True)
        with self.assertRaises(saves.MigrationError):
            saves.import_save(source, existing.parent, 'used', source_quiesced=True)
        with self.assertRaises(saves.MigrationError):
            saves.project_target(PROJECT.parent / 'outside')
        with self.assertRaises(saves.MigrationError):
            saves.import_save(source, self.temp / 'saves', '../escape', source_quiesced=True)
        with self.assertRaises(saves.MigrationError):
            saves.import_save(source, self.temp / 'saves', 'not-quiesced')

    def test_invalid_nbt_does_not_create_destination(self):
        source = self.temp / 'bad'
        source.mkdir()
        (source / 'level.dat').write_bytes(b'not gzip')
        with self.assertRaises((saves.MigrationError, OSError)):
            saves.import_save(source, self.temp / 'saves', 'bad', source_quiesced=True)
        self.assertFalse((self.temp / 'saves/bad').exists())

    def test_exact_duplicate_removed_but_different_mod_conflict_refused(self):
        mods = self.temp / 'mods'
        fixture_jar(mods / 'bettercombat-neoforge.jar', 'bettercombat')
        shutil.copyfile(mods / 'bettercombat-neoforge.jar', mods / 'bc232-rebuilt.jar')
        plan = saves.mod_plan(mods)
        self.assertEqual(len(plan['kept']), 1)
        self.assertEqual(plan['duplicates_removed'][0]['same_as'], 'bettercombat-neoforge.jar')
        fixture_jar(mods / 'other.jar', 'bettercombat', 'different')
        with self.assertRaises(saves.MigrationError):
            saves.mod_plan(mods)

    def test_json_toml_redactions_preserve_game_settings_and_hide_values(self):
        changes = []
        raw = b'{"provider":{"api_key":"production-test-secret","max_tokens":4000},"difficulty":3}'
        result = json.loads(saves.sanitized_text(raw, '.json', changes, 'safe.json'))
        self.assertEqual(result['provider']['api_key'], '')
        self.assertEqual(result['provider']['max_tokens'], 4000)
        self.assertNotIn('production-test-secret', json.dumps(changes))
        raw_toml = b'[maid]\napiKey="test-secret"\nmodel="example"\n[world]\nflight=true\n'
        result = tomllib.loads(saves.sanitized_text(raw_toml, '.toml', changes, 'maid.toml').decode())
        self.assertEqual(result['maid']['apiKey'], '')
        self.assertEqual(result['maid']['model'], 'example')
        self.assertTrue(result['world']['flight'])

    def test_jsonc_parser_preserves_url_and_comment_like_string(self):
        source = b'{\n// a comment\n"url":"https://example.invalid/a//b", "literal":"/*literal*/", "api_key":"redact-me", "items":[1,2,],\n}'
        changes = []
        result = json.loads(saves.sanitized_text(source, '.json', changes, 'mod.json'))
        self.assertEqual(result['url'], 'https://example.invalid/a//b')
        self.assertEqual(result['literal'], '/*literal*/')
        self.assertEqual(result['items'], [1, 2])
        self.assertEqual(result['api_key'], '')

    def test_toml_without_credentials_is_byte_identical(self):
        original = b'# keep comments and CRLF\r\n[database]\r\n    enabled = false\r\n[world]\r\n    distance = 6\r\n'
        self.assertEqual(saves.sanitized_text(original, '.toml', [], 'config.toml'), original)

    def test_toml_redaction_changes_only_secret_assignment(self):
        original = b'# existing format\r\n[database]\r\n  enabled = true\r\n  mysqlPassword = "fixture-key"  # retained comment\r\n[world]\r\n  distance = 6\r\n'
        expected = original.replace(b'"fixture-key"', b'""')
        actual = saves.sanitized_text(original, '.toml', [], 'grieflogger.toml')
        self.assertEqual(actual, expected)
        self.assertIn(b'[database]', actual)
        self.assertNotIn(b'"database" = {', actual)

    def test_sqlite_backup_includes_wal_and_removes_secrets(self):
        source = self.temp / 'world.db'
        writer = sqlite3.connect(source)
        try:
            writer.execute('PRAGMA journal_mode=WAL')
            writer.execute('CREATE TABLE state (id INTEGER PRIMARY KEY, api_key TEXT, data TEXT)')
            writer.execute('INSERT INTO state VALUES (1, ?, ?)', ('production-test-secret', '{"token":"nested-secret","mana":72}'))
            writer.commit()
            changes, records = [], []
            target = self.temp / 'copy/world.db'
            snapshots.sqlite_snapshot(source, target, changes, records)
            with closing(sqlite3.connect(target)) as check:
                row = check.execute('SELECT api_key,data FROM state').fetchone()
            self.assertEqual(row[0], '')
            self.assertEqual(json.loads(row[1]), {'token': '', 'mana': 72})
            self.assertFalse(b'production-test-secret' in target.read_bytes(), 'Credential bytes remain in the new database')
            self.assertEqual(writer.execute('SELECT api_key FROM state').fetchone()[0], 'production-test-secret')
        finally:
            writer.close()

    def test_snapshot_layout_port_isolation_and_separate_skill_states(self):
        source = self.temp / 'production'
        fixture_world(source / 'mc/shadow')
        fixture_jar(source / 'mc/mods/content.jar')
        (source / 'mc/config').mkdir()
        (source / 'mc/config/maid.json').write_text('{"api_key":"test-secret","enabled":true}', encoding='utf-8')
        (source / 'mc/server.properties').write_text('rcon.password=production-rcon\nserver-port=25565\nlevel-name=shadow\ndifficulty=hard\n', encoding='utf-8')
        for folder, count in [('data', 72), ('mcdata', 64)]:
            (source / folder).mkdir()
            (source / folder / 'magic-atoms.json').write_text(json.dumps({'atoms': list(range(count))}), encoding='utf-8')
            (source / folder / 'rcon-secret.txt').write_text('production-rcon', encoding='utf-8')
            (source / folder / 'spell-requests.jsonl').write_text('{"cast":"do-not-replay"}\n', encoding='utf-8')
            (source / folder / 'transmigrators').mkdir()
            (source / folder / 'transmigrators/person.persona.md').write_text('A preserved persona.', encoding='utf-8')
            (source / folder / 'transmigrators.json').write_text(json.dumps({'transmigrators':[{'personaFile':'transmigrators/person.persona.md'}]}), encoding='utf-8')
        report = snapshots.snapshot(source, self.temp / 'snapshot', source_quiesced=True, copy_runtime_cache=False)
        target = Path(report['destination'])
        self.assertEqual(report['skill_counts'], {'world-data': 72, 'mcdata': 64})
        self.assertNotIn('production-rcon', (target / 'mc/server.properties').read_text())
        self.assertIn('server-port=25599', (target / 'mc/server.properties').read_text())
        self.assertIn('enable-rcon=false', (target / 'mc/server.properties').read_text())
        self.assertFalse((target / 'world-data/rcon-secret.txt').exists())
        self.assertEqual((target / 'mcdata/spell-requests.jsonl').read_text(), '')
        self.assertFalse(report['cross_process_atomic'])
        self.assertFalse(report['runtime_load_verified'])
        self.assertTrue((target / 'snapshot-manifest.json').is_file())
        self.assertTrue((target / 'runtime-supplement-manifest.json').is_file())
        self.assertEqual((target / 'world-data/transmigrators/person.persona.md').read_text(), 'A preserved persona.')


if __name__ == '__main__':
    unittest.main()
