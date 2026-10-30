"""Private owned-body secret broker; stdout belongs only to the pinned caller.

Never invoke from a model tool or shell transcript. No provider/model keys are
read. This retains the harness's environment allowlist and the native vault.
"""
from pathlib import Path
import argparse,json,sys

def credential(root,username):
 root=Path(root).resolve(strict=True)
 if root!=Path('E:/MC/servers/sao-0.76.1').resolve()or username!='ag_Kirito':raise ValueError('explicit_owned_login_identity_required')
 if json.loads((root/'pack-source.json').read_text())['scope']!='managed_server':raise ValueError('managed_sao_realm_required')
 record=json.loads((root/'ops/credentials/ag_Kirito.fernet.json').read_text())
 if record.get('scope')!='sao-managed-game-login'or record.get('username')!=username or record.get('scheme')!='qwenpaw-native-fernet':raise ValueError('private_credential_identity_mismatch')
 from qwenpaw.security.secret_store import decrypt
 password=decrypt(record['encryptedPassword'])
 if not isinstance(password,str)or not 8<=len(password)<=72 or any(c.isspace()for c in password):raise ValueError('invalid_private_login_credential')
 return password
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('--username',required=True);a=p.parse_args()
 try:sys.stdout.write(credential(a.root,a.username));sys.stdout.flush()
 except Exception:sys.stderr.write('private_game_credential_unavailable\n');raise SystemExit(1)
