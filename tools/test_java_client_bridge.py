"""Run durable client-action recovery checks against the real Java/Gson runtime."""
from pathlib import Path
import argparse,json,os,subprocess,tempfile
REPO=Path(__file__).resolve().parents[1]
def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--minecraft',type=Path,required=True);ap.add_argument('--java',type=Path,required=True)
    a=ap.parse_args();gson=sorted((a.minecraft/'libraries/com/google/code/gson/gson').rglob('gson-*.jar'))[-1]
    with tempfile.TemporaryDirectory(prefix='maw-client-store-test-') as temp:
        root=Path(temp);classes=root/'classes';classes.mkdir()
        sources=[REPO/'world/java-client-bridge-src/src/dev/maw/client/ActionStore.java',REPO/'world/java-client-bridge-src/test/dev/maw/client/ActionStoreTest.java']
        subprocess.run([str(a.java.with_name('javac.exe')),'-proc:none','--release','21','-encoding','UTF-8','-cp',str(gson),'-d',str(classes),*map(str,sources)],check=True,capture_output=True)
        result=subprocess.run([str(a.java),'-cp',os.pathsep.join([str(classes),str(gson)]),'dev.maw.client.ActionStoreTest',str(root/'journal')],capture_output=True,text=True,check=True)
        print(result.stdout.strip())
if __name__=='__main__':main()
