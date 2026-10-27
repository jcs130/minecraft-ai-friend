"""Localize reviewed visible constants/resources in a verified local JAR.

No change to class IDs, mechanics, permissions, commands or private configs.
"""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile,yaml
def main():
 p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--sha256',required=True);p.add_argument('--server',type=Path,required=True);p.add_argument('--java',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 assert hashlib.sha256(a.input.read_bytes()).hexdigest()==a.sha256 and not a.output.exists()
 root=Path(__file__).resolve().parent;build=a.output.parent/(a.output.stem+'.build');build.mkdir();classes=build/'classes';classes.mkdir()
 cp=os.pathsep.join(map(str,[*a.server.glob('libraries/org/ow2/asm/asm/*/*.jar'),*a.server.glob('libraries/com/google/code/gson/gson/*/*.jar')]))
 subprocess.run([str(a.java/'javac.exe'),'-proc:none','-encoding','UTF-8','-cp',cp,'-d',str(classes),str(root/'VortexChineseConstants.java')],check=True,capture_output=True)
 binary=build/'constants.jar';lang=root/'resources/player-zh-cn.json'
 r=subprocess.run([str(a.java/'java.exe'),'-cp',str(classes)+os.pathsep+cp,'VortexChineseConstants',str(a.input),str(binary),str(lang)],capture_output=True,check=True)
 details=json.loads(r.stdout);rules=json.loads(lang.read_text(encoding='utf8'));fragments=sorted(rules['fragments'].items(),key=lambda t:-len(t[0]))
 def text(s):
  if s in rules['exact']:return rules['exact'][s]
  for a,b in fragments:s=s.replace(a,b)
  return s
 def values(v):
  if isinstance(v,str):return text(v)
  if isinstance(v,list):return [values(i)for i in v]
  if isinstance(v,dict):return {k:values(i)for k,i in v.items()}
  return v
 resources=[];preserved=0
 with zipfile.ZipFile(binary)as source,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED)as out:
  for info in source.infolist():
   data=source.read(info)
   if '/'not in info.filename and info.filename in ['spells.yml','quests.yml','items.yml','effects.yml','bosses.yml','dungeons.yml','talents.yml']:
    before=yaml.safe_load(data);after=values(before)
    if after!=before:data=yaml.safe_dump(after,allow_unicode=True,sort_keys=False).encode('utf8');resources.append(info.filename)
   else:preserved+=1
   out.writestr(info,data)
 report={'inputSha256':a.sha256,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'languageSha256':hashlib.sha256(lang.read_bytes()).hexdigest(),**details,'resources':resources,'productionChanged':False}
 a.output.with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'classes':len(details['classes']),'literals':details['translatedLiterals'],'resources':resources}))
if __name__=='__main__':main()
