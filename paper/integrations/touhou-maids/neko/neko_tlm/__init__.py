"""N.E.K.O. × Touhou Little Maid 的千灯纪私人身体接入。"""

import asyncio
import json
import os
import re
import ssl
import time
import uuid
import webbrowser
from functools import partial
from pathlib import Path

import httpx
from agent_mc_harness.body.maid import MaidBody
from agent_mc_harness.bridges import ControlChanged, MaidApiBridge, NativeMaidBridge
from agent_mc_harness.models import Scope
from plugin.sdk.plugin import (
    Err,
    NekoPluginBase,
    Ok,
    lifecycle,
    neko_plugin,
    plugin_entry,
)
from plugin.sdk.shared.models.exceptions import SdkError
from pydantic import BaseModel, ConfigDict

from .body_tools import BodyTools, tool_error
from .events import push_dialogue
from .tool_defs import TOOLS, Tool
from .website import PORTAL_ORIGIN, MaidWebsite, WebsiteRequest, save_token

CONFIG_ENV = "QIANDENGJI_NEKO_MAID_CONFIG"


class BodyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    endpoint: str = ""
    owner_id: uuid.UUID | None = None
    maid_id: uuid.UUID | None = None
    token_file: Path | None = None
    role: str
    forward_owner_dialogue: bool = False
    ca_file: Path | None = None
    portal_origin: str = PORTAL_ORIGIN

    @property
    def website(self) -> bool:
        return not self.endpoint

    @property
    def remote(self) -> bool:
        return self.website or self.endpoint.startswith("https://")

    @classmethod
    def load(cls, settings, config_path: str | None = None):
        if config_path:
            path = Path(config_path)
            if not path.is_absolute():
                raise ValueError("explicit absolute config path required")
            with path.open(encoding="utf-8") as source:
                settings = json.load(source)
        config = cls.model_validate(settings, strict=False)
        if (
            config.schema_version != 1
            or (not config.website and (config.token_file is None or not config.token_file.is_absolute()))
            or not config.role
            or config.role.strip() != config.role
            or (config.owner_id is None) != (config.maid_id is None)
            or (not config.remote and config.owner_id is None)
            or (config.ca_file is not None and (not config.remote or not config.ca_file.is_absolute()))
        ):
            raise ValueError("invalid configuration")
        return config


@neko_plugin
class NekoMinecraftPlugin(NekoPluginBase):
    def __init__(self, ctx):
        super().__init__(ctx)
        self.logger = ctx.logger
        self._config: BodyConfig | None = None
        self._bridge: NativeMaidBridge | None = None
        self._body: MaidBody | None = None
        self._tools: BodyTools | None = None
        self._maintenance: asyncio.Task | None = None
        self._pairing: asyncio.Task | None = None
        self._website_request: WebsiteRequest | None = None
        self._connection = "disabled"
        self._previous_dialogue: set[str] = set()

    @lifecycle(id="startup")
    async def on_startup(self, **_):
        try:
            config_path = os.environ.get(CONFIG_ENV)
            settings = None if config_path else await self.config.get("maid_body")
            self._config = BodyConfig.load(settings, config_path)
        except (OSError, ValueError, SdkError):
            self._connection = "configuration_required"
            return Err("在插件配置中填写 N.E.K.O. 角色名，然后启动插件并点击「官网授权」。")
        self._connection = "starting"
        return Ok({"status": self._connection})

    async def _on_command_loop_start(self):
        # NEKO runs startup and command handling on different event loops.
        if self._config is not None:
            await self._attach()

    @staticmethod
    def _http(config: BodyConfig) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            trust_env=False,
            follow_redirects=False,
            verify=ssl.create_default_context(cafile=str(config.ca_file)) if config.ca_file else True,
            limits=httpx.Limits(max_keepalive_connections=0),
        )

    async def _attach(self):
        config = self._config
        if config is None:
            return
        self._connection = "starting"
        http = None
        try:
            endpoint = config.endpoint
            expected = (str(config.owner_id), str(config.maid_id)) if config.owner_id is not None else None
            if config.website:
                filename = self.data_path("maid-website.key")
                if not filename.is_file():
                    self._connection = "login_required"
                    return
                token = filename.read_text(encoding="ascii").strip()
                http = self._http(config)
                try:
                    grant = await MaidWebsite(config.portal_origin, http).check(token)
                except ControlChanged:
                    self._connection = "login_required"
                    return
                if grant is None:
                    self._connection = "login_required"
                    return
                endpoint = grant.endpoint
                approved = (grant.owner_id, grant.maid_id)
                if expected is not None and expected != approved:
                    raise ControlChanged("MAID_WEBSITE_GRANT_IDENTITY_CHANGED")
                expected = approved
            else:
                token = config.token_file.read_text(encoding="ascii").strip()
                pattern = r"mda_[A-Za-z0-9_-]{43}" if config.remote else r"[A-Za-z0-9_-]{32,128}"
                if not re.fullmatch(pattern, token):
                    raise ValueError("invalid token format")
                http = self._http(config)

            if config.remote:
                assigned = await MaidApiBridge.identify(endpoint, token, http=http)
                if expected is not None and assigned != expected:
                    raise ControlChanged("MAID_API_GRANT_IDENTITY_CHANGED")
                expected = assigned
            if expected is None:
                raise ValueError("missing maid identity")
            owner_id, maid_id = expected
            bridge_class = MaidApiBridge if config.remote else NativeMaidBridge
            self._bridge = bridge_class(
                endpoint,
                token,
                owner_id=owner_id,
                maid_id=maid_id,
                controller_id=str(uuid.uuid4()),
                http=http,
            )
            self._body = MaidBody(
                self._bridge,
                scope=Scope(
                    realm="qiandengji",
                    account=owner_id,
                    agent=maid_id,
                ),
                owner_id=owner_id,
                maid_id=maid_id,
                poll_seconds=0,
                result_poll_seconds=0,
                context_poll_seconds=0,
            )
            await self._body.spawn()
            self._tools = BodyTools(self._body)
            if config.forward_owner_dialogue:
                existing = await self._tools.inbox()
                if existing.get("is_error"):
                    raise RuntimeError("inbox_unavailable")
                # Pending messages from a previous controller remain readable without
                # firing a new turn. MaidBody deduplicates events inside this connection.
                self._previous_dialogue = {
                    row["eventId"] for row in existing["messages"]
                }
            self._connection = "ready"
            self._register_tools(config.role)
            self._maintenance = asyncio.create_task(
                self._maintain(config), name="qiandengji-neko-maid"
            )
        except (OSError, ValueError, RuntimeError, httpx.HTTPError) as error:
            self._connection = (
                "control_changed"
                if isinstance(error, ControlChanged)
                else "attach_failed"
            )
            self.logger.warning(
                f"Minecraft maid attach: {self._connection} ({type(error).__name__})"
            )
        finally:
            if self._maintenance is None:
                if self._bridge is None and http is not None:
                    await http.aclose()
                await self._detach()

    @plugin_entry(id="connect_website", name="官网授权", description="使用千灯纪账号授权一只自己的车万女仆。")
    async def connect_website(self, **_):
        config = self._config
        if config is None or not config.website:
            return Err("官网授权使用插件中的角色名设置。请先清空旧的手动 API 地址。")
        if self._website_request is not None:
            return Ok({"status": self._connection, **self._website_request.public()})
        if self._connection == "ready":
            return Ok({"status": "ready", "manage_url": config.portal_origin + "/maid-connect.html"})
        if self._connection in {"starting", "opening_website"}:
            return Err("连接正在准备，请稍候。")
        self._connection = "opening_website"
        try:
            async with self._http(config) as http:
                request = await MaidWebsite(config.portal_origin, http).start()
        except (OSError, ValueError, RuntimeError, httpx.HTTPError):
            self._connection = "login_required"
            return Err("千灯纪官网授权入口暂时不可用。")

        self._website_request = request
        self._connection = "waiting_for_website"
        self._pairing = asyncio.create_task(self._finish_website_login(config, request), name="qiandengji-website")
        try:
            await asyncio.to_thread(webbrowser.open, request.verification_url)
        except (OSError, webbrowser.Error):
            pass  # The URL and code remain visible in the entry result.
        return Ok({"status": self._connection, **request.public()})

    async def _finish_website_login(self, config, request):
        try:
            remaining = max(0, min(600, request.expires_at / 1_000 - time.time()))
            async with asyncio.timeout(remaining), self._http(config) as http:
                website = MaidWebsite(config.portal_origin, http)
                while True:
                    await asyncio.sleep(request.poll_seconds)
                    try:
                        grant = await website.check(request.token)
                    except httpx.RequestError:
                        continue
                    if grant is not None:
                        save_token(self.data_path("maid-website.key"), request.token)
                        break
            await self._attach()
        except (TimeoutError, OSError, ValueError, RuntimeError, httpx.HTTPError) as error:
            self._connection = "login_required"
            self.logger.warning(f"Minecraft maid website authorization ended ({type(error).__name__})")
        finally:
            self._pairing = None
            self._website_request = None

    def _register_tools(self, role):
        offered = {action.name for action in self._body.capabilities().native_actions}
        for tool in TOOLS:
            if not offered.issuperset(tool.requires):
                continue
            self.register_llm_tool(
                name=tool.name,
                description=tool.description,
                parameters=tool.schema(),
                handler=partial(self._dispatch, tool),
                role=role,
                timeout=75,
            )
            self._tools.available.append(tool.name)

    async def _dispatch(self, tool: Tool, **arguments):
        if self._connection != "ready" or self._bridge.stopping.is_set():
            return tool_error("BODY_CONTROLLER_UNAVAILABLE")
        expected = set(tool.properties)
        if (
            arguments.keys() - expected
            or expected - set(tool.optional) - arguments.keys()
        ):
            return tool_error("INVALID_TOOL_ARGUMENTS")
        try:
            return await getattr(self._tools, tool.handler)(**arguments)
        except ControlChanged:
            return tool_error("CONTROL_CHANGED")
        except (httpx.HTTPError, RuntimeError):
            return tool_error("BODY_OBSERVATION_UNAVAILABLE")

    async def _maintain(self, config):
        body = self._body
        queue, unsubscribe = body.events()
        try:
            await asyncio.sleep(5)
            # Upstream 1.0.7_1 re-emits tool registrations once after startup while
            # main_server is starting its role sessions.
            for meta in self._llm_tools.values():
                self._notify_llm_tool_registered(meta)
            while not self._bridge.stopping.is_set():
                try:
                    if config.forward_owner_dialogue:
                        await (
                            body.poll_once()
                        )  # Successful poll renews the server lease.
                        while not queue.empty():
                            event = queue.get_nowait()
                            if event.data.get("eventId") not in self._previous_dialogue:
                                push_dialogue(self, config.role, event, body.identity())
                    else:
                        await self._tools.status()
                except ControlChanged:
                    break
                except (httpx.HTTPError, RuntimeError) as error:
                    self.logger.warning(
                        f"Minecraft maid poll unavailable ({type(error).__name__})"
                    )
                await asyncio.sleep(3 if config.forward_owner_dialogue else 20)
            self._connection = "control_changed"
            self.logger.warning(
                "Minecraft maid lease ended. Reattach from the plugin controls after handoff."
            )
        finally:
            unsubscribe()
            await self._detach()
            if self._maintenance is asyncio.current_task():
                self._maintenance = None

    async def _detach(self):
        if self._connection == "ready":
            self._connection = "stopped"
        tools, self._tools = self._tools, None
        if tools is not None:
            for name in tools.available:
                self.unregister_llm_tool(name)
        body, self._body = self._body, None
        bridge, self._bridge = self._bridge, None
        try:
            async with asyncio.timeout(8):
                if body is not None:
                    await body.destroy()
                elif bridge is not None:
                    await bridge.close()
        except (OSError, ValueError, RuntimeError, httpx.HTTPError) as error:
            self.logger.warning(
                f"Minecraft maid release unconfirmed ({type(error).__name__})"
            )

    @plugin_entry(
        id="body_connection",
        name="千灯纪身体连接",
        description="读取已连接女仆的租约状态。",
    )
    async def body_connection(self, **_):
        state = self._connection
        if self._bridge is not None and self._bridge.stopping.is_set():
            state = "control_changed"
        result = {"status": state, "role": self._config.role if self._config else None}
        if self._config is not None and self._config.website:
            result["manage_url"] = self._config.portal_origin + "/maid-connect.html"
        if self._website_request is not None:
            result.update(self._website_request.public())
        return Ok(result)

    @lifecycle(id="shutdown")
    async def on_shutdown(self, **_):
        pairing, self._pairing = self._pairing, None
        if pairing is not None and not pairing.done():
            loop = pairing.get_loop()
            if loop is asyncio.get_running_loop():
                pairing.cancel()
                await asyncio.gather(pairing, return_exceptions=True)
            elif loop.is_running():
                loop.call_soon_threadsafe(pairing.cancel)
        task, self._maintenance = self._maintenance, None
        if task is not None:
            if task.get_loop() is asyncio.get_running_loop():
                if not task.done():
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            elif task.done() and not task.cancelled() and (error := task.exception()):
                self.logger.warning(
                    f"Minecraft maid background task stopped ({type(error).__name__})"
                )
        await self._detach()
        return Ok({"status": self._connection})
