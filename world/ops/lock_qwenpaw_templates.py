"""Disable only the independent image's two automatic builtin profiles."""
import json
from pathlib import Path
from init_qwenpaw_runtime import lock_builtin_profiles, write


if __name__ == '__main__':
    from qwenpaw.config.config import Config
    path = Path('/state/work/config.json')
    config = Config.model_validate_json(path.read_text())
    assert {'mc-god', 'mc-herald'} <= set(config.agents.profiles)
    lock_builtin_profiles(config)
    config.agents.active_agent = 'mc-god'
    write(path, config.model_dump(mode='json', exclude_none=True))
    print(json.dumps({'project': 'qiandengji', 'ok': True,
                      'disabledBuiltinProfiles': ['default', 'QwenPaw_QA_Agent_0.2']}))
