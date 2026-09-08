"""Prepare the internal control credential and viewer asset provenance."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,secrets,subprocess
ROOT=Path(__file__).resolve().parents[1]
private=ROOT/'server/admin-state/secrets';private.mkdir(parents=True,exist_ok=True)
token=private/'control-token.txt'
if not token.exists():token.write_text(secrets.token_hex(32),encoding='utf-8')
# Local web access needs no password. Preserve any historical credentials untouched.
for folder in ['server/admin-state/operations','server/tts-state/tmp']:(ROOT/folder).mkdir(parents=True,exist_ok=True)
# Historical extraction provenance must not be rewritten with regenerated
# assets on a later credential preparation run. The asset builder maintains
# the separate current compatibility report.
manifest=ROOT/'manifests/modern-viewer-source.json'
if not manifest.exists():
    base=ROOT/'vendor/modern-viewer'
    files=[{'path':p.relative_to(base).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(base.rglob('*')) if p.is_file()]
    manifest.parent.mkdir(parents=True,exist_ok=True)
    manifest.write_text(json.dumps({'schema':1,'preparedAt':datetime.now(timezone.utc).isoformat(),'sourcePath':'vendor/modern-viewer (local staged assets)','files':files},indent=2),encoding='utf-8')
print(json.dumps({'ok':True,'credentials':'server/admin-state/secrets (private; values not printed)','provenancePreserved':True}))
