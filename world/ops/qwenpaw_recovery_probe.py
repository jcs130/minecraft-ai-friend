"""Offline image contract check: no user state, server, or model calls."""
import hashlib
import importlib.metadata
import inspect
import json
from pathlib import Path
import sys


def main():
    sys.path.insert(0, '/ops')
    expected = {'qwenpaw': '2.2.0', 'agentscope': '2.0.7.post1',
                'reme-ai': '0.4.1.10', 'nbtlib': '2.0.4',
                'quickjs-ng': '0.16.2.1', 'transformers': '4.57.1'}
    actual = {name: importlib.metadata.version(name) for name in expected}
    assert actual == expected, actual
    from llm_runtime_policy import install as llm_install
    from reme_status_compat import install as reme_install
    from native_tool_runtime import install as tools_install
    assert llm_install('game') == 1
    assert reme_install('game') == 1
    assert tools_install('game') == 1
    from survival_turn_runtime import install as finish_install
    from life_memory_evidence_runtime import install as memory_install
    assert finish_install('game') == 3
    from survival_request_runtime import install as request_install
    assert request_install('game') == 1
    assert memory_install('game') == 1
    from engineering_task_runtime import check_native_contract
    assert check_native_contract() == 1
    from qwenpaw.app.crons.executor import CronExecutor
    assert inspect.iscoroutinefunction(CronExecutor.execute)
    from qwenpaw.config.config import Config, AgentProfileConfig
    from qwenpaw.drivers.storage import load_card
    from qwenpaw.cli.main import cli
    from qwenpaw.app.multi_agent_manager import MultiAgentManager
    import quickjs
    import nbtlib
    source = Path(inspect.getfile(MultiAgentManager)).read_bytes()
    assert b'Qiandengji: disabled default is intentional' in source
    package = importlib.metadata.distribution('qwenpaw')
    assert any(str(f).endswith('index.html') for f in package.files), 'console assets missing'
    print(json.dumps({'ok': True, 'versions': actual,
                      'readinessSourceSha256': hashlib.sha256(source).hexdigest(),
                      'modelCalls': 0, 'stateMounted': False,
                      'patches': ['readiness', 'iteration-policy', 'reme-status', 'native-tools',
                                  'explicit-survival-finish', 'life-memory-evidence', 'engineering-native-help']}))


if __name__ == '__main__':
    main()
