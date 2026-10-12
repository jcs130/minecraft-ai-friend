"""Run real JVM assertions for the hosted model projection; no server or LLM."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile

from build_numen_server import NAME, MAID_NAME
from build_society_bridge import NUMEN_NAME
from society_lab import DEFAULT_JAVA, DEFAULT_ROOT, REPO


def main():
    spec = importlib.util.spec_from_file_location('numen_model_test_cp', REPO/'world/botgate-src/build.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    root = DEFAULT_ROOT
    cp = os.pathsep.join((helper.full_cp(root/'server/libraries'),
        str(root/'build/numen-server'/NAME), str(root/'build/numen-server/numen_api.jar'),
        str(root/'server/mods'/NUMEN_NAME), str(root/'server/mods'/MAID_NAME)))
    source = REPO/'world/numen-server-src/src/test/java/dev/qiandeng/maw/numenserver/BrainModelViewTest.java'
    with tempfile.TemporaryDirectory(prefix='numen-model-test-') as temp:
        args = Path(temp)/'javac.args'
        quote = lambda v: '"'+str(v).replace('\\', '/')+'"'
        args.write_text('\n'.join(('-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp', quote(cp), '-d', quote(temp), quote(source))), encoding='utf-8')
        subprocess.run([str(DEFAULT_JAVA.with_name('javac.exe')), '-J-Duser.language=en', '@'+str(args)], check=True)
        subprocess.run([str(DEFAULT_JAVA), '-cp', cp+os.pathsep+temp,
            'dev.qiandeng.maw.numenserver.BrainModelViewTest'], check=True)


if __name__ == '__main__':
    main()
