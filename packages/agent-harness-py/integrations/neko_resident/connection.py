"""Local pairing state and owner-facing N.E.K.O. Hosted UI."""
import asyncio
import json
import os
import re
import secrets
import tempfile
import time
import webbrowser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import uuid4

from plugin.sdk.plugin import Err, Ok, plugin_entry, ui


PORTAL = "https://mc.kangqiang.site"
SECRET = {"type": "string", "writeOnly": True}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_json(url, payload=None, token=None, *, timeout=8):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = Request(url, data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
    with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=timeout) as response:
        raw = response.read(256 * 1024 + 1)
        if len(raw) > 256 * 1024:
            raise ValueError("resident_reply_too_large")
        return json.loads(raw)


def origin_of(value):
    parsed = urlsplit(value)
    if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname == "127.0.0.1")):
        raise ValueError("invalid_portal_origin")
    return f"{parsed.scheme}://{parsed.netloc}"


def read_session(session, origin=None):
    endpoint = session["endpoint"]
    actual_origin = origin_of(endpoint)
    if ((origin and actual_origin != origin)
            or not re.fullmatch(r"/api/v1/resident-turns/[a-z][a-z0-9_-]{1,31}", urlsplit(endpoint).path)
            or not re.fullmatch(r"rdt_[A-Za-z0-9_-]{43}", session["token"])):
        raise ValueError("invalid_session")
    return session


def save_binding(path, role, session):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            tmp = Path(stream.name)
            json.dump({"role": role, "session": session}, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        tmp.replace(path)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


class ConnectionPanel:
    authorization = None
    catalog = None
    waiting = None
    draft = None

    @staticmethod
    def local_origin():
        from config import MAIN_SERVER_PORT
        return f"http://127.0.0.1:{int(MAIN_SERVER_PORT)}"

    def local_characters(self):
        try:
            result = request_json(self.local_origin() + "/api/characters", timeout=2)
            return list(result.get("猫娘", {})), result.get("当前猫娘", "")
        except (OSError, ValueError, TypeError, AttributeError):
            return [], ""

    def _clear_authorization(self):
        self.authorization = self.catalog = self.waiting = self.draft = None

    def _authorized(self):
        if self.authorization and self.authorization["expiresAt"] > time.time() * 1000:
            return True
        self._clear_authorization()
        return False

    def _from_panel(self, token):
        return isinstance(token, str) and token.isascii() and bool(self.panel_token) and secrets.compare_digest(self.panel_token, token)

    @ui.context(id="resident_connection", title="千灯纪居民")
    async def connection_context(self):
        resident = (self.session or {}).get("resident", {})
        names, current = await asyncio.to_thread(self.local_characters)
        return {"role": self.role or getattr(self._host_ctx, "current_lanlan", "") or current,
                "localRoles": names, "authorized": self._authorized(), "catalog": self.catalog or {},
                "waiting": self.waiting[0]["name"] if self.waiting else None,
                "resident": resident.get("name", ""), "connected": self.session is not None,
                "uiToken": self.panel_token}

    @ui.action(id="open_resident_website", label="打开角色管理或授权页")
    @plugin_entry(id="open_resident_website", name="打开角色管理或授权页", input_schema={
        "type": "object", "properties": {"page": {"type": "string", "enum": ["authorize", "characters"]}, "uiToken": SECRET},
        "required": ["page", "uiToken"], "additionalProperties": False})
    async def open_resident_website(self, page, uiToken, **_):
        if not self._from_panel(uiToken) or page not in ("authorize", "characters"):
            return Err("请从千灯纪居民面板打开。")
        url = self.portal + "/resident-connect.html?flow=authorize" if page == "authorize" else self.local_origin() + "/character_card_manager"
        if not await asyncio.to_thread(webbrowser.open, url):
            return Err("请在浏览器打开 " + url)
        return Ok({"opened": True})

    @ui.action(id="pair_resident", label="连接居民身体", refresh_context=True)
    @plugin_entry(id="pair_resident", name="连接居民身体", input_schema={
        "type": "object", "properties": {"code": {**SECRET, "maxLength": 20}, "uiToken": SECRET,
                                        "localRole": {"type": "string", "maxLength": 128}},
        "required": ["code", "uiToken"], "additionalProperties": False})
    async def pair_resident(self, code, uiToken, localRole="", **_):
        if not self._from_panel(uiToken):
            return Err("请在千灯纪居民面板输入官网连接码。")
        if not isinstance(code, str) or not re.fullmatch(r"[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){2}", code.strip().upper()):
            return Err("请粘贴官网显示的三组四位连接码。")
        async with self.pair_lock:
            try:
                payload = {"code": code.strip().upper()}
                try:
                    auth = await asyncio.to_thread(request_json, self.portal + "/api/v1/resident-onboarding/pair", payload)
                except HTTPError as exc:
                    if exc.code not in (403, 404):
                        raise
                    role = await self._resolve_role(localRole)
                    if not role:
                        return Err("请先选择本机角色，再提交旧版居民连接码。")
                    grant = await asyncio.to_thread(request_json, self.portal + "/api/v1/resident-turns/pair", payload)
                    return await self._bind(role, grant)
                if not re.fullmatch(r"rot_[A-Za-z0-9_-]{43}", auth["onboardingToken"]) or not isinstance(auth["expiresAt"], (int, float)):
                    raise ValueError("invalid_authorization")
                self._clear_authorization()
                self.authorization = auth
                await self._list()
            except (OSError, ValueError, TypeError, KeyError):
                return Err("未能完成配对。请检查网络并在官网重新生成连接码。")
        return Ok({"authorized": True})

    async def _resolve_role(self, candidate):
        names, current = await asyncio.to_thread(self.local_characters)
        role = (candidate or getattr(self._host_ctx, "current_lanlan", "") or self.role or current).strip()
        return role if role and role.isprintable() and len(role) <= 128 and (not names or role in names) else None

    async def _bind(self, role, grant):
        session = read_session(grant, self.portal)
        await asyncio.to_thread(save_binding, self.data_path("resident-binding.json"), role, session)
        self._clear_authorization()
        await self.detach()
        self.role, self.session = role, session
        await self._on_command_loop_start()
        return Ok({"role": role, "resident": session.get("resident", {}).get("name", ""), "connected": True})

    async def _onboarding_request(self, op, payload):
        return await asyncio.to_thread(request_json, self.portal + "/api/v1/resident-onboarding/" + op, payload, self.authorization["onboardingToken"])

    async def _list(self):
        data = await self._onboarding_request("list", {})
        self.catalog = {"availableBodies": data["availableBodies"], "residents": [
            {key: row[key] for key in ("id", "characterId", "name", "bodyKind", "state")} for row in data["residents"]]}

    @ui.action(id="manage_residents", label="管理游戏角色")
    @plugin_entry(id="manage_residents", name="管理游戏角色", input_schema={
        "type": "object", "properties": {"op": {"type": "string", "enum": ["list", "create", "connect"]},
            "uiToken": SECRET, "id": {"type": "string"}, "characterId": {"type": "string"}, "localRole": {"type": "string"},
            "bodyKind": {"type": "string", "enum": ["maid", "numen"]}, "name": {"type": "string", "maxLength": 24},
            "persona": {"type": "string", "maxLength": 1000}}, "required": ["op", "uiToken"], "additionalProperties": False})
    async def manage_residents(self, op, uiToken, id="", characterId="", localRole="", bodyKind="", name="", persona="", **_):
        if not self._from_panel(uiToken):
            return Err("请从千灯纪居民面板操作。")
        async with self.pair_lock:
            if not self._authorized():
                return Err("请重新登录官网授权。")
            try:
                if op == "list":
                    await self._list()
                    if not self.waiting:
                        return Ok({"updated": True})
                    target, role = self.waiting
                    id, characterId = target["id"], target["characterId"]
                else:
                    role = await self._resolve_role(localRole)
                    if not role:
                        return Err("请选择本机 N.E.K.O. 中接收游戏消息的角色。")
                    if op == "create":
                        profile = {"name": name.strip(), "persona": persona.strip(), "bodyKind": bodyKind}
                        if not self.draft or self.draft[0] != profile:
                            self.draft = profile, str(uuid4())
                        created = await self._onboarding_request("create", {**profile, "requestId": self.draft[1]})
                        self.waiting = created["resident"], role
                        id, characterId = self.waiting[0]["id"], self.waiting[0]["characterId"]
                        await self._list()
                    elif op != "connect":
                        return Err("未知角色操作。")
                selected = next((row for row in self.catalog["residents"] if row["id"] == id and row["characterId"] == characterId), None)
                if not selected:
                    return Err("请刷新角色列表后重新选择。")
                if selected["state"] != "available":
                    self.waiting = selected, role
                    return Ok({"state": "preparing"})
                grant = await self._onboarding_request("connect", {"id": id, "characterId": characterId})
                return await self._bind(role, grant)
            except HTTPError as exc:
                if exc.code == 401:
                    self._clear_authorization()
                    return Err("授权已过期，请重新登录官网。")
                return Err("官网暂未完成操作。请刷新角色列表后重试。")
            except (OSError, ValueError, TypeError, KeyError):
                return Err("未能完成角色操作。请检查连接后重试。")
