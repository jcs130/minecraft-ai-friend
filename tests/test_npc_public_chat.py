import ast
import copy
import json
from pathlib import Path
import re
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'world/sidecar'))
from npc_public_chat import PublicNpcChat, profile_revision, central_public_line


class PublicChatTests(unittest.TestCase):
    def setUp(self):
        t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup)
        self.path=Path(t.name)/'receipt.sqlite3';self.now=1000
        self.router=PublicNpcChat(self.path,clock=lambda:self.now)
        self.v={'key':'hesu','tag':'npc_hesu','display':'老农·禾叔','calls':['禾叔'],'profession':'farmer'}
        self.npc=SimpleNamespace(PROFILES=[self.v],HEAR_RADIUS=48,alive_pos=Mock(return_value=[0,64,0]),
            sel=lambda v:'@e[tag=npc_hesu,limit=1]',R=SimpleNamespace(cmd=Mock(return_value='Test passed, count: 1')),
            route=Mock(return_value=(self.v,['hello'])),speak=Mock(),feed_append=Mock())
    def row(self,**changes):
        return dict(schema=1,via='public-routed',eventId=str(uuid.uuid4()),createdAt=self.now*1000,
            speaker='TestPlayer',text='禾叔，你好',npcKey='hesu',profileRevision=profile_revision(self.v))|changes
    def test_success_selects_exact_profile_keeps_public_semantics_and_deduplicates_after_restart(self):
        row=self.row();self.assertEqual(self.router.consume(self.npc,row),'submitted')
        self.npc.route.assert_called_once_with('TestPlayer','禾叔，你好',via='public',target_key='hesu')
        self.assertIn('distance=..48',self.npc.R.cmd.call_args.args[0])
        router=PublicNpcChat(self.path,clock=lambda:self.now)
        self.assertEqual(router.consume(self.npc,row),'rejected_or_duplicate');self.assertEqual(self.npc.speak.call_count,1)
    def test_unknown_partial_send_never_replayed(self):
        self.npc.speak.side_effect=OSError('uncertain');row=self.row()
        self.assertEqual(self.router.consume(self.npc,row),'unknown')
        self.router.consume(self.npc,row);self.assertEqual(self.npc.speak.call_count,1)
        self.assertEqual(self.router.status()['counts'],{'unknown':1})
    def test_expired_future_and_changed_profile_never_query_world(self):
        for changes in ({'createdAt':0},{'createdAt':self.now*1000+1},{'profileRevision':'stale'},{'npcKey':'missing'}):
            self.router.consume(self.npc,self.row(**changes))
        self.npc.R.cmd.assert_not_called();self.npc.route.assert_not_called()
    def test_unloaded_distant_and_other_dimension_do_not_speak(self):
        self.npc.alive_pos.return_value=None
        self.assertEqual(self.router.consume(self.npc,self.row()),'not_nearby_or_loaded')
        self.npc.alive_pos.return_value=[0,64,0];self.npc.R.cmd.return_value='Test failed'
        self.assertEqual(self.router.consume(self.npc,self.row()),'not_nearby_or_loaded')
        self.npc.speak.assert_not_called()
    def test_invalid_input_and_cooldown_do_not_repeat_actions(self):
        self.assertEqual(self.router.consume(self.npc,self.row(speaker='bad"name')),'invalid')
        self.assertEqual(self.router.consume(self.npc,self.row(text='a\nb')),'invalid')
        self.router.consume(self.npc,self.row());self.router.consume(self.npc,self.row())
        self.assertEqual(self.npc.speak.call_count,1)
        self.now+=4;self.router.consume(self.npc,self.row());self.assertEqual(self.npc.speak.call_count,2)
    def test_only_vanilla_chat_leaves_legacy_log_router(self):
        self.assertTrue(central_public_line('[Server thread/INFO]: <Player> 禾叔你好'))
        self.assertFalse(central_public_line('[Server thread/INFO]: [Kirito] 禾叔你好'))
    def test_exact_target_real_route_cannot_handoff_public_goods(self):
        tree=ast.parse((ROOT/'world/sidecar/mc_npc.py').read_text('utf8'))
        route=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='route')
        other=dict(self.v,key='other',calls=['其他人'])
        scope={'PROFILES':[other,self.v],'LAST_TALK':{},'time':time,'GREET':['你好'],
            'RE_HANDOFF':re.compile(r'@(.+) 给(\d+)(.+)'), 'RE_GIVE':re.compile(r'给(\d+)(.+)'),
            'handoff':Mock(),'turn_in':Mock()}
        exec(compile(ast.Module(body=[route],type_ignores=[]),'real_route','exec'),scope)
        guild=SimpleNamespace(route_guild=lambda *a:None,npc_story_lines=lambda v:[])
        with patch.dict(sys.modules,{'mc_guild':guild}):
            v,lines=scope['route']('TestPlayer','禾叔 给6小麦',via='public',target_key='hesu')
        self.assertIs(v,self.v);self.assertIn('/msg Goddess',lines[0]);scope['turn_in'].assert_not_called()


if __name__=='__main__':unittest.main()
