"""Build a pinned Geyser-only extension outside Git; never installs or opens ports."""
from pathlib import Path
import argparse, hashlib, json, subprocess, zipfile

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
for name in ('geyser','gson','jdk','output'):parser.add_argument('--'+name,required=True,type=Path)
args=parser.parse_args()
pins={'geyser':'39d8a45eca9f2413080b9597c67d1b2bf3bc9b62e8577f46eb83c9c8abfc4499','gson':'4241c14a7727c34feea6507ec801318a3d4a90f070e4525681079fb94ee4c593'}
for name,sha in pins.items():assert hashlib.sha256(getattr(args,name).read_bytes()).hexdigest()==sha,('Dependency mismatch',name)
out=args.output.resolve();assert not out.exists() and not out.is_relative_to(ROOT.parent.parent.parent)
out.mkdir(parents=True);classes=out/'classes';classes.mkdir()
sources=list((ROOT/'src').rglob('*.java'))+[ROOT.parent/'freesia-optional/bridge/org/afuhome/appearance/ModelCatalog.java']
subprocess.run([str(args.jdk/'bin/javac.exe'),'-proc:none','-encoding','UTF-8','--release','21','-cp',str(args.geyser)+';'+str(args.gson),'-d',str(classes),*map(str,sources)],check=True)
jar=out/'AgentAppearance-Bedrock-0.1.0.jar'
with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as dst:
    for path in classes.rglob('*.class'):dst.writestr(path.relative_to(classes).as_posix(),path.read_bytes())
    # Extension-local Gson. Preserve upstream notice; no resources/binaries in Git.
    with zipfile.ZipFile(args.gson) as gson:
        for item in gson.infolist():
            if item.filename.startswith('com/google/gson/') or item.filename.startswith('META-INF/maven/com.google.code.gson/'):dst.writestr(item,gson.read(item.filename))
    dst.writestr('extension.yml','id: ysmbedrock\nname: AgentAppearanceBedrock\nmain: org.afuhome.appearance.BedrockAppearance\napi: 2.9.0\nversion: 0.1.0\nauthors: [AgentFriend]\n')
manifest={'dependencies':pins,'sources':{str(p.relative_to(ROOT.parent)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},'outputs':{jar.name:hashlib.sha256(jar.read_bytes()).hexdigest()}}
(out/'build-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps(manifest['outputs']))
