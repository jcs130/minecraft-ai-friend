"""Optional desktop presentation, independent of the Minecraft control loop."""

import asyncio
import webbrowser
from datetime import datetime, timezone

from .configuration import viewer_url


def viewer_observation(settings, snapshot):
    """A fresh bound packet observation, separate from complete scene parity."""
    current = snapshot.get("viewer") or {}
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(current["updated_at"])).total_seconds()
        identity = current["status"]["identity"]
        verified = (0 <= age <= 15 and current.get("available") is True and snapshot.get("game_connected") is True
                    and identity.get("confirmed") is True and identity.get("player") == settings.username
                    and identity.get("playerUuid") == current["player"]["uuid"])
        url = viewer_url(current.get("url", "")) if verified else settings.external_viewer_url
    except (ValueError, TypeError, KeyError):
        url, verified = settings.external_viewer_url, False
    return {"viewer_url": url, "viewer_body_binding_verified": verified}


class ViewerWindow:
    """One attempt after a live connection per explicitly started runtime."""

    def __init__(self, url, enabled=True, *, opener=None):
        self.url, self.enabled = url, enabled
        self.opener = opener or webbrowser.open
        self.attempted = False

    async def connected(self):
        if self.attempted or not self.enabled or not self.url:
            return None
        self.attempted = True
        try:
            opened = await asyncio.to_thread(self.opener, self.url, new=2)
            return "requested" if opened else "manual_open_required"
        except Exception:
            # Browser availability must never cancel native work or leak URLs.
            return "manual_open_required"
