"""Transport assembly for the existing autonomy runner and Harness Hub planner.

Configuration and the short-lived local-core token arrive on stdin, never argv.
No Minecraft login socket, model loop, password reader or second task queue.
"""
import asyncio
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import threading
import traceback
from urllib.parse import urlsplit


async def run(config):
    sys.path.insert(0, config["autonomySource"])
    from agent_mc_autonomy.bridge import MinecraftBridge
    from agent_mc_autonomy.configuration import Settings
    from agent_mc_autonomy.runner import run_session
    import httpx

    module_path = Path(config["plannerModule"])
    if hashlib.sha256(module_path.read_bytes()).hexdigest() != config["plannerSha256"]:
        raise ValueError("configured_harness_adapter_hash_mismatch")
    spec = importlib.util.spec_from_file_location("agent_mc_autonomy.hosted_hub_adapter", module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    endpoint = config["core"]["endpoint"]
    parsed = urlsplit(endpoint)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.path != "/core" or parsed.username or parsed.query or parsed.fragment:
        raise ValueError("core_transport_must_be_loopback")

    class CoreBridge(MinecraftBridge):
        def __init__(self, *args, **kwargs):
            self.tools = []
            self.http = httpx.AsyncClient(trust_env=False, follow_redirects=False,
                headers={"Authorization": "Bearer " + config["core"]["token"]})

        async def open(self):
            result = await self._request("tools")
            self.tools = result["tools"]
            if not any(tool["name"] == "mc_numen" for tool in self.tools):
                raise ValueError("selected_core_does_not_advertise_numen")

        async def _request(self, operation, *arguments, timeout=45):
            response = await self.http.post(endpoint, json={"operation": operation, "arguments": arguments}, timeout=timeout)
            if response.status_code != 200:
                raise RuntimeError("hosted_core_request_unknown_do_not_replay")
            return response.json()

        async def close(self):
            await self.http.aclose()

    raw = config["settings"]
    raw.setdefault("autonomy", {}).update(enabled=True, context_mode="compact")
    raw.setdefault("viewer", {}).update(auto_open=False)
    # Role identity remains the same between controllers. Network fields label
    # the shared core scope; CoreBridge never opens a game connection.
    raw.setdefault("server", {}).update(host=config["role"]["serverId"], username=config["role"]["name"], auth="offline", version="1.21.1")
    raw.setdefault("agent", {}).update(owner_id=config["role"]["ownerId"], id=config["role"]["roleUuid"], name=config["role"]["name"])
    settings = Settings.parse(raw)
    from agent_mc_autonomy.controller import model_tools
    if not any(tool["function"]["name"] == "mc_numen" for tool in model_tools([
        {"name": "mc_numen", "description": "Numen body", "inputSchema": {"type": "object", "properties": {}}}])):
        raise ValueError("autonomy_update_required_for_native_numen_catalog")
    planner = module.HarnessRouterPlanner(module.HarnessRouterConfig.parse(config["planner"]),
        settings.max_output_tokens, settings.model_timeout_seconds)
    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()

    def read_stop():
        line = sys.stdin.readline()
        # EOF is a parent failure; it is also a stop request.
        loop.call_soon_threadsafe(stopping.set)
    threading.Thread(target=read_stop, daemon=True).start()
    announced = False

    def publish(**status):
        nonlocal announced
        if status.get("game_connected") is True and not announced:
            announced = True
            print(json.dumps({"ready": True}), flush=True)

    task = asyncio.create_task(run_session(settings, Path(__file__), Path(config["dataRoot"]), planner,
        config["goal"], publish, stopping.is_set, bridge_factory=CoreBridge))
    waiter = asyncio.create_task(stopping.wait())
    try:
        await asyncio.wait([task, waiter], return_when=asyncio.FIRST_COMPLETED)
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=False)
    except asyncio.CancelledError:
        pass
    finally:
        waiter.cancel()
        await asyncio.gather(waiter, return_exceptions=True)


if __name__ == "__main__":
    try:
        line = sys.stdin.readline(131073)
        if len(line) > 131072:
            raise ValueError("configuration_too_large")
        asyncio.run(run(json.loads(line)))
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "frames": [Path(frame.filename).name + ":" + str(frame.lineno)
            for frame in traceback.extract_tb(error.__traceback__)[-6:]]}), flush=True)
        raise SystemExit(1)
