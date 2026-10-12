import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import maw_bedrock_voices as voices
from maw_bedrock_resources import sha


class NativeVoiceTests(unittest.TestCase):
    def fixture(self, root, audio=None):
        jar = root/'source.jar'
        with zipfile.ZipFile(jar, 'w') as z:
            z.writestr('assets/touhou_little_maid/sounds.json', json.dumps({v: {} for v in voices.EVENTS.values()}))
            for pack in ('first', 'second'):
                base = 'assets/touhou_little_maid/tlm_custom_pack/native/assets/'+pack+'/'
                z.writestr(base+'maid_sound.json', json.dumps({'author': ['Original author']}))
                for i, name in enumerate(('mode/idle1', 'mode/farm1', 'mode/attack1', 'mode/range_attack1', 'ai/hurt1')):
                    z.writestr(base+'sounds/maid/'+name+'.ogg', audio or (b'OggS\0\0\x01vorbis'+pack.encode()+bytes([i])))
                # Native loader ignores filenames without a numeric suffix.
                z.writestr(base+'sounds/maid/mode/idle_invalid.ogg', b'not audio')
        return jar

    def test_original_bytes_two_packs_and_additive_reuse_probability(self):
        with tempfile.TemporaryDirectory() as tmp:
            jar = self.fixture(Path(tmp)); entries, catalog = voices.convert(jar, expected_sha=sha(jar.read_bytes()))
            self.assertEqual(catalog['recordingCount'], 10)
            self.assertEqual(catalog['uniqueRecordings'], 10)
            self.assertEqual(len(catalog['packs']), 2)
            first, second = catalog['packs']
            for p in (first, second):
                events = p['events']
                self.assertEqual(len(events['touhou_little_maid:maid.mode.farm']['clips']), 2)
                self.assertEqual(len(events['touhou_little_maid:maid.mode.range_attack']['clips']), 2)
                self.assertEqual(events['touhou_little_maid:maid.ai.hurt']['clips'], events['touhou_little_maid:maid.ai.hurt_fire']['clips'])
            self.assertNotEqual(first['events']['touhou_little_maid:maid.mode.idle']['sound'], second['events']['touhou_little_maid:maid.mode.idle']['sound'])
            with zipfile.ZipFile(jar) as z:
                for clip in catalog['clips'].values():
                    self.assertEqual(entries[clip['file']], z.read(clip['sources'][0]))
            self.assertEqual((entries, catalog), voices.convert(jar, expected_sha=sha(jar.read_bytes())))

    def test_unpinned_or_invalid_audio_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); jar = self.fixture(root)
            with self.assertRaisesRegex(ValueError, 'hash locked'):
                voices.convert(jar)
            jar = self.fixture(root, b'OggSnot-vorbis')
            with self.assertRaisesRegex(ValueError, 'Vorbis'):
                voices.convert(jar, expected_sha=sha(jar.read_bytes()))

    def test_modified_audio_and_missing_reuse_are_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            jar = self.fixture(Path(tmp)); h = sha(jar.read_bytes()); entries, catalog = voices.convert(jar, expected_sha=h)
            def zipped(values):
                data = io.BytesIO()
                with zipfile.ZipFile(data, 'w') as z:
                    for k, v in values.items(): z.writestr(k, v)
                return zipfile.ZipFile(io.BytesIO(data.getvalue()))
            with patch.object(voices, 'TLM_SHA', h):
                with zipped(entries) as z: voices.validate(catalog, z)
                tampered = dict(entries); clip = next(iter(catalog['clips'].values()))
                tampered[clip['file']] = b'corrupt'
                with zipped(tampered) as z, self.assertRaisesRegex(ValueError, 'recording changed'):
                    voices.validate(catalog, z)
                definitions = json.loads(entries['sounds/sound_definitions.json'])
                event = catalog['packs'][0]['events']['touhou_little_maid:maid.mode.farm']['sound']
                definitions['sound_definitions'][event]['sounds'].pop()
                tampered = {**entries, 'sounds/sound_definitions.json': json.dumps(definitions).encode()}
                with zipped(tampered) as z, self.assertRaisesRegex(ValueError, 'pool changed'):
                    voices.validate(catalog, z)


if __name__ == '__main__': unittest.main()
