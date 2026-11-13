"""Relocate the pinned Paper builds into the independent hosting edition."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,tempfile,zipfile

p=argparse.ArgumentParser()
p.add_argument('--api',required=True);p.add_argument('--content',required=True)
p.add_argument('--java-home',required=True);p.add_argument('--asm-classpath',required=True)
p.add_argument('--output',required=True)
a=p.parse_args();root=Path(__file__).resolve().parent;output=Path(a.output).resolve()
output.mkdir(parents=True,exist_ok=True);java=Path(a.java_home)/'bin';manifest=[]
base=json.loads((root/'base.json').read_text())
version=base['version']
edition=base.get('hostedEdition',1)
suffix='.exe' if os.name=='nt' else ''
with tempfile.TemporaryDirectory(prefix='hosted-assembly-') as working:
    subprocess.run([str(java/('javac'+suffix)),'-cp',a.asm_classpath,'-d',working,str(root/'HostedEdition.java')],check=True)
    for source,name in [(Path(a.api),'numen_hosted_api'),(Path(a.content),'numen_hosted')]:
        digest=hashlib.sha256(source.read_bytes()+(root/'HostedEdition.java').read_bytes()).hexdigest()[:12]
        target=output/(f"{name}-{base['minecraft']}-{version}-hosted.{edition}-{digest}.jar");assert not target.exists()
        subprocess.run([str(java/('java'+suffix)),'-cp',working+os.pathsep+a.asm_classpath,'HostedEdition',
                        str(source),str(target),version,str(edition)],check=True)
        with zipfile.ZipFile(target) as jar:
            assert 'com.dwinovo.numen.hosted.' in jar.read('paper-plugin.yml').decode()
            assert not any(n.startswith('com/dwinovo/numen/') and not n.startswith('com/dwinovo/numen/hosted/') for n in jar.namelist())
        manifest.append({'file':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest()})
(output/'hosting-build.json').write_text(json.dumps({'base':base,'files':manifest},indent=2)+'\n')
