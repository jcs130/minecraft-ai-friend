"""Build a pinned Geyser-only extension outside Git; never installs or opens ports."""
from pathlib import Path
import argparse, hashlib, json, subprocess, zipfile

ROOT=Path(__file__).resolve().parent
VERSION='0.2.2'
parser=argparse.ArgumentParser()
for name in ('geyser','gson','jdk','output'):parser.add_argument('--'+name,required=True,type=Path)
args=parser.parse_args()
pins={'geyser':'d808c432bae955413c80ca752f99ea9f7dda52f2552057508646a3ee344a696e','gson':'4241c14a7727c34feea6507ec801318a3d4a90f070e4525681079fb94ee4c593'}
for name,sha in pins.items():assert hashlib.sha256(getattr(args,name).read_bytes()).hexdigest()==sha,('Dependency mismatch',name)
out=args.output.resolve();assert not out.exists() and not out.is_relative_to(ROOT.parent.parent.parent)
out.mkdir(parents=True);classes=out/'classes';classes.mkdir()
sources=list((ROOT/'src').rglob('*.java'))+[ROOT.parent/'freesia-optional/bridge/org/afuhome/appearance/ModelCatalog.java']
# Geyser extensions and Bukkit plugins share parent-visible class names.
# Compile the maintained shared source into an extension-owned namespace so
# package-private helpers can never resolve to NativeAppearance's loader.
generated=out/'generated';generated.mkdir();compiled=[]
for source in sources:
    target=generated/source.name
    text=source.read_text(encoding='utf-8')
    assert 'package org.afuhome.appearance;' in text
    target.write_text(text.replace('org.afuhome.appearance','org.afuhome.geyserappearance'),encoding='utf-8')
    compiled.append(target)
subprocess.run([str(args.jdk/'bin/javac.exe'),'-proc:none','-encoding','UTF-8','--release','21','-cp',str(args.geyser)+';'+str(args.gson),'-d',str(classes),*map(str,compiled)],check=True)
jar=out/f'AgentAppearance-Bedrock-{VERSION}.jar'
with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as dst:
    for path in classes.rglob('*.class'):dst.writestr(path.relative_to(classes).as_posix(),path.read_bytes())
    # Extension-local Gson. Preserve upstream notice; no resources/binaries in Git.
    with zipfile.ZipFile(args.gson) as gson:
        for item in gson.infolist():
            if item.filename.startswith('com/google/gson/') or item.filename.startswith('META-INF/maven/com.google.code.gson/'):dst.writestr(item,gson.read(item.filename))
    dst.writestr('extension.yml',f'id: ysmbedrock\nname: AgentAppearanceBedrock\nmain: org.afuhome.geyserappearance.BedrockAppearance\napi: 2.11.0\nversion: {VERSION}\nauthors: [AgentFriend]\n')
manifest={'dependencies':pins,'sharedNamespace':'org.afuhome.geyserappearance','sourceNamespace':'org.afuhome.appearance','sources':{str(p.relative_to(ROOT.parent)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},'outputs':{jar.name:hashlib.sha256(jar.read_bytes()).hexdigest()}}
(out/'build-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps(manifest['outputs']))
