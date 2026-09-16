"""Tests for action-receipt pruning (bounds the on-disk receipt archive).

_prune_receipts only touches self.state, so it is exercised through a
lightweight stand-in rather than a fully constructed gateway (which needs
RCON/MC state unavailable in the unit-test environment).
"""
import json, sys, tempfile, time, types, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from numen_gateway import NumenGateway, MAX_ACTION_RECEIPTS


def fake_gateway(state_dir):
    return types.SimpleNamespace(state=Path(state_dir))


def write_receipt(state_dir, action_id, mtime):
    receipts = Path(state_dir) / 'action-receipts'
    receipts.mkdir(parents=True, exist_ok=True)
    p = receipts / (action_id + '.json')
    p.write_text(json.dumps({'actionId': action_id, 'tool': 'goto'}), encoding='utf-8')
    import os
    os.utime(p, (mtime, mtime))
    return p


class PruneReceiptsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)

    def _prune(self):
        NumenGateway._prune_receipts(fake_gateway(self.state), self.state / 'action-receipts')

    def test_no_prune_under_cap(self):
        for i in range(10):
            write_receipt(self.state, '%032x' % i, 1000 + i)
        self._prune()
        remaining = list((self.state / 'action-receipts').glob('*.json'))
        self.assertEqual(len(remaining), 10)

    def test_prunes_oldest_over_cap(self):
        total = MAX_ACTION_RECEIPTS + 20
        for i in range(total):
            write_receipt(self.state, '%032x' % i, 1000 + i)
        self._prune()
        remaining = list((self.state / 'action-receipts').glob('*.json'))
        self.assertEqual(len(remaining), MAX_ACTION_RECEIPTS)
        # The oldest receipt (mtime 1000) must be gone; the newest kept.
        self.assertFalse((self.state / 'action-receipts' / ('%032x.json' % 0)).exists())
        self.assertTrue((self.state / 'action-receipts' / ('%032x.json' % (total - 1))).exists())

    def test_inflight_receipt_never_pruned(self):
        total = MAX_ACTION_RECEIPTS + 20
        inflight_id = '%032x' % 3  # an old receipt that is still in flight
        for i in range(total):
            write_receipt(self.state, '%032x' % i, 1000 + i)
        (self.state / 'inflight-action.json').write_text(
            json.dumps({'actionId': inflight_id}), encoding='utf-8')
        self._prune()
        self.assertTrue((self.state / 'action-receipts' / (inflight_id + '.json')).exists())

    def test_missing_dir_is_noop(self):
        # No receipts directory yet must not raise.
        self._prune()


if __name__ == '__main__':
    unittest.main()
