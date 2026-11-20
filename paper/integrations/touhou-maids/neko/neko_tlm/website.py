"""Desktop proof and website consent for one registered maid."""

import re
import secrets
import tempfile
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from agent_mc_harness.bridges import ControlChanged

PORTAL_ORIGIN = "https://mc.kangqiang.site"
_BASE = "/api/v1/maid-connect"
_TOKEN = re.compile(r"mdw_[A-Za-z0-9_-]{43}")


@dataclass(frozen=True)
class WebsiteRequest:
    token: str = field(repr=False)
    verification_url: str
    confirmation_code: str
    expires_at: int
    poll_seconds: int

    def public(self) -> dict:
        return {
            "verification_url": self.verification_url,
            "confirmation_code": self.confirmation_code,
            "expires_at": self.expires_at,
        }


@dataclass(frozen=True)
class WebsiteGrant:
    owner_id: str
    maid_id: str
    endpoint: str


class MaidWebsite:
    def __init__(self, origin: str, http: httpx.AsyncClient):
        url = urlsplit(origin)
        if (not origin.startswith("https://") or not url.hostname or url.path
                or url.username is not None or url.password is not None
                or "?" in origin or "#" in origin or url.port == 0):
            raise ValueError("invalid maid website origin")
        self.origin = origin
        self.http = http

    async def start(self) -> WebsiteRequest:
        token = "mdw_" + secrets.token_urlsafe(32)
        response = await self.http.post(self.origin + _BASE + "/request",
            json={"tokenHash": sha256(token.encode("ascii")).hexdigest()}, timeout=8, follow_redirects=False)
        response.raise_for_status()
        try:
            data = response.json()
            url, code = data["verificationUrl"], data["confirmationCode"]
            expires_at, poll_seconds = data["expiresAt"], data["pollSeconds"]
            prefix = self.origin + "/maid-connect.html#request="
            if (not isinstance(url, str) or not url.startswith(prefix)
                    or str(UUID(url.removeprefix(prefix))) != url.removeprefix(prefix)
                    or not isinstance(code, str) or not re.fullmatch(r"[0-9A-F]{6}", code)
                    or type(expires_at) is not int or type(poll_seconds) is not int or not 1 <= poll_seconds <= 30):
                raise ValueError("invalid authorization response")
        except (KeyError, TypeError, ValueError):
            raise RuntimeError("invalid maid authorization request") from None
        return WebsiteRequest(token, url, code, expires_at, poll_seconds)

    async def check(self, token: str) -> WebsiteGrant | None:
        if not _TOKEN.fullmatch(token):
            raise ControlChanged("MAID_WEBSITE_CONNECTION_DENIED")
        response = await self.http.post(self.origin + _BASE + "/check",
            headers={"Authorization": "Bearer " + token}, json={}, timeout=8, follow_redirects=False)
        if response.status_code == 202:
            return None
        if response.status_code in (401, 403):
            raise ControlChanged("MAID_WEBSITE_CONNECTION_DENIED")
        response.raise_for_status()
        try:
            data = response.json()
            if data.get("state") != "approved" or not isinstance(data["bodyEndpoint"], str):
                raise ValueError("invalid authorization response")
            return WebsiteGrant(str(UUID(data["ownerId"])), str(UUID(data["maidId"])), data["bodyEndpoint"])
        except (AttributeError, KeyError, TypeError, ValueError):
            raise RuntimeError("invalid maid authorization grant") from None


def save_token(filename: Path, token: str) -> None:
    filename.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="ascii", dir=filename.parent, delete=False) as stream:
            path = Path(stream.name)
            stream.write(token + "\n")
        path.replace(filename)
    finally:
        if path is not None:
            path.unlink(missing_ok=True)
