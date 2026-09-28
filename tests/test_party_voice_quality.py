"""Realistic outbound speech examples; no game or model calls."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from party_voice_quality import review_spoken_text


class PartyVoiceQualityTests(unittest.TestCase):
    def test_repeated_plan_with_changed_day_and_position_is_refused(self):
        old = ('爸爸，我们还在高空呢。我在(-526.5, 175.15, 866.5)。游戏时间Day 394上午。'
               '我们继续慢慢往下走，落地后去禾叔田吃蛋糕补满HP，然后等天黑一起巡逻找骷髅💚')
        new = ('爸爸，我们还在高空呢。我在(-518.49, 163.72, 874.30)。游戏时间Day 395清晨。'
               '我们继续慢慢往下走，落地后去禾叔田吃蛋糕补满HP，然后等天黑一起巡逻找骷髅💚')
        self.assertEqual(review_spoken_text(new, [old]), 'speech_repeats_recent_plan')

    def test_technical_status_report_is_refused_before_dispatch(self):
        text = ('爸爸，我在(-518.49, 163.72, 874.30)，游戏时间Day 395清晨。'
                '你的HP还没补满，我们要继续下山，稍后再等骷髅刷新。')
        self.assertEqual(review_spoken_text(text), 'speech_reads_game_status')

    def test_short_speech_and_needed_rescue_location_remain_available(self):
        self.assertIsNone(review_spoken_text('这边的路不稳，我先绕过去。'))
        self.assertIsNone(review_spoken_text('爸爸，我在(-518, 64, 874)的坑里被困了，快来帮我。'))
        self.assertIsNone(review_spoken_text('爸爸，我在(-518, 64, 874)被困了。我的HP只剩2，快来救我。'))

    def test_distinct_long_utterance_remains_available(self):
        text = '北边有一条窄路，刚才我亲眼看见它通到树林边。我们可以先到树旁停一下，再决定往哪走。'
        self.assertIsNone(review_spoken_text(text, ['我在南边采到小麦，放进自己背包了。']))


if __name__ == '__main__':
    unittest.main()
