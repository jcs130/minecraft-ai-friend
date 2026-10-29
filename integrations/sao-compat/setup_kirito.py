"""Freeze an explicit core/Forge adapter composition for the isolated SAO realm."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def setup(root):
    root=Path(root).resolve(strict=True)
    if json.loads((root/'pack-source.json').read_text('utf-8'))['scope']!='isolated_testing':raise ValueError('marked_lab_required')
    here=Path(__file__).resolve().parent
    runtime=root/'kirito-runtime'
    if runtime.exists() and any(runtime.iterdir()):raise FileExistsError('keep_existing_kirito_runtime')
    runtime.mkdir(exist_ok=True)
    distribution=here.parent.parent/'packages/agent-mc-autonomy/src/agent_mc_autonomy/core_distribution'
    source=json.loads((distribution/'source.json').read_text('utf-8'))
    archive=distribution/source['archive']
    if source['version']!='0.5.7-rc.130' or hashlib.sha256(archive.read_bytes()).hexdigest()!=source['sha256']:raise ValueError('canonical_core_archive_required')
    packages=runtime/'packages';packages.mkdir(exist_ok=True)
    if (packages/archive.name).exists():raise FileExistsError('keep_existing_runtime_archive')
    shutil.copyfile(archive,packages/archive.name)
    core=runtime/'core';core.mkdir(exist_ok=True)
    (core/'package.json').write_text(json.dumps({'name':'sao-kirito-core-runtime','private':True,'dependencies':{'agent-mc-world':'file:../packages/agent-mc-world-0.5.7-rc.130.tgz'}}),encoding='utf-8')
    adapter=runtime/'adapter/integrations/sao-compat';adapter.mkdir(parents=True,exist_ok=True)
    files=['package.json','package-lock.json','sao_bot.cjs','sao-engine.mjs','protection-client.cjs','craft-fence.cjs','native_registry.cjs','forge_client.cjs','sao-client.cjs','sao-tools.cjs','sao-operations.json']
    hashes={}
    for name in files:
        shutil.copyfile(here/name,adapter/name);hashes[name]=hashlib.sha256((adapter/name).read_bytes()).hexdigest()
    native=adapter.parent/'tau-ceti/native-bridge';native.mkdir(parents=True,exist_ok=True)
    for name in ['native-client.cjs','operations.json']:
        shutil.copyfile(here.parent/'tau-ceti/native-bridge'/name,native/name)
        hashes['../tau-ceti/native-bridge/'+name]=hashlib.sha256((native/name).read_bytes()).hexdigest()
    wrapper=runtime/'engine.mjs'
    wrapper.write_text("import {createSAOEnginePort} from './adapter/integrations/sao-compat/sao-engine.mjs';\nexport const {EngineBridge,EngineWorld,SERVER_TOOLS,createEngine}=await createSAOEnginePort("+json.dumps({'root':str(root),'packageDirectory':str(core),'adapterDirectory':str(adapter)})+");\n",encoding='utf-8')
    sha=hashlib.sha256(wrapper.read_bytes()).hexdigest()
    # No copied Paper memories, body IDs, passwords or model keys.
    config=f'''[runtime]
mode = "external"
data_directory = {json.dumps(str(runtime/'data'))}
[autonomy]
enabled = true
max_decisions = 10
max_tool_rounds = 6
context_tokens = 65536
context_mode = "compact"
max_output_tokens = 1536
model_timeout_seconds = 120
[server]
host = "127.0.0.1"
port = 39676
username = "ag_Kirito"
auth = "offline"
version = "1.20.1"
[backend]
node = "C:/Users/lzl19/AppData/Local/hermes/node/node.exe"
directory = {json.dumps(str(core/'node_modules/agent-mc-world'))}
[server_extension]
engine_module = {json.dumps(str(wrapper))}
engine_sha256 = "{sha}"
[viewer]
auto_open = false
port = 0
console_port = 0
[planner]
provider = "openai-compatible"
protocol = "chat"
base_url = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
model = "qwen3.7-plus"
api_key_env = "SAO_KIRITO_MODEL_KEY"
image_input = false
[planner.parameters]
enable_thinking = false
[perception]
enabled = true
mineral_vision = false
[native]
remote_textures = false
[native.idle]
enabled = false
allowMovement = false
afterArrival = false
[memory]
mode = "local"
'''
    configfile=runtime/'config.toml'
    if configfile.exists():raise FileExistsError('keep_existing_kirito_configuration')
    configfile.write_text(config,encoding='utf-8')
    shutil.copyfile(here/'KIRITO_GOAL.txt',runtime/'goal.txt')
    (runtime/'composition.json').write_text(json.dumps({'scope':'isolated_testing','core':'0.5.7-rc.130','autonomy':'0.2.129','realm':str(root),'body':'ag_Kirito','transport':'mineflayer_forge_native_registry','adapterFiles':hashes,'engineSha256':sha,'modelKeyStored':False,'paperMemoriesCopied':False},indent=2),encoding='utf-8')
    print(json.dumps({'runtime':str(runtime),'core':'0.5.7-rc.130','body':'ag_Kirito','credentialsStored':False}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);setup(p.parse_args().root)
