"""Import registered credentials from a cold H2 CSV, retaining canonical UUIDs.

No plaintext/password hashes are printed. Known-but-unregistered visitors do
not become reserved accounts. Legacy bcrypt is verified and upgraded by the
optional addon inside DirectAuth's ordinary asynchronous login path.
"""
from pathlib import Path
import argparse, csv, json, re, sqlite3, uuid

def prepared(rows):
 result=[];names=set()
 for row in rows:
  mode=row['LOGIN_MODE'];name=row['USERNAME'];password=row['PASSWORD_HASH']
  if mode not in('ONLINE','OFFLINE'):raise ValueError('unknown_original_login_mode')
  if mode=='OFFLINE'and not password:continue
  if not re.fullmatch(r'[A-Za-z0-9_]{3,16}',name):raise ValueError('unsupported_registered_account_name')
  normalized=name.lower()
  if normalized in names:raise ValueError('ambiguous_duplicate_account_name')
  names.add(normalized);body=str(uuid.UUID(row['PLAYER_UUID']))
  if password and not re.fullmatch(r'\$2[aby]\$(?:0[4-9]|1[0-6])\$[./A-Za-z0-9]{53}',password):raise ValueError('unsupported_legacy_hash_format')
  result.append((normalized,'maw_mixauth_bcrypt:'+password if password else 'premium_only_no_offline_password',1 if mode=='ONLINE'else 0,body if mode=='ONLINE'else None,None,body if mode=='OFFLINE'else None,body))
 return result

def migrate(root,csv_file):
 root=Path(root).resolve();health=json.loads((root/'ops/runtime/health.json').read_text())
 if any(row.get('pid')for row in health['services'])or not health['shutdownRequested']:raise ValueError('stopped_destination_required')
 with Path(csv_file).open(encoding='utf-8',newline='')as stream:rows=list(csv.DictReader(stream))
 values=prepared(rows)
 with sqlite3.connect(root/'server/world/serverconfig/directauth.db')as db:
  for row in values:
   if db.execute('SELECT 1 FROM users WHERE username=?',(row[0],)).fetchone():raise ValueError('destination_account_collision_no_overwrite')
  db.executemany('INSERT INTO users(username,passwordHash,isPremium,onlineUUID,registrationIp,offlineUUID,playerUUID) VALUES(?,?,?,?,?,?,?)',values)
 return {'schemaVersion':1,'sourceKnownAccounts':len(rows),'importedRegisteredAccounts':len(values),'premiumAccounts':sum(v[2]for v in values),'existingOwnedAccountsPreserved':True,'canonicalUuidsPreserved':True,'unregisteredVisitorsSkipped':len(rows)-len(values),'plaintextStored':False}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('--csv',required=True);a=p.parse_args();print(json.dumps(migrate(a.root,a.csv)))
