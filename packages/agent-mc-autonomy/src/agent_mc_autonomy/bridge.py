"""Host-neutral ownership of an MCP session and its independent Node child."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path


class MinecraftBridge:
    def __init__(self, node: str, entry: Path, config: Path, log: Path, *, node_args: tuple[str, ...] = ()):
        self.node, self.entry, self.config, self.log = node, entry, config, log
        self.node_args = node_args
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=16)
        self._owner: asyncio.Task | None = None
        self._ready: asyncio.Future | None = None
        self._error: Exception | None = None
        self.tools: list[dict] = []

    async def open(self) -> None:
        if self._owner:
            raise RuntimeError("The Minecraft transport already has an owner")
        self._ready = asyncio.get_running_loop().create_future()
        self._owner = asyncio.create_task(self._serve(), name="minecraft-autonomous-mcp")
        try:
            await asyncio.wait_for(asyncio.shield(self._ready), 45)
        except BaseException:
            await self.close()
            raise

    async def _serve(self) -> None:
        # MCP's AnyIO cancel scopes must be entered/exited by the same task.
        pending: set[asyncio.Task] = set()
        try:
            from mcp import ClientSession, StdioServerParameters
            from mcp.client.stdio import stdio_client

            self.log.parent.mkdir(parents=True, exist_ok=True)
            with self.log.open("a", encoding="utf-8") as errors:
                parameters = StdioServerParameters(command=self.node, args=[*self.node_args, str(self.entry), str(self.config)])
                async with stdio_client(parameters, errlog=errors) as (read, write), ClientSession(read, write) as session:
                    await session.initialize()
                    self.tools = [tool.model_dump(mode="json", exclude_none=True, by_alias=True) for tool in (await session.list_tools()).tools]
                    self._ready.set_result(None)
                    async def execute(operation, arguments, future):
                        try:
                            if operation == "tool":
                                response = await session.call_tool(arguments[0], arguments[1], meta=arguments[2])
                            else:
                                response = await session.read_resource(arguments[0])
                            if not future.done():
                                future.set_result(response.model_dump(mode="json", exclude_none=True, by_alias=True))
                        except Exception as error:
                            if not future.done():
                                future.set_exception(error)
                        finally:
                            if not future.done():
                                future.set_exception(RuntimeError("Minecraft request interrupted; delivery is uncertain"))

                    try:
                        while True:
                            current = await self._queue.get()
                            if current is None:
                                break
                            operation, arguments, future = current
                            if future.cancelled():
                                continue
                            if len(pending) >= 16:
                                future.set_exception(RuntimeError("Too many pending Minecraft requests"))
                                continue
                            task = asyncio.create_task(execute(operation, arguments, future))
                            pending.add(task)
                            task.add_done_callback(pending.discard)
                            # Cancelling the waiter propagates MCP cancellation; a long
                            # event wait cannot monopolize disconnect/cancel calls.
                            future.add_done_callback(lambda done, task=task: task.cancel() if done.cancelled() else None)
                    finally:
                        for task in pending:
                            task.cancel()
                        await asyncio.gather(*pending, return_exceptions=True)
        except BaseException as error:
            self._error = RuntimeError(f"Minecraft transport closed ({type(error).__name__}); inspect private backend log")
            if self._ready and not self._ready.done():
                self._ready.set_exception(self._error)
        finally:
            error = self._error or RuntimeError("Minecraft transport is stopped")
            while not self._queue.empty():
                item = self._queue.get_nowait()
                if item and not item[2].done():
                    item[2].set_exception(error)

    async def _request(self, operation: str, *arguments, timeout: float = 45) -> dict:
        if not self._owner or self._owner.done():
            raise self._error or RuntimeError("Minecraft transport is not running")
        future = asyncio.get_running_loop().create_future()
        self._queue.put_nowait((operation, arguments, future))
        try:
            return await asyncio.wait_for(future, timeout)
        except TimeoutError as error:
            # Submission may already have reached the server. Never retry an action.
            raise RuntimeError("Minecraft request timed out; delivery is uncertain. Stop and inspect receipts before retrying.") from error

    async def call(self, name: str, arguments: dict, *, timeout: float = 45,
                   request_id: str | None = None, turn_id: str | None = None) -> dict:
        if name not in {tool["name"] for tool in self.tools}:
            raise ValueError("Unknown Minecraft tool; discover the actual tool catalogue first")
        control = {key: value for key, value in (("requestId", request_id), ("turnId", turn_id)) if value is not None}
        return await self._request("tool", name, arguments, {"agent-mc/v1": control} if control else None, timeout=timeout)

    async def resource(self, uri: str) -> dict:
        return await self._request("resource", uri)

    async def close(self) -> None:
        owner, self._owner = self._owner, None
        if not owner:
            return
        try:
            if not owner.done():
                try:
                    self._queue.put_nowait(None)
                except asyncio.QueueFull:
                    owner.cancel()
                await asyncio.wait({owner}, timeout=5)
        finally:
            if not owner.done():
                owner.cancel()
            await asyncio.gather(owner, return_exceptions=True)


def text_content(result: dict) -> str:
    return "\n".join(part.get("text", "") for part in result.get("content", result.get("contents", [])) if "text" in part)


def json_content(result: dict) -> dict:
    if result.get("isError"):
        raise RuntimeError(text_content(result))
    value = json.loads(text_content(result))
    if not isinstance(value, dict):
        raise ValueError("Expected a structured Minecraft receipt")
    return value


def outcome(result: dict) -> dict:
    """Retain v1 control/execution/events; readable text need not be JSON."""
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        if structured.get("protocol") != "agent-mc/v1":
            raise ValueError("Unsupported Minecraft protocol receipt")
        return {**structured, "failed": result.get("isError", False) or structured.get("failed", False)}
    return {"text": text_content(result), "failed": result.get("isError", False), "control": None, "execution": None, "events": []}
