"""Content publication with the real validator and isolated guild files only."""
from contextlib import nullcontext
from copy import deepcopy
from datetime import date
import json
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
sys.path.insert(0, str(ROOT / 'world/ops'))
import world_content as content
from world_content_tools import register_content_tools, content_tools

DAY = date(2026, 9, 9)
DESIGNER, ADMIN, AUTHOR = content.ACTORS


class ContentTests(unittest.TestCase):
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
        self.original_board = {'date':DAY.isoformat(),'board':[{
            'no':1,'type':'hunt','rank':0,'from':'zhujiu','display':'zhujiu',
            'title':'已有巡夜','pitch':'旧委托不应被覆盖','mob':'zombie','zh':'僵尸',
            'count':2,'reward':2,'fame':1,'status':'open','taker':[],
            'baseline':{},'taken_at':None,'done_by':None,'done_at':None}]}
        content.save(Path(self.guild.guild_path(DAY.isoformat())), self.original_board)
        content.save(Path(self.npc.quests_path(DAY.isoformat())), {'date':DAY.isoformat(),'quests':[]})
        self.guild.board_today=lambda:content.load(Path(self.guild.guild_path(DAY.isoformat())))
        self.npc.quests_today=lambda:content.load(Path(self.npc.quests_path(DAY.isoformat())))
        self.queue=content.ContentQueue(self.team,clock=lambda:1000)
        self.tick()

    def tick(self):
        return content.tick(self.npc,self.guild,state=self.team,today=DAY,clock=lambda:1000)

    def episode(self):
        return {'date':DAY.isoformat(),'title':'远行之前','story':'村民希望旅人备好粮食，走出镇外看看。',
            'ending':'各步骤是否完成以原公会回执为准。','stages':[
                {'id':'food','kind':'gather','issuer':'hesu','title':'旅途补给','pitch':'收集麦子补给旅人。','item':'wheat','count':6,'reward':2},
                {'id':'patrol','kind':'hunt','issuer':'zhujiu','title':'夜巡协作','pitch':'清理两只真实僵尸。','mob':'zombie','count':2,'reward':2},
                {'id':'explore','kind':'visit','issuer':'jingshui','title':'看见远方','pitch':'从公会锚点走出300格。','destination':'far_horizon','reward':3}]}

    def submit_and_approve(self, payload=None):
        row=self.queue.submit(DESIGNER,'episode-one',payload or self.episode())
        self.queue.publish(ADMIN,'release-one',row['contentId'])
        return row['contentId']

    def test_publish_real_new_contracts_no_random_drops_and_keep_existing(self):
        identity=self.submit_and_approve()
        result=self.tick()['publications'][0]
        self.assertEqual(result['status'],'published')
        board=self.guild.board_today()['board']; quests=self.npc.quests_today()['quests']
        self.assertEqual(board[0],self.original_board['board'][0])
        self.assertEqual([r['type'] for r in board[1:]],['gather','hunt','visit'])
        self.assertEqual(len(quests),1)
        self.assertEqual(quests[0]['count'],6)
        self.assertEqual(quests[0]['id'],board[1]['qid'])
        from guild_rules import gather_matches, new_claim_block
        self.assertTrue(gather_matches(board[1],quests))
        self.assertIsNone(new_claim_block(board[1],True,False))
        self.assertIsNone(new_claim_block(board[3],True,False))
        receipt=self.queue.read(DESIGNER,identity)['publication']
        self.assertEqual(receipt['newContracts'],3)
        self.assertEqual(receipt['worldActionsExecuted'],0)
        self.assertIn('before',receipt); self.assertIn('after',receipt)

    def test_repeated_submit_publish_tick_do_not_duplicate_or_reset_progress(self):
        identity=self.submit_and_approve();self.tick()
        board=self.guild.board_today();board['board'][1].update(status='claimed',taker=['Fixture'])
        content.save(Path(self.guild.guild_path(DAY.isoformat())),board)
        self.assertEqual(self.queue.submit(DESIGNER,'episode-one',self.episode())['code'],'already_submitted')
        self.queue.publish(ADMIN,'release-one',identity);self.tick()
        self.assertEqual(self.guild.board_today(),board)
        self.assertEqual(len(self.npc.quests_today()['quests']),1)
        changed=self.episode();changed['title']='Changed'
        with self.assertRaisesRegex(ValueError,'content_request_conflict'):
            self.queue.submit(DESIGNER,'episode-one',changed)

    def test_unknown_role_cannot_publish_or_submit(self):
        for actor in ('game:qd-survivor',ADMIN,AUTHOR):
            with self.assertRaisesRegex(ValueError,'designer'):
                self.queue.submit(actor,'wrong',self.episode())
        identity=self.queue.submit(DESIGNER,'valid',self.episode())['contentId']
        with self.assertRaisesRegex(ValueError,'administrator'):
            self.queue.publish(DESIGNER,'wrong',identity)

    def test_author_story_is_readable_but_not_executable(self):
        row=self.queue.story(AUTHOR,'story-one','去旅行','一段剧情',['补给','探索'])
        self.assertEqual(self.queue.read(DESIGNER,row['contentId'])['status'],'story_proposed')
        with self.assertRaisesRegex(ValueError,'executable_content_required'):
            self.queue.publish(ADMIN,'invalid',row['contentId'])
        self.assertEqual(self.guild.board_today(),self.original_board)

    def test_capabilities_keep_boss_chest_blocked_and_reject_commands(self):
        context=self.queue.context()
        for kind in ('boss','chest'):
            self.assertFalse(context['capabilities'][kind]['ready'])
            value=self.episode();value['stages']=[{'kind':kind}]
            with self.assertRaisesRegex(ValueError,kind+'_adapter_missing'):
                self.queue.submit(DESIGNER,kind,value)
        value=self.episode();value['stages'][0]['command']='give @a diamond 64'
        with self.assertRaisesRegex(ValueError,'invalid_content_stage'):
            self.queue.submit(DESIGNER,'command',value)

    def test_binding_and_loaded_issuer_rechecked_at_publication(self):
        identity=self.submit_and_approve()
        self.npc.PROFILES[0]['entityBinding']['uuid']='10000000-0000-4000-8000-000000000001'
        self.assertEqual(self.tick()['publications'][0]['status'],'blocked')
        self.assertEqual(self.guild.board_today(),self.original_board)
        self.assertEqual(self.queue.read(ADMIN,identity)['publication']['code'],'content_context_changed')

    def test_existing_reference_binds_objective_and_never_rewrites_contract(self):
        value=self.episode();value['stages']=[{'id':'existing','kind':'existing','questId':DAY.isoformat()+':1',
            'title':'同游的开端','pitch':'完成看板上的巡夜。'}]
        self.submit_and_approve(value)
        self.assertEqual(self.tick()['publications'][0]['status'],'published')
        self.assertEqual(self.guild.board_today(),self.original_board)

    def test_existing_claim_or_reward_change_before_release_blocks(self):
        value=self.episode();value['stages']=[{'id':'existing','kind':'existing','questId':DAY.isoformat()+':1',
            'title':'同游的开端','pitch':'完成看板上的巡夜。'}]
        self.submit_and_approve(value)
        board=self.guild.board_today();board['board'][0]['reward']=3
        content.save(Path(self.guild.guild_path(DAY.isoformat())),board)
        self.assertEqual(self.tick()['publications'][0]['status'],'blocked')
        self.assertEqual(self.guild.board_today(),board)

    def test_crash_between_files_recovers_only_missing_append_preserving_progress(self):
        identity=self.submit_and_approve()
        original=content._append
        def interrupted(path,*args):
            if Path(path).name.startswith('guild-'):raise OSError('interrupted')
            return original(path,*args)
        with patch.object(content,'_append',interrupted):
            self.assertEqual(self.tick()['publications'][0]['status'],'publication_unconfirmed')
        self.assertEqual(len(self.npc.quests_today()['quests']),1)
        quests=self.npc.quests_today();quests['quests'][0].update(done=True,done_by='Fixture')
        content.save(Path(self.npc.quests_path(DAY.isoformat())),quests)
        board=self.guild.board_today();board['board'][0].update(status='claimed',taker=['Fixture'])
        content.save(Path(self.guild.guild_path(DAY.isoformat())),board)
        self.assertEqual(self.tick()['publications'][0]['status'],'published')
        self.assertEqual(self.npc.quests_today(),quests)
        self.assertEqual(self.guild.board_today()['board'][0],board['board'][0])
        self.assertEqual(self.guild.board_today()['board'][1]['status'],'done')
        self.assertEqual(self.guild.board_today()['board'][1]['done_by'],'Fixture')
        self.assertEqual(len(self.guild.board_today()['board']),4)
        self.assertEqual(self.queue.read(ADMIN,identity)['publication']['status'],'published')

    def test_recovery_identity_collision_does_not_overwrite(self):
        self.submit_and_approve();original=content._append
        def interrupted(path,*args):
            if Path(path).name.startswith('guild-'):raise OSError('interrupted')
            return original(path,*args)
        with patch.object(content,'_append',interrupted):self.tick()
        board=self.guild.board_today();board['board'].append({**board['board'][0],'no':2,'count':9})
        content.save(Path(self.guild.guild_path(DAY.isoformat())),board)
        self.assertEqual(self.tick()['publications'][0]['status'],'publication_unconfirmed')
        self.assertEqual(self.guild.board_today(),board)

    def test_future_episode_waits_and_no_open_gather_overlap(self):
        value=self.episode();value['date']='2026-09-10'
        self.submit_and_approve(value)
        self.assertEqual(self.tick()['publications'][0]['status'],'scheduled')
        self.assertEqual(self.guild.board_today(),self.original_board)
        quests={'date':DAY.isoformat(),'quests':[{'id':'old','villager':'hesu','done':False}]}
        content.save(Path(self.npc.quests_path(DAY.isoformat())),quests);self.tick()
        with self.assertRaisesRegex(ValueError,'has_open_gather'):
            self.queue.submit(DESIGNER,'busy',self.episode())

    def test_stale_context_cannot_submit(self):
        self.queue.clock=lambda:1201
        with self.assertRaisesRegex(ValueError,'content_context_unavailable'):
            self.queue.submit(DESIGNER,'stale',self.episode())

    def test_unknown_locations_quantities_and_unloaded_reception_rejected(self):
        for field, value in [('reward',True), ('count','6'), ('item','command_block')]:
            payload=self.episode();payload['stages'][0][field]=value
            with self.assertRaises(ValueError):self.queue.submit(DESIGNER,'bad-'+field,payload)
        payload=self.episode();payload['stages'][2]['destination']='unverified_ruins'
        with self.assertRaisesRegex(ValueError,'destination_unverified'):
            self.queue.submit(DESIGNER,'ruins',payload)
        self.npc.alive_pos=lambda p:None if p['key']=='guild_lan' else [0,64,0]
        self.tick()
        with self.assertRaisesRegex(ValueError,'reception_unavailable'):
            self.queue.submit(DESIGNER,'reception',self.episode())

    def test_references_and_new_contracts_keep_authored_order(self):
        value=self.episode()
        value['stages'].insert(1,{'id':'old','kind':'existing','questId':DAY.isoformat()+':1',
                                 'title':'已有巡夜','pitch':'与原本的任务一起完成。'})
        identity=self.submit_and_approve(value);self.tick()
        receipt=self.queue.read(ADMIN,identity)['publication']
        self.assertEqual(receipt['questIds'],['2026-09-09:2','2026-09-09:1','2026-09-09:3','2026-09-09:4'])

    def test_native_registration_exposes_only_fixed_role_tools(self):
        class App:
            def __init__(self):self.tools={}
            def tool(self):
                def add(fn):self.tools[fn.__name__]=fn;return fn
                return add
        for actor in content.ACTORS:
            app=App();names=register_content_tools(app,actor,self.team)
            self.assertEqual(set(app.tools),set(content_tools(actor)))
            self.assertEqual(set(names),set(app.tools))
        app=App();self.assertEqual(register_content_tools(app,'game:qd-survivor',self.team),())
        self.assertEqual(app.tools,{})

    def test_player_board_and_numbered_activity_render_confirmed_episode(self):
        identity=self.submit_and_approve();self.tick()
        self.npc.DATA=str(self.village);self.npc.CFG={};self.npc.GUILD_AUTOGENERATE=False
        self.npc.R=SimpleNamespace(cmd=Mock(side_effect=AssertionError('no world command during display')))
        spec=importlib.util.spec_from_file_location('content_guild_display',ROOT/'world/sidecar/mc_guild.py')
        module=importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules,{'mc_npc':self.npc}):spec.loader.exec_module(module)
        module.board_today=self.guild.board_today
        with patch.dict('os.environ',{'NPC_WORLD_TEAM_ROOT':str(self.team)}):
            board='\n'.join(module.board_lines())
            self.assertIn('故事活动 · 远行之前',board)
            self.assertIn('No.2 → No.3 → No.4',board)
            self.assertIn('活动 2',board)
            detail=module.route_guild('Fixture','活动 2','活动 2',{'key':'guild_lan'})
            self.assertIn(self.episode()['story'],'\n'.join(detail))
            self.assertIn('第3步','\n'.join(detail))
            self.assertIn('不是通关回执','\n'.join(detail))
            self.assertIn('剧情文本','\n'.join(detail))
            self.assertEqual(module.activity_lines(99),['今日看板没有 No.99。'])
        self.npc.R.cmd.assert_not_called()
        self.assertEqual(self.queue.read(ADMIN,identity)['publication']['status'],'published')

    def test_unconfirmed_missing_or_changed_story_receipt_never_rendered(self):
        identity=self.submit_and_approve();self.tick()
        receipt_path=self.queue.root/'receipts'/(identity+'.json')
        receipt=content.load(receipt_path);receipt['status']='publishing';content.save(receipt_path,receipt)
        self.assertEqual(content.episode_lines(self.guild.board_today(),state=self.team),[])
        # Existing deterministic publication resumes, then display becomes
        # visible only after its final receipt is confirmed again.
        self.tick()
        self.assertTrue(content.episode_lines(self.guild.board_today(),state=self.team))
        board=self.guild.board_today();board['board'][1]['reward']=99
        self.assertEqual(content.episode_lines(board,state=self.team),[])
        receipt_path.unlink()
        self.assertEqual(content.episode_lines(self.guild.board_today(),state=self.team),[])


if __name__=='__main__':unittest.main()
