"""Stage pinned bridge binaries and native icons. No listener or firewall edits."""
from pathlib import Path
import argparse, hashlib, json, shutil

PINNED={
 'ViaProxy-3.4.14.jar':'2894bbfb2f4342f8fde887af6c689313efd5b0e46a8006775eea0e21e2948ab5',
 'plugins/Geyser-ViaProxy.jar':'b3b39ada8f56a44f018d5e405874cbb2152527fab0240603309831e89e5e95c7',
}
def prepare(root,source,icons,*,public=False,offline_qa=False):
 root,source,icons=map(Path,(root,source,icons))
 if public and offline_qa:raise ValueError('offline_qa_must_never_be_public')
 bridge=root/'ops/bedrock';bridge.mkdir(exist_ok=True)
 for relative,expected in PINNED.items():
  src=source/relative
  with src.open('rb')as stream:actual=hashlib.file_digest(stream,'sha256').hexdigest()
  if actual!=expected:raise ValueError('bridge_binary_hash_mismatch:'+relative)
  dest=bridge/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
 geyser=bridge/'plugins/Geyser';geyser.mkdir(exist_ok=True)
 packs=geyser/'packs';packs.mkdir(exist_ok=True);mappings=geyser/'custom_mappings';mappings.mkdir(exist_ok=True)
 for name,dest in [('maw-native-icons.mcpack',packs),('maw-native-icons.json',mappings),('maw-native-items.json',geyser),('resource-contract.json',geyser)]:shutil.copy2(icons/name,dest/name)
 host,port=('0.0.0.0',28988)if public else('127.0.0.1',38988)
 (geyser/'config.yml').write_text(f'''# SAO compatibility bridge. Xbox validation is mandatory on public listeners.
bedrock:
  address: {host}
  port: {port}
  transport: raknet
  clone-remote-port: false
  signaling:
    mode: none
java:
  auth-type: offline
motd:
  primary-motd: My Agent World SAO
  secondary-motd: Java + Agent + Bedrock
  passthrough-motd: false
  max-players: 20
  passthrough-player-counts: false
gameplay:
  server-name: My Agent World SAO
  show-coordinates: true
  enable-custom-content: true
  enable-integrated-pack: true
  force-resource-packs: true
default-locale: zh_cn
log-player-ip-addresses: false
saved-user-logins: []
advanced:
  java:
    use-direct-connection: false
  bedrock:
    validate-bedrock-login: {'false'if offline_qa else'true'}
    use-haproxy-protocol: false
    use-waterdogpe-forwarding: false
enable-metrics: false
debug-mode: false
config-version: 8
''',encoding='utf-8')
 cfg={'root':str(root),'port':39694,'backendPort':39676,'iconCatalog':str(geyser/'maw-native-items.json'),'forgeClientModule':str(root/'ops/gateway/integrations/sao-compat/forge_client.cjs')}
 (root/'ops/compat.json').write_text(json.dumps(cfg,indent=2),encoding='utf-8')
 return {'bridge':str(bridge),'host':host,'udpPort':port,'xboxValidation':not offline_qa,'pins':PINNED}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('--source',required=True);p.add_argument('--icons',required=True);p.add_argument('--public',action='store_true');p.add_argument('--offline-qa',action='store_true');a=p.parse_args();print(json.dumps(prepare(a.root,a.source,a.icons,public=a.public,offline_qa=a.offline_qa)))
