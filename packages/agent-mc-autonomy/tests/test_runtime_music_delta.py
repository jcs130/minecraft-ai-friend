"""The music ZIP can add only the fixed omitted media and three receipts."""
import hashlib
import io
import json
import threading
import zipfile

import pytest

from agent_mc_autonomy.runtime_bundle import BundleError
from agent_mc_autonomy.runtime_bundle import download as d


@pytest.fixture
def delta(tmp_path, monkeypatch):
    base = tmp_path / 'base'
    base.mkdir()
    sound = 'assets/public/sounds/manifest.json'
    music = 'assets/public/sounds/music/song.ogg'
    originals = {'node/node.exe': b'node fixture', 'assets/public/sounds/step.ogg': b'original effect'}
    for name, data in originals.items():
        file = base / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
    (base / d.INVENTORY).write_text(json.dumps({name: {'bytes': len(data)} for name, data in originals.items()}))
    expected_base = 'a' * 64
    pin = {'offline_resources': {sound: 'b' * 64}, 'offline_resource_profiles': {'effects-only': {
        'sourceManifestSha256': 'b' * 64, 'overrides': {sound: 'c' * 64}, 'omitted': [music]}}}
    monkeypatch.setattr(d, 'source_pin', lambda: pin)
    def verify(root, *, expected_manifest_sha256):
        if root == base:
            assert expected_manifest_sha256 == expected_base
            return {'audioProfile': 'effects-only', 'resources': {'assetDirectory': 'assets'}}
        assert (root / music).read_bytes() == b'original music'
        assert all((root / name).read_bytes() == data for name, data in originals.items())
        return {'audioProfile': 'complete'}
    monkeypatch.setattr(d, 'verify_bundle', verify)
    rows = {d.MANIFEST: b'complete fixed manifest', d.INVENTORY: b'complete fixed inventory',
            sound: b'original complete audio manifest', music: b'original music'}
    def package(extra=None):
        entries = {**rows, **(extra or {})}
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
        data = output.getvalue()
        target = tmp_path / ('music-' + str(len(data)) + '.zip')
        target.write_bytes(data)
        spec = d.ReleaseBundle('https://github.com/fixture/r/releases/download/v1/music.zip', len(data),
            hashlib.sha256(data).hexdigest(), hashlib.sha256(rows[d.MANIFEST]).hexdigest(), sum(map(len, entries.values())))
        return target, spec
    return base, expected_base, package


def test_music_delta_reuses_unchanged_base_without_downloading_it(delta, tmp_path):
    base, expected, package = delta
    archive, spec = package()
    destination = tmp_path / 'new'
    d.unpack_archive(archive, destination, spec, base_root=base, base_manifest_sha256=expected)
    assert (base / 'assets/public/sounds/step.ogg').read_bytes() == b'original effect'
    assert not (base / 'assets/public/sounds/music').exists()


@pytest.mark.parametrize('name', ['node/node.exe', 'assets/public/sounds/step.ogg', '../escape', 'extra.exe'])
def test_music_delta_cannot_replace_code_effects_or_unlisted_files(delta, tmp_path, name):
    base, expected, package = delta
    archive, spec = package({name: b'not music'})
    with pytest.raises(BundleError):
        d.unpack_archive(archive, tmp_path / 'new', spec, base_root=base, base_manifest_sha256=expected)
    assert (base / 'node/node.exe').read_bytes() == b'node fixture'


def test_cancel_music_copy_keeps_the_base_unchanged(delta, tmp_path):
    base, expected, package = delta
    archive, spec = package()
    cancel = threading.Event()
    def progress(row):
        if row['phase'] == 'copying':
            cancel.set()
    with pytest.raises(BundleError, match='cancelled'):
        d.unpack_archive(archive, tmp_path / 'new', spec, base_root=base, base_manifest_sha256=expected,
                         progress=progress, cancelled=cancel)
    assert (base / 'assets/public/sounds/step.ogg').read_bytes() == b'original effect'
