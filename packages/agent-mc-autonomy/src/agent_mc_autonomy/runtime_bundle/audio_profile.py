"""Deterministic optional-music projection; original retained audio is unchanged."""

import copy
import hashlib
import json


def project_effects_audio(data: bytes) -> tuple[bytes, tuple[str, ...]]:
    original = json.loads(data)
    value = copy.deepcopy(original)
    removed = tuple(sorted(name for name in original['fileMetadata']
                           if name.startswith(('music/', 'records/'))))
    excluded = set(removed)
    value['fileMetadata'] = {k: v for k, v in original['fileMetadata'].items() if k not in excluded}
    value['files'] = {k: v for k, v in original['files'].items() if k not in excluded}
    events = {}
    for name, variants in original['events'].items():
        kept = [row for row in variants if row['file'] not in excluded]
        if kept or not variants:
            events[name] = kept
    value['events'] = events
    value['eventMetadata'] = {k: v for k, v in original.get('eventMetadata', {}).items() if k in events}
    value['audioProfile'] = 'effects-only'
    value['sourceManifestSha256'] = hashlib.sha256(data).hexdigest()
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8'), removed


def resource_profile(pin: dict, profile: str, sound_manifest: str) -> tuple[dict, tuple[str, ...]]:
    expected = dict(pin['offline_resources'])
    if profile == 'complete':
        return expected, ()
    if profile != 'effects-only':
        raise ValueError('runtime_bundle_audio_profile_invalid')
    selected = pin.get('offline_resource_profiles', {}).get(profile, {})
    if (selected.get('sourceManifestSha256') != expected.get(sound_manifest)
            or set(selected.get('overrides', {})) != {sound_manifest}
            or not isinstance(selected.get('omitted'), list)):
        raise ValueError('runtime_bundle_audio_profile_invalid')
    expected.update(selected['overrides'])
    return expected, tuple(selected['omitted'])
