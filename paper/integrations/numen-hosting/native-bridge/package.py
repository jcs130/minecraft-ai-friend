from pathlib import Path
import argparse,hashlib,json,zipfile
parser=argparse.ArgumentParser();parser.add_argument('--classes',required=True);parser.add_argument('--output',required=True)
args=parser.parse_args();root=Path(__file__).resolve().parent;classes=Path(args.classes);out=Path(args.output)
assert not out.exists() and (classes/'local/hosting/mixin/HostedRespawnMixin.class').is_file()
with zipfile.ZipFile(out,'x',zipfile.ZIP_DEFLATED) as jar:
    for file in sorted(classes.rglob('*.class')):jar.writestr(file.relative_to(classes).as_posix(),file.read_bytes())
    jar.writestr('META-INF/neoforge.mods.toml',(root/'neoforge.mods.toml').read_bytes())
    jar.writestr('qiandengji-hosted.mixins.json',(root/'qiandengji-hosted.mixins.json').read_bytes())
print(json.dumps({'artifact':str(out),'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}))
