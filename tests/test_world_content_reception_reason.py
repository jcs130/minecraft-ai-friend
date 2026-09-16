"""Reception gate closure reasons are visible in the content context.

case content-reception-frozen-20260915: world_content_submit was rejected
with a bare receptionReady=false for >=18h and no operator could tell a
fault from a deliberate closure. These tests pin make_context's read-only
'reception' block (ready/reason/receptionist plus the diagnostic extra
keys) through real tick() -> context.json -> ContentQueue.context() round
trips; they never change the gate itself — receptionReady stays the single
authority validate_episode reads, and the closed-gate submit error stays
content_reception_unavailable.
"""
from contextlib import nullcontext
from datetime import date
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
import world_content as content

DAY = date(2026, 9, 9)


class ReceptionReasonTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.village, self.team = self.root/'village', self.root/'team'
        self.village.mkdir()
        profiles = []
        for no, (key, profession) in enumerate((('hesu','farmer'), ('jingshui','cleric'),
                                                ('zhujiu','toolsmith'), ('guild_lan','cartographer')), 1):
            profiles.append({'key':key,'display':key,'profession':profession,
                'entityBinding':{'uuid':f'00000000-0000-4000-8000-{no:012d}',
                    'entityType':'minecraft:villager','dimension':'minecraft:overworld',
                    'preservePosition':True,'lastKnownPosition':[0,64,0]}})
        self.npc = SimpleNamespace(PROFILES=profiles, VDIR=str(self.village), alive_pos=lambda p:[0,64,0],
            quests_path=lambda d:str(self.village/f'quests-{d}.json'), QUESTS={})
        self.guild = SimpleNamespace(PLAZA=(0,64,0),state_lock=nullcontext,
            guild_path=lambda d:str(self.village/f'guild-{d}.json'),BOARD={})
        content.save(Path(self.guild.guild_path(DAY.isoformat())), {'date':DAY.isoformat(),'board':[]})
        content.save(Path(self.npc.quests_path(DAY.isoformat())), {'date':DAY.isoformat(),'quests':[]})
        self.queue = content.ContentQueue(self.team, clock=lambda:1000)
        self.tick()

    def tick(self):
        return content.tick(self.npc, self.guild, state=self.team, today=DAY, clock=lambda:1000)

    def test_open_gate_reports_receptionist_and_position(self):
        context = self.queue.context()
        self.assertTrue(context['receptionReady'])
        self.assertEqual(context['reception'], {'ready':True, 'reason':None,
            'receptionist':'guild_lan', 'position':[0,64,0]})

    def test_invalid_position_names_the_observed_shape(self):
        self.npc.alive_pos = lambda p: None if p['key']=='guild_lan' else [0,64,0]
        self.tick()
        context = self.queue.context()
        self.assertFalse(context['receptionReady'])
        self.assertEqual(context['reception']['reason'], 'receptionist_position_invalid')
        self.assertEqual(context['reception']['receptionist'], 'guild_lan')
        self.assertEqual(context['reception']['observedPositionType'], 'NoneType')

    def test_lookup_failure_names_the_exception_class(self):
        def broken(p):
            raise RuntimeError('entity data query failed')
        self.npc.alive_pos = broken
        self.tick()
        context = self.queue.context()
        self.assertFalse(context['receptionReady'])
        self.assertEqual(context['reception']['reason'], 'receptionist_position_unavailable')
        self.assertEqual(context['reception']['errorType'], 'RuntimeError')

    def test_missing_receptionist_reports_roster_gap(self):
        self.npc.PROFILES = [p for p in self.npc.PROFILES if p['key'] != 'guild_lan']
        self.tick()
        context = self.queue.context()
        self.assertFalse(context['receptionReady'])
        self.assertEqual(context['reception'], {'ready':False, 'reason':'receptionist_missing',
                                                'receptionist':None})


if __name__ == '__main__':
    unittest.main()
