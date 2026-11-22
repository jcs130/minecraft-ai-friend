import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apply_access import rebuild_region


def record(data):
    return struct.pack(">IB", len(data) + 1, 2) + data


def region(tail):
    header = bytearray(8192)
    struct.pack_into(">II", header, 0, (2 << 8) | 1, (3 << 8) | 2)
    return bytes(header) + record(b"original").ljust(4096, b"\0") + tail


class AccessRegions(unittest.TestCase):
    def test_accepts_complete_unpadded_tail_and_preserves_record(self):
        tail = record(b"x" * 5000)
        changed = record(b"updated")
        result = rebuild_region(region(tail), {0: changed})
        self.assertEqual(len(result), 5 * 4096)
        self.assertEqual(result[8192:8192+len(changed)], changed)
        self.assertEqual(result[12288:12288+len(tail)], tail)

    def test_rejects_truncated_payload_even_when_that_chunk_is_replaced(self):
        tail = record(b"x" * 5000)
        with self.assertRaisesRegex(ValueError, "truncated region record"):
            rebuild_region(region(tail[:-1]), {1: record(b"replacement")})

    def test_rejects_overlapping_sector_pointers(self):
        raw = bytearray(region(record(b"x" * 5000)))
        struct.pack_into(">I", raw, 0, (3 << 8) | 2)
        with self.assertRaisesRegex(ValueError, "overlapping source region pointers"):
            rebuild_region(raw, {})
