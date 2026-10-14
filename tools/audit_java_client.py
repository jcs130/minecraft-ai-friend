"""Offline operator recovery. Keeps the original unknown action and never replays it."""
from pathlib import Path
import argparse,os,subprocess

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('java','bridge-jar','gson','bridge-root','evidence'):
        parser.add_argument('--'+key,type=Path,required=True)
    for key in ('body-id','server','action-id'):
        parser.add_argument('--'+key,required=True)
    parser.add_argument('--release-new-actions-keep-unknown',action='store_true',required=True)
    args=parser.parse_args()
    subprocess.run([str(args.java),'-cp',os.pathsep.join([str(args.bridge_jar),str(args.gson)]),
        'dev.maw.client.ActionStoreAudit',str(args.bridge_root.resolve()),args.body_id,args.server,args.action_id,
        str(args.evidence.resolve()),'--release-new-actions-keep-unknown'],check=True)

if __name__=='__main__':main()
