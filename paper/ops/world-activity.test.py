import importlib.util, json, sqlite3, tempfile, unittest, gzip
from datetime import datetime
from pathlib import Path

spec=importlib.util.spec_from_file_location('activity',Path(__file__).with_name('world-activity.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
P='11111111-1111-4111-8111-111111111111'
NOW=datetime.fromisoformat('2026-10-26T09:00:00+08:00')

class ActivityTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.defs={'harvest_home':{'title':'交付','category':'logistics','tags':['logistics']}}
    def tearDown(self):self.temp.cleanup()
    def line(self,body):return '[08:00:00] [Server thread/INFO]: [AgentFriend] '+body
    def test_only_real_success_not_chat_or_commands(self):
        lines=[self.line(f'Guild claimed: player={P}, contract=harvest_home, fame=6'),
               self.line(f'Guild reward refused: player={P}, contract=harvest_home'),
               f'[08:00:00] [Server thread/INFO]: <attacker> [AgentFriend] Guild claimed: player={P}, contract=harvest_home, fame=7',
               self.line(f'player issued server command: /mycli guild claim')]
        rows,d=a.log_events(lines,'2026-10-26',self.defs,{})
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['status'],'completed');self.assertFalse(d)
    def test_accepted_is_not_completed(self):
        rows,_=a.log_events([self.line(f'Guild accepted: player={P}, contract=harvest_home')],'2026-10-26',self.defs,{})
        self.assertEqual(rows[0]['status'],'accepted')
    def test_invalid_uuid_ignored(self):
        rows,_=a.log_events([self.line('Guild claimed: player='+'-'*36+', contract=x, fame=1')],'2026-10-26',{},{});self.assertEqual(rows,[])
    def test_repeated_snapshot_and_rotated_log_dedupe(self):
        lines=[self.line(f'Guild claimed: player={P}, contract=harvest_home, fame=6')]
        rows,_=a.log_events(lines,'2026-10-26',self.defs,{})
        merged,_=a.merge_history({},rows+rows,self.defs,'2026-10-01','2026-10-26')
        self.assertEqual(len(merged),1)
    def history(self,status='completed'):
        return {'task-market':{'assessments':{P:{'history':[{'run':'r1','task':'harvest_home','outcome':status,
            'at':int(datetime.fromisoformat('2026-10-26T08:00:00.100+08:00').timestamp()*1000),
            'steps':[{'step':1,'goal':'harvest','target':8},{'step':2,'goal':'replant','target':8}]}]}}}}
    def test_frozen_steps_override_today_definition_without_double_count(self):
        rows,_=a.log_events([self.line(f'Guild claimed: player={P}, contract=harvest_home, fame=6')],'2026-10-26',self.defs,{})
        merged,_=a.merge_history(self.history(),rows,self.defs,'2026-10-01','2026-10-26')
        self.assertEqual(len(merged),1);self.assertEqual(merged[0]['category'],'farming')
    def test_destination_runs_same_day_not_coalesced(self):
        rows,_=a.log_events([self.line(f'Guild claimed: player={P}, contract=harvest_home, fame={f}') for f in (6,12)],'2026-10-26',self.defs,{})
        merged,_=a.merge_history(self.history(),rows,self.defs,'2026-10-01','2026-10-26')
        self.assertEqual(len(merged),2)
    def test_abandonment_is_separate_outcome(self):
        merged,_=a.merge_history(self.history('abandoned'),[],self.defs,'2026-10-01','2026-10-26')
        self.assertEqual(merged[0]['status'],'abandoned')
    def test_completed_stage_is_not_completed_contract(self):
        c=self.history();c['task-market']['assessments'][P]['history'][0]['outcome']='stage_complete'
        merged,_=a.merge_history(c,[],self.defs,'2026-10-01','2026-10-26');self.assertFalse(merged)
    def test_delivery_only_verified_donate_stage(self):
        c=self.history('abandoned');h=c['task-market']['assessments'][P]['history'][0]
        h['steps']=[{'step':1,'goal':'donate','site':'WHEAT','target':16},{'step':2,'goal':'craft','site':'BREAD','target':99}]
        _,d=a.merge_history(c,[],{},'2026-10-01','2026-10-26')
        self.assertEqual(len(d),1);self.assertEqual(d[0]['deposited'],16);self.assertIsNone(d[0]['occurredAt'])
    def test_admin_transfer_distinct_from_player_donation(self):
        _,d=a.log_events([self.line('Guild donation Test stashSlot=4 chest=2 item=BREAD count=16')],'2026-10-26',{}, {'test':P})
        self.assertEqual(d[0]['source'],'admin_transfer');self.assertEqual(d[0]['playerUuid'],P)
    def test_dynamic_template_and_unknown_categories(self):
        defs={'template:supply':{'title':'补给','category':'logistics','tags':['logistics']}}
        self.assertEqual(a.task_info('db_20261026_supply',defs)['category'],'logistics')
        self.assertEqual(a.task_info('unknown',defs)['category'],'other')
        self.assertEqual(a.category(['build','fish'])[0],'mixed')
    def test_market_yaml_short_keys_map_to_actual_prefixed_runtime_ids(self):
        folder=self.root/'plugins/AgentFriend';folder.mkdir(parents=True)
        for name in ('task-market.yml','resident-contracts.yml','route-contracts.yml'):
            (folder/name).write_text('tasks:\n  crypt_report:\n    title: Crypt\n    steps:\n      - goal: explore\n',encoding='utf8')
        defs,_=a.catalogue(self.root,{})
        self.assertEqual(a.task_info('tm_crypt_report',defs)['category'],'exploration')
        self.assertEqual(a.task_info('crypt_report',defs)['category'],'other')
        rows,_=a.log_events([self.line(f'Guild accepted: player={P}, contract=tm_crypt_report')],'2026-10-26',defs,{})
        self.assertEqual(rows[0]['category'],'exploration')
    def test_public_box_allowlist_does_not_expand_to_arbitrary_private_boxes(self):
        c={'guild-hall':{'services-built':True,'x':0,'y':64,'z':0}}
        points=a.public_boxes(c,{'extras':{'misc':[[16,67,13],[500,65,500]]}})
        self.assertIn((16,67,13),points);self.assertNotIn((17,67,13),points);self.assertNotIn((500,65,500),points)
    def db(self):
        file=self.root/'co.db';d=sqlite3.connect(file)
        d.executescript('CREATE TABLE co_world(id INTEGER,world TEXT); INSERT INTO co_world VALUES(1,"world"); CREATE TABLE co_user(id INTEGER,user TEXT,uuid TEXT); CREATE TABLE co_material_map(id INTEGER,material TEXT); INSERT INTO co_material_map VALUES(1,"stone"); CREATE TABLE co_container(time INTEGER,user INTEGER,wid INTEGER,x INTEGER,y INTEGER,z INTEGER,type INTEGER,amount INTEGER,action INTEGER,rolled_back INTEGER);')
        d.execute('INSERT INTO co_user VALUES(1,?,?)',('Test',P));d.execute('INSERT INTO co_user VALUES(2,?,?)',('#hopper',P))
        for x,user,action,rolled in [(16,1,1,0),(16,1,0,0),(16,1,1,1),(16,2,1,0),(999,1,1,0)]:
            d.execute('INSERT INTO co_container VALUES(?,?,?,?,?,?,?,?,?,?)',(int(NOW.timestamp())-2,user,1,x,65,7,1,4,action,rolled))
        d.commit();d.close();return file
    def test_storage_real_units_actions_rollbacks_and_private_exclusion(self):
        file=self.db();before=file.read_bytes();rows,cov=a.read_storage(file,[(16,65,7)],'2026-10-01',NOW)
        self.assertTrue(cov['complete']);self.assertEqual(len(rows),2)
        self.assertEqual(sum(r['deposited'] for r in rows),4);self.assertEqual(sum(r['net'] for r in rows),0)
        self.assertEqual(file.read_bytes(),before)
    def test_missing_storage_is_unknown_not_known_zero(self):
        rows,cov=a.read_storage(self.root/'missing',[(1,2,3)],'2026-10-01',NOW)
        self.assertFalse(cov['available']);self.assertFalse(cov['complete']);self.assertFalse((self.root/'missing').exists())
    def test_storage_budget_and_timeout_report_partial(self):
        f=self.db();rows,cov=a.read_storage(f,[(16,65,7)],'2026-10-01',NOW,row_limit=1)
        self.assertFalse(cov['complete']);self.assertLessEqual(len(rows),1)
    def test_newest_logs_first_and_unfinished_lines_not_accepted(self):
        (self.root/'logs').mkdir()
        for day in ('2026-10-24','2026-10-25'):
            with gzip.open(self.root/'logs'/f'{day}-1.log.gz','wb') as f:f.write((self.line(f'Guild claimed: player={P}, contract=x, fame=1')+'\n').encode())
        (self.root/'logs/latest.log').write_text(self.line(f'Guild claimed: player={P}, contract=x, fame=2'))
        rows,_,cov=a.read_logs(self.root,'2026-10-24','2026-10-25',{}, {},max_files=1)
        self.assertFalse(cov['complete']);self.assertEqual(cov['daysRead'],['2026-10-25']);self.assertEqual(rows[0]['day'],'2026-10-25')
    def test_missing_config_unavailable(self):
        out=a.collect(self.root,{},now=NOW);self.assertFalse(out['available']);self.assertFalse(out['commissions'])
    def test_day_coverage_and_numeric_rotation_order(self):
        (self.root/'logs').mkdir()
        for day,n in [('2026-10-24',1),('2026-10-25',9),('2026-10-25',10)]:
            with gzip.open(self.root/'logs'/f'{day}-{n}.log.gz','wb') as f:
                f.write((self.line(f'Guild claimed: player={P}, contract=x, fame={n}')+'\n').encode())
        rows,_,cov=a.read_logs(self.root,'2026-10-23','2026-10-25',{}, {},max_files=1)
        expected,_=a.log_events([self.line(f'Guild claimed: player={P}, contract=x, fame=10')],'2026-10-25',{}, {})
        self.assertEqual(rows,expected);self.assertEqual(cov['completeDays'],[])
        self.assertEqual(cov['partialDays'],['2026-10-25']);self.assertEqual(cov['unreadDays'],['2026-10-24'])
        self.assertEqual(cov['missingDays'],['2026-10-23'])
        _,_,cov=a.read_logs(self.root,'2026-10-23','2026-10-25',{}, {})
        self.assertEqual(cov['completeDays'],['2026-10-24','2026-10-25'])
    def test_catalogue_reproducible_shape(self):
        cat=json.loads(Path(__file__).with_name('world-activity-catalogue.json').read_text(encoding='utf8'))
        self.assertGreaterEqual(len(cat['tasks']),35)
        self.assertEqual(cat['tasks']['farmer_harvest']['category'],'farming')
        self.assertEqual(cat['tasks']['undead_explorer']['category'],'exploration')

if __name__=='__main__':unittest.main()
