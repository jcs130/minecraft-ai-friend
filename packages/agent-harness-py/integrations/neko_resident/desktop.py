"""Device consent and credentials. A saved device does not run a game session."""
import asyncio
import base64
import hashlib
import json
import os
import platform
import re
import secrets
import time
from contextlib import contextmanager
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from uuid import uuid4


API = "/api/v1/desktop-devices"
CALLBACK = "/qd-desktop/callback"
SERVICE = "Qiandengji N.E.K.O. device"
SECRET = re.compile(r"[A-Za-z0-9_-]{43}\Z")
IDENTITY = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")


class WindowsCredentials:
    def __init__(self):
        import ctypes as c
        from ctypes import wintypes as w

        class Credential(c.Structure):
            _fields_ = [("Flags", w.DWORD), ("Type", w.DWORD), ("TargetName", w.LPWSTR),
                        ("Comment", w.LPWSTR), ("LastWritten", w.FILETIME), ("CredentialBlobSize", w.DWORD),
                        ("CredentialBlob", c.c_void_p), ("Persist", w.DWORD), ("AttributeCount", w.DWORD),
                        ("Attributes", c.c_void_p), ("TargetAlias", w.LPWSTR), ("UserName", w.LPWSTR)]

        self.c = c
        self.record = Credential
        self.api = c.WinDLL("Advapi32", use_last_error=True)
        self.api.CredReadW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, c.POINTER(c.POINTER(Credential))]
        self.api.CredWriteW.argtypes = [c.POINTER(Credential), w.DWORD]
        self.api.CredFree.argtypes, self.api.CredFree.restype = [c.c_void_p], None
        self.api.CredDeleteW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD]

    def get_password(self, service, account):
        ptr = self.c.POINTER(self.record)()
        if not self.api.CredReadW(f"{service}/{account}", 1, 0, self.c.byref(ptr)):
            if self.c.get_last_error() == 1168:  # ERROR_NOT_FOUND
                return None
            raise self.c.WinError(self.c.get_last_error())
        try:
            value = ptr.contents
            return self.c.string_at(value.CredentialBlob, value.CredentialBlobSize).decode("utf-8")
        finally:
            self.api.CredFree(ptr)

    def set_password(self, service, account, password):
        data = password.encode("utf-8")
        blob = self.c.create_string_buffer(data)
        # A generic credential persists across user sessions on this machine only.
        value = self.record(Type=1, TargetName=f"{service}/{account}", Persist=2, UserName=account,
                            CredentialBlobSize=len(data), CredentialBlob=self.c.addressof(blob))
        if not self.api.CredWriteW(self.c.byref(value), 0):
            raise self.c.WinError(self.c.get_last_error())

    def delete_password(self, service, account):
        if not self.api.CredDeleteW(f"{service}/{account}", 1, 0) and self.c.get_last_error() != 1168:
            raise self.c.WinError(self.c.get_last_error())


class DeviceVault:
    def __init__(self, path, portal):
        self.path = path
        self.account = hashlib.sha256((str(path.resolve()) + "\0" + portal).encode()).hexdigest()

    @staticmethod
    def backend():
        if os.name == "nt":
            return WindowsCredentials()
        import keyring
        backend = keyring.get_keyring()
        if not type(backend).__module__.startswith(("keyring.backends.macOS", "keyring.backends.SecretService",
                                                   "keyring.backends.kwallet", "keyring.backends.libsecret")):
            raise RuntimeError("desktop_secure_storage_unavailable")
        return backend

    @contextmanager
    def lock(self):
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self.path.open("a+b") as stream:
            stream.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX)
            try:
                yield
            finally:
                stream.seek(0)
                if os.name == "nt":
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream, fcntl.LOCK_UN)

    def load(self):
        raw = self.backend().get_password(SERVICE, self.account)
        return json.loads(raw) if raw else {}

    def save(self, data):
        self.backend().set_password(SERVICE, self.account, json.dumps(data, ensure_ascii=False, separators=(",", ":")))


class DesktopDevice:
    def __init__(self, portal, vault, request):
        self.portal = portal
        self.vault = vault
        self.request = request
        self.login = None
        self.listener = None
        self.expiry = None

    @staticmethod
    def headers(data):
        return {"X-QD-Device": data["device"], "X-QD-Device-Proof": data["proof"]}

    def _post(self, data, op, payload, token=None):
        return self.request(self.portal + API + "/" + op, payload, token, extra_headers=self.headers(data))

    def settings(self):
        with self.vault.lock():
            return self.vault.load()

    def remember_role(self, role, mode):
        with self.vault.lock():
            record = self.vault.load()
            if role:
                record["localRole"] = role
            record["mode"] = mode
            record["modeCharacter"] = record["character"]
            self.vault.save(record)

    def _device(self):
        with self.vault.lock():
            data = self.vault.load()
            if not data:
                data = {"device":str(uuid4()), "proof":secrets.token_urlsafe(32)}
                self.vault.save(data)
            return data

    @staticmethod
    def _credentials(record, result):
        if (not re.fullmatch(r"qda2_[A-Za-z0-9_-]{43}", result["accessToken"])
                or not re.fullmatch(r"qdr2_[A-Za-z0-9_-]{43}", result["refreshToken"])
                or not IDENTITY.fullmatch(result["character"])
                or type(result["expiresAt"]) is not int or result["expiresAt"] <= time.time() * 1000):
            raise ValueError("invalid_desktop_credentials")
        return record | {key:result[key] for key in ("accessToken","refreshToken","expiresAt","character","role")}

    def authorized(self, op, payload):
        # A pending rotation ID survives app and network failures. Another host
        # process cannot rotate this keyring record concurrently.
        with self.vault.lock():
            row = self.vault.load()
            if not row.get("refreshToken"):
                raise ValueError("desktop_reauthorization_required")
            try:
                if row.get("expiresAt", 0) > time.time() * 1000 + 5_000 and not row.get("rotationId"):
                    try:
                        return self._post(row,op,payload,row["accessToken"])
                    except HTTPError as err:
                        if err.code != 401:
                            raise
                row.setdefault("rotationId",str(uuid4()))
                self.vault.save(row)
                result = self._post(row,"refresh",{"refreshToken":row["refreshToken"],"rotationId":row["rotationId"]})
                row = self._credentials(row,result)
                row.pop("rotationId")
                self.vault.save(row)
                return self._post(row,op,payload,row["accessToken"])
            except HTTPError as err:
                if err.code == 401:
                    self._erase(row)
                raise

    def _erase(self, record):
        for key in ("accessToken","refreshToken","expiresAt","rotationId"):
            record.pop(key,None)
        self.vault.save(record)

    def erase(self):
        with self.vault.lock():
            row = self.vault.load()
            if row:
                self._erase(row)

    def close_login(self):
        if self.listener:
            self.listener.close()
            self.listener = None
        if self.expiry:
            self.expiry.cancel()
            self.expiry = None
        self.login = None

    async def start(self, cross_device):
        self.close_login()
        data = await asyncio.to_thread(self._device)
        verifier, state = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).decode().rstrip("=")
        redirect = None
        if not cross_device:
            self.listener = await asyncio.start_server(self.callback, "127.0.0.1", 0, limit=8192)
            redirect = "http://127.0.0.1:" + str(self.listener.sockets[0].getsockname()[1]) + CALLBACK
        try:
            name = f"N.E.K.O. · {platform.system()} · {data['device'][:6]}"
            result = await asyncio.to_thread(self._post,data,"begin",{"state":state,"challenge":challenge,
                "redirectUri":redirect,"name":name})
            identity = result["id"]
            expected = self.portal + "/desktop-connect.html#" + identity
            if (not SECRET.fullmatch(identity) or result["url"] != expected or
                    type(result["expiresAt"]) is not int or result["expiresAt"] <= time.time() * 1000 or
                    cross_device and not re.fullmatch(r"\d{6}",result.get("code",""))):
                raise ValueError("invalid_desktop_flow")
        except Exception:
            self.close_login()
            raise
        suffix = "?" + urlencode({"character":data["character"]}) if data.get("character") else ""
        url = self.portal + "/desktop-connect.html" + suffix + "#" + identity
        self.login = {"id":identity,"state":state,"verifier":verifier,"redirectUri":redirect,
                      "crossCode":result.get("code"),"authorizationCode":None,"url":url}
        self.expiry = asyncio.get_running_loop().call_later(min(300,(result["expiresAt"]-time.time()*1000)/1000),self.close_login)
        return url

    async def callback(self, reader, writer):
        ok = False
        try:
            raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"),3)
            method, path, protocol = raw.split(b"\r\n",1)[0].decode("ascii").split(" ")
            target = urlsplit(path)
            params = parse_qs(target.query,strict_parsing=True,max_num_fields=3)
            pending = self.login
            host = [line[5:].strip().decode("ascii") for line in raw.split(b"\r\n") if line.lower().startswith(b"host:")]
            if (method == "GET" and protocol in ("HTTP/1.0","HTTP/1.1") and not target.netloc
                    and not target.scheme and target.path == CALLBACK and pending and pending["redirectUri"]
                    and not pending["authorizationCode"] and host == [urlsplit(pending["redirectUri"]).netloc]
                    and set(params) == {"state","iss","code"} and all(len(v) == 1 for v in params.values())
                    and params["iss"] == [self.portal] and params["state"] == [pending["state"]]
                    and SECRET.fullmatch(params["code"][0])):
                pending["authorizationCode"] = params["code"][0]
                ok = True
        except (OSError, ValueError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            pass
        finally:
            message = ("已收到授权，请返回 N.E.K.O.。" if ok else "授权回调无效，请从 N.E.K.O. 重新开始。").encode()
            try:
                status = b"200 OK" if ok else b"400 Bad Request"
                writer.write(b"HTTP/1.1 " + status + b"\r\nContent-Type: text/plain; charset=utf-8\r\n"
                    b"Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\n"
                    b"Connection: close\r\nContent-Length: " + str(len(message)).encode() + b"\r\n\r\n" + message)
                await writer.drain()
            except OSError:
                pass
            finally:
                writer.close()

    def _exchange(self, flow):
        payload = {key:flow[key] for key in ("id","state","verifier","redirectUri")}
        if flow["authorizationCode"]:
            payload["code"] = flow["authorizationCode"]
        with self.vault.lock():
            row = self.vault.load()
            result = self._post(row,"exchange",payload)
            if result.get("pending"):
                return False
            row = self._credentials(row,result)
            row.pop("rotationId",None)
            self.vault.save(row)
        return True

    async def complete(self):
        flow = self.login
        if not flow:
            return False
        if not flow["authorizationCode"] and not flow["crossCode"]:
            return False
        if await asyncio.to_thread(self._exchange,flow):
            self.close_login()
            return True
        return False
