"""Build reviewed Bedrock maid overlays against an explicit server tree; never installs."""
from pathlib import Path
import argparse,hashlib,json,os,re,subprocess,zipfile

p=argparse.ArgumentParser(description=__doc__)
for name in ['server','jdk','output']:p.add_argument('--'+name,type=Path,required=True)
p.add_argument('--pack',type=Path);p.add_argument('--export-models',action='store_true');a=p.parse_args()
root=Path(__file__).resolve().parent;repo=root.parents[2];out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
server=a.server.resolve();sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
platform=server/'mods/qiandengji-native-platform-0.1.4.jar'
extension=server/'plugins/Geyser-Spigot/extensions/qiandengji-geyser-maids-0.1.4.jar'
assert sha(platform)=='2ae8aebd0a0b43ae5d88e752fa4145ef31b3369c893d5f239318ad7fa1a074eb','Review changed native platform baseline'
assert sha(extension)=='3c593c7529dc971444e81bb3582cfc65ce4f3efb0dbb2769714385dad9a748b5','Review changed Geyser maid baseline'
cp=os.pathsep.join(str(f) for f in [platform,extension,*server.glob('libraries/**/*.jar'),*server.glob('mods/*.jar'),*server.glob('plugins/*.jar')])
suffix='.exe' if os.name=='nt' else ''
def compile(name,files,classpath=cp):
 target=out/(name+'-classes');target.mkdir()
 args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',classpath,'-d',target,*files]
 argfile=out/(name+'.args');argfile.write_bytes(('\n'.join('"'+str(v).replace('\\','/')+'"' for v in args)).encode())
 with (out/(name+'.log')).open('wb') as log:subprocess.run([a.jdk/'bin'/('javac'+suffix),'@'+str(argfile)],stdout=log,stderr=subprocess.STDOUT,check=True)
 return {f.relative_to(target).as_posix():f.read_bytes() for f in target.rglob('*.class')}
if a.export_models:
 compile('export',[root/'tools/MaidModelExport.java',repo/'paper/integrations/freesia-optional/bridge/org/afuhome/appearance/ModelCatalog.java',repo/'paper/integrations/geyser-ysm/src/org/afuhome/appearance/BedrockPack.java',repo/'paper/integrations/geyser-ysm/src/org/afuhome/appearance/BedrockState.java'])
 runargs=['-cp',str(out/'export-classes')+os.pathsep+cp,'org.afuhome.appearance.MaidModelExport',server/'plugins/AgentAppearanceNative/models.json',out/'ysm-export.json']
 runfile=out/'export-run.args';runfile.write_bytes(('\n'.join('"'+str(v).replace('\\','/')+'"' for v in runargs)).encode())
 subprocess.run([a.jdk/'bin'/('java'+suffix),'@'+str(runfile)],check=True)
 raise SystemExit(0)
assert a.pack and (a.pack/'maid.mcpack').is_file() and (a.pack/'maid-models.tsv').is_file(),'Build the reviewed model pack first'
changes=compile('platform',[root/'platform-src/local/tlmcompat/numen'/name for name in ['VanillaMaidView.java','MaidVisualRegistry.java','MaidVisualKey.java']])
def overlay(base,target,updates):
 with zipfile.ZipFile(base) as old:
  previous={n:old.read(n) for n in old.namelist()}
  assert not any(n.upper().endswith(('.SF','.RSA','.DSA')) for n in previous),'Review signed archive explicitly'
  with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED) as z:
   for n in sorted(previous.keys()|updates.keys()):
    info=zipfile.ZipInfo(n,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,updates.get(n,previous.get(n)))
  untouched=[n for n in previous if n not in updates]
  with zipfile.ZipFile(target) as z:assert all(z.read(n)==previous[n] for n in untouched)
 return dict(artifact=target.name,sha256=sha(target),baselineSha256=sha(base),changedEntries=sorted(updates),unrelatedEntriesPreserved=len(untouched))
with zipfile.ZipFile(platform) as z:
 descriptor=z.read('META-INF/neoforge.mods.toml');assert b'version="0.1.6"' in descriptor
 changes['META-INF/neoforge.mods.toml']=descriptor.replace(b'version="0.1.6"',b'version="0.1.7"')
proof=[overlay(platform,out/'qiandengji-native-platform-0.1.7.jar',changes)]
changes=compile('geyser',[root/'geyser-src/local/tlmcompat/geyser/MaidGeyserExtension.java'],str(out/'platform-classes')+os.pathsep+cp)
with zipfile.ZipFile(extension) as z:
 descriptor=z.read('extension.yml');assert b"version: '0.1.4'" in descriptor
 changes['extension.yml']=descriptor.replace(b"version: '0.1.4'",b"version: '0.1.5'")
for name in ['maid.mcpack','maid-models.tsv']:changes[name]=(a.pack/name).read_bytes()
proof.append(overlay(extension,out/'qiandengji-geyser-maids-0.1.5.jar',changes))
record=dict(productionChanged=False,artifacts=proof,sourceSha256={str(f.relative_to(root)):sha(f) for pattern in ['platform-src/**/*.java','geyser-src/**/*.java'] for f in root.glob(pattern)})
(out/'build.json').write_bytes((json.dumps(record,indent=2)+'\n').encode());print(json.dumps(record))
