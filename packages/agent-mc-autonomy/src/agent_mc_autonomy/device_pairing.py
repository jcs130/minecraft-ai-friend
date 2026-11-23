"""Explicit, owner-approved enrollment for the hosted Minecraft device protocol."""
import re
import time
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx

_PAIR = "/api/v1/character-device/pair"
_DEVICE = "/api/v1/character-device"
_TOKEN_ENV = "AGENT_MC_MANAGED_DEVICE_TOKEN"


@dataclass(frozen=True, slots=True)
class DevicePairing:
    pair_id: str
    approval_url: str
    expires_at: int
    _origin: str = field(repr=False)
    _poll_secret: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class ManagedPlayerDevice:
    character_id: str
    endpoint: str
    expires_at: int
    _token: str = field(repr=False)

    def client_binding(self) -> dict:
        """The runner writes this public binding to client.json."""
        return {"characterId": self.character_id, "endpoint": self.endpoint}

    def child_environment(self) -> dict:
        """Only the private stdio child receives the token."""
        if not _fresh(self.expires_at) or not _matches(r"qdh_[A-Za-z0-9_-]{43}", self._token):
            raise ValueError("device_enrollment_invalid_or_expired")
        return {_TOKEN_ENV: self._token}


def _matches(pattern, value):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def _fresh(expires):
    return type(expires) is int and expires > int(time.time() * 1000)


def _https_origin(value):
    try:
        u = urlsplit(value)
        port = u.port
    except (TypeError, ValueError):
        raise ValueError("device_https_portal_required") from None
    if (u.scheme != "https" or not u.hostname or u.username or u.password or u.query or u.fragment
            or u.path not in ("", "/") or port == 0 or u.netloc.lower() != u.netloc):
        raise ValueError("device_https_portal_required")
    return f"https://{u.netloc}"


async def _post(origin, body, token=None):
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=8) as client:
            reply = await client.post(origin + _PAIR, json=body,
                                      headers={"Authorization": f"Bearer {token}"} if token else None)
            if reply.status_code not in (200, 201) or len(reply.content) > 4096:
                raise ValueError
            data = reply.json()
            if not isinstance(data, dict):
                raise ValueError
            return data
    except (httpx.HTTPError, ValueError):
        raise RuntimeError("device_pairing_unavailable") from None


async def begin_device_pairing(portal_origin: str) -> DevicePairing:
    """Return a browser address and a code for host UI, keeping redemption private."""
    origin = _https_origin(portal_origin)
    row = await _post(origin, {"op": "start"})
    pair, secret, expires = row.get("pairId"), row.get("pollSecret"), row.get("expiresAt")
    if not _matches(r"[A-Za-z0-9_-]{24}", pair) or not _matches(r"qdp_[A-Za-z0-9_-]{43}", secret) or not _fresh(expires):
        raise RuntimeError("device_pairing_invalid_response")
    return DevicePairing(pair, origin + "/resident-connect.html?flow=bodies", expires, origin, secret)


async def redeem_device_pairing(pairing: DevicePairing) -> ManagedPlayerDevice | None:
    """Read the original enrollment. A pending response does not launch a runtime."""
    if not _fresh(pairing.expires_at):
        raise ValueError("device_pairing_expired")
    row = await _post(pairing._origin, {"op": "redeem", "pairId": pairing.pair_id}, pairing._poll_secret)
    if row == {"state": "pending"}:
        return None
    character, endpoint, token, expires = (row.get(key) for key in ("characterId", "endpoint", "token", "expiresAt"))
    if (row.get("state") != "approved" or endpoint != pairing._origin + _DEVICE
            or not _matches(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", character)
            or not _matches(r"qdh_[A-Za-z0-9_-]{43}", token) or not _fresh(expires)):
        raise RuntimeError("device_pairing_invalid_response")
    return ManagedPlayerDevice(character, endpoint, expires, token)
