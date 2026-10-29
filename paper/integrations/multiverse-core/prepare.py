"""Download the pinned official release and prepare configuration, without installing it."""
from pathlib import Path
import argparse, hashlib, json, shutil, urllib.request, zipfile

VERSION='5.8.1'
SHA256='bc3f34e2d747fdf024f44868747bb016b08fa11d98ccb4ffcac958f083151a83'
URL='https://github.com/Multiverse/Multiverse-Core/releases/download/5.8.1/multiverse-core-5.8.1.jar'

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--cached-jar',type=Path)
    a=p.parse_args();out=a.output.resolve()
    if out.exists():raise ValueError('Choose a new review directory; nothing is overwritten.')
    data=a.cached_jar.read_bytes() if a.cached_jar else urllib.request.urlopen(urllib.request.Request(URL,headers={'User-Agent':'Qiandengji-self-host'}),timeout=60).read(16*1024*1024)
    if hashlib.sha256(data).hexdigest()!=SHA256:raise ValueError('Official artifact checksum mismatch; nothing installed.')
    out.mkdir(parents=True)
    jar=out/('Multiverse-Core-'+VERSION+'.jar');jar.write_bytes(data)
    with zipfile.ZipFile(jar) as z:
        descriptor=z.read('plugin.yml').decode('utf8')
        if VERSION not in descriptor:raise ValueError('Unexpected plugin version')
    source=Path(__file__).resolve().parents[2]/'config-candidates/multiverse-core/config.yml'
    shutil.copy2(source,out/'config.yml')
    report={'state':'candidate_not_installed','version':VERSION,'url':URL,'sha256':SHA256,
        'configSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'bytes':len(data),
        'productionApproved':False,'queued':False,'productionModified':False,'clientModsRequired':False,
        'worldInventorySplit':False,'restrictiveAincradBorder':False}
    (out/'candidate.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print(json.dumps(report))
if __name__=='__main__':main()
