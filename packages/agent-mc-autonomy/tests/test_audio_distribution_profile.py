"""Music is optional only through an exact, fixed resource projection."""
import hashlib
import json

import pytest

from agent_mc_autonomy.runtime_bundle.audio_profile import (
    project_effects_audio,
    resource_profile,
)


def test_effects_projection_retains_original_bytes_metadata_and_empty_events():
    original = {'fileMetadata': {'step.ogg': {'sha256': 'a'}, 'music/song.ogg': {'sha256': 'b'}},
                'files': {'step.ogg': 'c', 'music/song.ogg': 'd'},
                'events': {'step': [{'file': 'step.ogg', 'pitch': 1.5}],
                           'music.game': [{'file': 'music/song.ogg'}], 'intentional.silence': []},
                'eventMetadata': {'step': {'subtitle': 'steps'}, 'music.game': {}, 'intentional.silence': {}},
                'minecraftVersion': '1.21.1'}
    data = json.dumps(original).encode()
    result, omitted = project_effects_audio(data)
    projected = json.loads(result)
    assert omitted == ('music/song.ogg',)
    assert projected['files'] == {'step.ogg': 'c'}
    assert projected['fileMetadata']['step.ogg'] == original['fileMetadata']['step.ogg']
    assert projected['events'] == {'step': original['events']['step'], 'intentional.silence': []}
    assert projected['sourceManifestSha256'] == hashlib.sha256(data).hexdigest()
    assert original['events']['music.game']  # input never mutated


def test_resource_profile_keeps_all_other_pins_and_rejects_unknown_projection():
    key = 'assets/public/sounds/manifest.json'
    pin = {'offline_resources': {key: 'a', 'original.png': 'b'},
           'offline_resource_profiles': {'effects-only': {'sourceManifestSha256': 'a',
                'overrides': {key: 'c'}, 'omitted': ['assets/public/sounds/music/song.ogg']}}}
    assert resource_profile(pin, 'complete', key) == (pin['offline_resources'], ())
    assert resource_profile(pin, 'effects-only', key) == (
        {key: 'c', 'original.png': 'b'}, ('assets/public/sounds/music/song.ogg',))
    for profile in ['anything', 'unknown']:
        with pytest.raises(ValueError):
            resource_profile(pin, profile, key)
    pin['offline_resource_profiles']['effects-only']['overrides']['original.png'] = 'tampered'
    with pytest.raises(ValueError):
        resource_profile(pin, 'effects-only', key)
