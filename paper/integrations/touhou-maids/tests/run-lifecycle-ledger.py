"""Compile the real lifecycle reducer without a game, accounts or native mod binaries."""
from pathlib import Path
import argparse,hashlib,shutil,subprocess,tempfile

def main():
    p=argparse.ArgumentParser();p.add_argument('--gson',type=Path,required=True);p.add_argument('--javac',default=shutil.which('javac'));p.add_argument('--java',default=shutil.which('java'));a=p.parse_args()
    assert a.javac and a.java,'Use Java 21 or later'
    assert hashlib.sha256(a.gson.read_bytes()).hexdigest()=='4241c14a7727c34feea6507ec801318a3d4a90f070e4525681079fb94ee4c593','Unexpected Gson dependency'
    root=Path(__file__).resolve().parents[1]
    sources=[root/'hybrid-src/local/tlmcompat/hybrid/MaidLifeEpisodes.java',root/'tests/MaidLifeEpisodesFixture.java']
    with tempfile.TemporaryDirectory(prefix='maid-life-synthetic-') as tmp:
        subprocess.run([a.javac,'--release','21','-encoding','UTF-8','-cp',str(a.gson.resolve()),'-d',tmp,*map(str,sources)],check=True)
        import os
        subprocess.run([a.java,'-cp',tmp+os.pathsep+str(a.gson.resolve()),'MaidLifeEpisodesFixture'],check=True)

if __name__=='__main__':main()
