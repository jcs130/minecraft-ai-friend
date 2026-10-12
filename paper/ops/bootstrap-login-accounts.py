"""Seed a NEW LibreLogin SQLite database from a private JSON account file.

Run only with the proxy stopped. Passwords go to the Java hasher on stdin;
neither plaintext nor hashes are printed. Existing database rows are forbidden
so this cannot reset players' passwords or overwrite an established identity.
"""
import argparse,base64,json,socket,sqlite3,subprocess,time,uuid
from pathlib import Path

def seed(accounts,db,java,classpath,proxy_port):
    with socket.socket() as s:
        assert s.connect_ex(('127.0.0.1',proxy_port))!=0, 'Stop the proxy before seeding accounts'
    con=sqlite3.connect(db)
    assert con.execute('select count(*) from librepremium_data').fetchone()[0]==0, 'Refuse an existing authentication database'
    seen=set()
    for a in accounts:
        name=a['name'];assert name.lower() not in seen;seen.add(name.lower())
        expected=uuid.UUID(bytes=__import__('hashlib').md5(('OfflinePlayer:'+name).encode()).digest(),version=3)
        assert str(expected)==a['uuid'], ('Existing UUID mismatch',name)
        assert a['password'] and not any(c.isspace() for c in a['password'])
        if a.get('administrator'):assert len(a['password'])>=16,'Admin password must be independent and strong'
    payload=''.join(a['name']+'\t'+base64.b64encode(a['password'].encode()).decode()+'\n' for a in accounts)
    r=subprocess.run([str(java),'-cp',classpath,'HashAccounts'],input=payload,text=True,encoding='utf-8',capture_output=True)
    if r.returncode:raise RuntimeError('Password hashing failed; inspect runtime dependencies (passwords withheld)')
    hashed={s[0]:s[1:] for s in (line.split('\t') for line in r.stdout.splitlines())}
    now=int(time.time()*1000)
    with con:
        for a in accounts:
            h,salt,algo=hashed[a['name']]
            con.execute('insert into librepremium_data(uuid,last_nickname,hashed_password,salt,algo,joined,last_seen) values(?,?,?,?,?,?,?)',(a['uuid'],a['name'],h,salt,algo,now,now))
    assert con.execute('pragma integrity_check').fetchone()[0]=='ok'
    con.close()
    return {'seeded':len(accounts),'administrators':sum(bool(a.get('administrator')) for a in accounts),'uuidPreserved':True}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--accounts',type=Path,required=True);p.add_argument('--db',type=Path,required=True);p.add_argument('--java',type=Path,required=True);p.add_argument('--classpath',type=Path,required=True);p.add_argument('--proxy-port',type=int,required=True);a=p.parse_args()
    print(json.dumps(seed(json.loads(a.accounts.read_text(encoding='utf-8-sig')),a.db,a.java,a.classpath.read_text(encoding='utf-8'),a.proxy_port)))
