"""Compile one stair support class family over the exact deployed Numen JAR; never deploy."""
import argparse, importlib.util, io, json, os, re, subprocess, uuid, zipfile
from pathlib import Path
import build_numen_walk_only as common

ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT/'world/numen-patches/stair-support-v1.patch'
MANIFEST = ROOT/'world/numen-patches/stair-support-v1.json'
TEST = ROOT/'world/numen-patches/tests/StairSupportContractTest.java'

def verified_parent_bytes(path, manifest):
    """Verify and return the same bytes that will be copied into the build."""
    data = path.read_bytes()
    if common.sha(data) != manifest['baselineJarSha256']:
        raise ValueError('exact_deployed_parent_required')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if len(archive.namelist()) != len(set(archive.namelist())) or archive.testzip():
            raise ValueError('invalid_parent_jar')
        for name, digest in manifest['baselineClassHashes'].items():
            if common.sha(archive.read(name)) != digest:
                raise ValueError('deployed_class_mismatch:' + name)
    return data


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--baseline-jar',required=True,type=Path)
    p.add_argument('--libraries',required=True,type=Path)
    p.add_argument('--jdk-bin',type=Path,default=Path(os.environ.get('JDK21_BIN',r'C:\Program Files\Eclipse Adoptium\jdk-25.0.3.9-hotspot\bin')))
    a=p.parse_args();m=json.loads(MANIFEST.read_bytes());src=ROOT/m['sourceFile']
    parent_bytes = verified_parent_bytes(a.baseline_jar, m)
    if common.sha(common.normalized(src))!=m['sourceSha256']:raise ValueError('source_baseline_changed')
    if common.sha(PATCH.read_bytes())!=m['patchSha256']:raise ValueError('patch_changed')
    out=ROOT/'runtime/numen-stair-support-build'/uuid.uuid4().hex
    out.mkdir(parents=True);baseline=out/'baseline-numen.jar';baseline.write_bytes(parent_bytes)
    before=out/'original-source'/m['sourceFile'];before.parent.mkdir(parents=True);before.write_bytes(common.normalized(src))
    after=out/'source'/m['sourceFile'];after.parent.mkdir(parents=True);after.write_bytes(common.normalized(src))
    subprocess.run(['git','apply','--check',str(PATCH)],cwd=out/'source',check=True)
    subprocess.run(['git','apply',str(PATCH)],cwd=out/'source',check=True)
    if common.sha(common.normalized(after))!=m['patchedSourceSha256']:raise ValueError('patched_source_mismatch')
    deps=common.embedded_dependencies(baseline,out/'dependencies')
    spec=importlib.util.spec_from_file_location('stair_cp',ROOT/'world/botgate-src/build.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    cp=os.pathsep.join([str(baseline),*(str(x) for x in deps),helper.full_cp(a.libraries)])
    suffix='.exe' if os.name=='nt' else '';javac=str(a.jdk_bin/('javac'+suffix));java=str(a.jdk_bin/('java'+suffix));javap=str(a.jdk_bin/('javap'+suffix))
    quote=lambda v:'"'+str(v).replace('\\','/')+'"'
    def compile_to(source,dest,classpath):
        dest.mkdir();argfile=dest.parent/(dest.name+'.args');argfile.write_text('\n'.join(['-proc:none','--release','21','-encoding','UTF-8','-cp',quote(classpath),'-d',quote(dest),quote(source)])+'\n','utf8');subprocess.run([javac,'@'+str(argfile)],check=True,timeout=120)
    original,classes,tests=(out/n for n in ('original-classes','classes','tests'))
    compile_to(before,original,cp);compile_to(after,classes,cp)
    family=m['classFamilies'][0];cls=family.replace('/','.')
    def disassemble(classpath):return subprocess.check_output([javap,'-classpath',classpath,'-c','-p',cls],text=True,encoding='utf8')
    deployed_text=disassemble(str(baseline));original_text=disassemble(str(original));patched_text=disassemble(str(classes))
    for name,value in [('deployed',deployed_text),('source-before',original_text),('candidate',patched_text)]: (out/(name+'-javap.txt')).write_text(value,'utf8')
    normalize=lambda s:re.sub(r'#\d+','#CP',s).replace('\r\n','\n')
    if normalize(deployed_text)!=normalize(original_text):raise ValueError('source_bytecode_semantics_differ_from_parent: inspect javap before proceeding')
    # Reuse the project's headless MC tests' classpath order: vanilla mapped
    # classes first. NeoForge's registry bootstrap requires a running mod loader.
    vanilla=a.libraries/'net/minecraft/server/1.21.1-20240808.144430/server-1.21.1-20240808.144430-srg.jar'
    extra=vanilla.with_name('server-1.21.1-20240808.144430-extra.jar')
    if not extra.is_file():raise ValueError('mapped_vanilla_resources_missing')
    test_cp=os.pathsep.join([str(vanilla),str(extra),cp])
    compile_to(TEST,tests,os.pathsep.join([str(classes),test_cp]))
    def run_test(classpath,name):
        r=subprocess.run([java,'-cp',classpath,'StairSupportContractTest'],cwd=out,capture_output=True,text=True,encoding='utf8',timeout=90);(out/(name+'.stdout.log')).write_text(r.stdout,'utf8');(out/(name+'.stderr.log')).write_text(r.stderr,'utf8');return r
    old=run_test(os.pathsep.join([str(tests),test_cp]),'baseline-test')
    if old.returncode==0 or 'solid stair cell must not be a body cell' not in old.stdout+old.stderr:raise ValueError('baseline_did_not_reproduce_stair_bug')
    new=run_test(os.pathsep.join([str(tests),str(classes),test_cp]),'candidate-test')
    if new.returncode:raise ValueError('candidate_regression_failed: '+str(out))
    checks=json.loads(new.stdout.strip().splitlines()[-1])
    if checks.get('ok') is not True or checks.get('assertions', 0) < 200:
        raise ValueError('candidate_regression_incomplete')
    jar=out/'numen-neoforge-1.21.1-0.1.3-stair-support-v1.jar'
    preservation=common.overlay_jar(baseline,classes,jar,set(m['classFamilies']))
    record={'ok':True,'jar':str(jar),'sha256':common.sha(jar.read_bytes()),'baselineJarSha256':m['baselineJarSha256'],'sourceFile':m['sourceFile'],'sourceHash':m['sourceSha256'],'patchedSourceHash':m['patchedSourceSha256'],'patchSha256':m['patchSha256'],'sourceBytecodeMatchesParent':True,'baselineReproduced':True,'tests':checks,'deployment':'not performed','livePhysicsVerified':False,'sourceFiles':{str(f.relative_to(ROOT)):common.sha(f.read_bytes()) for f in (Path(__file__),PATCH,MANIFEST,TEST)},**preservation}
    for dest in (out/'build-record.json',out.parent/'latest.json'):dest.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({k:record[k] for k in ('ok','jar','sha256','baselineJarSha256','tests','compiledClasses','preservedEntries','deployment')},ensure_ascii=False))

if __name__=='__main__':main()
