"""The party voice update is additive and never changes identity or models."""
import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
from party_voice_style import deploy, managed_text, START, END


class PartyVoiceStyleTests(unittest.TestCase):
    def test_managed_speaker_rules_keep_persona_and_are_idempotent(self):
        for role, name in [('qd-survivor', '桐人'), ('5swvhK', '结衣')]:
            with self.subTest(role=role):
                original = '# ' + name + '\n原有安全规则。\n'
                updated = managed_text(original, role)
                self.assertTrue(updated.startswith(original))
                self.assertEqual(managed_text(updated, role), updated)
                self.assertEqual(updated.count(START), 1)
                self.assertEqual(updated.count(END), 1)
                self.assertIn('skills/say-it-plain/SKILL.md', updated)
                self.assertIn(name, updated)

    def test_corrupt_managed_block_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'party_voice_block_invalid'):
            managed_text(START + '\nunfinished', 'qd-survivor')

    def test_preview_reads_both_exact_roles_without_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            skill = root / 'SKILL.md'
            skill.write_text('---\nname: say-it-plain\ndescription: plain\n---\n', encoding='utf-8')
            for role in ('qd-survivor', '5swvhK'):
                folder = root / 'workspaces' / role
                folder.mkdir(parents=True)
                (folder / 'agent.json').write_text(json.dumps({'id': role, 'active_model': 'preserve'}), encoding='utf-8')
                (folder / 'AGENTS.md').write_text('原规则\n', encoding='utf-8')
                (folder / 'skill.json').write_text(json.dumps({'skills': {}}), encoding='utf-8')
            result = deploy(root / 'workspaces', skill)
            self.assertFalse(result['applied'])
            self.assertEqual([row['role'] for row in result['roles']], ['qd-survivor', '5swvhK'])
            for role in ('qd-survivor', '5swvhK'):
                self.assertEqual((root / 'workspaces' / role / 'AGENTS.md').read_text(encoding='utf-8'), '原规则\n')
                self.assertEqual(json.loads((root / 'workspaces' / role / 'agent.json').read_text())['active_model'], 'preserve')


if __name__ == '__main__':
    unittest.main()
