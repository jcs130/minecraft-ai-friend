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
import test_world_content as _baseline


class CandidateContentTests(_baseline.ContentTests):
    def test_site_ledger_tools_exposed_by_role(self):
        class App:
            def __init__(self):self.tools={}
            def tool(self):
                def add(fn):self.tools[fn.__name__]=fn;return fn
                return add
        mutations=set(('world_site_propose','world_site_approve','world_site_record','world_site_recover'))
        self.assertTrue(mutations < set(content_tools(ADMIN)))
        admin=App();register_content_tools(admin,ADMIN,self.team)
        site_id=admin.tools['world_site_propose'](
            'site-alpha','boss',{'x':150,'y':64,'z':0},'矿道尽头')['siteId']
        for actor in (DESIGNER,AUTHOR):
            app=App();register_content_tools(app,actor,self.team)
            self.assertIn('world_site_read',app.tools)
            self.assertFalse(mutations & set(app.tools))
            row=app.tools['world_site_read'](site_id)
            self.assertTrue(row['ok']);self.assertEqual(row['status'],'proposed')
            self.assertEqual(row['worldActionsExecuted'],0)

    def test_site_ledger_mcp_chain_records_receipts_offline(self):
        class App:
            def __init__(self):self.tools={}
            def tool(self):
                def add(fn):self.tools[fn.__name__]=fn;return fn
                return add
        app=App();register_content_tools(app,ADMIN,self.team)
        site_id=app.tools['world_site_propose']('site-beta','chest',{'x':90,'y':70,'z':0},'密林洼地')['siteId']
        self.assertEqual(app.tools['world_site_approve']('go-beta',site_id)['code'],'site_approved')
        recorded=app.tools['world_site_record']('rec-beta',site_id,'scout',{'surface':'forest'})
        self.assertEqual((recorded['code'],recorded['status']),('site_step_recorded','scouted'))
        self.assertEqual(recorded['worldActionsExecuted'],0)
        self.assertEqual(app.tools['world_site_recover'](site_id)['status'],'scouted')
        row=app.tools['world_site_read'](site_id)
        self.assertEqual(row['receipts']['scout'],content.digest({'surface':'forest'}))
        with self.assertRaisesRegex(ValueError,'out_of_order'):
            app.tools['world_site_record']('rec-skip',site_id,'cleanup',{'removed':True})


class SiteLedgerTests(unittest.TestCase):
    """Boss/chest site receipt ledger: storage, ordering, replay and recovery."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.team = Path(self.tmp.name)
        self.queue = content.SiteQueue(self.team, anchor=(0, 64, 0), clock=lambda: 1000)

    def site(self, kind='boss', venue=None, request='site-one', note='矿道尽头的空场'):
        result = self.queue.propose(ADMIN, request, kind, venue or {'x': 150, 'y': 64, 'z': 0}, note)
        self.assertEqual(result['code'], 'site_proposed')
        self.assertEqual(result['worldActionsExecuted'], 0)
        return result['siteId']

    def test_full_chain_records_every_step_and_stays_offline(self):
        site_id = self.site()
        self.assertEqual(self.queue.approve(ADMIN, 'go-one', site_id)['code'], 'site_approved')
        evidence = {'scout': {'surface': 'plains'}, 'place': {'entities': []},
                    'proof': {'kills': []}, 'cleanup': {'removed': True}}
        for step in ('scout', 'place', 'proof', 'cleanup'):
            result = self.queue.record(ADMIN, 'rec-' + step, site_id, step, evidence[step])
            self.assertEqual(result['worldActionsExecuted'], 0)
        row = self.queue.read(DESIGNER, site_id)
        self.assertTrue(row['ok'])
        self.assertEqual(row['status'], 'closed')
        self.assertEqual(sorted(row['receipts']), sorted(content.SITE_STEPS))
        self.assertEqual(self.queue.recover(ADMIN, site_id)['status'], 'closed')
        self.assertIsNone(self.queue.recover(ADMIN, site_id)['nextStep'])

    def test_propose_permissions_and_venue_validation(self):
        for actor in (DESIGNER, AUTHOR, 'game:qd-survivor'):
            with self.assertRaisesRegex(ValueError, 'administrator'):
                self.queue.propose(actor, 'nope', 'boss', {'x': 150, 'y': 64, 'z': 0})
        with self.assertRaisesRegex(ValueError, 'kind'):
            self.queue.propose(ADMIN, 'bad-kind', 'lair', {'x': 150, 'y': 64, 'z': 0})
        with self.assertRaisesRegex(ValueError, 'out_of_band'):
            self.queue.propose(ADMIN, 'too-close', 'boss', {'x': 50, 'y': 64, 'z': 0})
        with self.assertRaisesRegex(ValueError, 'out_of_band'):
            self.queue.propose(ADMIN, 'too-far', 'chest', {'x': 250, 'y': 64, 'z': 0})
        for venue in ({'x': 1.5, 'y': 64, 'z': 0}, {'x': 150, 'z': 0}, {'x': 150, 'y': 999, 'z': 0}):
            with self.assertRaisesRegex(ValueError, 'venue'):
                self.queue.propose(ADMIN, 'bad-venue', 'boss', venue)
        with self.assertRaisesRegex(ValueError, 'request'):
            self.queue.propose(ADMIN, 'bad id!', 'boss', {'x': 150, 'y': 64, 'z': 0})
        first = self.queue.propose(ADMIN, 'site-one', 'boss', {'x': 150, 'y': 64, 'z': 0})
        self.assertEqual(first['code'], 'site_proposed')
        self.assertEqual(first['worldActionsExecuted'], 0)
        site_path = self.queue.root / 'sites' / (first['siteId'] + '.json')
        first_bytes = site_path.read_bytes()
        again = self.queue.propose(ADMIN, 'site-one', 'boss', {'x': 150, 'y': 64, 'z': 0})
        self.assertEqual(again['code'], 'already_proposed')
        self.assertEqual(again['siteId'], first['siteId'])
        self.assertEqual(again['worldActionsExecuted'], 0)
        self.assertEqual(site_path.read_bytes(), first_bytes)
        self.assertEqual([path.name for path in site_path.parent.glob('*.json')], [site_path.name])
        other = self.queue.propose(ADMIN, 'site-two', 'boss', {'x': 160, 'y': 64, 'z': 0})
        self.assertEqual(other['code'], 'site_proposed')
        self.assertNotEqual(other['siteId'], first['siteId'])
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.queue.propose(ADMIN, 'site-one', 'boss', {'x': 160, 'y': 64, 'z': 0})

    def test_step_ordering_replay_and_freeze_rules(self):
        site_id = self.site()
        with self.assertRaisesRegex(ValueError, 'not_acceptable'):
            self.queue.record(ADMIN, 'too-early', site_id, 'scout', {'surface': 'plains'})
        self.queue.approve(ADMIN, 'go-one', site_id)
        with self.assertRaisesRegex(ValueError, 'out_of_order'):
            self.queue.record(ADMIN, 'skip', site_id, 'proof', {'kills': []})
        self.assertEqual(self.queue.record(ADMIN, 'rec-scout', site_id, 'scout', {'surface': 'plains'})['status'], 'scouted')
        replay = self.queue.record(ADMIN, 'rec-scout-again', site_id, 'scout', {'surface': 'plains'})
        self.assertEqual((replay['code'], replay['status']), ('site_step_recorded', 'scouted'))
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.queue.record(ADMIN, 'rec-scout-differs', site_id, 'scout', {'surface': 'desert'})
        row = self.queue.read(ADMIN, site_id)
        self.assertEqual(row['receipts']['scout'], content.digest({'surface': 'plains'}))
        with self.assertRaisesRegex(ValueError, '^site_not_approvable$'):
            self.queue.approve(ADMIN, 'go-two', site_id)
        self.assertEqual(self.queue.read(ADMIN, site_id), row)
        self.assertEqual(self.queue.read(AUTHOR, 'site-ffffffffffffffffffffffff')['ok'], False)
        for actor in ('game:qd-survivor', 'player'):
            with self.assertRaisesRegex(ValueError, 'actor'):
                self.queue.read(actor, site_id)
            with self.assertRaisesRegex(ValueError, 'actor'):
                self.queue.recover(actor, site_id)

    def test_crash_between_receipt_and_record_heals_from_disk_truth(self):
        site_id = self.site()
        self.queue.approve(ADMIN, 'go-one', site_id)
        self.queue.record(ADMIN, 'rec-scout', site_id, 'scout', {'surface': 'plains'})
        path = self.queue.root / 'sites' / (site_id + '.json')
        row = content.load(path)
        row.update(status='approved', steps={'scout': 'pending', 'place': 'pending', 'proof': 'pending', 'cleanup': 'pending'}, receipts={})
        content.save(path, row)
        report = self.queue.recover(ADMIN, site_id)
        self.assertEqual(report['recovered'], ['scout'])
        self.assertEqual(report['status'], 'scouted')
        self.assertEqual(report['nextStep'], 'place')
        healed = self.queue.read(ADMIN, site_id)
        self.assertEqual(healed['steps']['scout'], 'recorded')
        self.assertEqual(healed['receipts']['scout'], content.digest({'surface': 'plains'}))

    def test_missing_receipt_is_unknown_and_freezes_instead_of_rewriting(self):
        site_id = self.site()
        self.queue.approve(ADMIN, 'go-one', site_id)
        self.queue.record(ADMIN, 'rec-scout', site_id, 'scout', {'surface': 'plains'})
        (self.queue.root / 'receipts' / (site_id + '-scout.json')).unlink()
        report = self.queue.recover(ADMIN, site_id)
        self.assertEqual(report['unknown'], ['scout'])
        self.assertEqual(report['status'], 'outcome_unknown')
        with self.assertRaisesRegex(ValueError, 'not_acceptable'):
            self.queue.record(ADMIN, 'rec-place', site_id, 'place', {'entities': []})
        self.assertEqual(self.queue.recover(ADMIN, site_id)['status'], 'outcome_unknown')

    def test_capabilities_report_ledger_progress_without_flipping_ready(self):
        for kind in ('boss', 'chest'):
            entry = content.BLOCKED[kind]
            self.assertFalse(entry['ready'])
            self.assertEqual(entry['steps']['ledger'], 'implemented')
            self.assertEqual(entry['steps']['scout'], 'planned')
        offline = content.ContentQueue(self.team).context()
        self.assertFalse(offline['ok'])
        for kind in ('boss', 'chest'):
            capability = offline['capabilities'][kind]
            self.assertFalse(capability['ready'])
            self.assertEqual(capability['code'], kind + '_adapter_missing')
            self.assertEqual(capability['steps']['ledger'], 'implemented')
            capability['steps']['ledger'] = 'mutated'
        self.assertEqual(content.BLOCKED['boss']['steps']['ledger'], 'implemented')
