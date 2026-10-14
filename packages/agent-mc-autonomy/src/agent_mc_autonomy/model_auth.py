"""Explicit API credentials and official OAuth. Never borrow another app's login."""

import asyncio
import base64
import hashlib
import json
import secrets
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx

from .model_config import secret
from .ownership import session_lease

OAUTH = {
    "openai": {
        "authorize": "https://auth.openai.com/api/accounts/authorize",
        "token": "https://auth.openai.com/api/accounts/oauth/token",
        "jwks": "https://auth.openai.com/.well-known/jwks.json", "issuer": "https://auth.openai.com",
        "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    },
    "google": {
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "jwks": "https://www.googleapis.com/oauth2/v3/certs", "issuer": "https://accounts.google.com",
        "scope": "openid email https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever",
    },
}


class CredentialStore:
    """OS credential vault. No insecure file or browser-storage fallback."""

    def __init__(self, config):
        try:
            import keyring
        except ImportError:
            raise RuntimeError("brain_oauth_install_auth_extra") from None
        self.backend = keyring.get_keyring()
        if not type(self.backend).__module__.startswith(("keyring.backends.Windows", "keyring.backends.macOS",
                                                        "keyring.backends.SecretService", "keyring.backends.kwallet")):
            raise RuntimeError("brain_oauth_secure_keyring_required")
        self.name = config.provider + ":" + config.auth.credential_id
        self.lock_path = Path.home() / ".agent-mc" / "oauth-locks" / hashlib.sha256(self.name.encode()).hexdigest()

    def load(self):
        try:
            value = self.backend.get_password("agent-mc-model-oauth", self.name)
            return json.loads(value) if value else None
        except Exception:
            raise RuntimeError("brain_oauth_vault_read_failed") from None

    def save(self, value):
        try:
            self.backend.set_password("agent-mc-model-oauth", self.name, json.dumps(value))
        except Exception:
            raise RuntimeError("brain_oauth_vault_write_failed") from None

    def delete(self):
        try:
            if self.load():
                self.backend.delete_password("agent-mc-model-oauth", self.name)
        except Exception:
            raise RuntimeError("brain_oauth_vault_delete_failed") from None

    def host_id(self):
        with session_lease(self.lock_path.parent / "host-registration"):
            try:
                value = self.backend.get_password("agent-mc-model-oauth", "host-id")
                if not value:
                    value = "urn:uuid:" + str(uuid.uuid4())
                    self.backend.set_password("agent-mc-model-oauth", "host-id", value)
                return value
            except Exception:
                raise RuntimeError("brain_oauth_vault_unavailable") from None


async def token_request(client, provider, data):
    try:
        response = await client.post(OAUTH[provider]["token"], data=data, follow_redirects=False)
        if response.status_code != 200:
            raise RuntimeError("brain_oauth_reauthorization_required")
        result = response.json()
        if (not isinstance(result.get("access_token"), str) or not result["access_token"]
                or str(result.get("token_type", "")).lower() != "bearer"
                or type(result.get("expires_in")) not in {int, float} or not 0 < result["expires_in"] <= 86400
                or any(ord(c) < 32 for c in result["access_token"])):
            raise RuntimeError("brain_oauth_response_invalid")
        return result
    except (httpx.HTTPError, json.JSONDecodeError, TypeError, KeyError):
        raise RuntimeError("brain_oauth_exchange_failed") from None


async def identity(client, provider, token, client_id, nonce=None):
    try:
        import jwt
        response = await client.get(OAUTH[provider]["jwks"], follow_redirects=False)
        response.raise_for_status()
        header = jwt.get_unverified_header(token)
        key = next(k for k in response.json()["keys"] if k.get("kid") == header.get("kid"))
        claims = jwt.decode(token, jwt.PyJWK.from_dict(key).key, algorithms=["RS256"],
                            audience=client_id, issuer=OAUTH[provider]["issuer"],
                            options={"require": ["iss", "aud", "exp", "sub"]})
        if nonce is not None and not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
            raise RuntimeError("nonce")
        return claims["sub"]
    except ImportError:
        raise RuntimeError("brain_oauth_install_auth_extra") from None
    except Exception:
        raise RuntimeError("brain_oauth_identity_invalid") from None


class Authorization:
    def __init__(self, config, *, store=None):
        self.config, self.store = config, store
        self.lock = asyncio.Lock()
        self.adc = None

    def vault(self):
        if self.store is None:
            self.store = CredentialStore(self.config)
        return self.store

    async def token(self, client):
        config, mode = self.config, self.config.auth.mode
        if mode in {"api_key", "bearer"}:
            return config.key()
        if mode == "none":
            return ""
        async with self.lock:
            if mode == "google_adc":
                return await asyncio.to_thread(self._google_token)
            store = self.vault()
            # Serialize rotating refresh tokens across independent game sessions/processes.
            with session_lease(store.lock_path):
                saved = store.load()
                if not saved or saved.get("provider") != config.provider or not saved.get("subject"):
                    raise RuntimeError("brain_oauth_login_required")
                if saved.get("expires_at", 0) > time.time() + 30:
                    return saved["access_token"]
                if not saved.get("refresh_token"):
                    raise RuntimeError("brain_oauth_reauthorization_required")
                data = {"grant_type": "refresh_token", "client_id": saved["client_id"], "refresh_token": saved["refresh_token"]}
                self._extra(data)
                value = await token_request(client, config.provider, data)
                if value.get("id_token") and await identity(client, config.provider, value["id_token"], saved["client_id"]) != saved["subject"]:
                    raise RuntimeError("brain_oauth_account_changed")
                updated = {**saved, **value, "expires_at": time.time() + value["expires_in"]}
                if config.provider == "openai" and "chatgpt.tokens.use.direct" not in updated.get("scope", "").split():
                    raise RuntimeError("brain_oauth_plan_permission_required")
                store.save(updated)
                return updated["access_token"]

    def _extra(self, data):
        if self.config.provider == "openai":
            data["resource"] = "https://api.openai.com/v1"
        elif self.config.auth.client_secret_env:
            data["client_secret"] = secret(self.config.auth.client_secret_env)

    def _google_token(self):
        try:
            import google.auth
            from google.auth.transport.requests import Request
            if self.adc is None:
                self.adc, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform",
                                                        "https://www.googleapis.com/auth/generative-language.retriever"])
            if not self.adc.valid:
                self.adc.refresh(Request())
            return self.adc.token
        except ImportError:
            raise RuntimeError("brain_oauth_install_google_extra") from None
        except Exception:
            raise RuntimeError("brain_google_adc_unavailable") from None

    async def headers(self, client):
        token = await self.token(client)
        config = self.config
        result = {}
        if token:
            if config.auth.mode == "api_key" and config.protocol == "anthropic":
                result["x-api-key"] = token
            elif config.auth.mode == "api_key" and config.protocol == "gemini":
                result["x-goog-api-key"] = token
            else:
                result["Authorization"] = "Bearer " + token
        if config.protocol == "anthropic":
            result["anthropic-version"] = config.anthropic_version
            if config.anthropic_beta:
                result["anthropic-beta"] = config.anthropic_beta
        if config.organization:
            result["OpenAI-Organization"] = config.organization
        if config.project:
            result["OpenAI-Project"] = config.project
        if config.auth.quota_project:
            result["x-goog-user-project"] = config.auth.quota_project
        return result


class OAuthAttempt:
    """Single-use state/nonce/PKCE transaction, separate from an existing account."""

    def __init__(self, config, redirect_uri, saved=None):
        self.config, self.saved, self.redirect_uri = config, saved or {}, redirect_uri
        callback = urlsplit(redirect_uri)
        if (config.auth.mode != "oauth" or callback.scheme != "http" or callback.hostname != "127.0.0.1"
                or callback.path != "/auth/callback" or not callback.port or callback.query or callback.fragment):
            raise RuntimeError("brain_oauth_callback_invalid")
        self.state, self.nonce, self.verifier = (secrets.token_urlsafe(32) for _ in range(3))
        self.consumed = False
        self.client_id = self.saved.get("client_id") or config.auth.client_id
        if not self.client_id:
            if config.provider != "openai":
                raise RuntimeError("brain_google_oauth_client_required")
            self.client_id = "dynamic_agent_client"
        self.host = self.saved.get("ext_agent_host_id") or "urn:uuid:" + str(uuid.uuid4())

    def url(self):
        config = self.config
        params = {"client_id": self.client_id, "response_type": "code", "redirect_uri": self.redirect_uri,
                  "scope": OAUTH[config.provider]["scope"], "state": self.state, "nonce": self.nonce,
                  "code_challenge_method": "S256", "code_challenge": base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest()).decode().rstrip("=")}
        if config.provider == "openai":
            params.update(resource="https://api.openai.com/v1", ext_agent_host_id=self.host)
            if self.client_id == "dynamic_agent_client":
                params["agent_name_hint"] = "Agent MC"
        else:
            params.update(access_type="offline", prompt="consent")
        return OAUTH[config.provider]["authorize"] + "?" + urlencode(params)

    async def complete(self, query, client, *, verify=identity):
        if self.consumed:
            raise RuntimeError("brain_oauth_attempt_consumed")
        self.consumed = True
        values = parse_qs(query, strict_parsing=True)
        if any(len(v) != 1 for v in values.values()) or not secrets.compare_digest(values.get("state", [""])[0], self.state):
            raise RuntimeError("brain_oauth_state_invalid")
        if "error" in values or not values.get("code"):
            raise RuntimeError("brain_oauth_authorization_denied")
        client_id = values.get("client_id", [self.client_id])[0]
        if self.client_id == "dynamic_agent_client":
            if not client_id.startswith("oaiapp_"):
                raise RuntimeError("brain_oauth_registration_incomplete")
        elif client_id != self.client_id:
            raise RuntimeError("brain_oauth_client_changed")
        data = {"grant_type": "authorization_code", "client_id": client_id, "code": values["code"][0],
                "code_verifier": self.verifier, "redirect_uri": self.redirect_uri}
        Authorization(self.config)._extra(data)
        value = await token_request(client, self.config.provider, data)
        subject = await verify(client, self.config.provider, value.get("id_token"), client_id, self.nonce)
        if self.saved.get("subject") and self.saved["subject"] != subject:
            raise RuntimeError("brain_oauth_account_changed_use_new_credential_id")
        if self.config.provider == "openai" and "chatgpt.tokens.use.direct" not in value.get("scope", "").split():
            raise RuntimeError("brain_oauth_plan_permission_required")
        return {**value, "provider": self.config.provider, "subject": subject, "client_id": client_id,
                "ext_agent_host_id": self.host, "expires_at": time.time() + value["expires_in"]}


def login(config):
    """Operator-only CLI action on the machine running the agent. Never starts gameplay."""
    import webbrowser
    from http.server import BaseHTTPRequestHandler, HTTPServer
    if config.auth.mode != "oauth":
        raise RuntimeError("brain_oauth_mode_required")
    store = CredentialStore(config)
    with session_lease(store.lock_path):
        returned = []

        class Callback(BaseHTTPRequestHandler):
            def do_GET(self):
                url = urlsplit(self.path)
                if url.path != "/auth/callback" or self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                    self.send_error(404)
                    return
                returned.append(url.query)
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(b"Callback received. Return to Agent MC to check the sign-in result.")

            def log_message(self, *_):
                pass  # Authorization code/state must never enter access logs.

        with HTTPServer(("127.0.0.1", 0), Callback) as server:
            server.timeout = 1
            saved = store.load() or {}
            saved.setdefault("ext_agent_host_id", store.host_id())
            attempt = OAuthAttempt(config, f"http://127.0.0.1:{server.server_port}/auth/callback", saved)
            # Retain the host identifier even if registration is cancelled, without replacing tokens.
            store.save({**attempt.saved, "ext_agent_host_id": attempt.host})
            if not webbrowser.open(attempt.url()):
                raise RuntimeError("brain_oauth_browser_unavailable")
            until = time.monotonic() + 180
            while not returned and time.monotonic() < until:
                server.handle_request()
            if not returned:
                raise RuntimeError("brain_oauth_callback_timeout")

        async def exchange():
            async with httpx.AsyncClient(timeout=30, trust_env=False, follow_redirects=False) as client:
                return await attempt.complete(returned[0], client)
        store.save(asyncio.run(exchange()))
    return {"signed_in": True, "provider": config.provider, "credential_id": config.auth.credential_id, "game_started": False}
