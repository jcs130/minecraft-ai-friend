"""Reviewed upstream contracts for the two reversible game releases.

Source checks cover the native entry points retained by our scoped adapters.
They are not a migration and never modify state or installed packages.
"""
import hashlib
import importlib.metadata
import inspect

RELEASES = {
    '2.2.0': {'agentscope': '2.0.7.post1', 'reme-ai': '0.4.1.10'},
    '2.2.1': {'agentscope': '2.0.7.post1', 'reme-ai': '0.4.1.11'},
}
SOURCES = {
    'agent': ('agents/react_agent.py', {
        '2.2.0': '24637f07e82d30bd96c1c89af288d2716a81abd4fd692da32621653e6676f62b',
        '2.2.1': '3c3268502ff6b5d2c28757b110f688680c60e9b075626f6d70a0ab41c6524547'}),
    'builder': ('runtime/builder.py', {
        '2.2.0': '3e104a3e540eec3c5134a82448460c5244243eb12d53b5b7d522c31195e6454a',
        '2.2.1': '7cfd1bf4177b40f70a6fdcdda7144e7c5192a91b2919b8fc840076fc958741c2'}),
    'policy': ('governance/tool_adapter.py', {
        '2.2.0': '47b06aa46b1811b48f223fd897a58cfd566c6c4bb7f0e7c2bb1e87c4013e879b',
        '2.2.1': '742666483c5ba641583dab6519f4369ece4587558bf137bea779a60cf5ac8941'}),
    'legacy': ('runtime/tool_guard.py', '1c49451fbeed996ab5923640b5685fe987a87a36a4ca0fc68a296d201a27ae55'),
    'engine': ('security/tool_guard/engine.py', '117500f5aff482746fbbcd14538fc8fb56ddfa571375b4ff8fd8afdd56441b45'),
    'file_guard': ('security/tool_guard/guardians/file_guardian.py', '7669b427d886f3b7188a1cc729efd21f121ffb40230bfc7fe0c0f6d0b5cb30ab'),
    'rule_guard': ('security/tool_guard/guardians/rule_guardian.py', '758596c99cf4dac8da7b67628404d5f3694baf9fc97a06f0ddddd5ca257b6555'),
}
CALLABLES = {
    'next_action': '5036f1677b5f00b30e96f60199705eda8f226fe94113536de44aa7b20bb4b836',
    'reasoning_impl': '69e23b3beef67a875ea0f8932b23932bd17208f9b5f60b6e034f05a0b9cc1ebc',
    'prepare_model_input': 'e880fe580fc1e3b8e31d5fc47f4434c5637493ce48172cb48353c1bbcc61af94',
}


def release():
    version = importlib.metadata.version('qwenpaw')
    dependencies = RELEASES.get(version)
    if dependencies is None or any(importlib.metadata.version(name) != wanted
                                    for name, wanted in dependencies.items()):
        raise ValueError('review_new_qwen_runtime_release')
    return version


def verify_sources(*names):
    version = release()
    package = importlib.metadata.distribution('qwenpaw')
    for name in names:
        relative, values = SOURCES[name]
        wanted = values[version] if isinstance(values, dict) else values
        source = package.locate_file('qwenpaw/' + relative).read_text(encoding='utf8')
        if hashlib.sha256(source.encode()).hexdigest() != wanted:
            raise ValueError('review_new_qwen_runtime_source:' + name)
    return version


def verify_callable(name, function):
    if hashlib.sha256(inspect.getsource(function).encode()).hexdigest() != CALLABLES[name]:
        raise ValueError('review_new_qwen_runtime_callable:' + name)
