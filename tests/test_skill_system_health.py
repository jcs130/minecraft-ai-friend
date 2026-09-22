import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('skill_health', Path(__file__).resolve().parents[1]/'tools/skill_system_health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class SkillSystemHealthTest(unittest.TestCase):
    def test_evidence_is_bound_to_deployed_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            paths = ['server/mc/mods/botgate.jar', 'world/src/application/player-commands.ts',
                     'world/src/gameplay/commands/player-cli.ts', 'world/src/mc-magic.ts',
                     'config/skill-catalog.json', 'world/botgate-src/build-record.json',
                     'server/world-data/skill-catalog.json', 'server/mcdata/skill-catalog.json']
            for name in paths:
                p = root/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b'fixture')
            digest = hashlib.sha256(b'fixture').hexdigest()
            report = {'ok': True, 'sources': {name: digest for name in paths},
                      'isolatedQa': {'ok': True, 'candidateSha256': digest,
                                     'checks': [{'name': n} for n in health.CHECKS]},
                      'productionReadback': {'ok': True, 'checks': ['help-irons', 'help-tp', 'skills', 'spells-legacy']}}
            target = root/'reports/skill-system-review-smoke.json'; target.parent.mkdir()
            target.write_text(json.dumps(report), 'utf8')
            self.assertTrue(health.check(root)['ok'])
            (root/paths[0]).write_bytes(b'different build')
            result = health.check(root)
            self.assertFalse(result['ok'])
            self.assertFalse(result['checks']['isolated_native_behavior'])
            (root/paths[0]).write_bytes(b'fixture')
            report['isolatedQa']['checks'].pop()
            target.write_text(json.dumps(report), 'utf8')
            self.assertFalse(health.check(root)['ok'])
            target.unlink()
            self.assertFalse(health.check(root)['ok'])


if __name__ == '__main__':
    unittest.main()
