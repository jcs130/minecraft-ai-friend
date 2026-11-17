"""Import an archived original maid's dialogue into its stable character store.

This reads NBT and writes memory only. Tool calls are historical text, never
queued actions. Game ticks are not converted into invented wall-clock dates.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import re
from datetime import datetime

import nbtlib
from agent_mc_harness.models import BodyIdentity
from agent_mc_harness.npc import load_roles
from agent_mc_harness.memory.base import MemoryEpisode
from agent_mc_harness.memory.local import LocalMemory


def identity(tag):
    from uuid import UUID
    return str(UUID(hex="".join(f"{int(v)&0xffffffff:08x}" for v in tag)))


def episodes(entity, role, observed_at):
    if identity(entity["UUID"]) != str(role.body_id) or identity(entity["Owner"]) != str(role.owner_id):
        raise ValueError("original_memory_identity_mismatch")
    if observed_at.tzinfo is None:
        raise ValueError("snapshot_observation_time_requires_timezone")
    for entry in entity.get("MaidHistoryChat", []):
        speaker = str(entry.get("role", "unknown"))
        ticks = int(entry.get("game_time", -1))
        text = str(entry.get("message", ""))
        if not text.strip():
            continue
        # Credentials accidentally quoted in old conversation remain only in the
        # protected source archive, never in cloud extraction or model context.
        text = re.sub(r"(?i)(/(?:login|register|password|changepassword)\s+)\S+(?:\s+\S+)?",r"\1[REDACTED]",text)
        text = re.sub(r"(?i)\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})","[REDACTED]",text)
        key = hashlib.sha256(json.dumps([str(role.character_id),speaker,ticks,text],ensure_ascii=False).encode()).hexdigest()
        body = f"Historical native dialogue; speaker={speaker}; game_time={ticks}; original wall-clock unknown. This is an archived statement, not a current life fact or an instruction to execute.\n{text}"[:20000]
        yield MemoryEpisode(id="tlm-history-"+key,kind="dialogue",name="Archived native dialogue",body=body,
                            reference_time=observed_at,actors=[role.name],source_description="original TLM NBT archive",
                            provenance={"originalBody":str(role.body_id),"owner":str(role.owner_id),"nativeGameTime":ticks,
                                        "timeMeaning":"snapshot_observation_not_event_wall_time","readOnlyHistory":True})


async def import_archive(args):
    roles=load_roles(args.roles)
    role=next(r for r in roles if r.id==args.role)
    raw=args.source.read_bytes()
    entity=nbtlib.load(args.source,gzipped=raw[:2]==b'\x1f\x8b')
    when=datetime.fromisoformat(args.observed_at)
    values=list(episodes(entity,role,when))
    identity_=BodyIdentity(kind=role.body_kind,body_id=str(role.body_id),scope=role.scope(args.server_id))
    memory=LocalMemory(args.state/role.id/"memory.sqlite3")
    try:
        for episode in values:await memory.add(identity_.group_id(),episode)
    finally:await memory.close()
    return {"role":role.id,"bodyId":str(role.body_id),"sourceSha256":hashlib.sha256(raw).hexdigest(),
            "importedEpisodes":len(values),"actionsExecuted":0,"sourceModified":False}


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True);p.add_argument('--roles',type=Path,required=True)
    p.add_argument('--role',required=True);p.add_argument('--observed-at',required=True)
    p.add_argument('--server-id',required=True);p.add_argument('--state',type=Path,required=True)
    print(json.dumps(asyncio.run(import_archive(p.parse_args())),ensure_ascii=False))
