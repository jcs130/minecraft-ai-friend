"""Prepare this realm's owned Agent login using the existing native secret store.

Run with the explicitly selected QwenPaw interpreter. Password plaintext exists
only in this process; SQLite stores a native DirectAuth PBKDF2 hash. No fallback.
"""
from pathlib import Path
import argparse, base64, hashlib, json, secrets, sqlite3, uuid

def seed(root):
    from qwenpaw.security.secret_store import encrypt,decrypt
    root=Path(root).resolve(strict=True)
    if root!=Path('E:/MC/servers/sao-0.76.1').resolve()or json.loads((root/'pack-source.json').read_text())['scope']!='managed_server':raise ValueError('owned_sao_realm_required')
    directory=root/'ops/credentials';directory.mkdir(exist_ok=True)
    db=root/'server/world/serverconfig/directauth.db'
    if db.exists():raise ValueError('do_not_overwrite_existing_authentication_database')
    connection=sqlite3.connect(db)
    connection.execute('CREATE TABLE users (username TEXT PRIMARY KEY,passwordHash TEXT NOT NULL,isPremium INTEGER DEFAULT 0,onlineUUID TEXT,registrationIp TEXT,offlineUUID TEXT,playerUUID TEXT)')
    for name in ['ag_Kirito','SAOAuthProbe']:
        target=directory/(name+'.fernet.json')
        if target.exists():raise ValueError('preserve_existing_native_credential')
        password=secrets.token_urlsafe(24);sealed=encrypt(password)
        if decrypt(sealed)!=password:raise ValueError('native_secret_store_roundtrip_failed')
        salt=secrets.token_bytes(16);key=hashlib.pbkdf2_hmac('sha256',password.encode(),salt,100000)
        stored=base64.b64encode(salt).decode()+':'+base64.b64encode(key).decode()
        body=str(uuid.UUID(bytes=hashlib.md5(('OfflinePlayer:'+name).encode()).digest(),version=3))
        connection.execute('INSERT INTO users(username,passwordHash,isPremium,registrationIp,playerUUID) VALUES(?,?,0,NULL,?)',(name.lower(),stored,body))
        target.write_text(json.dumps({'scope':'sao-managed-game-login','username':name,'encryptedPassword':sealed,'scheme':'qwenpaw-native-fernet'},indent=2),encoding='utf-8')
    connection.commit();connection.close()
    return {'accounts':2,'plaintextStored':False,'nativeSecretRoundtrip':True}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);a=p.parse_args();print(json.dumps(seed(a.root)))
