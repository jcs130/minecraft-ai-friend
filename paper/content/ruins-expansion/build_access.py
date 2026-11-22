"""Compile the reviewed access classes over the pinned installed artifacts."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
CASES = (
    ("AgentFriend-0.4.47.59-shop-rpg.jar",
     "6471b85093b115b435efa962561ecdc41eed2f40dda237340a09c2512de334cc",
     ROOT/"plugins/AgentFriend/src/org/afuhome/agentfriend",
     "org/afuhome/agentfriend/",
     ("DungeonEntrance","SiteDungeonManager","DungeonAdvice","ActionFeedback","AgentCliCatalog","ResidentCli")),
    ("qiandengji-maid-brain-0.1.0.jar",
     "d066cf057e28c9f9ad569dae8bed33b2b853d9e6c77f9e98afa1ccea11876cac",
     ROOT/"integrations/touhou-maids/standalone/src/local/qdj/maids/brain",
     "local/qdj/maids/brain/",
     ("ResidentCliContract",)),
)


def build(java, dependencies, base, output):
    output.mkdir(exist_ok=False, parents=True)
    for name, expected, src, namespace, names in CASES:
        origin=base/name
        if hashlib.sha256(origin.read_bytes()).hexdigest() != expected:
            raise ValueError(f"unexpected baseline {name}")
        work=output/(origin.stem+".build")
        classes,empty=work/"classes",work/"empty"
        classes.mkdir(parents=True);empty.mkdir()
        specs=["-proc:none","-implicit:none","--release","21","-encoding","UTF-8","-sourcepath",str(empty),
               "-cp",str(origin)+os.pathsep+dependencies,"-d",str(classes),*(str(src/(n+".java")) for n in names)]
        args=work/"javac.args"
        args.write_text("\n".join('"'+s.replace("\\","/")+'"' for s in specs),encoding="utf-8")
        subprocess.run([str(java),"@"+str(args)],check=True)
        def own(key):
            return any(key==namespace+c+".class" or key.startswith(namespace+c+"$") for c in names)
        additions={p.relative_to(classes).as_posix():p.read_bytes() for p in classes.rglob("*.class")}
        if not additions or not all(own(k) for k in additions):
            raise ValueError("unexpected recompiled classes")
        result=output/name
        with zipfile.ZipFile(origin) as baseline, zipfile.ZipFile(result,"x",zipfile.ZIP_DEFLATED) as jar:
            for row in baseline.infolist():
                if own(row.filename):continue
                content=baseline.read(row)
                if name.startswith("AgentFriend") and row.filename=="plugin.yml":
                    old=b"version: '0.4.62-dungeon-relics'"
                    if content.count(old)!=1:raise ValueError("missing reviewed version")
                    content=content.replace(old,b"version: '0.4.63-ruins-access'")
                jar.writestr(row,content)
            for key,content in sorted(additions.items()):
                row=zipfile.ZipInfo(key,(2026,11,22,0,0,0));row.compress_type=zipfile.ZIP_DEFLATED
                jar.writestr(row,content)
        print(hashlib.sha256(result.read_bytes()).hexdigest(),result.name)


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for flag in ("javac","classpath","base","out"):
        p.add_argument("--"+flag,required=True,type=Path)
    o=p.parse_args()
    build(o.javac,o.classpath.read_text(encoding="utf-8-sig").strip(),o.base,o.out)
