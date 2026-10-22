from pathlib import Path
import sqlite3,datetime,gzip,os,re
root=Path('/var/backups/qiandengji-portal/daily')
root.mkdir(parents=True,exist_ok=True,mode=0o700);root.chmod(0o700)
name='portal-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
tmp=root/(name+'.sqlite')
a=sqlite3.connect('file:/var/lib/qiandengji-portal/data/portal.sqlite?mode=ro',uri=True)
b=sqlite3.connect(tmp);a.backup(b)
assert b.execute('pragma integrity_check').fetchone()[0]=='ok'
b.close();a.close();tmp.chmod(0o600)
out=tmp.with_suffix('.sqlite.gz')
with out.open('xb') as f:f.write(gzip.compress(tmp.read_bytes(),mtime=0))
out.chmod(0o600);tmp.unlink()
files=sorted(p for p in root.iterdir() if p.is_file() and not p.is_symlink() and re.fullmatch(r'portal-\d{8}-\d{6}\.sqlite\.gz',p.name))
for p in files[:-14]:p.unlink()
print('Website SQLite backup completed; integrity verified; retention 14 daily files.')
