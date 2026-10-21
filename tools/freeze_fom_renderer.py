"""Freeze a committed shared renderer plus its exact installed dependencies.

No npm install, game login, service mutation or world access. Builds consume a
new directory; a missing dependency fails before any output is created.
"""
from pathlib import Path
import argparse,hashlib,json,shutil,subprocess

RELATIVE='packages/modern-viewer/renderer-src'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def dependency_versions(package,dependencies):
    versions={}
    for name,wanted in {**package.get('dependencies',{}),**package.get('devDependencies',{})}.items():
        file=dependencies/name/'package.json'
        if not file.is_file():raise ValueError('Missing renderer dependency: '+name)
        version=json.loads(file.read_bytes()).get('version')
        if version!=wanted:raise ValueError('Renderer dependency version differs: '+name)
        versions[name]={'version':version,'packageSha256':sha(file)}
    return versions

def freeze(shared_source,dependencies,output):
    shared_source,dependencies,output=map(lambda p:Path(p).resolve(),(shared_source,dependencies,output))
    if output.exists():raise ValueError('Choose a new immutable renderer release directory')
    package=json.loads((shared_source/RELATIVE/'package.json').read_bytes())
    versions=dependency_versions(package,dependencies)
    dirty=subprocess.check_output(['git','status','--porcelain','--',RELATIVE],cwd=shared_source,text=True)
    if dirty.strip():raise ValueError('Commit the shared renderer sources before freezing')
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=shared_source,text=True).strip()
    files=subprocess.check_output(['git','ls-files','--',RELATIVE],cwd=shared_source,text=True).splitlines()
    if not files:raise ValueError('No tracked shared renderer source')
    output.mkdir(parents=True)
    source_files={}
    for name in files:
        relative=Path(name).relative_to(RELATIVE);source=shared_source/name;target=output/relative
        if source.is_symlink() or not source.is_file():raise ValueError('Invalid renderer source input')
        target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target);source_files[relative.as_posix()]=sha(target)
    shutil.copytree(dependencies,output/'node_modules',ignore=shutil.ignore_patterns('.cache','.bin'))
    actual={p.relative_to(output).as_posix():sha(p) for p in sorted(output.rglob('*')) if p.is_file()}
    record={'schemaVersion':1,'sourceRepository':'https://github.com/jcs130/mc-visual-console','sourceCommit':commit,
        'sourceFiles':source_files,'dependencies':versions,'files':actual,'buildAndConnectionAcceptanceRequired':True}
    (output/'renderer-release.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
    return {'sourceCommit':commit,'sourceFiles':len(source_files),'dependencies':len(versions),'files':len(actual),'manifestSha256':sha(output/'renderer-release.json')}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('shared-source','dependencies','output'):parser.add_argument('--'+name,type=Path,required=True)
    print(json.dumps(freeze(**vars(parser.parse_args()))))
