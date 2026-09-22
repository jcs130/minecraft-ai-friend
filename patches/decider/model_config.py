"""Resolve weights and calibration from one snapshot; never silently serve defaults.

Installed as decider/model_config.py alongside the small serve-config.patch.
No torch import: resolution and validation can be tested without a GPU.
"""
import hashlib
import json
import math
import os
from pathlib import Path


def load_model_config(model, environ=None, download=None):
    env = os.environ if environ is None else environ
    root = Path(model)
    if not root.is_dir():
        if download is None:
            from huggingface_hub import snapshot_download
            download = snapshot_download
        root = Path(download(repo_id=model, revision=env.get('DECIDER_REVISION'),
            cache_dir=env.get('HF_HUB_CACHE'), allow_patterns=[
                '*.json', '*.safetensors', '*.model', '*.tiktoken', '*.jinja', 'vocab.*', 'merges.txt']))
    raw = (root / 'decider_config.json').read_bytes()
    if len(raw) > 16384:
        raise ValueError('decider_config_too_large')
    cfg = json.loads(raw)
    if not isinstance(cfg, dict) or not isinstance(cfg.get('version'), str) or not 1 <= len(cfg['version']) <= 40:
        raise ValueError('decider_config_version_missing')
    for key in ('temperature', 'temperature_schema_first'):
        value = cfg.get(key, cfg.get('temperature'))
        if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
            raise ValueError('decider_config_temperature_invalid')
    for key in ('neutralize_none', 'schema_first', 'schema_first_trained', 'isolated_levels'):
        if key in cfg and type(cfg[key]) is not bool:
            raise ValueError('decider_config_flag_invalid')
    temperature = float(env.get('DECIDER_TEMPERATURE', cfg['temperature']))
    if not math.isfinite(temperature) or temperature <= 0:
        raise ValueError('decider_temperature_override_invalid')
    revision = root.name if root.parent.name == 'snapshots' else None
    return str(root.resolve()), cfg, {'configLoaded': True, 'configSha256': hashlib.sha256(raw).hexdigest(),
        'revision': revision, 'modelName': 'decider-' + cfg['version'], 'temperature': temperature,
        'temperatureOverridden': 'DECIDER_TEMPERATURE' in env}
