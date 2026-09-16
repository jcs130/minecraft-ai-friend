"""Board-contract takedown tests, kept out of the byte-pinned check files."""
from contextlib import nullcontext
from datetime import date
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
from world_content_tools import register_content_tools

DAY = date(2026, 9, 9)
DESIGNER, ADMIN, AUTHOR = content.ACTORS


class WithdrawTests(unittest.TestCase):
    """Board-contract takedown for an issuer that left the roster.

    Root case contract-takedown-tool-missing (2026-09-15): a listed gather
    contract whose issuing NPC is gone cannot be delivered and previously
    had no takedown path. The tests pin the full chain: read-only dead-issuer
    visibility, mc-god-only submit gates, receipt-backed execution under the
    guild lock, crash recovery, and the guild board refusing withdrawn rows.
    """

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
            guild_path=lambda d:str(self.village/f'guild-{d}.json'),BOARD={'date':None,'doc':None})
        # shilei is deliberately absent from PROFILES: the on-board contract
        # below reproduces the live dead-issuer delivery dead-end.
        self.dead_gather = {'no':1,'type':'gather','rank':0,'qid':'iron-shilei','from':'shilei',
            'display':'石磊','title':'收购·铁锭','item':'iron_ingot','zh':'铁锭','count':4,
            'reward':2,'fame':1,'pitch':'凑4个铁锭。','status':'open','taker':[],
            'taken_at':None,'done_by':None,'done_at':None}
        self.open_hunt = {'no':2,'type':'hunt','rank':0,'from':'zhujiu','display':'zhujiu',
            'title':'夜巡的噩梦','pitch':'清理两只真实僵尸。','mob':'zombie','zh':'僵尸',
            'count':2,'reward':2,'fame':1,'status':'open','taker':[],'baseline':{},
            'taken_at':None,'done_by':None,'done_at':None}
        board = {'date':DAY.isoformat(),'board':[self.dead_gather,self.open_hunt]}
        content.save(Path(self.guild.guild_path(DAY.isoformat())),board)
        quests = {'date':DAY.isoformat(),'quests':[{'id':'iron-shilei','villager':'shilei',
            'display':'石磊','item':'iron_ingot','zh':'铁锭','count':4,'emerald':2,
            'pitch':'凑4个铁锭。','effect':None,'lore_atom':False,'done':False,
            'done_by':None,'done_at':None}]}
        content.save(Path(self.npc.quests_path(DAY.isoformat())),quests)
        self.guild.board_today=lambda:content.load(Path(self.guild.guild_path(DAY.isoformat())))
        self.npc.quests_today=lambda:content.load(Path(self.npc.quests_path(DAY.isoformat())))
        self.queue=content.ContentQueue(self.team,clock=lambda:1000)
        self.tick()

    def tick(self):
        return content.tick(self.npc,self.guild,state=self.team,today=DAY,clock=lambda:1000)

    def contract(self, context, quest_id):
        return next(c for c in context['days'][DAY.isoformat()]['contracts'] if c['questId']==quest_id)

    def test_context_flags_dead_issuer_and_withdraw_capability(self):
        context=self.queue.context()
        dead=self.contract(context,DAY.isoformat()+':1')
        self.assertFalse(dead['issuerReady'])
        self.assertEqual(dead['status'],'open')
        live=self.contract(context,DAY.isoformat()+':2')
        self.assertTrue(live['issuerReady'])
        self.assertEqual(context['days'][DAY.isoformat()]['issuerMissingContracts'],[DAY.isoformat()+':1'])
        withdraw=context['capabilities']['withdraw']
        self.assertTrue(withdraw['ready'])
        self.assertEqual(withdraw['operator'],'game:mc-god')

    def test_withdraw_submit_gates_replay_and_conflict(self):
        for actor in (DESIGNER,AUTHOR):
            with self.assertRaisesRegex(ValueError,'administrator'):
                self.queue.withdraw(actor,'gate-1',DAY.isoformat(),1)
        with self.assertRaisesRegex(ValueError,'invalid_withdraw_day'):
            self.queue.withdraw(ADMIN,'gate-2','2020-01-01',1)
        for bad in (0,100,True,'1',None,1.0):
            with self.assertRaisesRegex(ValueError,'invalid_withdraw_number'):
                self.queue.withdraw(ADMIN,'gate-3',DAY.isoformat(),bad)
        with self.assertRaisesRegex(ValueError,'content_contract_unavailable'):
            self.queue.withdraw(ADMIN,'gate-4',DAY.isoformat(),9)
        self.assertEqual(list((self.queue.root/'withdraw').glob('*.json')),[])
        # a settled contract cannot be taken down
        board=self.guild.board_today();board['board'][1].update(status='done',done_by='Fixture')
        content.save(Path(self.guild.guild_path(DAY.isoformat())),board);self.tick()
        with self.assertRaisesRegex(ValueError,'withdraw_contract_not_active'):
            self.queue.withdraw(ADMIN,'gate-5',DAY.isoformat(),2)
        # replay of the same request is idempotent, a different reason conflicts
        self.assertEqual(self.queue.withdraw(ADMIN,'take-down-1',DAY.isoformat(),1,'发行人石磊已不在名册')['code'],'withdraw_queued')
        self.assertEqual(self.queue.withdraw(ADMIN,'take-down-1',DAY.isoformat(),1,'  发行人石磊已不在名册  ')['code'],'withdraw_queued')
        with self.assertRaisesRegex(ValueError,'withdraw_request_conflict'):
            self.queue.withdraw(ADMIN,'take-down-1',DAY.isoformat(),1,'别的理由')
        self.assertEqual(len(list((self.queue.root/'withdraw').glob('*.json'))),1)
        # a second takedown of the same contract is refused at submit
        self.tick()
        with self.assertRaisesRegex(ValueError,'withdraw_contract_withdrawn'):
            self.queue.withdraw(ADMIN,'take-down-2',DAY.isoformat(),1,'再下一次')
        replay=self.queue.withdraw(ADMIN,'take-down-1',DAY.isoformat(),1,'发行人石磊已不在名册')
        self.assertEqual(replay['code'],'withdraw_withdrawn')
        self.assertEqual(replay['receipt']['status'],'withdrawn')

    def test_withdraw_execution_receipt_board_cache_and_context(self):
        board=self.guild.board_today()
        board['board'][0].update(status='claimed',taker=['Fixture'],taken_at='09:00')
        content.save(Path(self.guild.guild_path(DAY.isoformat())),board);self.tick()
        self.assertEqual(self.queue.withdraw(ADMIN,'take-down-1',DAY.isoformat(),1,'发行人石磊已不在名册，玩家无法交付')['code'],'withdraw_queued')
        result=self.tick()['withdrawals'][0]
        self.assertEqual(result['status'],'withdrawn')
        self.assertEqual(result['day'],DAY.isoformat());self.assertEqual(result['no'],1)
        receipt=content.load(self.queue.root/'receipts'/(result['withdrawId']+'.json'))
        self.assertEqual(receipt['releasedTakers'],['Fixture'])
        self.assertEqual(receipt['reason'],'发行人石磊已不在名册，玩家无法交付')
        self.assertNotEqual(receipt['before']['boardSha256'],receipt['after']['boardSha256'])
        self.assertEqual(receipt['after']['boardSha256'],
                         content.digest(self.guild.board_today()))
        row=self.guild.board_today()['board'][0]
        self.assertEqual(row['status'],'withdrawn');self.assertEqual(row['taker'],[])
        self.assertEqual(row['withdrawnBy'],'game:mc-god')
        # the guild BOARD cache follows the write: the 30s poller must not
        # overwrite the takedown from a stale cached doc
        self.assertEqual(self.guild.BOARD['date'],DAY.isoformat())
        self.assertEqual(self.guild.BOARD['doc'],self.guild.board_today())
        # acceptance path: a fresh context rereads questId status withdrawn
        context=self.queue.context()
        self.assertEqual(self.contract(context,DAY.isoformat()+':1')['status'],'withdrawn')
        self.assertFalse(self.contract(context,DAY.isoformat()+':1')['issuerReady'])
        # second tick is a no-op: same terminal receipt, unchanged board
        second=self.tick()
        self.assertEqual(second['withdrawals'][0]['status'],'withdrawn')
        self.assertEqual(content.load(self.queue.root/'receipts'/(result['withdrawId']+'.json')),receipt)
        self.assertEqual(content.digest(self.guild.board_today()),receipt['after']['boardSha256'])

    def test_withdraw_rejects_changed_objective_and_keeps_board(self):
        self.queue.withdraw(ADMIN,'take-down-1',DAY.isoformat(),2,'测试')
        board=self.guild.board_today();board['board'][1]['reward']=3
        content.save(Path(self.guild.guild_path(DAY.isoformat())),board)
        result=self.tick()['withdrawals'][0]
        self.assertEqual(result['status'],'rejected')
        self.assertEqual(result['code'],'withdraw_contract_changed')
        receipt=content.load(self.queue.root/'receipts'/(result['withdrawId']+'.json'))
        self.assertEqual(receipt['status'],'rejected')
        self.assertEqual(self.guild.board_today()['board'][1]['status'],'open')
        self.assertEqual(self.guild.board_today()['board'][1]['reward'],3)
        replay=self.queue.withdraw(ADMIN,'take-down-1',DAY.isoformat(),2,'测试')
        self.assertEqual(replay['code'],'withdraw_rejected')

    def test_withdraw_crash_recovery_redoes_missing_write_and_heals_receipt(self):
        # crash after the intermediate receipt, before the board write: the
        # next tick redoes exactly the board write and finishes the receipt
        self.queue.withdraw(ADMIN,'take-down-a',DAY.isoformat(),1)
        withdraw_a='withdraw-'+content.digest([ADMIN,'take-down-a'])[:24]
        request_a=content.load(self.queue.root/'withdraw'/(withdraw_a+'.json'))
        doc=self.guild.board_today()
        content.save(self.queue.root/'receipts'/(withdraw_a+'.json'),
            {'schema':1,'withdrawId':withdraw_a,'status':'withdrawing','day':DAY.isoformat(),'no':1,
             'actor':ADMIN,'requestId':'take-down-a','reason':request_a['reason'],
             'objectiveSha256':request_a['objectiveSha256'],'startedAt':1000,
             'before':{'boardSha256':content.digest(doc)},'worldActionsExecuted':0})
        result=next(r for r in self.tick()['withdrawals'] if r['withdrawId']==withdraw_a)
        self.assertEqual(result['status'],'withdrawn')
        self.assertFalse(result.get('recoveredFromBoard'))
        self.assertEqual(self.guild.board_today()['board'][0]['status'],'withdrawn')
        # crash after the board write, before the terminal receipt: the
        # settled board is never rewritten, only the receipt is healed
        self.queue.withdraw(ADMIN,'take-down-b',DAY.isoformat(),2)
        withdraw_b='withdraw-'+content.digest([ADMIN,'take-down-b'])[:24]
        request_b=content.load(self.queue.root/'withdraw'/(withdraw_b+'.json'))
        doc=self.guild.board_today();doc['board'][1].update(status='withdrawn',taker=[],withdrawnBy='game:mc-god')
        content.save(Path(self.guild.guild_path(DAY.isoformat())),doc)
        settled=content.digest(doc)
        content.save(self.queue.root/'receipts'/(withdraw_b+'.json'),
            {'schema':1,'withdrawId':withdraw_b,'status':'withdrawing','day':DAY.isoformat(),'no':2,
             'actor':ADMIN,'requestId':'take-down-b','reason':request_b['reason'],
             'objectiveSha256':request_b['objectiveSha256'],'startedAt':1000,
             'before':{'boardSha256':'0'*64},'worldActionsExecuted':0})
        result=next(r for r in self.tick()['withdrawals'] if r['withdrawId']==withdraw_b)
        self.assertEqual(result['status'],'withdrawn')
        receipt=content.load(self.queue.root/'receipts'/(withdraw_b+'.json'))
        self.assertTrue(receipt.get('recoveredFromBoard'))
        self.assertEqual(receipt['after']['boardSha256'],settled)
        self.assertEqual(content.digest(self.guild.board_today()),settled)

    def test_guild_board_and_dialogue_refuse_withdrawn_contract(self):
        self.queue.withdraw(ADMIN,'take-down-1',DAY.isoformat(),1,'发行人已不在名册');self.tick()
        self.npc.DATA=str(self.village);self.npc.CFG={};self.npc.GUILD_AUTOGENERATE=False
        self.npc.R=SimpleNamespace(cmd=Mock(side_effect=AssertionError('no world command for a withdrawn contract')))
        for name in ('tellraw','goddess','chronicle_append','ledger_append','feed_append','start_npc_thread'):
            setattr(self.npc,name,Mock())
        spec=importlib.util.spec_from_file_location('withdraw_guild',ROOT/'world/sidecar/mc_guild.py')
        module=importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules,{'mc_npc':self.npc}):spec.loader.exec_module(module)
        module.board_today=self.guild.board_today
        with patch.dict('os.environ',{'NPC_WORLD_TEAM_ROOT':str(self.team)}):
            board='\n'.join(module.board_lines())
            self.assertNotIn('收购·铁锭',board)
            self.assertIn('1 单已被公会下架',board)
            self.assertIn('夜巡的噩梦',board)
            self.assertIn('下架', '\n'.join(module.claim('Fixture',1)))
            self.assertIn('下架', '\n'.join(module.party_claim('Fixture',1,'Mate')))
            self.assertIn('下架', '\n'.join(module.deliver('Fixture',1)))
            self.assertEqual(module.activity_lines(1),['No.1 已被公会下架，不再办理。'])
        # a late native trade on the withdrawn gather settles nothing
        self.assertFalse(module.settle_gather('iron-shilei','Fixture'))
        self.assertEqual(self.guild.board_today()['board'][0]['status'],'withdrawn')
        self.npc.R.cmd.assert_not_called()

    def test_admin_tool_registration_includes_callable_withdraw(self):
        class App:
            def __init__(self):self.tools={}
            def tool(self):
                def add(fn):self.tools[fn.__name__]=fn;return fn
                return add
        # the registered tool builds its own queue on the real clock, so the
        # fixture-written context (clock=1000) would read as stale: refresh
        # it with a real-clock tick first, exactly like production freshness
        content.tick(self.npc,self.guild,state=self.team,today=DAY)
        app=App();names=register_content_tools(app,ADMIN,self.team)
        self.assertIn('world_content_withdraw',names)
        reply=app.tools['world_content_withdraw']('take-down-tool-1',DAY.isoformat(),1,'发行人已不在名册')
        self.assertEqual(reply['code'],'withdraw_queued')
        result=self.tick()['withdrawals'][0]
        self.assertEqual(result['status'],'withdrawn')


if __name__=='__main__':unittest.main()
