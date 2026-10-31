"""Package only owned client code. No registry/world/player/model credentials."""
from pathlib import Path
import argparse,hashlib,io,json,tarfile,zipfile

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
def sha(data):return hashlib.sha256(data).hexdigest()
def build(gateway,server_addon,output):
    if output.exists():raise ValueError('Preserve prior package; choose a new file')
    source=HERE/'agent-access'
    with zipfile.ZipFile(server_addon) as z:contract=z.read('native-operations.json')
    if json.loads(contract)['version']!='0.1.1':raise ValueError('Client contract must come from this exact addon')
    stream=(gateway/'native-viewer-packet.cjs').read_text(encoding='utf-8')
    for marker in ['function nativeRegistries (','function decodeNativePacket (','module.exports =']:
        if stream.count(marker)!=1:raise ValueError('Review changed native packet implementation')
    # Reuse the original bounded decoder/receiver verbatim. Server encoders and
    # their optional mod codecs are deliberately outside the client package.
    decoder=stream[:stream.index('function nativeRegistries (')]+stream[stream.index('function decodeNativePacket ('):stream.index('module.exports =')]
    decoder+='module.exports = { CHANNEL, NAMES, registryHash, decodeNativePacket, attachNativeViewerPackets }\n'
    files={n:(source/n).read_bytes() for n in ['index.cjs','native-world.cjs','mineflayer-plugin.cjs','registry-protocol.cjs']}
    files['native-stream.cjs']=decoder.encode()
    for name in ['native-chunk-remap.cjs','bounded-jsonl.cjs']:files[name]=(gateway/name).read_bytes()
    files['native-client.cjs']=(REPO/'integrations/tau-ceti/native-bridge/native-client.cjs').read_bytes()
    files['operations.json']=contract
    files['README.md']=(HERE/'AGENT_ACCESS.md').read_bytes()
    files['LICENSE']=(REPO/'LICENSE').read_bytes()
    files['package.json']=json.dumps({'name':'@qiandengji/native-adventure-client','version':'0.1.0-test.2',
        'description':'Optional same-connection native data adapter; no bot or model loop',
        'license':'MIT','main':'index.cjs','engines':{'node':'>=22'},'files':list(files),
        'exports':{'.':'./index.cjs','./mineflayer':'./mineflayer-plugin.cjs'}}).encode()
    provenance={'schemaVersion':1,'files':{k:sha(v) for k,v in files.items()},'serverAddonSha256':sha(server_addon.read_bytes()),
        'nativeStreamSourceSha256':sha(stream.encode()),'builderSha256':sha(Path(__file__).read_bytes()),'includesCredentialsOrWorld':False,'published':False}
    files['provenance.json']=json.dumps(provenance,indent=2).encode()
    output.parent.mkdir(parents=True,exist_ok=True)
    with tarfile.open(output,'w:gz') as tar:
        for name,data in sorted(files.items()):
            info=tarfile.TarInfo('package/'+name);info.size=len(data);info.mtime=0;info.mode=0o644;tar.addfile(info,io.BytesIO(data))
    return {'package':str(output),'sha256':sha(output.read_bytes()),'files':len(files),'published':False}
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['gateway','server-addon','output']:p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();print(json.dumps(build(a.gateway,a.server_addon,a.output)))
