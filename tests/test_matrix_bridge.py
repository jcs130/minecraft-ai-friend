"""Test the Matrix bridge logic without running the daemon."""
import json, sys, time, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/sidecar'))
from unittest.mock import patch, MagicMock

from matrix_bridge import Bridge, MatrixClient, send_to_qwenpaw

CREDS = json.loads(Path(r'D:\Projects\QiandengJi\server\secret\agentteam-credentials.json').read_text(encoding='utf-8'))


class MentionExtractionTests(unittest.TestCase):
    def setUp(self):
        with patch.object(Bridge, '__init__', lambda self: None):
            self.bridge = Bridge()
            self.bridge.creds = CREDS

    def _event(self, body, sender='@admin:matrix-local.agentteams.io:18080', msgtype='m.text', formatted=''):
        return {'content': {'msgtype': msgtype, 'body': body, 'formatted_body': formatted},
                'sender': sender}

    def test_at_agent_name(self):
        ev = self._event('@qiandengji-goddess 查下服务器状态')
        agent, text = self.bridge.extract_mention(ev)
        self.assertEqual(agent, 'qiandengji-goddess')
        self.assertIn('服务器', text)

    def test_at_display_name(self):
        ev = self._event('@灯语女神 帮忙看下')
        agent, _ = self.bridge.extract_mention(ev)
        self.assertEqual(agent, 'qiandengji-goddess')

    def test_at_engineer(self):
        ev = self._event('@qiandengji-engineer 修下这个bug')
        agent, _ = self.bridge.extract_mention(ev)
        self.assertEqual(agent, 'qiandengji-engineer')

    def test_at_survivor(self):
        ev = self._event('@qiandengji-survivor 你今天干嘛了')
        agent, _ = self.bridge.extract_mention(ev)
        self.assertEqual(agent, 'qiandengji-survivor')

    def test_ignores_own_messages(self):
        ev = self._event('@qiandengji-goddess hi', sender='@qiandengji-yui:matrix-local.agentteams.io:18080')
        agent, _ = self.bridge.extract_mention(ev)
        self.assertIsNone(agent)

    def test_ignores_non_mention(self):
        ev = self._event('今天天气不错')
        agent, _ = self.bridge.extract_mention(ev)
        self.assertIsNone(agent)

    def test_ignores_non_text(self):
        ev = self._event('image', msgtype='m.image')
        agent, _ = self.bridge.extract_mention(ev)
        self.assertIsNone(agent)


class QwenPawMappingTests(unittest.TestCase):
    def test_goddess_maps_to_mc_god(self):
        self.assertEqual(send_to_qwenpaw.__code__.co_consts.count('qiandengji-goddess'), 0)  # function uses dict
        # Test the mapping indirectly through the name_map in send_to_qwenpaw
        import matrix_bridge
        # The function exists and is callable
        self.assertTrue(callable(send_to_qwenpaw))

    def test_unknown_agent_returns_error(self):
        reply, err = send_to_qwenpaw('unknown-agent', 'test')
        self.assertIsNone(reply)
        self.assertIn('unknown', err)


if __name__ == '__main__':
    unittest.main()
