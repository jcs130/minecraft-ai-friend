"""Explicit stopped deployment -> verified E/F archives, without source deletion."""
from pathlib import Path
import argparse, hashlib, json, shutil, time, zipfile

def sha(p):
 with Path(p).open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def backup(root,primary,secondary):
 root,primary,secondary=map(lambda p:Path(p).resolve(),(root,primary,secondary))
 if root not in [Path('E:/MC/servers/tau-ceti-1.3.3').resolve(),Path('E:/MC/servers/sao-0.76.1').resolve()]:raise ValueError('explicit_game_deployment_required')
 if primary.drive!='E:'or secondary.drive!='F:'or primary.is_relative_to(root)or secondary.is_relative_to(root):raise ValueError('independent_e_f_archive_paths_required')
 health=json.loads((root/'ops/runtime/health.json').read_text())
 if not health.get('shutdownRequested')or not health.get('paused')or any(row.get('pid')for row in health['services']):raise ValueError('normal_completed_shutdown_required')
 java=next(row for row in health['services']if row['id']=='java')
 if java.get('lastExit',{}).get('code')!=0 or not java['lastExit'].get('requested'):raise ValueError('normal_java_exit_zero_required')
 primary.parent.mkdir(parents=True,exist_ok=True);secondary.parent.mkdir(parents=True,exist_ok=True)
 if primary.exists()or secondary.exists():raise FileExistsError('preserve_existing_archives')
 files=[p for p in sorted(root.rglob('*'))if p.is_file()]
 if any(p.is_symlink()or not p.resolve().is_relative_to(root)for p in files):raise ValueError('external_symlink_in_cold_tree')
 manifest={};total=0
 with zipfile.ZipFile(primary,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=1,allowZip64=True)as archive:
  for p in files:
   relative=p.relative_to(root).as_posix();fingerprint=sha(p);size=p.stat().st_size;archive.write(p,relative);manifest[relative]={'bytes':size,'sha256':fingerprint};total+=size
  archive.writestr('COLD_BACKUP_MANIFEST.json',json.dumps({'root':str(root),'files':manifest},separators=(',',':')))
 with zipfile.ZipFile(primary)as archive:
  for relative,expected in manifest.items():
   with archive.open(relative)as stream:actual=hashlib.file_digest(stream,'sha256').hexdigest()
   if actual!=expected['sha256']:raise ValueError('archive_content_mismatch:'+relative)
 digest=sha(primary);shutil.copy2(primary,secondary)
 if sha(secondary)!=digest:raise ValueError('secondary_archive_mismatch')
 result={'schemaVersion':1,'root':str(root),'primary':str(primary),'secondary':str(secondary),'fileCount':len(files),'sourceBytes':total,'archiveBytes':primary.stat().st_size,'sha256':digest,'fullContentVerified':True,'normalJavaExit':0,'sourceRetained':True}
 primary.with_suffix('.verified.json').write_text(json.dumps(result,indent=2));secondary.with_suffix('.verified.json').write_text(json.dumps(result,indent=2));return result
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('--primary',required=True);p.add_argument('--secondary',required=True);a=p.parse_args();print(json.dumps(backup(a.root,a.primary,a.secondary)))
