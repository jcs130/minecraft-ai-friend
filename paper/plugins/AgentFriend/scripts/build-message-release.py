"""Pinned 0.4.47.6 -> 0.4.47.8 message-only backport; never installs anything.

Other source-tree features (archive 0.4.48, parry 0.4.47.7) are not released.
Compiles only the six reviewed classes, runs policy tests and verifies every
unrelated ZIP entry byte-for-byte. Output must be a new directory outside Paper.
"""
import argparse, hashlib, json, os, subprocess, zipfile
from pathlib import Path
from importlib.machinery import SourceFileLoader

BASE = "e9f2c8b41d6117d7deba318c81d0a4aa43894dc95f0c887b40968a5626c035a7"
NAMES = ("AgentCommunication", "OnboardingGuide", "AgentMessagePolicy", "AgentMessageTransport", "ActivityBarBudget", "ActivityBarLimiter")
PACKAGE = "org/afuhome/agentfriend/"
sha = lambda b: hashlib.sha256(b).hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--server",required=True,type=Path);p.add_argument("--base-jar",required=True,type=Path)
    p.add_argument("--jdk",required=True,type=Path);p.add_argument("--output",required=True,type=Path)
    a=p.parse_args();root=Path(__file__).resolve().parents[1];out=a.output.resolve();server=a.server.resolve()
    assert sha(a.base_jar.read_bytes())==BASE,"Unreviewed production baseline"
    assert not out.exists() and out!=server and server not in out.parents,"Use a fresh build outside Paper"
    out.mkdir(parents=True);src=out/"source"/PACKAGE;src.mkdir(parents=True);classes=out/"classes";classes.mkdir();(out/"empty").mkdir()
    backport=SourceFileLoader("rpg_backport",str(Path(__file__).with_name("build-rpg-release.py"))).load_module().backport
    sources=[];digests={}
    for name in NAMES:
        original=root/"src"/PACKAGE/(name+".java");text=original.read_text(encoding="utf-8")
        if name=="AgentCommunication":text=backport(name,text)
        target=src/(name+".java");target.write_text(text,encoding="utf-8",newline="\n");sources.append(target)
        digests[original.relative_to(root).as_posix()]=sha(original.read_bytes())
    test=root/"tests"/PACKAGE/"AgentMessagePolicyTest.java"
    digests[test.relative_to(root).as_posix()]=sha(test.read_bytes())
    cp=os.pathsep.join(map(str,[a.base_jar,server/"versions/1.21.1/paper-1.21.1.jar",*sorted((server/"libraries").rglob("*.jar")),*sorted((server/"plugins").glob("*.jar"))]))
    args=["-proc:none","-encoding","UTF-8","--release","21","-sourcepath",str(out/"empty"),"-cp",cp,"-d",str(classes),*map(str,sources),str(test)]
    argfile=out/"javac.args";argfile.write_text("\n".join('"'+v.replace('\\','/')+'"' for v in args),encoding="utf-8")
    subprocess.run([str(a.jdk/"bin/javac.exe"),"@"+str(argfile)],check=True)
    subprocess.run([str(a.jdk/"bin/java.exe"),"-cp",str(classes)+os.pathsep+cp,"org.afuhome.agentfriend.AgentMessagePolicyTest"],check=True)
    jar=out/"AgentFriend-0.4.47.8.jar";changed=[];unchanged=[]
    owned=lambda n:n.startswith(PACKAGE) and n.endswith(".class") and n.rsplit("/",1)[-1].split("$")[0].removesuffix(".class") in NAMES
    with zipfile.ZipFile(a.base_jar) as old,zipfile.ZipFile(jar,"x",zipfile.ZIP_DEFLATED) as z:
        assert len(old.namelist())==len(set(old.namelist()))
        for i in old.infolist():
            if i.filename=="plugin.yml" or owned(i.filename):continue
            z.writestr(i,old.read(i.filename));unchanged.append(i.filename)
        text=old.read("plugin.yml").decode("utf-8");assert text.count("version: '0.4.47.6'")==1
        entries={"plugin.yml":text.replace("version: '0.4.47.6'","version: '0.4.47.8'").encode()}
        for f in sorted(classes.rglob("*.class")):
            n=f.relative_to(classes).as_posix()
            if n.endswith("AgentMessagePolicyTest.class"):continue
            assert owned(n),n;entries[n]=f.read_bytes()
        for n,b in entries.items():
            i=zipfile.ZipInfo(n,(1980,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;z.writestr(i,b);changed.append(n)
    with zipfile.ZipFile(a.base_jar) as old,zipfile.ZipFile(jar) as new:
        assert all(old.read(n)==new.read(n) for n in unchanged)
        assert not any("PublicArchive" in n or n.startswith("org/sqlite/") for n in new.namelist())
    report=dict(version="0.4.47.8",sha256=sha(jar.read_bytes()),baselineSha256=BASE,changedEntries=changed,
                unrelatedEntriesByteIdentical=len(unchanged),sources=digests,productionChanged=False)
    (out/"build.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k!="sources"}))

if __name__=="__main__":main()
