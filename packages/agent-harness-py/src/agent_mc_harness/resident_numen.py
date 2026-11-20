"""Operator-only admission for a reserved Numen slot after the website profile is durable."""
import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx


def validate_admission(slot, transport):
    cfg = slot["numenAdmission"]
    for address, path in ((cfg["endpoint"], "/v1/hosted-role"), (transport["endpoint"], "/mcp")):
        url = urlsplit(address)
        if (url.scheme != "http" or url.hostname != "127.0.0.1" or not url.port or url.path != path
                or url.username is not None or url.password is not None or url.query or url.fragment):
            raise ValueError("resident_numen_admission_requires_loopback")
    if (slot["bodyKind"] != "numen" or not Path(cfg["controlKeyFile"]).is_absolute()
            or not re.fullmatch(r"[A-Za-z0-9_]{1,16}", transport["name"]) or slot["bodyId"] == slot["ownerGameId"]):
        raise ValueError("invalid_resident_numen_admission")


def _encoded(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _save_token(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent)
    tmp = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="ascii") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


async def admit_numen(role, cfg, transport, token_file, *, http=None):
    key = Path(cfg["controlKeyFile"]).read_bytes()
    if len(key) != 32:
        raise ValueError("invalid_resident_numen_control_key")
    identity = {"roleUuid": str(role.body_id), "ownerUuid": str(role.owner_id), "name": transport["name"]}
    async with httpx.AsyncClient(trust_env=False, follow_redirects=False, transport=http, timeout=50) as client:
        for op in ("admit", "session"):
            claims = {**identity, "op": op, "expires": int(time.time() * 1000) + 45000}
            payload = _encoded(json.dumps(claims, separators=(",", ":")).encode())
            signature = _encoded(hmac.new(key, payload.encode("ascii"), hashlib.sha256).digest())
            response = await client.post(cfg["endpoint"], json={"payload": payload, "signature": signature})
            response.raise_for_status()
            reply = response.json()
            if reply.get("roleUuid") != identity["roleUuid"]:
                raise ValueError("wrong_numen_body_in_admission")
            if op == "admit" and (reply.get("name") != identity["name"] or reply.get("ready") is not True):
                raise RuntimeError("numen_admission_unconfirmed")
            if op == "session":
                token = reply.get("token")
                if (reply.get("endpoint") != transport["endpoint"] or not isinstance(token, str)
                        or not 24 <= len(token) <= 1024 or not token.isascii() or not token.isprintable() or " " in token):
                    raise ValueError("invalid_numen_scoped_session")
                _save_token(token_file, token)


async def run_with_connection(host):
    """Transport loss ends this actor run. The service reopens the same slot and original journal."""
    actor = asyncio.create_task(host.run())
    disconnected = asyncio.create_task(host.body.port.disconnected.wait())
    try:
        done, _ = await asyncio.wait((actor, disconnected), return_when=asyncio.FIRST_COMPLETED)
        if actor in done:
            return actor.result()
        raise ConnectionError("numen_transport_disconnected")
    finally:
        for task in (actor, disconnected):
            task.cancel()
        await asyncio.gather(actor, disconnected, return_exceptions=True)
