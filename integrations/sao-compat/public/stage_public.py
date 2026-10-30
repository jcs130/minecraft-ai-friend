"""Prepare a new sealed, loopback-only SAO candidate. Does not stop any service."""
from pathlib import Path
import argparse, hashlib, json, shutil

ROOT=Path('E:/MC/servers/sao-0.76.1')
def digest(p):
    with Path(p).open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def freeze(root):
    root=Path(root);files={}
    for base in [root/'ops/gateway',root/'ops/service-tools']:
        for p in base.rglob('*'):
            if p.is_file()and'__pycache__'not in p.parts:files[p.relative_to(root).as_posix()]=digest(p)
    mods={p.name:digest(p)for p in(root/'server/mods').glob('*.jar')}
    for p in(root/'server/mods').glob('*.jar'):files[p.relative_to(root).as_posix()]=mods[p.name]
    java=next((root/'java').glob('*/bin/java.exe'));files[java.relative_to(root).as_posix()]=digest(java)
    for name in ['user_jvm_args.txt','libraries/net/minecraftforge/forge/1.20.1-47.4.10/win_args.txt']:
        p=root/'server'/name;files[p.relative_to(root).as_posix()]=digest(p)
    for relative in ['pack-source.json','agent-connection.json','ops/front-java_front.json','ops/front-agent_front.json','ops/compat.json','ops/bedrock/ViaProxy-3.4.14.jar','ops/bedrock/plugins/Geyser-ViaProxy.jar','ops/bedrock/plugins/Geyser/config.yml','ops/bedrock/plugins/Geyser/maw-native-items.json','ops/bedrock/plugins/Geyser/packs/maw-native-icons.mcpack','ops/bedrock/plugins/Geyser/custom_mappings/maw-native-icons.json']:
        p=root/relative
        if p.exists():files[relative]=digest(p)
    # The shared-account authority paths and enabled flag are deployment policy.
    p=root/'server/config/maw-shared-accounts.properties'
    if p.exists():files[p.relative_to(root).as_posix()]=digest(p)
    p=root/'ops/release.json';p.write_text(json.dumps({'schemaVersion':1,'minecraft':'1.20.1','mods':mods,'files':files},indent=2),encoding='utf-8')
    return len(files)
def stage(root,work,source):
    root,work,source=Path(root).resolve(),Path(work).resolve(),Path(source).resolve()
    if root!=ROOT.resolve()or(root/'ops/service.json').exists():raise ValueError('new_owned_sao_config_required')
    if json.loads((root/'pack-source.json').read_text())['scope']!='managed_server':raise ValueError('cold_promoted_server_required')
    from ali_login_compat import EXCEPTION,verify_mods
    verify_mods(root/'server/mods')
    ops=root/'ops';gw=ops/'gateway';gw.mkdir();node=Path('C:/Users/lzl19/AppData/Local/hermes/node/node.exe');shutil.copy2(node,gw/'node.exe')
    shutil.copytree(source/'node_modules',gw/'node_modules')
    dest=gw/'integrations/sao-compat';dest.mkdir(parents=True)
    for name in ['package.json','package-lock.json','sao_bot.cjs','forge_client.cjs','native_registry.cjs','sao-client.cjs','sao-operations.json','sao-tools.cjs','sao-engine.mjs','protection-client.cjs','craft-fence.cjs']:shutil.copy2(source/name,dest/name)
    shutil.copytree(source/'public',gw/'public');shutil.copytree(source/'public',dest/'public')
    other=gw/'integrations/tau-ceti/native-bridge';other.mkdir(parents=True)
    for name in ['native-client.cjs','operations.json']:shutil.copy2(source.parent/'tau-ceti/native-bridge'/name,other/name)
    tools=ops/'service-tools';tools.mkdir()
    for name in ['sao_service.py','publish_assets.py','bedrock_health.py','listener_policy.py']:shutil.copy2(source/'public'/name,tools/name)
    shutil.copy2('E:/MC/servers/tau-ceti-1.3.3/ops/maw_service.py',tools/'maw_service.py')
    jar=work/'sao-native-build/build/libs/maw-sao-native-0.1.0.jar';shutil.copy2(jar,root/'server/mods'/jar.name)
    (root/'agent-connection.json').write_text(json.dumps({'host':'127.0.0.1','port':39676,'loginUsername':'ag_Kirito','loginPasswordEnv':'SAO_GAME_PASSWORD'},indent=2),encoding='utf-8')
    config={'schemaVersion':1,'root':str(root),'publicGameAccess':False,'bedrockEnabled':False,'java':str(next((root/'java').glob('*/bin/java.exe'))),'bridgeJava':'E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe','sourceDirectory':str(dest)}
    (ops/'service.json').write_text(json.dumps(config,indent=2),encoding='utf-8')
    for role,port in [('java_front',38976),('agent_front',38977)]:
        value={'host':'127.0.0.1','port':port,'backendPort':39676,'assetsRoot':str(ops/'public-assets')if role=='agent_front'else None};(ops/('front-'+role+'.json')).write_text(json.dumps(value,indent=2),encoding='utf-8')
    auth=root/'server/world/serverconfig';auth.mkdir(parents=True,exist_ok=True)
    (auth/'DirectAuth-config.json').write_text(json.dumps({'language':'en','sessionGracePeriod':0,'minPasswordLength':8,'maxPasswordLength':72,'maxAccountsPerIP':32,'heldPayloadExceptions':['maw_agent:world_query',EXCEPTION]}),encoding='utf-8')
    (auth/'DirectAuth-lang-en.json').write_text(json.dumps({'msgLoginRequest':'§e请输入 /login <密码> 登录。','msgRegisterRequest':'§e首次进入，请使用 /register <密码> 注册（至少8位）。','msgAuthReminder':'§e请先注册或登录，再开始游玩。','msgLoginSuccess':'§a登录成功，欢迎来到 SAO！','errWrongPassword':'§c密码不正确。','errAlreadyRegistered':'§e此账号已注册，请使用 /login <密码>。'},ensure_ascii=False),encoding='utf-8')
    voice=root/'server/config/voicechat';voice.mkdir(exist_ok=True)
    original=Path('E:/MC/servers/tau-ceti-1.3.3/server/config/voicechat/voicechat-server.properties').read_text(encoding='utf-8')
    import re
    original=re.sub(r'(?m)^port=.*$','port=38989',original);original=re.sub(r'(?m)^bind_address=.*$','bind_address=127.0.0.1',original);original=re.sub(r'(?m)^voice_host=.*$','voice_host=',original)
    (voice/'voicechat-server.properties').write_text(original,encoding='utf-8')
    return freeze(root)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('--work',required=True);p.add_argument('--source',required=True);a=p.parse_args();print(json.dumps({'frozenFiles':stage(a.root,a.work,a.source),'public':False}))
