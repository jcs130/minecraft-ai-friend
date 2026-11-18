"""Supervise the operator-configured graph and NPC processes, independent of a chat session.

The bootstrap key is never available to an NPC model. Only previously verified
Numen identities may be re-admitted; missing proof leaves the host stopped.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from uuid import UUID

import httpx


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write(path, value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+".tmp")
    with temp.open("w",encoding="utf8") as stream:
        json.dump(value,stream,ensure_ascii=False,indent=2);stream.flush();os.fsync(stream.fileno())
    os.replace(temp,path)


def available(port):
    with socket.socket() as sock:
        sock.settimeout(.25)
        return sock.connect_ex(("127.0.0.1",port))==0


def bootstrap(row):
    from urllib.parse import urlsplit
    endpoint=urlsplit(row["endpoint"])
    if endpoint.scheme!="http" or endpoint.hostname!="127.0.0.1" or endpoint.path!="/v1/hosted-role" or endpoint.username or endpoint.query or endpoint.fragment:
        raise ValueError("bootstrap_must_be_protected_loopback")
    proof=read(row["admissionProof"])
    role=row["role"]
    for field in ("roleUuid","ownerUuid"):
        if str(UUID(role[field]))!=proof[field]:
            raise ValueError("verified_original_identity_required")
    if proof["state"]!="verified_native_admitted" or proof["name"]!=role["name"]:
        raise ValueError("admission_acceptance_required")
    key=Path(row["keyFile"]).read_bytes()
    if len(key)!=32:
        raise ValueError("protected_operator_key_required")
    encode=lambda value:base64.urlsafe_b64encode(value).decode().rstrip("=")
    with httpx.Client(timeout=50,trust_env=False,follow_redirects=False) as http:
        for op in ("admit","session"):
            payload=encode(json.dumps(dict(role,op=op,expires=int(time.time()*1000)+45000),separators=(",",":")).encode())
            signature=encode(hmac.new(key,payload.encode(),hashlib.sha256).digest())
            response=http.post(row["endpoint"],json={"payload":payload,"signature":signature})
            if response.status_code!=200:
                raise RuntimeError("original_body_admission_unconfirmed")
            result=response.json()
            if result.get("roleUuid")!=role["roleUuid"]:
                raise ValueError("bootstrap_identity_mismatch")
        if result.get("endpoint")!=row["mcpEndpoint"] or not isinstance(result.get("token"),str):
            raise ValueError("bootstrap_endpoint_mismatch")
        target=Path(row["tokenFile"]);target.parent.mkdir(parents=True,exist_ok=True)
        temp=target.with_name(target.name+".tmp");temp.write_text(result["token"],encoding="utf8");os.replace(temp,target)


def serve(config):
    settings=read(config)
    if settings.get("schema")!=1:
        raise ValueError("supervisor_schema")
    state=Path(settings["stateDirectory"]);state.mkdir(parents=True,exist_ok=True)
    pause=Path(settings["pauseFile"]);offline=state/"game-offline.pause"
    lock=(state/"supervisor.lock").open("a+b")
    if os.name=="nt":
        import msvcrt
        lock.seek(0)
        if not lock.read(1):lock.write(b"1");lock.flush()
        lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    else:
        import fcntl
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    children={};cooldown={};logs=[];error=None
    root=Path(settings["repositoryRoot"]).resolve()
    sys.path.insert(0, str(root / "packages/agent-harness-py/src"))
    from agent_mc_harness.status_file import StatusFile
    status_file = StatusFile(state / "supervisor.json")
    env=dict(os.environ,PYTHONUTF8="1",PYTHONPATH=os.pathsep.join([str(root/"packages/agent-harness-py/src"),str(root/"packages/agent-memory/graphiti-sidecar")]),AGENT_HARNESS_PY_REPO_ROOT=str(root))
    def start(kind):
        stamp=time.strftime("%Y%m%d-%H%M%S")
        stream=(state/(kind+"-"+stamp+".log")).open("ab");logs.append(stream)
        if kind=="graphiti":args=[str(root/"paper/integrations/unified-npc/graphiti_service.py"),"--config",settings["graphitiConfig"]]
        else:args=["-m","agent_mc_harness.npc_service","--config",settings["npcConfig"]]
        children[kind]=subprocess.Popen([settings["python"],"-X","utf8",*args],cwd=root,env=env,stdin=subprocess.DEVNULL,stdout=stream,stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0)
        cooldown[kind]=time.monotonic()+15
    try:
        while not (state/"supervisor.stop").exists():
            ready=available(settings["gamePort"])
            npc_settings=read(settings["npcConfig"])
            host_pause=Path(npc_settings["pauseFile"])
            if not ready or pause.exists():
                if not host_pause.exists():write(host_pause,{"reason":"maintenance"if pause.exists()else"game_offline"})
            else:
                if host_pause.exists():host_pause.unlink()
            for kind in ("graphiti","npc"):
                child=children.get(kind)
                if child and child.poll()is None:continue
                if time.monotonic()<cooldown.get(kind,0):continue
                if kind=="npc" and(not ready or pause.exists()):continue
                try:
                    if kind=="npc":
                        for row in settings.get("numen",[]):bootstrap(row)
                    start(kind);error=None
                except Exception as failed:
                    error=type(failed).__name__;cooldown[kind]=time.monotonic()+30
            status_file.publish({"schema":1,"pid":os.getpid(),"time":time.time(),"gameAvailable":ready,"maintenance":pause.exists(),"error":error,
                  "children":{kind:{"pid":p.pid,"running":p.poll()is None}for kind,p in children.items()}})
            time.sleep(2)
    finally:
        write(Path(read(settings["npcConfig"])["pauseFile"]),{"reason":"supervisor_stopping"})
        npc=children.get("npc")
        if npc and npc.poll()is None:
            try:npc.wait(timeout=160)
            except subprocess.TimeoutExpired:npc.terminate();npc.wait(timeout=10)
        graph=children.get("graphiti")
        if graph and graph.poll()is None:graph.terminate();graph.wait(timeout=10)
        for stream in logs:stream.close()
        lock.close()


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--config",type=Path,required=True)
    serve(parser.parse_args().config)
