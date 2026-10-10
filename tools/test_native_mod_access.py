"""Compile and execute native operation validation against the actual locked JARs."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO=Path(__file__).resolve().parents[1]

@unittest.skipUnless(os.environ.get('MAW_MENU_AUDIT_ROOT'),'select the private pinned runtime')
class NativeModAccessAudit(unittest.TestCase):
    def test_native_schema_body_isolation_limits_and_discovery(self):
        root=Path(os.environ['MAW_MENU_AUDIT_ROOT']);java=Path('E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe')
        spec=importlib.util.spec_from_file_location('native_mod_cp',REPO/'world/botgate-src/build.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
        bridge=os.environ.get('MAW_NATIVE_AUDIT_JAR',str(root/'server/mods/maw_agent_bridge-0.1.0.jar'))
        cp=os.pathsep.join([bridge,helper.full_cp(root/'server/libraries'),*(str(p) for p in (root/'server/mods').glob('*.jar'))])
        with tempfile.TemporaryDirectory(prefix='native-mod-arguments-') as temp:
            src=REPO/'world/society-bridge-src/src/test/java/dev/qiandeng/maw/NativeModAccessTest.java'
            compiled=subprocess.run([str(java.with_name('javac.exe')),'-proc:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',temp,str(src)],capture_output=True,text=True,encoding='utf-8',timeout=90)
            self.assertEqual(compiled.returncode,0,compiled.stderr[-4000:])
            result=subprocess.run([str(java),'-cp',temp+os.pathsep+cp,'dev.qiandeng.maw.NativeModAccessTest'],capture_output=True,text=True,encoding='utf-8',timeout=30)
            self.assertEqual(result.returncode,0,result.stderr[-4000:]);self.assertIn('NativeModAccess 21 checks passed',result.stdout)

if __name__=='__main__':unittest.main()
