"""Read-only native dashboard projection and current-role boundaries."""
from pathlib import Path
import hashlib,json,sqlite3,sys,tempfile,unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'world/ops'))
import evolution_policy as board


class BoardTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.work=self.root/'workspaces';self.work.mkdir()
        self.notes=self.root/'notes';self.notes.mkdir()
        self.skills=self.root/'world-skills';self.skills.mkdir()
        self.db=self.root/'team.sqlite3'
        with sqlite3.connect(self.db) as db:
            db.execute('CREATE TABLE cases(id TEXT,author TEXT,owner TEXT,status TEXT,version INT,updated_at REAL,body TEXT)')
            for i in range(35):
                db.execute('INSERT INTO cases VALUES(?,?,?,?,?,?,?)',
                    (str(i),'game:mc-god','operations:mc-god','working',1,i,
                     json.dumps({'category':'improvement','title':'Test '+str(i)})))
        db.close()
        self.config={'agents':{'profiles':{}}}
        for role,enabled in [('qd-survivor',True),('qd-engineer',True),('retired',False)]:
            folder=self.work/role;folder.mkdir()
            (folder/'agent.json').write_text(json.dumps({'name':'Name '+role}),'utf8')
            (folder/'learning/drafts').mkdir(parents=True)
            (folder/'learning/drafts/example.json').write_text('{}','utf8')
            (folder/'learning/index.json').write_text('{"skills":{"one":{}}}','utf8')
            self.config['agents']['profiles'][role]={'id':role,'enabled':enabled,'workspace_dir':str(folder)}
        (self.root/'config.json').write_text(json.dumps(self.config),'utf8')
        (self.skills/'index.json').write_text('{"skills":{"one":{},"two":{}}}','utf8')
        (self.skills/'index.lock').write_text('ignored','utf8')
        self.survival=self.root/'survival.json'
        self.survival.write_text(json.dumps({'schema':2,'at':100,'generation':{'status':'current'},
            'runtime':{'status':'paused'},'trends':{'buckets':[]},'evidence':{'errors':['bad.json']}}),'utf8')
        for name,value in [('WORKSPACES',self.work),('NOTES',self.notes),('WORLD_SKILLS',self.skills),
                           ('TEAM_DB',self.db),('SURVIVAL_METRICS',self.survival)]:
            p=patch.object(board,name,value);p.start();self.addCleanup(p.stop)
        facts={'shiftCron':'20 * * * *','shiftTaskType':'agent','shiftTimeoutSeconds':180,
               'shiftMaxConcurrency':1,'knowledgeCapPerTree':200,'evidenceTrees':['memory'],
               'quotaCycles':'legacy','abandonStallSeconds':30,'minPatternRepeats':3,'guardVersion':1}
        p=patch.object(board,'code_facts',return_value=facts);p.start();self.addCleanup(p.stop)

    def fingerprints(self):
        return {str(p.relative_to(self.root)):hashlib.sha256(p.read_bytes()).hexdigest()
                for p in self.root.rglob('*') if p.is_file()}

    def test_live_projection_is_read_only_and_excludes_retired_workspaces(self):
        before=self.fingerprints()
        first=board.build_live_board();second=board.build_live_board()
        self.assertEqual(self.fingerprints(),before)
        self.assertEqual([x['role'] for x in first['roles']],['qd-engineer','qd-survivor'])
        self.assertEqual(first['metrics']['skillLevel']['drafts'],2)
        self.assertEqual(first['metrics']['skillLevel']['sharedPublished'],2)
        self.assertEqual(first['metrics']['cases']['counts'],{'working':35})
        self.assertIsNone(first['metrics']['cases']['resolutionMedianMinutes'])
        self.assertEqual(len(first['proposals']),30)
        self.assertEqual(second['metrics']['survival']['runtime'],{'status':'paused'})
        self.assertEqual(first['metrics']['survival']['evidence']['errors'],['bad.json'])
        self.assertNotIn('quotaCycles',first['policy']['insideTheTurn'])
        self.assertFalse(any('no_skill_draft_yet' in r['flags'] for r in first['roles']))

    def test_live_reads_new_source_instead_of_generated_snapshot(self):
        self.assertEqual(board.build_live_board()['metrics']['survival']['at'],100)
        self.survival.write_text('{"schema":2,"at":200,"closedLoop":{"rate":null}}','utf8')
        result=board.build_live_board()
        self.assertEqual(result['metrics']['survival']['at'],200)
        self.assertIsNone(result['metrics']['survival']['closedLoop']['rate'])

    def test_readonly_missing_ledger_does_not_create_database(self):
        with patch.object(board,'TEAM_DB',self.root/'missing.sqlite3'):
            self.assertIn('error',board._case_totals())
            self.assertIn('error',board.proposals()[0])
        self.assertFalse((self.root/'missing.sqlite3').exists())

    def test_registry_failure_is_not_a_fake_zero_role_board(self):
        (self.root/'config.json').write_text('{','utf8')
        with self.assertRaises(ValueError):board.build_live_board()

    def test_current_flag_age_resets_after_recovery(self):
        path=self.notes/'flag-history.jsonl'
        path.write_text('\n'.join(json.dumps(row) for row in [
            {'at':100,'flags':['qd-survivor|knowledge_stale']},
            {'at':200,'flags':[]},{'at':300,'flags':['qd-survivor|knowledge_stale']}]),'utf8')
        before=path.read_bytes()
        with patch.object(board.time,'time',return_value=360):
            value=board._flag_history([{'role':'qd-survivor','flags':['knowledge_stale']}],persist=False)
        self.assertEqual(value[0]['minutes'],1)
        self.assertEqual(path.read_bytes(),before)

    def test_migrated_role_reads_its_native_learning_marker(self):
        (self.work/'qd-engineer/learning/last-cron.json').write_text(
            '{"checkedAt":300,"code":"engineer-fact"}','utf8')
        other=self.work/'mc-god/learning';other.mkdir(parents=True)
        (other/'last-cron.json').write_text('{"checkedAt":350,"code":"other-role"}','utf8')
        with patch('role_learning_profiles.learning_identity',return_value=('mc-god','operations')):
            row=next(x for x in board.board_rows() if x['role']=='qd-engineer')
        self.assertEqual(row['lastShift']['code'],'engineer-fact')


if __name__=='__main__':unittest.main()
