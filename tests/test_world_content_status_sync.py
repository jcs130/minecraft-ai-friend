"""Regression: a proposal's top-level status must follow its publication receipt.

case content-read-top-status-vs-publication-published (case-a6bdeb0067329cba24d9):
after the 2026-09-14 shift published episode content-47df3307bfd4824c8da43f57,
world_content_read kept answering status='proposed' while the embedded
publication receipt and the context index said 'published', inviting duplicate
approvals and misread acceptance state. These checks pin the contract:
terminal receipts (published/blocked/expired) win over a stale record, the
record itself is healed on publish/tick, and non-terminal receipts never
contradict the still-accurate 'proposed'.
"""
from datetime import date
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
sys.path.insert(0, str(ROOT / 'world/ops'))
import world_content as content
import test_world_content as _baseline

DESIGNER, ADMIN, AUTHOR = content.ACTORS


class ContentStatusSyncTests(_baseline.ContentTests):
    def test_published_receipt_syncs_proposal_top_status_read_and_record(self):
        identity=self.submit_and_approve()
        self.assertEqual(self.tick()['publications'][0]['status'],'published')
        read=self.queue.read(ADMIN,identity)
        self.assertEqual(read['status'],'published')
        self.assertEqual(read['publication']['status'],'published')
        self.assertEqual(content.load(self.queue.root/'proposals'/(identity+'.json'))['status'],'published')
        self.assertNotIn('statusSource',read)
        self.tick()
        self.assertEqual(self.queue.read(DESIGNER,identity)['status'],'published')

    def test_blocked_and_expired_receipts_sync_proposal_top_status(self):
        identity=self.submit_and_approve()
        self.npc.PROFILES[0]['entityBinding']['uuid']='10000000-0000-4000-8000-000000000001'
        self.assertEqual(self.tick()['publications'][0]['status'],'blocked')
        self.assertEqual(self.queue.read(DESIGNER,identity)['status'],'blocked')
        self.assertEqual(self.queue.read(DESIGNER,identity)['publication']['status'],'blocked')
        self.assertEqual(content.load(self.queue.root/'proposals'/(identity+'.json'))['status'],'blocked')
        later=self.episode();later['date']='2026-09-10'
        future=self.queue.submit(DESIGNER,'late',later)['contentId']
        self.queue.publish(ADMIN,'release-late',future)
        outcomes={row['contentId']:row['status'] for row in
            content.tick(self.npc,self.guild,state=self.team,today=date(2026,9,12),clock=lambda:1000)['publications']}
        self.assertEqual(outcomes[future],'expired')
        self.assertEqual(self.queue.read(ADMIN,future)['status'],'expired')
        self.assertEqual(self.queue.read(ADMIN,future)['publication']['status'],'expired')
        self.assertEqual(content.load(self.queue.root/'proposals'/(future+'.json'))['status'],'expired')

    def test_read_never_contradicts_terminal_receipt_and_tick_heals_stale_record(self):
        identity=self.submit_and_approve();self.tick()
        record_path=self.queue.root/'proposals'/(identity+'.json')
        record=content.load(record_path);record['status']='proposed';content.save(record_path,record)
        read=self.queue.read(DESIGNER,identity)
        self.assertEqual(read['status'],'published')
        self.assertEqual(read['statusSource'],'publication')
        self.assertEqual(read['publication']['status'],'published')
        self.assertEqual(content.load(record_path)['status'],'proposed')
        self.tick()
        healed=content.load(record_path)
        self.assertEqual(healed['status'],'published')
        self.assertNotIn('statusSource',healed)
        again=self.queue.read(ADMIN,identity)
        self.assertEqual(again['status'],'published')
        self.assertNotIn('statusSource',again)

    def test_scheduled_publication_keeps_proposed_until_terminal(self):
        value=self.episode();value['date']='2026-09-10'
        identity=self.submit_and_approve(value)
        self.assertEqual(self.tick()['publications'][0]['status'],'scheduled')
        read=self.queue.read(ADMIN,identity)
        self.assertEqual(read['status'],'proposed')
        self.assertIsNone(read['publication'])
        self.assertEqual(content.load(self.queue.root/'proposals'/(identity+'.json'))['status'],'proposed')


if __name__=='__main__':
    unittest.main()
