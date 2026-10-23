"""Reject private runtime files in Git. Output locations only, never file values.

Run alongside Gitleaks: this path check is not a substitute for secret scanning.
"""
from pathlib import PurePosixPath
import argparse
import json
import re
import subprocess
import sys


def private_path(filename):
    path=PurePosixPath(filename);parts=[part.lower() for part in path.parts];name=parts[-1] if parts else ''
    if any(part in ['private','secrets','.local','node_modules'] for part in parts):return True
    if name in ['.env','ops.json','whitelist.json','usercache.json','credentials.json','credentials.yaml','rcon-secret.txt']:return True
    if name.startswith('.env.') and not name.endswith(('.example','.sample')):return True
    if re.search(r'\.(?:sqlite\d*(?:-(?:wal|shm))?|db|pem|key|p12|pfx|dmp|dump)$',name):return True
    if re.search(r'\.local\.',name):return True
    return False


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--staged',action='store_true');args=parser.parse_args()
    command=['git','diff','--cached','--name-only','--diff-filter=ACMR','-z'] if args.staged else ['git','ls-files','-z']
    files=[p for p in subprocess.check_output(command).decode('utf-8').split('\0') if p]
    found=[p for p in files if private_path(p)]
    print(json.dumps({'checkedTrackedPaths':len(files),'privatePaths':found,'valuesPrinted':False},ensure_ascii=True))
    return 1 if found else 0


if __name__=='__main__':sys.exit(main())
